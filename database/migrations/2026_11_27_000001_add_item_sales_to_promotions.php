<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Dish sales (Promotions Part A). A promotion is either a label (shown as a
 * badge only, the existing behaviour) or an item sale that lowers the price of
 * chosen dishes at checkout. Order items keep the price they were sold at, the
 * menu price before the sale and which sale applied, so history never changes
 * when a sale ends or is archived.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('promotions', function (Blueprint $table) {
            $table->string('kind', 20)->default('label')->after('business_id');
            $table->index(['kind', 'is_active']);
        });

        Schema::create('promotion_offering', function (Blueprint $table) {
            $table->id();
            $table->foreignId('promotion_id')->constrained()->cascadeOnDelete();
            $table->foreignId('offering_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['promotion_id', 'offering_id']);
            $table->index('offering_id');
        });

        Schema::table('order_items', function (Blueprint $table) {
            $table->decimal('original_unit_price', 12, 2)->nullable()->after('unit_price');
            $table->foreignId('promotion_id')->nullable()->after('original_unit_price')->constrained()->nullOnDelete();
            $table->string('sale_label', 160)->nullable()->after('promotion_id');
        });
    }

    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropConstrainedForeignId('promotion_id');
            $table->dropColumn(['original_unit_price', 'sale_label']);
        });
        Schema::dropIfExists('promotion_offering');
        Schema::table('promotions', function (Blueprint $table) {
            $table->dropIndex(['kind', 'is_active']);
            $table->dropColumn('kind');
        });
    }
};
