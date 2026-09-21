<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->text('welcome_message')->nullable()->after('special_offers');
            $table->json('signature_dishes')->nullable()->after('welcome_message');
            $table->string('featured_banner')->nullable()->after('signature_dishes');
            $table->string('featured_video')->nullable()->after('featured_banner');
        });

        Schema::table('business_media', function (Blueprint $table) {
            $table->string('title')->nullable()->after('type');
            $table->string('category')->nullable()->default('restaurant')->after('title');
            $table->boolean('featured')->default(false)->after('category');
            $table->string('visibility')->default('public')->after('featured');
        });
    }

    public function down(): void
    {
        Schema::table('business_media', function (Blueprint $table) {
            $table->dropColumn(['title', 'category', 'featured', 'visibility']);
        });

        Schema::table('businesses', function (Blueprint $table) {
            $table->dropColumn(['welcome_message', 'signature_dishes', 'featured_banner', 'featured_video']);
        });
    }
};
