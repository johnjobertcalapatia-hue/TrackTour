<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Promotion;
use App\Models\Review;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * GET /api/tourist/stays — Stays & Deals browse page.
 */
class TouristStaysTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Municipality $bansud;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);
        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => '1st', 'province' => 'Oriental Mindoro']);
    }

    private function business(string $name, string $category, array $overrides = []): Business
    {
        $cat = BusinessCategory::firstOrCreate(['name' => $category]);

        return Business::create(array_merge([
            'owner_id' => $this->owner->id,
            'business_category_id' => $cat->id,
            'municipality_id' => $this->bansud->id,
            'business_name' => $name,
            'status' => 'approved',
        ], $overrides));
    }

    private function promo(Business $business, string $name, array $overrides = []): Promotion
    {
        return Promotion::create(array_merge([
            'business_id' => $business->id,
            'name' => $name,
            'type' => 'percentage',
            'value' => 20,
            'is_active' => true,
            'start_date' => now()->subDay(),
            'end_date' => now()->addWeek(),
        ], $overrides));
    }

    public function test_lists_all_approved_accommodations_flagging_bookability(): void
    {
        $resort = $this->business('Bansud Bay Resort', 'Resort', ['accepts_reservation' => true]);
        $this->business('Hilltop Homestay', 'Homestay', ['accepts_reservation' => false]);
        $this->business('Pending Hotel', 'Hotel', ['status' => 'pending']);
        $this->business('Ekslusibo Grill', 'Restaurant');

        $response = $this->getJson('/api/tourist/stays')->assertOk();

        $names = collect($response->json('data.accommodations'))->pluck('name')->all();
        $this->assertEqualsCanonicalizing(['Bansud Bay Resort', 'Hilltop Homestay'], $names);
        $byName = collect($response->json('data.accommodations'))->keyBy('name');
        $this->assertTrue($byName['Bansud Bay Resort']['accepts_reservation']);
        $this->assertFalse($byName['Hilltop Homestay']['accepts_reservation']);
        $this->assertSame('Resort', $byName['Bansud Bay Resort']['category']);
        $this->assertSame('Bansud', $byName['Bansud Bay Resort']['municipality']);
        $this->assertSame(2, $response->json('data.meta.total'));
        $this->assertEqualsCanonicalizing(['Homestay', 'Resort'], $response->json('data.types'));
        $this->assertNotContains('Hotel', $response->json('data.types'), 'types only lists categories with approved listings');
        $this->assertNotNull($resort);
    }

    public function test_search_and_type_filter(): void
    {
        $this->business('Bansud Bay Resort', 'Resort');
        $this->business('Seaside Hotel', 'Hotel');

        $search = collect($this->getJson('/api/tourist/stays?search=seaside')->json('data.accommodations'))->pluck('name')->all();
        $this->assertSame(['Seaside Hotel'], $search);

        $type = collect($this->getJson('/api/tourist/stays?type=Resort')->json('data.accommodations'))->pluck('name')->all();
        $this->assertSame(['Bansud Bay Resort'], $type);
    }

    public function test_rating_is_null_without_reviews_and_real_otherwise(): void
    {
        $rated = $this->business('Rated Resort', 'Resort');
        $this->business('New Resort', 'Resort');
        $reviewer = User::create(['email' => 'r@example.com', 'password' => Hash::make('Password123!'), 'role' => 'tourist', 'account_status' => 'approved']);
        Review::create(['business_id' => $rated->id, 'user_id' => $reviewer->id, 'rating' => 5, 'review' => 'a', 'status' => 'approved']);
        Review::create(['business_id' => $rated->id, 'user_id' => $reviewer->id, 'rating' => 4, 'review' => 'b', 'status' => 'approved']);
        Review::create(['business_id' => $rated->id, 'user_id' => $reviewer->id, 'rating' => 1, 'review' => 'c', 'status' => 'pending']);

        $byName = collect($this->getJson('/api/tourist/stays')->json('data.accommodations'))->keyBy('name');

        $this->assertEquals(4.5, $byName['Rated Resort']['rating']);
        $this->assertSame(2, $byName['Rated Resort']['reviews_count']);
        $this->assertNull($byName['New Resort']['rating']);
        // Popular sort puts the reviewed listing first.
        $this->assertSame('Rated Resort', $this->getJson('/api/tourist/stays')->json('data.accommodations.0.name'));
    }

    public function test_promotions_only_from_active_resort_and_attraction_deals(): void
    {
        $resort = $this->business('Bansud Bay Resort', 'Resort');
        $falls = $this->business('Tigbao Falls', 'Tourist Attraction');
        $restaurant = $this->business('Ekslusibo Grill', 'Restaurant');
        $pendingResort = $this->business('Pending Resort', 'Resort', ['status' => 'pending']);

        $this->promo($resort, 'Weekend Stay 20% Off', ['code' => 'STAY20']);
        $this->promo($falls, 'Free Guided Tour', ['type' => 'fixed', 'value' => 100]);
        $this->promo($restaurant, 'Meal Deal');
        $this->promo($pendingResort, 'Hidden Deal');
        $this->promo($resort, 'Expired Deal', ['end_date' => now()->subDay()]);
        $this->promo($resort, 'Switched Off', ['is_active' => false]);

        $promos = collect($this->getJson('/api/tourist/stays')->assertOk()->json('data.promotions'));

        $this->assertEqualsCanonicalizing(['Weekend Stay 20% Off', 'Free Guided Tour'], $promos->pluck('name')->all());
        $byName = $promos->keyBy('name');
        $this->assertSame('stay', $byName['Weekend Stay 20% Off']['business']['kind']);
        $this->assertSame('attraction', $byName['Free Guided Tour']['business']['kind']);
        $this->assertSame('STAY20', $byName['Weekend Stay 20% Off']['code']);
        $this->assertEquals(20.0, $byName['Weekend Stay 20% Off']['value']);
        $this->assertSame($resort->id, $byName['Weekend Stay 20% Off']['business']['id']);
    }

    public function test_rejects_unknown_sort(): void
    {
        $this->getJson('/api/tourist/stays?sort=drop_table')->assertUnprocessable();
    }
}
