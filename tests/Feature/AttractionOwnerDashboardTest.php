<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\BusinessDetail;
use App\Models\BusinessEngagementEvent;
use App\Models\Favorite;
use App\Models\Municipality;
use App\Models\Review;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Tourist attraction owner dashboard (2026-11-24): views, saves, reviews,
 * gallery and the visitor-information checklist; never orders or revenue.
 */
class AttractionOwnerDashboardTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Business $river;

    protected function setUp(): void
    {
        parent::setUp();
        $town = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $this->owner = User::create(['email' => 'owner@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->river = Business::create([
            'owner_id' => $this->owner->id,
            // The production name ("Attractions") must work like "Tourist Attraction".
            'business_category_id' => BusinessCategory::firstOrCreate(['name' => 'Tourist Attraction'])->id,
            'municipality_id' => $town->id,
            'business_name' => 'Batong Buwaya River',
            'business_description' => 'short',
            'status' => 'approved',
            'latitude' => 12.8,
            'longitude' => 121.4,
        ]);
    }

    private function dashboard(?User $as = null)
    {
        return $this->actingAs($as ?? $this->owner, 'sanctum')->getJson("/api/business-owner/dashboard/attraction/{$this->river->id}");
    }

    public function test_views_saves_reviews_and_gallery_for_the_last_30_days(): void
    {
        $today = now('Asia/Manila');
        foreach ([0, 0, 3, 40] as $i => $daysAgo) {
            BusinessEngagementEvent::create(['business_id' => $this->river->id, 'type' => BusinessEngagementEvent::TYPE_PROFILE_VIEW, 'viewer_key' => "v{$i}", 'viewed_on' => $today->copy()->subDays($daysAgo)->toDateString(), 'created_at' => now()]);
        }
        $tourist = User::create(['email' => 't@example.com', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        Favorite::create(['user_id' => $tourist->id, 'favoritable_type' => Business::class, 'favoritable_id' => $this->river->id]);
        Review::create(['business_id' => $this->river->id, 'user_id' => $tourist->id, 'rating' => 4, 'review' => 'Cool water', 'status' => 'pending']);
        Review::create(['business_id' => $this->river->id, 'user_id' => $tourist->id, 'rating' => 1, 'review' => 'spam', 'status' => 'rejected']);
        DB::table('business_media')->insert([
            ['business_id' => $this->river->id, 'type' => 'Gallery', 'status' => 'published', 'visibility' => 'public', 'file_path' => 'g/a.jpg', 'sort_order' => 2, 'featured' => false, 'created_at' => now(), 'updated_at' => now()],
            ['business_id' => $this->river->id, 'type' => 'Gallery', 'status' => 'published', 'visibility' => 'public', 'file_path' => 'g/hero.jpg', 'sort_order' => 1, 'featured' => true, 'created_at' => now(), 'updated_at' => now()],
            ['business_id' => $this->river->id, 'type' => 'Gallery', 'status' => 'published', 'visibility' => 'public', 'file_path' => 'g/clip.mp4', 'sort_order' => 3, 'featured' => false, 'created_at' => now(), 'updated_at' => now()],
        ]);

        $data = $this->dashboard()->assertOk()->json('data');

        $this->assertSame(3, $data['views']['last_30_days']);
        $this->assertSame(1, $data['views']['previous_30_days']);
        $this->assertCount(30, $data['views']['daily']);
        $this->assertSame(2, end($data['views']['daily'])['views']); // today
        $this->assertSame(['total' => 1, 'last_30_days' => 1], $data['saves']);
        $this->assertSame(1, $data['reviews']['count']); // the rejected one is hidden
        $this->assertSame('Cool water', $data['reviews']['latest'][0]['review']);
        $this->assertArrayNotHasKey('email', $data['reviews']['latest'][0]['user'] ?? []);
        $this->assertSame(['photos' => 2, 'videos' => 1], $data['gallery']);
        $this->assertSame('g/hero.jpg', $data['business']['photo']);
        $this->assertSame('Always open', $data['business']['open_status']['label']);
        $this->assertArrayNotHasKey('total_revenue', $data);
    }

    public function test_the_checklist_shows_what_visitors_still_miss(): void
    {
        BusinessDetail::create(['business_id' => $this->river->id, 'field_name' => 'entrance_fee', 'field_value' => '0']);
        BusinessDetail::create(['business_id' => $this->river->id, 'field_name' => 'attraction_type', 'field_value' => 'River']);

        $checklist = collect($this->dashboard()->assertOk()->json('data.checklist'))->pluck('done', 'key');

        $this->assertTrue($checklist['entrance_fee']); // "0" (free) counts as filled in
        $this->assertTrue($checklist['attraction_type']);
        $this->assertTrue($checklist['location']);
        $this->assertFalse($checklist['description']); // too short
        $this->assertFalse($checklist['photos']);
        $this->assertFalse($checklist['activities']);
        $this->assertFalse($checklist['contact']);
    }

    public function test_only_the_owner_sees_it(): void
    {
        $other = User::create(['email' => 'other@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->dashboard($other)->assertForbidden();
    }
}
