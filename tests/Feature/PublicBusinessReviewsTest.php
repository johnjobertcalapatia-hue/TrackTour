<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Review;
use App\Models\User;
use App\Models\UserProfile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Business reviews on public pages (2026-11-24). Reviews are saved "pending"
 * and nothing approves them, so "approved only" hid every review from the
 * landing page and the map panels. They are shown unless rejected, and only
 * as a public card (first name + initial, never email or phone).
 */
class PublicBusinessReviewsTest extends TestCase
{
    use RefreshDatabase;

    private Business $grill;

    private User $tourist;

    protected function setUp(): void
    {
        parent::setUp();
        $town = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $owner = User::create(['email' => 'owner@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->grill = Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => BusinessCategory::firstOrCreate(['name' => 'Restaurant'])->id,
            'municipality_id' => $town->id,
            'business_name' => 'Ekslusibo Grill',
            'status' => 'approved',
            'latitude' => 12.86,
            'longitude' => 121.45,
        ]);
        $this->tourist = User::create(['name' => 'jayvie', 'email' => 'jayvie.private@example.com', 'password' => Hash::make('Password123!'), 'role' => 'tourist', 'account_status' => 'approved']);
        UserProfile::create(['user_id' => $this->tourist->id, 'first_name' => 'Jayvie', 'last_name' => 'De Torres', 'mobile_number' => '09170001111']);
    }

    private function review(int $rating, string $status, string $text): Review
    {
        return Review::create(['business_id' => $this->grill->id, 'user_id' => $this->tourist->id, 'rating' => $rating, 'review' => $text, 'status' => $status]);
    }

    public function test_a_new_pending_review_is_shown_with_a_public_card_only(): void
    {
        $this->review(5, 'pending', 'Sobrang sarap');

        $res = $this->getJson("/api/tourist/explore/{$this->grill->id}/reviews")->assertOk();
        $res->assertJsonPath('data.count', 1)
            ->assertJsonPath('data.average', 5)
            ->assertJsonPath('data.reviews.0.user_name', 'Jayvie D.')
            ->assertJsonPath('data.reviews.0.review', 'Sobrang sarap')
            ->assertJsonPath('data.reviews.0.comment', 'Sobrang sarap');
        $this->assertStringNotContainsString('jayvie.private@example.com', $res->getContent());
        $this->assertStringNotContainsString('09170001111', $res->getContent());

        // The business page (landing place page) lists it the same way, without the account.
        $show = $this->getJson("/api/tourist/explore/{$this->grill->id}")->assertOk();
        $this->assertSame('Jayvie D.', $show->json('reviews.0.user_name') ?? $show->json('data.reviews.0.user_name'));
        $this->assertStringNotContainsString('jayvie.private@example.com', $show->getContent());
    }

    public function test_rejected_reviews_are_neither_listed_nor_counted(): void
    {
        $this->review(5, 'approved', 'Great');
        $this->review(1, 'rejected', 'Spam');

        $res = $this->getJson("/api/tourist/explore/{$this->grill->id}/reviews")->assertOk();
        $res->assertJsonPath('data.count', 1)->assertJsonPath('data.average', 5);
        $this->assertSame(['Great'], collect($res->json('data.reviews'))->pluck('review')->all());
        // The stored numbers the cards read follow the same rule.
        $this->assertSame(1, $this->grill->fresh()->review_count);
        $this->assertEquals(5.0, $this->grill->fresh()->average_rating);
    }

    public function test_the_map_counts_pending_reviews(): void
    {
        $this->review(4, 'pending', 'Nice');

        $places = collect($this->getJson('/api/tourist/explore/map')->assertOk()->json('data.businesses') ?? $this->getJson('/api/tourist/explore/map')->json('businesses'));
        $grill = $places->firstWhere('id', $this->grill->id);
        $this->assertNotNull($grill);
        $this->assertSame(1, (int) ($grill['reviews_count'] ?? $grill['review_count']));
    }

    public function test_review_averages_reach_the_api_as_numbers_not_strings(): void
    {
        // MySQL returns withAvg() as "5.0000"; the browser called .toFixed() on it (2026-11-24).
        $business = new Business;
        $business->setRawAttributes(['reviews_avg_rating' => '4.5000', 'reviews_count' => '2']);
        $this->assertSame(4.5, $business->reviews_avg_rating);
        $this->assertSame(2, $business->reviews_count);
        $this->assertSame(4.5, $business->toArray()['reviews_avg_rating']);
    }

    public function test_an_unapproved_business_has_no_public_reviews(): void
    {
        $this->grill->update(['status' => 'pending']);
        $this->getJson("/api/tourist/explore/{$this->grill->id}/reviews")->assertNotFound();
    }
}
