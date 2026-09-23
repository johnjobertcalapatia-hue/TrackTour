<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\TourismCategory;
use App\Models\TouristDestination;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Public landing card feed (GET /api/landing/cards).
 *
 * The landing filter tabs (All / Tourist Spots / Food / Businesses / Resorts)
 * render these rows directly, so the feed must reflect live database state:
 * only active destinations and approved businesses, each classified into the
 * tabs it belongs to.
 */
class LandingCardsTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private Municipality $municipality;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner@example.com',
            'password' => 'secret-password',
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '2nd',
            'province' => 'Oriental Mindoro',
        ]);
    }

    private function makeDestination(string $name, array $overrides = []): TouristDestination
    {
        $category = TourismCategory::firstOrCreate(
            ['slug' => 'beach'],
            ['name' => 'Beach']
        );

        return TouristDestination::create(array_merge([
            'municipality_id' => $this->municipality->id,
            'category_id' => $category->id,
            'name' => $name,
            'slug' => Str::slug($name).'-'.uniqid(),
            'status' => 'active',
        ], $overrides));
    }

    private function makeBusiness(string $categoryName, array $overrides = []): Business
    {
        $category = BusinessCategory::firstOrCreate(['name' => $categoryName]);

        return Business::create(array_merge([
            'owner_id' => $this->owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $this->municipality->id,
            'business_name' => $categoryName.' Store',
            'status' => 'approved',
            'latitude' => 12.3456789,
            'longitude' => 122.3456789,
        ], $overrides));
    }

    private function titles(array $cards): array
    {
        return array_column($cards, 'title');
    }

    public function test_guest_can_fetch_landing_cards_without_authentication(): void
    {
        $this->makeDestination('White Beach');

        $response = $this->getJson('/api/landing/cards');

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonStructure(['success', 'message', 'data']);
    }

    public function test_cards_include_active_destinations_and_exclude_inactive_ones(): void
    {
        $this->makeDestination('White Beach');
        $this->makeDestination('Hidden Beach', ['status' => 'inactive']);

        $cards = $this->getJson('/api/landing/cards')->json('data');

        $this->assertContains('White Beach', $this->titles($cards));
        $this->assertNotContains('Hidden Beach', $this->titles($cards));
    }

    public function test_cards_include_approved_businesses_and_exclude_unapproved_ones(): void
    {
        $this->makeBusiness('Restaurant');
        $this->makeBusiness('Restaurant', [
            'business_name' => 'Pending Restaurant',
            'status' => 'pending',
        ]);

        $titles = $this->titles($this->getJson('/api/landing/cards')->json('data'));

        $this->assertContains('Restaurant Store', $titles);
        $this->assertNotContains('Pending Restaurant', $titles);
    }

    public function test_cards_carry_the_fields_the_landing_card_renders(): void
    {
        $this->makeDestination('White Beach');

        $card = collect($this->getJson('/api/landing/cards')->json('data'))
            ->firstWhere('title', 'White Beach');

        $this->assertStringStartsWith('spot-', $card['key']);
        $this->assertSame(['spot'], $card['types']);
        $this->assertSame('Bansud', $card['location']);
        $this->assertSame('Beach', $card['category']);
        $this->assertNull($card['rating']);
        $this->assertArrayHasKey('image', $card);
    }

    public function test_businesses_are_classified_into_the_filter_tabs(): void
    {
        $this->makeBusiness('Restaurant');
        $this->makeBusiness('Resort');
        $this->makeBusiness('Tourist Attraction');
        $this->makeBusiness('Souvenir Shop');
        $this->makeBusiness('Hotel & Restaurant Combination', ['business_name' => 'Seaside Inn']);

        $cards = collect($this->getJson('/api/landing/cards')->json('data'));
        $typesByTitle = $cards->pluck('types', 'title');

        $this->assertSame(['food'], $typesByTitle['Restaurant Store']);
        $this->assertSame(['resort'], $typesByTitle['Resort Store']);
        $this->assertSame(['spot'], $typesByTitle['Tourist Attraction Store']);
        $this->assertSame(['business'], $typesByTitle['Souvenir Shop Store']);
        $this->assertEqualsCanonicalizing(['food', 'resort'], $typesByTitle['Seaside Inn']);
    }

    public function test_destination_category_badge_uses_the_attraction_type_detail(): void
    {
        $business = $this->makeBusiness('Tourist Attraction', ['business_name' => 'Apo Reef']);
        $business->details()->create(['field_name' => 'attraction_type', 'field_value' => 'Diving']);

        $card = collect($this->getJson('/api/landing/cards')->json('data'))
            ->firstWhere('title', 'Apo Reef');

        $this->assertSame('Diving', $card['category']);
    }

    public function test_rating_is_null_until_reviews_lift_the_average(): void
    {
        $this->makeBusiness('Restaurant', ['business_name' => 'Rated Restaurant', 'average_rating' => 0]);
        $this->makeBusiness('Restaurant', ['business_name' => 'Loved Restaurant', 'average_rating' => 4.8]);

        $ratings = collect($this->getJson('/api/landing/cards')->json('data'))->pluck('rating', 'title');

        $this->assertNull($ratings['Rated Restaurant']);
        $this->assertSame(4.8, $ratings['Loved Restaurant']);
    }

    public function test_cards_limit_is_respected_and_bounded(): void
    {
        foreach (range(1, 5) as $i) {
            $this->makeDestination('Spot '.$i);
        }

        $this->assertCount(2, $this->getJson('/api/landing/cards?limit=2')->json('data'));
        $this->assertCount(5, $this->getJson('/api/landing/cards?limit=0')->json('data'));
    }
}
