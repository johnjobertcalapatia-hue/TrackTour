<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\TouristDestination;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Phase 2 — ride pickup/destination selection contract.
 *
 * Pins the local-registry search + reverse-geocode endpoints that back the
 * Pickup/Destination pickers:
 *   - search sources = active destinations, approved restaurant/accommodation
 *     businesses (with coordinates), municipalities, barangays (fall back to
 *     their municipality coords); results carry {id, type, name, address, lat, lng}.
 *   - unapproved businesses and inactive destinations are never returned.
 *   - reverse-geocode resolves the nearest registered place within 2 km, else
 *     the documented 'Picked location' fallback.
 *   - both endpoints are tourist-authenticated read-only lookups.
 */
class TouristTransportLocationContractTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;
    private User $owner;
    private Municipality $municipality;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tourist = User::create([
            'name' => 'Location Tourist',
            'email' => 'location-tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->owner = User::create([
            'name' => 'Location Owner',
            'email' => 'location-owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->municipality = Municipality::firstOrCreate(
            ['name' => 'Bansud'],
            [
                'district' => '1st',
                'province' => 'Oriental Mindoro',
                'latitude' => 12.5,
                'longitude' => 121.3,
            ]
        );

        $restaurantCategory = BusinessCategory::firstOrCreate(['name' => 'Restaurant']);
        $hotelCategory = BusinessCategory::firstOrCreate(['name' => 'Hotel']);

        Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $restaurantCategory->id,
            'municipality_id' => $this->municipality->id,
            'business_name' => 'Bansud Bay Restaurant',
            'status' => 'approved',
            'force_closed' => false,
            'latitude' => 12.51,
            'longitude' => 121.31,
        ]);

        Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $hotelCategory->id,
            'municipality_id' => $this->municipality->id,
            'business_name' => 'Beachfront Hotel and Resort',
            'status' => 'approved',
            'force_closed' => false,
            'latitude' => 12.52,
            'longitude' => 121.32,
        ]);

        Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $restaurantCategory->id,
            'municipality_id' => $this->municipality->id,
            'business_name' => 'Hidden Unapproved Diner',
            'status' => 'pending',
            'force_closed' => false,
            'latitude' => 12.6,
            'longitude' => 121.4,
        ]);

        TouristDestination::create([
            'municipality_id' => $this->municipality->id,
            'name' => 'Bansud Beach Cove',
            'slug' => 'bansud-beach-cove',
            'address' => 'Sitio Baywalk, Bansud',
            'latitude' => 12.55,
            'longitude' => 121.35,
            'status' => 'active',
        ]);

        TouristDestination::create([
            'municipality_id' => $this->municipality->id,
            'name' => 'Hidden Inactive Falls',
            'slug' => 'hidden-inactive-falls',
            'address' => 'Bansud',
            'latitude' => 12.65,
            'longitude' => 121.45,
            'status' => 'inactive',
        ]);

        Barangay::create([
            'municipality_id' => $this->municipality->id,
            'name' => 'Poblacion',
        ]);
    }

    // ---------- helpers ----------

    private function authHeaders(User $user): array
    {
        $token = $user->createToken('test-token')->plainTextToken;

        return [
            'Authorization' => "Bearer {$token}",
            'Accept' => 'application/json',
        ];
    }

    private function searchJson(string $q)
    {
        return $this->getJson('/api/tourist/transport/locations/search?q='.urlencode($q), $this->authHeaders($this->tourist));
    }

    // ---------- search ----------

    public function test_search_returns_active_destinations_as_attractions(): void
    {
        $response = $this->searchJson('Beach Cove');

        $response->assertOk();
        $names = collect($response->json('data'))->pluck('name');
        $this->assertTrue($names->contains('Bansud Beach Cove'));
        $result = collect($response->json('data'))->firstWhere('name', 'Bansud Beach Cove');
        $this->assertSame('attraction', $result['type']);
        $this->assertSame(12.55, (float) $result['lat']);
        $this->assertSame(121.35, (float) $result['lng']);
        $this->assertStringContainsString('Sitio Baywalk', $result['address']);
    }

    public function test_search_returns_approved_restaurant_businesses_only(): void
    {
        $response = $this->searchJson('Bay');

        $data = $response->json('data');
        $names = collect($data)->pluck('name');

        $this->assertTrue($names->contains('Bansud Bay Restaurant'));
        $this->assertTrue($names->doesntContain('Hidden Unapproved Diner'));

        $restaurant = collect($data)->firstWhere('name', 'Bansud Bay Restaurant');
        $this->assertSame('restaurant', $restaurant['type']);
        $this->assertSame(12.51, (float) $restaurant['lat']);
        $this->assertSame(121.31, (float) $restaurant['lng']);
    }

    public function test_search_returns_accommodation_businesses_as_stay(): void
    {
        $response = $this->searchJson('Hotel');

        $data = $response->json('data');
        $hotel = collect($data)->firstWhere('name', 'Beachfront Hotel and Resort');

        $this->assertNotNull($hotel, 'approved accommodation expected in results');
        $this->assertSame('stay', $hotel['type']);
    }

    public function test_search_returns_municipality_and_barangay_with_coordinates(): void
    {
        $response = $this->searchJson('Bansud');

        $data = $response->json('data');
        $municipality = collect($data)->firstWhere('type', 'municipality');
        $barangay = collect($data)->firstWhere('type', 'barangay');

        $this->assertNotNull($municipality, 'municipality result expected');
        $this->assertSame('Bansud', $municipality['name']);
        $this->assertSame(12.5, (float) $municipality['lat']);
        $this->assertSame(121.3, (float) $municipality['lng']);

        $this->assertNotNull($barangay, 'barangay result expected');
        $this->assertSame('Poblacion', $barangay['name']);
        $this->assertSame(12.5, (float) $barangay['lat']);
        $this->assertSame(121.3, (float) $barangay['lng']);
    }

    public function test_search_empty_query_returns_empty_list(): void
    {
        $this->searchJson('')
            ->assertOk()
            ->assertJsonPath('data', []);
    }

    public function test_search_requires_authentication(): void
    {
        $this->getJson('/api/tourist/transport/locations/search?q=Bansud')
            ->assertUnauthorized();
    }

    // ---------- reverse-geocode ----------

    public function test_reverse_geocode_resolves_nearest_registered_place_within_radius(): void
    {
        // Exactly on the destination => nearest is the destination itself.
        $response = $this->getJson('/api/tourist/transport/locations/reverse-geocode?lat=12.55&lng=121.35', $this->authHeaders($this->tourist));

        $response->assertOk()
            ->assertJsonPath('data.name', 'Bansud Beach Cove')
            ->assertJsonPath('data.type', 'attraction');
    }

    public function test_reverse_geocode_falls_back_to_picked_location_far_from_registry(): void
    {
        $response = $this->getJson('/api/tourist/transport/locations/reverse-geocode?lat=14.6&lng=121.9', $this->authHeaders($this->tourist));

        $response->assertOk()
            ->assertJsonPath('data.type', 'custom')
            ->assertJsonPath('data.name', 'Picked location')
            ->assertJsonPath('data.lat', 14.6)
            ->assertJsonPath('data.lng', 121.9);
    }

    public function test_reverse_geocode_rejects_invalid_coordinates(): void
    {
        $this->getJson('/api/tourist/transport/locations/reverse-geocode?lat=999&lng=121.3', $this->authHeaders($this->tourist))
            ->assertUnprocessable();
    }
}