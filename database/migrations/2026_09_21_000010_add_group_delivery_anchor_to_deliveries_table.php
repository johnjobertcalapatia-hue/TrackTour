<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One group checkout -> ONE physical delivery.
 *
 * A multi-restaurant group checkout is a single physical trip with a single
 * rider who collects from every restaurant. The delivery is anchored on the
 * group checkout (deliveries.group_checkout_id, UNIQUE) and is NOT linked to a
 * single restaurant order (deliveries.order_id becomes nullable).
 *
 * UNIQUE(deliveries.order_id) already exists (added by the concurrency-guards
 * migration) and remains the schema backstop for the existing one-order ->
 * one-delivery invariant of standalone orders.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            // SQLite rebuilds the table and carries the existing order_id FK
            // across; only nullability changes.
            Schema::table('deliveries', function (Blueprint $table) {
                $table->unsignedBigInteger('order_id')->nullable()->change();
            });

            Schema::table('deliveries', function (Blueprint $table) {
                $table->foreignId('group_checkout_id')->nullable()->after('order_id')
                    ->constrained('group_checkouts')->cascadeOnDelete();
                $table->unique('group_checkout_id');
            });
        } else {
            $foreignKeys = collect(Schema::getForeignKeys('deliveries'))->pluck('name');
            $hasGroupAnchor = Schema::hasColumn('deliveries', 'group_checkout_id');
            Schema::table('deliveries', function (Blueprint $table) use ($foreignKeys, $hasGroupAnchor) {
                if ($foreignKeys->contains('deliveries_order_id_foreign')) {
                    $table->dropForeign(['order_id']);
                }
                $table->unsignedBigInteger('order_id')->nullable()->change();
                if (! $foreignKeys->contains('deliveries_order_id_foreign')) {
                    $table->foreign('order_id')->references('id')->on('orders')->cascadeOnDelete();
                }

                if (! $hasGroupAnchor) {
                    $table->foreignId('group_checkout_id')->nullable()->after('order_id')
                        ->constrained('group_checkouts')->cascadeOnDelete();
                    $table->unique('group_checkout_id');
                }
            });
        }
    }

    public function down(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            $table->dropUnique('deliveries_group_checkout_id_unique');
            $table->dropForeign(['group_checkout_id']);
            $table->dropColumn('group_checkout_id');
        });

        if (DB::connection()->getDriverName() === 'sqlite') {
            Schema::table('deliveries', function (Blueprint $table) {
                $table->unsignedBigInteger('order_id')->nullable(false)->change();
            });
        } else {
            Schema::table('deliveries', function (Blueprint $table) {
                $table->dropForeign(['order_id']);
                $table->unsignedBigInteger('order_id')->nullable(false)->change();
                $table->foreign('order_id')->references('id')->on('orders')->cascadeOnDelete();
            });
        }
    }
};