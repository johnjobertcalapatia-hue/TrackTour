<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Resort reservations Stage 7 (docs/resort-reservation-architecture.md §11).
 * Additive only: existing bookings keep working.
 *
 * - bookings: subtotal, payment option, the cancellation policy in force when
 *   booked (snapshot), when it was confirmed, and a per-tourist client
 *   reference so a double-submitted form books once (UNIQUE user + reference).
 * - booking_items: a priced snapshot of each reserved resort offering (name,
 *   category, mode, basis, unit price, units / guests / nights, dates, slot) and
 *   exactly how much inventory it holds per date (allocated_quantity), so a
 *   cancellation releases what was reserved even if the offering changes later.
 * - booking_status_logs: every status change, who made it and why.
 * - resort_settings: the resort's own cancellation policy (inside the Tourism
 *   Office limits).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->decimal('subtotal', 12, 2)->nullable()->after('guests');
            $table->string('payment_option', 20)->nullable()->after('payment_status');
            $table->json('cancellation_policy')->nullable()->after('notes');
            $table->timestamp('confirmed_at')->nullable()->after('cancelled_at');
            $table->string('client_reference', 64)->nullable()->after('booking_number');
            $table->unique(['user_id', 'client_reference'], 'bookings_user_client_reference_unique');
        });

        Schema::table('booking_items', function (Blueprint $table) {
            $table->foreignId('resort_offering_id')->nullable()->after('booking_id')->constrained('resort_offerings')->nullOnDelete();
            $table->string('category', 30)->nullable()->after('description');
            $table->string('booking_mode', 20)->nullable()->after('category');
            $table->string('pricing_basis', 20)->nullable()->after('booking_mode');
            $table->unsignedInteger('units')->nullable()->after('quantity');
            $table->unsignedInteger('guests')->nullable()->after('units');
            $table->unsignedInteger('nights')->nullable()->after('guests');
            $table->unsignedInteger('allocated_quantity')->nullable()->after('nights');
            $table->date('start_date')->nullable()->after('date');
            $table->date('end_date')->nullable()->after('start_date');
            $table->string('slot', 5)->nullable()->after('end_date');
            $table->json('snapshot')->nullable()->after('slot');
        });

        Schema::create('booking_status_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('booking_id')->constrained('bookings')->cascadeOnDelete();
            $table->string('from_status', 20)->nullable();
            $table->string('to_status', 20);
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('actor_type', 20);
            $table->string('reason', 500)->nullable();
            $table->timestamp('created_at')->nullable();

            $table->index(['booking_id', 'created_at']);
        });

        Schema::create('resort_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_id')->unique()->constrained('businesses')->cascadeOnDelete();
            $table->unsignedTinyInteger('cancellation_free_days')->default(3);
            $table->unsignedTinyInteger('cancellation_penalty_percent')->default(50);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('resort_settings');
        Schema::dropIfExists('booking_status_logs');

        Schema::table('booking_items', function (Blueprint $table) {
            $table->dropConstrainedForeignId('resort_offering_id');
            $table->dropColumn(['category', 'booking_mode', 'pricing_basis', 'units', 'guests', 'nights', 'allocated_quantity', 'start_date', 'end_date', 'slot', 'snapshot']);
        });

        Schema::table('bookings', function (Blueprint $table) {
            $table->dropUnique('bookings_user_client_reference_unique');
            $table->dropColumn(['subtotal', 'payment_option', 'cancellation_policy', 'confirmed_at', 'client_reference']);
        });
    }
};
