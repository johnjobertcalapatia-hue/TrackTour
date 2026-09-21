<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('products') && ! Schema::hasTable('offerings')) {
            Schema::table('products', function (Blueprint $table) {
                $table->dropForeign(['product_category_id']);
            });

            Schema::table('order_items', function (Blueprint $table) {
                $table->dropForeign(['product_id']);
            });

            Schema::rename('product_categories', 'offering_categories');
            Schema::rename('products', 'offerings');

            Schema::table('offerings', function (Blueprint $table) {
                $table->renameColumn('product_category_id', 'offering_category_id');
            });

            Schema::table('order_items', function (Blueprint $table) {
                $table->renameColumn('product_id', 'offering_id');
            });

            if (Schema::getConnection()->getDriverName() !== 'sqlite') {
                Schema::table('offerings', function (Blueprint $table) {
                    $table->foreign('offering_category_id')->references('id')->on('offering_categories')->nullOnDelete();
                });

                Schema::table('order_items', function (Blueprint $table) {
                    $table->foreign('offering_id')->references('id')->on('offerings')->nullOnDelete();
                });
            }
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('offerings') && ! Schema::hasTable('products')) {
            if (Schema::getConnection()->getDriverName() !== 'sqlite') {
                Schema::table('offerings', function (Blueprint $table) {
                    $table->dropForeign(['offering_category_id']);
                });

                Schema::table('order_items', function (Blueprint $table) {
                    $table->dropForeign(['offering_id']);
                });
            }

            Schema::table('offerings', function (Blueprint $table) {
                $table->renameColumn('offering_category_id', 'product_category_id');
            });

            Schema::table('order_items', function (Blueprint $table) {
                $table->renameColumn('offering_id', 'product_id');
            });

            Schema::rename('offerings', 'products');
            Schema::rename('offering_categories', 'product_categories');

            Schema::table('products', function (Blueprint $table) {
                $table->foreign('product_category_id')->references('id')->on('product_categories')->nullOnDelete();
            });

            Schema::table('order_items', function (Blueprint $table) {
                $table->foreign('product_id')->references('id')->on('products')->nullOnDelete();
            });
        }
    }
};
