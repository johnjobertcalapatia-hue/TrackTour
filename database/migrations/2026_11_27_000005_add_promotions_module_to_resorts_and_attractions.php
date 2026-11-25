<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Deals & Posts for resorts and tourist attractions: their categories now
 * offer the `promotions` module, and every existing resort / tourist
 * attraction gets it switched on (the owner sidebar shows Deals & Posts by
 * module). Additive only; a business whose owner had switched it off keeps
 * it off. Fresh installs get it from BusinessModuleSeeder.
 */
return new class extends Migration
{
    // Production names its attraction category "Attractions" (BusinessModuleSeeder alias).
    private const CATEGORIES = ['Resort', 'Tourist Attraction', 'Attractions'];

    public function up(): void
    {
        $moduleId = DB::table('business_modules')->where('code', 'promotions')->value('id');
        if (! $moduleId) {
            return;
        }
        $now = now();
        $categoryIds = DB::table('business_categories')->whereIn('name', self::CATEGORIES)->pluck('id');

        DB::table('business_type_module')->insertOrIgnore($categoryIds->map(fn ($id) => [
            'business_category_id' => $id, 'business_module_id' => $moduleId, 'created_at' => $now, 'updated_at' => $now,
        ])->all());

        $businessIds = DB::table('businesses')->whereIn('business_category_id', $categoryIds)->pluck('id');
        DB::table('business_module_assignments')->insertOrIgnore($businessIds->map(fn ($id) => [
            'business_id' => $id, 'business_module_id' => $moduleId, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ])->all());

        foreach ($businessIds as $id) {
            Cache::forget("business_{$id}_modules");
        }
    }

    public function down(): void
    {
        $moduleId = DB::table('business_modules')->where('code', 'promotions')->value('id');
        if (! $moduleId) {
            return;
        }
        $categoryIds = DB::table('business_categories')->whereIn('name', self::CATEGORIES)->pluck('id');
        DB::table('business_type_module')->whereIn('business_category_id', $categoryIds)->where('business_module_id', $moduleId)->delete();
        $businessIds = DB::table('businesses')->whereIn('business_category_id', $categoryIds)->pluck('id');
        DB::table('business_module_assignments')->whereIn('business_id', $businessIds)->where('business_module_id', $moduleId)->delete();
        foreach ($businessIds as $id) {
            Cache::forget("business_{$id}_modules");
        }
    }
};
