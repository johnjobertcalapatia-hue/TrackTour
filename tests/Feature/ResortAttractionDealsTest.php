<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\BusinessModule;
use App\Models\Municipality;
use App\Models\Promotion;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Deals & Posts for resorts and tourist attractions: migration
 * 2026_11_27_000005 gives their categories and existing businesses the
 * `promotions` module (the owner sidebar shows Deals & Posts by module), and
 * their owners can post and run deals that tourists see.
 */
class ResortAttractionDealsTest extends TestCase
{
    use RefreshDatabase;

    private Municipality $town;

    private BusinessModule $promotions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->town = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $this->promotions = BusinessModule::firstOrCreate(['code' => 'promotions'], ['name' => 'Promotions']);
        foreach (['Resort', 'Tourist Attraction', 'Attractions', 'Homestay'] as $name) {
            BusinessCategory::firstOrCreate(['name' => $name]);
        }
    }

    private function business(string $category, string $email): Business
    {
        $owner = User::create(['email' => $email, 'name' => Str::before($email, '@'), 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);

        return Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => BusinessCategory::where('name', $category)->value('id'),
            'municipality_id' => $this->town->id,
            'business_name' => "{$category} place",
            'status' => 'approved',
            'latitude' => 12.86,
            'longitude' => 121.45,
        ]);
    }

    private function migrate(): void
    {
        (require base_path('database/migrations/2026_11_27_000005_add_promotions_module_to_resorts_and_attractions.php'))->up();
    }

    public function test_resorts_and_attractions_get_the_promotions_module_and_other_types_do_not(): void
    {
        $resort = $this->business('Resort', 'resort@example.com');
        $attraction = $this->business('Tourist Attraction', 'spot@example.com');
        // Production's name for the attraction category.
        $prodAttraction = $this->business('Attractions', 'prod-spot@example.com');
        $homestay = $this->business('Homestay', 'home@example.com');
        // The owner portal caches module codes; the migration must clear that.
        $this->assertNotContains('promotions', $resort->module_codes);

        $this->migrate();
        $this->migrate(); // idempotent

        $this->assertContains('promotions', $resort->fresh()->module_codes);
        $this->assertContains('promotions', $attraction->fresh()->module_codes);
        $this->assertContains('promotions', $prodAttraction->fresh()->module_codes);
        $this->assertNotContains('promotions', $homestay->fresh()->module_codes);
        $this->assertSame(1, DB::table('business_module_assignments')->where('business_id', $resort->id)->where('business_module_id', $this->promotions->id)->count());

        // A resort registered later gets it from its category.
        $later = $this->business('Resort', 'later@example.com');
        $later->syncModulesFromCategory();
        $this->assertContains('promotions', $later->fresh()->module_codes);
    }

    public function test_a_switched_off_module_stays_off(): void
    {
        $resort = $this->business('Resort', 'resort@example.com');
        DB::table('business_module_assignments')->insert(['business_id' => $resort->id, 'business_module_id' => $this->promotions->id, 'is_active' => false, 'created_at' => now(), 'updated_at' => now()]);
        Cache::flush();

        $this->migrate();

        $this->assertNotContains('promotions', $resort->fresh()->module_codes);
    }

    public function test_resort_and_attraction_owners_post_and_run_deals_tourists_see(): void
    {
        foreach (['Resort' => 'resort@example.com', 'Tourist Attraction' => 'spot@example.com'] as $category => $email) {
            $business = $this->business($category, $email);
            $owner = $this->actingAs($business->owner, 'sanctum');

            $owner->postJson('/api/business-owner/posts', ['business_id' => $business->id, 'caption' => "20% off at our {$category}!", 'status' => 'published'])
                ->assertCreated();

            $owner->postJson('/api/business-owner/promotions', [
                'business_id' => $business->id, 'title' => 'Weekend deal', 'description' => 'Weekend only',
                'discount_type' => 'percentage', 'discount_value' => 20,
                'start_date' => now()->subDay()->toDateString(), 'end_date' => now()->addWeek()->toDateString(),
            ])->assertSuccessful();

            $this->assertTrue(Promotion::where('business_id', $business->id)->active()->exists(), $category);
        }

        $feed = collect($this->getJson('/api/tourist/posts')->assertOk()->json('data'))->pluck('caption');
        $this->assertContains('20% off at our Resort!', $feed->all());
        $this->assertContains('20% off at our Tourist Attraction!', $feed->all());
    }
}
