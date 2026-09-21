<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $rows = DB::table('offerings')
            ->select('business_id', 'category')
            ->whereNotNull('category')
            ->where('category', '!=', '')
            ->distinct()
            ->get();

        foreach ($rows as $row) {
            $category = \App\Models\OfferingCategory::where('business_id', $row->business_id)
                ->where('name', $row->category)
                ->first();

            if (! $category) {
                $category = \App\Models\OfferingCategory::create([
                    'business_id' => $row->business_id,
                    'name' => $row->category,
                    'is_available' => true,
                    'sort_order' => 0,
                ]);
            }

            DB::table('offerings')
                ->where('business_id', $row->business_id)
                ->where('category', $row->category)
                ->whereNull('offering_category_id')
                ->update(['offering_category_id' => $category->id]);
        }

        Schema::table('offerings', function (Blueprint $table) {
            $table->dropColumn('category');
        });
    }

    public function down(): void
    {
        Schema::table('offerings', function (Blueprint $table) {
            $table->string('category', 255)->nullable()->after('offering_category_id');
        });

        $categories = \App\Models\OfferingCategory::with('offerings')->get();
        foreach ($categories as $category) {
            if ($category->name) {
                DB::table('offerings')
                    ->where('id', $category->offerings->pluck('id'))
                    ->update(['category' => $category->name]);
            }
        }
    }
};
