<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reviews', function (Blueprint $table) {
            $table->tinyInteger('food_rating')->unsigned()->nullable()->after('rating');
            $table->tinyInteger('service_rating')->unsigned()->nullable()->after('food_rating');
            $table->tinyInteger('cleanliness_rating')->unsigned()->nullable()->after('service_rating');
            $table->tinyInteger('atmosphere_rating')->unsigned()->nullable()->after('cleanliness_rating');
            $table->tinyInteger('value_rating')->unsigned()->nullable()->after('atmosphere_rating');
            $table->string('visit_type')->nullable()->after('value_rating')->comment('dine_in, take_out, delivery');
            $table->boolean('would_recommend')->default(true)->after('visit_type');
        });
    }

    public function down(): void
    {
        Schema::table('reviews', function (Blueprint $table) {
            $table->dropColumn([
                'food_rating', 'service_rating', 'cleanliness_rating',
                'atmosphere_rating', 'value_rating', 'visit_type', 'would_recommend',
            ]);
        });
    }
};
