<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * SOS alerts (owner decisions 2026-11-18). A tourist during a ride, or a rider
 * during any trip (ride or food delivery), holds the SOS button for 3 seconds;
 * the alert goes to the Bansud Tourism Office (in-app only, no SMS yet).
 *
 * status: pending → acknowledged → responding → resolved (outcome handled |
 * false_alarm). One active alert per sender per trip: a repeat SOS refreshes
 * the location of the open one instead of creating another.
 * The other party on the trip is never told an SOS was raised.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sos_alerts', function (Blueprint $table) {
            $table->id();
            $table->string('reference', 20)->unique();
            $table->foreignId('raised_by')->constrained('users');
            $table->string('raised_by_role', 20);          // tourist | rider
            $table->string('service', 20);                 // ride | food
            $table->foreignId('order_id')->nullable()->constrained('orders')->nullOnDelete();
            $table->foreignId('delivery_id')->nullable()->constrained('deliveries')->nullOnDelete();
            $table->string('trip_status', 40)->nullable(); // delivery status when raised
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->decimal('accuracy_m', 8, 1)->nullable();
            $table->timestamp('location_at')->nullable();
            $table->string('location_source', 20)->nullable(); // device | rider_gps
            $table->text('message')->nullable();
            $table->string('status', 20);
            $table->timestamp('raised_at')->useCurrent();
            $table->timestamp('sender_safe_at')->nullable();
            $table->timestamp('acknowledged_at')->nullable();
            $table->foreignId('acknowledged_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('responding_at')->nullable();
            $table->foreignId('responding_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('responder', 120)->nullable();   // who was sent (e.g. "PNP Bansud")
            $table->text('response_note')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->foreignId('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('outcome', 20)->nullable();      // handled | false_alarm
            $table->text('resolution_note')->nullable();
            $table->timestamps();

            $table->index(['status', 'raised_at']);
            $table->index(['raised_by', 'delivery_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sos_alerts');
    }
};
