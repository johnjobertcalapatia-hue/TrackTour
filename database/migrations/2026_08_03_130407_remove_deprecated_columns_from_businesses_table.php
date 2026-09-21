<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->dropColumn([
                'welcome_message',
                'special_offers',
                'restaurant_profile',
                'signature_dishes',
                'featured_menu_items',
                'featured_promotions',
                'featured_banner',
                'featured_video',
                'dining_style',
                'average_wait_time',
            ]);
        });
    }

    public function down(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->text('welcome_message')->nullable()->after('business_description');
            $table->text('special_offers')->nullable()->after('services');
            $table->json('restaurant_profile')->nullable()->after('special_offers');
            $table->json('signature_dishes')->nullable()->after('restaurant_profile');
            $table->json('featured_menu_items')->nullable()->after('signature_dishes');
            $table->json('featured_promotions')->nullable()->after('featured_menu_items');
            $table->string('featured_banner')->nullable()->after('featured_promotions');
            $table->string('featured_video')->nullable()->after('featured_banner');
            $table->string('dining_style')->nullable()->after('price_range');
            $table->unsignedSmallInteger('average_wait_time')->nullable()->after('dining_style');
        });
    }
};
