<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\BusinessDetail;
use App\Models\Municipality;
use App\Models\TourismCategory;
use App\Models\TouristDestination;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class TouristDestinationTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private Municipality $municipality;
    private BusinessCategory $spotCategory;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'spot-owner@example.com',
            'password' => 'secret-password',
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '2nd',
            'province' => 'Oriental Mindoro',
        ]);

        $this->spotCategory = BusinessCategory::create([
            'name' => 'Tourist Attraction',
        ]);
    }

    private function makeDestination(string $name, array $overrides = []): TouristDestination
    {
        $category = TourismCategory::firstOrCreate(
            ['slug' => 'eco-park'],
            ['name' => 'Eco Park']
        );

        return TouristDestination::create(array_merge([
            'municipality_id' => $this->municipality->id,
            'category_id' => $category->id,
            'name' => $name,
            'slug' => Str::slug($name).'-'.uniqid(),
            'status' => 'active',
        ], $overrides));
    }

    private function makeAttraction(string $name, array $overrides = []): Business
    {
        return Business::create(array_merge([
            'owner_id' => $this->owner->id,
            'business_category_id' => $this->spotCategory->id,
            'municipality_id' => $this->municipality->id,
            'business_name' => $name,
            'status' => 'approved',
            'latitude' => 12.3456789,
            'longitude' => 121.3456789,
        ], $overrides));
    }

    public function test_destinations_index_succeeds_when_empty(): void
    {
        $response = $this->getJson('/api/tourist/destinations');

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.data', []);
    }

    public function test_destinations_index_returns_legacy_destinations(): void
    {
        $this->makeDestination('Bansud Viewpoint');

        $response = $this->getJson('/api/tourist/destinations');

        $response->assertOk()
            ->assertJsonPath('success', true);

        $items = $response->json('data.data');
        $this->assertCount(1, $items);
        $this->assertSame('Bansud Viewpoint', $items[0]['name']);
    }

    /**
     * Regression test: An approved attraction with NO details, or missing
     * attraction_type / activities / entrance_fee, must NOT throw an
     * ErrorException (Undefined array key) under PHP 8.4 in index().
     */
    public function test_destinations_index_includes_attractions_without_crashing_on_missing_details(): void
    {
        // 1. Attraction with NO details
        $this->makeAttraction('Bare Attraction');

        // 2. Attraction with only entrance_fee detail (missing attraction_type and activities)
        $partial = $this->makeAttraction('Partial Attraction');
        BusinessDetail::create([
            'business_id' => $partial->id,
            'field_name' => 'entrance_fee',
            'field_value' => '75.50',
        ]);

        // 3. Attraction with all details
        $full = $this->makeAttraction('Full Attraction');
        BusinessDetail::create([
            'business_id' => $full->id,
            'field_name' => 'attraction_type',
            'field_value' => 'Waterfalls',
        ]);
        BusinessDetail::create([
            'business_id' => $full->id,
            'field_name' => 'activities',
            'field_value' => 'Swimming, Trekking',
        ]);
        BusinessDetail::create([
            'business_id' => $full->id,
            'field_name' => 'entrance_fee',
            'field_value' => '50.00',
        ]);

        $response = $this->getJson('/api/tourist/destinations');

        $response->assertOk()
            ->assertJsonPath('success', true);

        $data = collect($response->json('data.data'))->keyBy('name');

        // Bare attraction checks
        $this->assertTrue($data->has('Bare Attraction'));
        $bare = $data->get('Bare Attraction');
        $this->assertEquals(0, $bare['entrance_fee']);
        $this->assertSame([], $bare['amenities']);
        $this->assertSame('Tourist Attraction', $bare['category']['name']);
        $this->assertSame('tourist-attraction', $bare['category']['slug']);

        // Partial attraction checks
        $this->assertTrue($data->has('Partial Attraction'));
        $part = $data->get('Partial Attraction');
        $this->assertEquals(75.50, $part['entrance_fee']);
        $this->assertSame([], $part['amenities']);
        $this->assertSame('Tourist Attraction', $part['category']['name']);

        // Full attraction checks
        $this->assertTrue($data->has('Full Attraction'));
        $f = $data->get('Full Attraction');
        $this->assertEquals(50.0, $f['entrance_fee']);
        $this->assertSame(['Swimming, Trekking'], $f['amenities']);
        $this->assertSame('Waterfalls', $f['category']['name']);
        $this->assertSame('waterfalls', $f['category']['slug']);
    }

    public function test_destinations_show_returns_legacy_destination(): void
    {
        $dest = $this->makeDestination('Legacy Spot');

        $response = $this->getJson("/api/tourist/destinations/{$dest->id}");

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.id', $dest->id)
            ->assertJsonPath('data.name', 'Legacy Spot');
    }

    /**
     * Regression test: show() must NOT crash when an attraction business has
     * no 'activities' or 'attraction_type' detail rows.
     */
    public function test_destinations_show_returns_attraction_without_crashing_on_missing_details(): void
    {
        $attraction = $this->makeAttraction('Mountain View Park');

        $response = $this->getJson("/api/tourist/destinations/{$attraction->id}");

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.id', $attraction->id)
            ->assertJsonPath('data.name', 'Mountain View Park')
            ->assertJsonPath('data.entrance_fee', 0)
            ->assertJsonPath('data.amenities', [])
            ->assertJsonPath('data.category.name', 'Tourist Attraction');
    }

    public function test_destinations_show_returns_attraction_with_full_details(): void
    {
        $attraction = $this->makeAttraction('Hidden Falls');
        BusinessDetail::create([
            'business_id' => $attraction->id,
            'field_name' => 'attraction_type',
            'field_value' => 'Nature Reserve',
        ]);
        BusinessDetail::create([
            'business_id' => $attraction->id,
            'field_name' => 'activities',
            'field_value' => 'Hiking, Bird Watching',
        ]);
        BusinessDetail::create([
            'business_id' => $attraction->id,
            'field_name' => 'entrance_fee',
            'field_value' => '100',
        ]);

        $response = $this->getJson("/api/tourist/destinations/{$attraction->id}");

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.id', $attraction->id)
            ->assertJsonPath('data.name', 'Hidden Falls')
            ->assertJsonPath('data.entrance_fee', 100)
            ->assertJsonPath('data.amenities', ['Hiking, Bird Watching'])
            ->assertJsonPath('data.category.name', 'Nature Reserve');
    }

    public function test_destinations_show_returns_404_when_not_found(): void
    {
        $response = $this->getJson('/api/tourist/destinations/99999');

        $response->assertStatus(404)
            ->assertJsonPath('success', false)
            ->assertJsonPath('message', 'Destination not found.');
    }

    public function test_destinations_categories_returns_active_categories(): void
    {
        TourismCategory::create(['name' => 'Beaches', 'slug' => 'beaches']);
        TourismCategory::create(['name' => 'Mountains', 'slug' => 'mountains']);

        $response = $this->getJson('/api/tourist/destinations/categories');

        $response->assertOk()
            ->assertJsonPath('success', true);

        $categories = $response->json('data');
        $this->assertCount(2, $categories);
        $this->assertSame('Beaches', $categories[0]['name']);
        $this->assertSame('Mountains', $categories[1]['name']);
    }
}
