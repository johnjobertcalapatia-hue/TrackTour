<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->json('featured_menu_items')->nullable()->after('signature_dishes');
            $table->json('featured_promotions')->nullable()->after('featured_menu_items');
        });
    }

    public function down(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->dropColumn(['featured_menu_items', 'featured_promotions']);
        });
    }
};
