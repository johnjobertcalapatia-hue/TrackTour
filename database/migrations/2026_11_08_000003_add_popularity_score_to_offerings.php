<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Rider trip flow, Stage D (decision 2026-11-08): food ratings boost a dish's
 * popularity. offerings.popularity_score is the stored ranking value
 * (FoodPopularityService) so the tourist Food page can sort "Popular" in SQL
 * and paginate. Recomputed on review save/approval and every 10 minutes.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('offerings', 'popularity_score')) {
            Schema::table('offerings', function (Blueprint $table) {
                $table->decimal('popularity_score', 8, 3)->default(0)->after('bestseller');
                $table->index('popularity_score', 'offerings_popularity_score_index');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('offerings', 'popularity_score')) {
            Schema::table('offerings', function (Blueprint $table) {
                $table->dropIndex('offerings_popularity_score_index');
                $table->dropColumn('popularity_score');
            });
        }
    }
};
