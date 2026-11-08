<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\ResortFacility;
use App\Models\ResortType;
use App\Models\Review;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Dynamic resort system, Stage 2: resort cards and filters on Stays & Deals
 * (GET /api/tourist/stays).
 */
class TouristStaysResortFiltersTest extends TestCase
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
    }

    private function resort(string $name, array $types, array $facilities = [], array $custom = [], ?Municipality $m = null, string $category = 'Resort', string $status = 'approved'): Business
    {
        $b = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => BusinessCategory::firstOrCreate(['name' => $category])->id,
            'municipality_id' => ($m ?? $this->bansud)->id,
            'business_name' => $name,
            'status' => $status,
        ]);
        $b->resortTypes()->attach(ResortType::whereIn('slug', $types)->pluck('id'));
        $b->resortFacilities()->attach(ResortFacility::whereIn('slug', $facilities)->pluck('id'));
        foreach ($custom as $c) {
            $b->resortCustomFacilities()->create(['name' => $c]);
        }

        return $b;
    }

    private function names(string $query = ''): array
    {
        return collect($this->getJson('/api/tourist/stays'.$query)->assertOk()->json('data.accommodations'))->pluck('name')->sort()->values()->all();
    }

    private function seedSet(): void
    {
        $this->resort('Lagoon Pool Resort', ['pool'], ['swimming_pool', 'cottages', 'parking'], ['Videoke room']);
        $this->resort('Forest Haven', ['nature', 'pool'], ['swimming_pool', 'camping_area', 'gardens'], [], $this->gloria);
        $this->resort('Bansud Bay Resort', ['beach'], ['beach_access', 'cottages', 'parking']);
        $this->resort('Hilltop Homestay', [], [], [], null, 'Homestay');       // non-resort stay
        $this->resort('Pending Pool Resort', ['pool'], ['swimming_pool'], [], null, 'Resort', 'pending');
    }

    public function test_cards_carry_real_resort_types_and_facilities_and_never_invent_counts_or_prices(): void
    {
        $this->seedSet();
        $byName = collect($this->getJson('/api/tourist/stays')->json('data.accommodations'))->keyBy('name');

        $forest = $byName['Forest Haven'];
        $this->assertSame(['pool', 'nature'], array_column($forest['resort_types'], 'slug'), 'catalogue order');
        $this->assertSame(['Swimming pool', 'Camping area', 'Gardens'], array_column($forest['facilities'], 'name'));
        $this->assertSame('Videoke room', collect($byName['Lagoon Pool Resort']['facilities'])->firstWhere('slug', null)['name']);
        $this->assertNull($forest['cottage_count']);
        $this->assertNull($forest['starting_price']);
        $this->assertSame([], $byName['Hilltop Homestay']['resort_types'], 'non-resort stays still listed, without resort labels');
    }

    public function test_filters_by_type_any_facilities_all_custom_rating_and_location(): void
    {
        $this->seedSet();

        $this->assertSame(['Forest Haven', 'Lagoon Pool Resort'], $this->names('?resort_types[]=pool'));
        $this->assertSame(['Bansud Bay Resort', 'Forest Haven', 'Lagoon Pool Resort'], $this->names('?resort_types[]=pool&resort_types[]=beach'));
        $this->assertSame(['Bansud Bay Resort', 'Lagoon Pool Resort'], $this->names('?facilities[]=cottages&facilities[]=parking'));
        $this->assertSame(['Lagoon Pool Resort'], $this->names('?facilities[]=swimming_pool&facilities[]=cottages'));
        $this->assertSame(['Lagoon Pool Resort'], $this->names('?custom_facilities[]=Videoke%20room'));
        $this->assertSame(['Forest Haven'], $this->names('?municipality_id='.$this->gloria->id));
        $this->assertSame(['Forest Haven'], $this->names('?resort_types[]=nature&facilities[]=gardens&municipality_id='.$this->gloria->id));

        $tourist = User::create(['email' => 't@example.com', 'password' => Hash::make('Password123!'), 'role' => 'tourist', 'account_status' => 'approved']);
        $bay = Business::where('business_name', 'Bansud Bay Resort')->first();
        Review::create(['business_id' => $bay->id, 'user_id' => $tourist->id, 'rating' => 5, 'review' => 'Great', 'status' => 'approved']);
        Review::create(['business_id' => $bay->id, 'user_id' => $tourist->id, 'rating' => 3, 'review' => 'Ok', 'status' => 'approved']);
        $this->assertSame(['Bansud Bay Resort'], $this->names('?min_rating=4'), 'avg 4.0');
        $this->assertSame([], $this->names('?min_rating=4.5'));
    }

    public function test_filter_options_come_from_real_data_with_counts(): void
    {
        $this->seedSet();
        $filters = $this->getJson('/api/tourist/stays')->json('data.filters');

        $types = collect($filters['resort_types'])->keyBy('slug');
        $this->assertSame(['pool', 'nature', 'beach', 'riverside', 'adventure', 'farm', 'other'], $types->keys()->all(), 'full catalogue');
        $this->assertSame(2, $types['pool']['count'], 'pending resort not counted');
        $this->assertSame(0, $types['farm']['count']);

        $facilities = collect($filters['facilities'])->pluck('count', 'slug');
        $this->assertSame(2, $facilities['swimming_pool']);
        $this->assertSame(2, $facilities['cottages']);
        $this->assertArrayNotHasKey('wifi', $facilities->all(), 'unused facilities are not offered as filters');
        $this->assertSame([['name' => 'Videoke room', 'count' => 1]], $filters['custom_facilities']);
        $this->assertSame(['Bansud', 'Gloria'], array_column($filters['municipalities'], 'name'));
        $this->assertFalse($filters['rating_available'], 'no rating filter until real reviews exist');
    }

    public function test_rejects_unknown_types_and_facilities(): void
    {
        $this->getJson('/api/tourist/stays?resort_types[]=volcano')->assertUnprocessable();
        $this->getJson('/api/tourist/stays?facilities[]=helipad')->assertUnprocessable();
        $this->getJson('/api/tourist/stays?min_rating=9')->assertUnprocessable();
    }
}
