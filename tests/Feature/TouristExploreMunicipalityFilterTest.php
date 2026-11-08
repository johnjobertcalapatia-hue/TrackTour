<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * GET /api/tourist/explore?municipality_id= — the Explore page's municipality
 * filter applies to places, food and stays (and their counts).
 */
class TouristExploreMunicipalityFilterTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Municipality $bansud;

    private Municipality $gloria;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::create(['email' => 'owner@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $this->gloria = Municipality::create(['name' => 'Gloria', 'district' => '2', 'province' => 'Oriental Mindoro']);

        foreach ([$this->bansud, $this->gloria] as $m) {
            $this->business("{$m->name} Falls", 'Tourist Attraction', $m);
            $this->business("{$m->name} Resort", 'Resort', $m);
            $restaurant = $this->business("{$m->name} Grill", 'Restaurant', $m);
            Offering::create(['business_id' => $restaurant->id, 'name' => 'Sisig', 'price' => 150, 'is_available' => true, 'status' => 'available']);
        }
    }

    private function business(string $name, string $category, Municipality $m): Business
    {
        return Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => BusinessCategory::firstOrCreate(['name' => $category])->id,
            'municipality_id' => $m->id,
            'business_name' => $name,
            'status' => 'approved',
        ]);
    }

    private function names($response, string $key): array
    {
        return collect($response->json("data.{$key}"))->pluck('name')->sort()->values()->all();
    }

    public function test_filters_places_food_and_stays_by_municipality(): void
    {
        $response = $this->getJson("/api/tourist/explore?municipality_id={$this->gloria->id}")->assertOk();

        $this->assertSame(['Gloria Falls'], $this->names($response, 'places'));
        $this->assertSame(['Gloria Grill'], $this->names($response, 'food'));
        $this->assertSame(['Gloria Resort'], $this->names($response, 'stays'));
        $this->assertSame(['places' => 1, 'food' => 1, 'stays' => 1], $response->json('data.counts'));
        // The filter's option list still contains every municipality.
        $this->assertEqualsCanonicalizing(['Bansud', 'Gloria'], collect($response->json('data.municipalities'))->pluck('name')->all());
    }

    public function test_without_a_filter_every_municipality_is_listed(): void
    {
        $response = $this->getJson('/api/tourist/explore')->assertOk();

        $this->assertSame(['Bansud Falls', 'Gloria Falls'], $this->names($response, 'places'));
        $this->assertSame(['Bansud Grill', 'Gloria Grill'], $this->names($response, 'food'));
        $this->assertSame(['Bansud Resort', 'Gloria Resort'], $this->names($response, 'stays'));
    }

    public function test_an_invalid_filter_is_ignored(): void
    {
        $response = $this->getJson('/api/tourist/explore?municipality_id=abc')->assertOk();

        $this->assertCount(2, $response->json('data.places'));
    }
}
