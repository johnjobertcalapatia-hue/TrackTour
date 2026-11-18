<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Ride hailing — Stage B: cancellation penalty assessment (owner decisions
 * 2026-11-18). One row per tourist-cancelled ride that was cancelled MORE
 * than 300 s after the rider accepted (deliveries.assigned_at): ₱50 owed to
 * that rider only (compensated_rider_id never changes).
 *
 * status: owed (strong evidence: the rider had confirmed arrival at the
 * pickup and had recent GPS) | under_review (anything weaker — never
 * collected automatically) | disputed (the tourist disputed it) | waived.
 * Collection (Stage C) and rider compensation (Stage D) add their own columns.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ride_cancellation_penalties', function (Blueprint $table) {
            $table->id();
            $table->foreignId('cancelled_order_id')->unique()->constrained('orders')->cascadeOnDelete();
            $table->foreignId('delivery_id')->constrained('deliveries')->cascadeOnDelete();
            $table->foreignId('tourist_id')->constrained('users');
            $table->foreignId('compensated_rider_id')->constrained('users');
            $table->decimal('penalty_amount', 10, 2);
            $table->timestamp('acceptance_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->unsignedInteger('seconds_after_acceptance');
            $table->string('status', 20);
            $table->json('evidence')->nullable();
            $table->json('review_reasons')->nullable();
            $table->timestamp('disputed_at')->nullable();
            $table->text('dispute_reason')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->foreignId('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('resolution_note')->nullable();
            $table->timestamps();
            $table->index(['tourist_id', 'status']);
            $table->index(['compensated_rider_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ride_cancellation_penalties');
    }
};
