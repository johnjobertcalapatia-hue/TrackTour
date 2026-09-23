<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->foreignId('business_id')->nullable()->after('order_id')
                ->constrained('businesses')->nullOnDelete();
            $table->index(['order_id', 'business_id']);
        });
    }

    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropForeign(['business_id']);
            $table->dropIndex(['order_id', 'business_id']);
            $table->dropColumn('business_id');
        });
    }
};