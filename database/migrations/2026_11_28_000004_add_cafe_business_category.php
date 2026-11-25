<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Café business category in every environment (2026-11-28).
 *
 * The code already treats "Café" as a food business (Business::isRestaurant,
 * FOOD_CATEGORIES, CafeDashboard, DiscoveryGroup::Dining), but production's
 * categories were not created by BusinessCategorySeeder, so the deployed
 * system has no Café to register under.
 *
 * Does nothing on a fresh install (no categories yet: the seeders add Café).
 *
 * Idempotent and additive only:
 *  - creates "Café" unless a café category already exists (an archived one is
 *    restored instead);
 *  - gives it the Café module list only if it has no modules yet;
 *  - gives it the three restaurant staff roles only if it has none yet;
 *  - copies the Restaurant category's active required documents only if it
 *    has no required documents yet (so it matches what the office set for
 *    restaurants in this environment).
 */
return new class extends Migration
{
    private const NAME = 'Café';

    /** Names that already mean "café" in some environment. */
    private const EXISTING_NAMES = ['café', 'cafe', 'cafés', 'cafes'];

    /** Restaurant category names, for copying required documents. */
    private const RESTAURANT_NAMES = ['Restaurant', 'Restaurants'];

    /** Same as BusinessModuleSeeder's 'Café' list. */
    private const MODULES = [
        'business_profile', 'menu_management', 'food_categories',
        'food_ordering', 'pickup_orders', 'staff_management',
        'promotions', 'customer_reviews', 'reports', 'gallery',
        'pos_sales', 'table_management',
        'user_role_management', 'business_settings', 'pos_monitoring',
        'operational_reports', 'payments', 'receipts', 'kitchen_orders', 'order_status', 'menu_availability',
        'expenses',
    ];

    /** Same as BusinessCategoryStaffRoleSeeder's 'Café' list. */
    private const STAFF_ROLES = ['Order & Pickup Staff', 'Finance Staff', 'Menu & Promotions Staff'];

    public function up(): void
    {
        if (! Schema::hasTable('business_categories')) {
            return;
        }
        // A fresh install has no categories yet: BusinessCategorySeeder (and the module,
        // staff-role and document seeders) create Café with everything else.
        if (! DB::table('business_categories')->exists()) {
            return;
        }

        $now = now();
        $categoryId = $this->findOrCreateCategory($now);

        $this->attachModules($categoryId, $now);
        $this->attachStaffRoles($categoryId, $now);
        $this->copyRestaurantDocuments($categoryId, $now);
    }

    public function down(): void
    {
        // Reference data: nothing to undo (a café business may already use it).
    }

    private function findOrCreateCategory($now): int
    {
        $existing = DB::table('business_categories')
            ->whereIn(DB::raw('LOWER(name)'), self::EXISTING_NAMES)
            ->orderByRaw('archived_at IS NOT NULL') // prefer an active one
            ->first();

        if ($existing) {
            if ($existing->archived_at !== null) {
                DB::table('business_categories')->where('id', $existing->id)
                    ->update(['archived_at' => null, 'updated_at' => $now]);
            }

            return (int) $existing->id;
        }

        return (int) DB::table('business_categories')->insertGetId([
            'name' => self::NAME,
            'description' => 'Coffee shop and light meals',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    private function attachModules(int $categoryId, $now): void
    {
        if (! Schema::hasTable('business_type_module') || ! Schema::hasTable('business_modules')) {
            return;
        }
        if (DB::table('business_type_module')->where('business_category_id', $categoryId)->exists()) {
            return; // an admin already chose this category's modules
        }

        $moduleIds = DB::table('business_modules')->whereIn('code', self::MODULES)->pluck('id');

        DB::table('business_type_module')->insertOrIgnore($moduleIds->map(fn ($id) => [
            'business_category_id' => $categoryId,
            'business_module_id' => $id,
            'created_at' => $now,
            'updated_at' => $now,
        ])->all());
    }

    private function attachStaffRoles(int $categoryId, $now): void
    {
        if (! Schema::hasTable('business_category_staff_role') || ! Schema::hasTable('staff_roles')) {
            return;
        }
        if (DB::table('business_category_staff_role')->where('business_category_id', $categoryId)->exists()) {
            return;
        }

        $roleIds = DB::table('staff_roles')
            ->whereNull('business_id') // built-in roles only
            ->whereIn('name', self::STAFF_ROLES)
            ->pluck('id');

        DB::table('business_category_staff_role')->insertOrIgnore($roleIds->map(fn ($id) => [
            'business_category_id' => $categoryId,
            'staff_role_id' => $id,
            'created_at' => $now,
            'updated_at' => $now,
        ])->all());
    }

    private function copyRestaurantDocuments(int $categoryId, $now): void
    {
        if (! Schema::hasTable('required_documents')) {
            return;
        }
        if (DB::table('required_documents')->where('business_category_id', $categoryId)->exists()) {
            return;
        }

        $restaurantId = DB::table('business_categories')
            ->whereIn('name', self::RESTAURANT_NAMES)
            ->whereNull('archived_at')
            ->value('id');
        if (! $restaurantId) {
            return; // the office can add Café's documents in the admin panel
        }

        $rows = DB::table('required_documents')
            ->where('business_category_id', $restaurantId)
            ->whereNull('archived_at')
            ->get()
            ->map(function ($doc) use ($categoryId, $now) {
                $row = (array) $doc;
                unset($row['id']);
                $row['business_category_id'] = $categoryId;
                $row['created_at'] = $now;
                $row['updated_at'] = $now;

                return $row;
            })
            ->all();

        if ($rows) {
            DB::table('required_documents')->insert($rows);
        }
    }
};
