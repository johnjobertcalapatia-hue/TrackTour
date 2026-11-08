<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\BusinessMedia;
use App\Models\Municipality;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * GET /api/municipalities/{id}/photos — photos for the tourist sidebar card,
 * Home hero carousel and getaway card.
 */
class MunicipalityPhotosTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::create(['email' => 'owner@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
    }

    private function business(Municipality $m, string $name, string $category, array $overrides = []): Business
    {
        return Business::create(array_merge([
            'owner_id' => $this->owner->id,
            'business_category_id' => BusinessCategory::firstOrCreate(['name' => $category])->id,
            'municipality_id' => $m->id,
            'business_name' => $name,
            'status' => 'approved',
        ], $overrides));
    }

    public function test_orders_cover_then_attractions_then_businesses_and_stays_in_the_municipality(): void
    {
        $gloria = Municipality::create(['name' => 'Gloria', 'district' => '2', 'province' => 'Oriental Mindoro', 'cover_photo' => 'municipalities/gloria.jpg']);
        $bansud = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);

        $falls = $this->business($gloria, 'Gloria Falls', 'Tourist Attraction');
        BusinessMedia::create(['business_id' => $falls->id, 'type' => 'Gallery', 'file_path' => 'media/falls.jpg', 'sort_order' => 1]);
        $this->business($gloria, 'Gloria Resort', 'Resort', ['cover_photo' => 'covers/resort.jpg']);
        $this->business($gloria, 'No Photo Eatery', 'Restaurant');
        $this->business($gloria, 'Pending Resort', 'Resort', ['status' => 'pending', 'cover_photo' => 'covers/pending.jpg']);
        $this->business($bansud, 'Bansud Resort', 'Resort', ['cover_photo' => 'covers/bansud.jpg']);

        $photos = $this->getJson("/api/municipalities/{$gloria->id}/photos")->assertOk()->json('data');

        $this->assertSame(['Gloria', 'Gloria Falls', 'Gloria Resort'], array_column($photos, 'caption'));
        $this->assertSame(['municipality', 'attraction', 'business'], array_column($photos, 'kind'));
        $this->assertStringEndsWith('/storage/municipalities/gloria.jpg', $photos[0]['src']);
        $this->assertStringEndsWith('/storage/media/falls.jpg', $photos[1]['src']);
    }

    public function test_empty_when_the_municipality_has_no_photos(): void
    {
        $roxas = Municipality::create(['name' => 'Roxas', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $this->business($roxas, 'No Photo Eatery', 'Restaurant');

        $this->getJson("/api/municipalities/{$roxas->id}/photos")->assertOk()->assertExactJson([
            'success' => true, 'message' => 'Municipality photos retrieved.', 'data' => [],
        ]);
    }

    public function test_unknown_municipality_is_404(): void
    {
        $this->getJson('/api/municipalities/999/photos')->assertNotFound();
    }
}
