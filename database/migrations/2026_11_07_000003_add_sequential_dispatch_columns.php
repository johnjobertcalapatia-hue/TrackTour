<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sequential targeted dispatch (docs/dispatch-escalation-plan.md, Stage 2).
 *
 * deliveries:
 *   dispatch_phase     targeted | manual (null = legacy wave / not started)
 *   targeted_attempts  targeted offers sent so far (max 4, then manual board)
 *   current_offer_id   the ONE live targeted offer; set/cleared only under the
 *                      delivery row lock (one active targeted offer per order)
 *   pickup_sequence    ordered business ids, farthest from the tourist first
 *
 * booking_dispatch_logs:
 *   attempt_no / phase  audit of which targeted attempt this offer was
 *   expires_at          server-owned per-offer deadline (60 s targeted)
 *
 * UNIQUE(booking_dispatch_logs.delivery_id, rider_id) already guarantees one
 * attempt per rider per order.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('booking_dispatch_logs', 'expires_at')) {
            Schema::table('booking_dispatch_logs', function (Blueprint $table) {
                $table->unsignedTinyInteger('attempt_no')->nullable()->after('distance_km');
                $table->string('phase', 16)->nullable()->after('attempt_no');
                $table->timestamp('expires_at')->nullable()->after('dispatched_at');
            });
        }

        if (! Schema::hasColumn('deliveries', 'dispatch_phase')) {
            Schema::table('deliveries', function (Blueprint $table) {
                $table->string('dispatch_phase', 16)->nullable()->after('dispatch_status');
                $table->unsignedTinyInteger('targeted_attempts')->default(0)->after('dispatch_phase');
                $table->foreignId('current_offer_id')->nullable()->after('targeted_attempts')
                    ->constrained('booking_dispatch_logs')->nullOnDelete();
                $table->json('pickup_sequence')->nullable()->after('pickup_longitude');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('deliveries', 'dispatch_phase')) {
            Schema::table('deliveries', function (Blueprint $table) {
                $table->dropConstrainedForeignId('current_offer_id');
                $table->dropColumn(['dispatch_phase', 'targeted_attempts', 'pickup_sequence']);
            });
        }

        if (Schema::hasColumn('booking_dispatch_logs', 'expires_at')) {
            Schema::table('booking_dispatch_logs', function (Blueprint $table) {
                $table->dropColumn(['attempt_no', 'phase', 'expires_at']);
            });
        }
    }
};
