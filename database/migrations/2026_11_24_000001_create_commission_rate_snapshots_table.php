<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Earnings Stage 1 (2026-11-24, docs/secure-transaction-audit.md §R): the
 * commission rates an order or ride was booked with. One row per order and
 * municipality (a group food order can span restaurants in several towns).
 * Rows are written once and never updated or deleted: a later rate change
 * never rewrites what an earlier order used.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commission_rate_snapshots', function (Blueprint $table) {
            $table->id();
            // RESTRICT: the rates stay with the order's history. Orders and
            // municipalities are only soft-deleted by the app, so this only
            // refuses a hard delete made outside it.
            $table->foreignId('order_id')->constrained()->restrictOnDelete();
            $table->foreignId('municipality_id')->nullable()->constrained()->restrictOnDelete();
            // food_checkout: the restaurant's town at checkout; ride_accepted: the driver's town at acceptance.
            $table->string('context', 32);
            $table->json('rates');
            $table->char('fingerprint', 64);
            $table->timestamp('captured_at');
            $table->timestamps();

            $table->unique(['order_id', 'context', 'municipality_id'], 'commission_snapshot_unique');
            $table->index(['municipality_id', 'captured_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commission_rate_snapshots');
    }
};
