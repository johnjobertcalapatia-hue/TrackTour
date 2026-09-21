<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Use raw query to avoid SoftDeletes issue
        $businesses = DB::table('businesses')
            ->join('business_categories', 'businesses.business_category_id', '=', 'business_categories.id')
            ->select('businesses.id', 'business_categories.id as category_id')
            ->get();

        foreach ($businesses as $business) {
            $modules = DB::table('business_modules')
                ->where('business_category_id', $business->category_id)
                ->get();

            if ($modules->isEmpty()) {
                continue;
            }

            foreach ($modules as $module) {
                DB::table('business_module_assignments')->updateOrInsert(
                    [
                        'business_id' => $business->id,
                        'business_module_id' => $module->id,
                    ],
                    [
                        'is_active' => true,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]
                );
            }
        }
    }
};
