<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Production had no business modules at all (empty business_modules,
 * business_type_module and business_module_assignments), so the restaurant's
 * module_codes were [] and the business owner sidebar showed none of the
 * restaurant modules. Migration 2026_11_10_000001 backfills them in any
 * environment, idempotently, and keeps modules an owner turned off.
 */
class BusinessModuleBackfillTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private Business $restaurant;
    private Business $attraction;

    protected function setUp(): void
    {
        parent::setUp();
        $muni = Municipality::create(['name' => 'Bansud', 'district' => '1st', 'province' => 'Oriental Mindoro']);
        // Production's category names.
        $restaurantCategory = BusinessCategory::create(['name' => 'Restaurant']);
        $attractionCategory = BusinessCategory::create(['name' => 'Attractions']);
        $this->owner = User::create(['email' => 'owner@modules.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->restaurant = Business::create(['owner_id' => $this->owner->id, 'business_category_id' => $restaurantCategory->id, 'municipality_id' => $muni->id, 'business_name' => 'Ekslusibo Grill and Restaurant', 'status' => 'approved']);
        $this->attraction = Business::create(['owner_id' => $this->owner->id, 'business_category_id' => $attractionCategory->id, 'municipality_id' => $muni->id, 'business_name' => 'Batong Buwaya River', 'status' => 'approved']);

        // Like production: no category mappings, no assignments.
        DB::table('business_module_assignments')->delete();
        DB::table('business_type_module')->delete();
    }

    private function runBackfill(): void
    {
        $migration = require database_path('migrations/2026_11_10_000001_seed_business_modules_and_assignments.php');
        $migration->up();
    }

    public function test_restaurant_without_modules_gets_its_restaurant_modules_back(): void
    {
        // Production also had the empty list cached.
        Cache::put("business_{$this->restaurant->id}_modules", [], 3600);
        $this->assertSame([], $this->restaurant->fresh()->module_codes);

        $this->runBackfill();

        $codes = $this->restaurant->fresh()->module_codes;
        foreach (['menu_management', 'food_ordering', 'kitchen_orders', 'pos_sales', 'order_status', 'reports'] as $code) {
            $this->assertContains($code, $codes);
        }
        // "Attractions" (production's name) gets the Tourist Attraction modules.
        $this->assertEqualsCanonicalizing(
            ['business_profile', 'facility_management', 'booking_requests', 'gallery', 'staff_management', 'customer_reviews', 'expenses'],
            $this->attraction->fresh()->module_codes,
        );

        // The sidebar's data source now carries them.
        $switcher = $this->be($this->owner)->getJson('/api/business-owner/businesses/switcher')->assertOk();
        $row = collect($switcher->json('data.businesses'))->firstWhere('id', $this->restaurant->id);
        $this->assertSame('Restaurant', $row['category']);
        $this->assertContains('menu_management', $row['module_codes']);
    }

    public function test_running_it_again_changes_nothing_and_keeps_modules_the_owner_turned_off(): void
    {
        $this->runBackfill();
        $menuModuleId = DB::table('business_modules')->where('code', 'table_reservations')->value('id');
        DB::table('business_module_assignments')
            ->where('business_id', $this->restaurant->id)
            ->where('business_module_id', $menuModuleId)
            ->update(['is_active' => false]);
        $before = DB::table('business_module_assignments')->count();
        $modulesBefore = DB::table('business_modules')->count();

        $this->runBackfill();

        $this->assertSame($before, DB::table('business_module_assignments')->count());
        $this->assertSame($modulesBefore, DB::table('business_modules')->count());
        $this->assertFalse((bool) DB::table('business_module_assignments')
            ->where('business_id', $this->restaurant->id)
            ->where('business_module_id', $menuModuleId)
            ->value('is_active'));
    }

    public function test_a_category_module_list_an_admin_customised_is_left_alone(): void
    {
        $category = BusinessCategory::where('name', 'Restaurant')->first();
        $extra = DB::table('business_modules')->insertGetId(['code' => 'customer_management', 'name' => 'Customer Management', 'created_at' => now(), 'updated_at' => now()]);
        $category->modules()->sync([$extra]);

        $this->runBackfill();

        $this->assertSame(['customer_management'], $category->modules()->pluck('code')->all());
    }
}
