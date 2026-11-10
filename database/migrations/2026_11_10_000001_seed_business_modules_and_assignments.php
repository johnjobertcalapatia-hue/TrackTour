<?php

use App\Models\Business;
use Database\Seeders\BusinessModuleSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

/**
 * Business owner modules must exist in every environment (2026-11-10).
 *
 * Production had empty business_modules / business_type_module /
 * business_module_assignments tables (the seeder was never run there), so a
 * restaurant's module_codes were [] and the business owner sidebar showed none
 * of the restaurant modules (Menu, Orders, Kitchen, POS, ...).
 *
 * Idempotent:
 *  - BusinessModuleSeeder creates missing modules (firstOrCreate by code) and
 *    gives each category WITHOUT modules its default list (lists an admin
 *    customised are left alone);
 *  - only businesses with NO module assignments get their category's modules,
 *    so modules an owner or admin turned off stay off.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['business_modules', 'business_type_module', 'business_module_assignments', 'business_categories', 'businesses'] as $table) {
            if (! Schema::hasTable($table)) {
                return;
            }
        }

        $seeder = new BusinessModuleSeeder;
        $seeder->onlyEmptyCategories = true;
        $seeder->run();

        Business::query()
            ->whereNotNull('business_category_id')
            ->whereDoesntHave('modules')
            ->with('category')
            ->each(fn (Business $business) => $business->syncModulesFromCategory());
    }

    public function down(): void
    {
        // Data backfill: nothing to undo (modules are reference data).
    }
};
