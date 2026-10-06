<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P3 (master spec §17/§49) — observable dispatch-cycle termination.
 *
 * A dispatch attempt must never dead-end silently: it ends either with an
 * accepted rider or with a terminal failure that records WHEN it ended and
 * WHY (dispatch_end_reason: rider_accepted | no_rider_accepted |
 * invalid_pickup_coordinates | order_cancelled).
 *
 * NOTE: deliveries.dispatch_expires_at intentionally keeps its existing
 * WAVE/offer-deadline semantics (bounded by offerExpiresAt(), used by
 * AdminMapController). The 60-minute cycle deadline is derived from
 * orders.dispatch_started_at instead — see
 * NearestRiderService::dispatchCycleDeadline().
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            if (! Schema::hasColumn('deliveries', 'dispatch_ended_at')) {
                $table->timestamp('dispatch_ended_at')->nullable()->after('dispatch_failed_at');
            }
            if (! Schema::hasColumn('deliveries', 'dispatch_end_reason')) {
                $table->string('dispatch_end_reason')->nullable()->after('dispatch_ended_at');
            }
        });
    }

    public function down(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            $columns = array_values(array_filter(
                ['dispatch_ended_at', 'dispatch_end_reason'],
                fn (string $c) => Schema::hasColumn('deliveries', $c)
            ));

            if ($columns !== []) {
                $table->dropColumn($columns);
            }
        });
    }
};
