<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $codIndexes = collect(Schema::getIndexes('cod_settlements'))->pluck('name');
        Schema::table('cod_settlements', function (Blueprint $table) use ($codIndexes) {
            if (! $codIndexes->contains('cod_settlements_order_id_index')) {
                $table->index('order_id', 'cod_settlements_order_id_index');
            }
            if ($codIndexes->contains('cod_settlements_order_id_unique')) {
                $table->dropUnique('cod_settlements_order_id_unique');
            }
            if (! $codIndexes->contains('cod_settlements_order_business_unique')) {
                $table->unique(['order_id', 'business_id'], 'cod_settlements_order_business_unique');
            }
        });

        $orderIndexes = collect(Schema::getIndexes('order_settlements'))->pluck('name');
        Schema::table('order_settlements', function (Blueprint $table) use ($orderIndexes) {
            if (! $orderIndexes->contains('order_settlements_order_id_index')) {
                $table->index('order_id', 'order_settlements_order_id_index');
            }
            if ($orderIndexes->contains('order_settlements_order_id_unique')) {
                $table->dropUnique('order_settlements_order_id_unique');
            }
            if (! $orderIndexes->contains('order_settlements_order_business_unique')) {
                $table->unique(['order_id', 'business_id'], 'order_settlements_order_business_unique');
            }
        });
    }

    public function down(): void
    {
        Schema::table('order_settlements', function (Blueprint $table) {
            $table->dropUnique('order_settlements_order_business_unique');
            $table->unique('order_id');
        });

        Schema::table('cod_settlements', function (Blueprint $table) {
            $table->dropUnique('cod_settlements_order_business_unique');
            $table->unique('order_id');
        });
    }
};