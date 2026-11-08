<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\TourismEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Home sections scope to the tourist's current municipality through an
 * optional filter on each public list endpoint. Omitting it keeps the
 * existing all-municipalities behaviour.
 */
class TouristMunicipalityScopeTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Municipality $bansud;

    private Municipality $bongabong;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create(['email' => 'owner@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $this->bongabong = Municipality::create(['name' => 'Bongabong', 'district' => '2', 'province' => 'Oriental Mindoro']);
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

    private function names(string $url, string $path): array
    {
        return collect($this->getJson($url)->assertOk()->json($path))->pluck('name')->sort()->values()->all();
    }

    public function test_food_filters_by_restaurant_municipality(): void
    {
        foreach ([[$this->bansud, 'Adobo'], [$this->bongabong, 'Kakanin']] as [$m, $dish]) {
            $r = $this->business("{$m->name} Eatery", 'Restaurant', $m);
            Offering::create(['business_id' => $r->id, 'name' => $dish, 'price' => 100, 'is_available' => true, 'status' => 'available']);
        }

        $this->assertSame(['Kakanin'], $this->names("/api/tourist/food?municipality_id={$this->bongabong->id}", 'data.data'));
        $this->assertSame(['Adobo', 'Kakanin'], $this->names('/api/tourist/food', 'data.data'));
    }

    public function test_destinations_municipality_filter_now_covers_attraction_businesses(): void
    {
        $this->business('Tigbao Falls', 'Tourist Attraction', $this->bansud);
        $this->business('Bongabong Falls', 'Tourist Attraction', $this->bongabong);

        $this->assertSame(['Bongabong Falls'], $this->names("/api/tourist/destinations?municipality={$this->bongabong->id}", 'data.data'));
        $this->assertSame(['Bongabong Falls', 'Tigbao Falls'], $this->names('/api/tourist/destinations', 'data.data'));
    }

    public function test_stays_filter_by_municipality_and_validate_it(): void
    {
        $this->business('Bansud Bay Resort', 'Resort', $this->bansud);
        $this->business('Bongabong Inn', 'Resort', $this->bongabong);

        $this->assertSame(['Bongabong Inn'], $this->names("/api/tourist/stays?municipality_id={$this->bongabong->id}", 'data.accommodations'));
        $this->assertSame(['Bansud Bay Resort', 'Bongabong Inn'], $this->names('/api/tourist/stays', 'data.accommodations'));
        $this->getJson('/api/tourist/stays?municipality_id=abc')->assertUnprocessable();
    }

    public function test_events_filter_by_municipality(): void
    {
        foreach ([[$this->bansud, 'Bansud Fiesta'], [$this->bongabong, 'Bongabong Fiesta']] as [$m, $name]) {
            TourismEvent::create(['municipality_id' => $m->id, 'name' => $name, 'start_date' => now()->addWeek(), 'end_date' => now()->addWeeks(2), 'status' => 'active']);
        }

        $this->assertSame(['Bongabong Fiesta'], $this->names("/api/tourist/events?municipality_id={$this->bongabong->id}", 'data.events'));
        $this->assertSame(['Bansud Fiesta', 'Bongabong Fiesta'], $this->names('/api/tourist/events', 'data.events'));
    }
}
