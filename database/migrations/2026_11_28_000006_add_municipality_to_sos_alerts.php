<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Municipal Office plan Stage 3 (decision D1): every SOS alert belongs to the
 * municipal Tourism Office that handles it; Bansud keeps seeing every alert.
 *
 * The municipality is fixed when the alert is raised (SosAlertService), with
 * the same town rule as office earnings: food → the order's restaurant's town
 * (first restaurant of a group checkout); ride → the driver's town. Alerts
 * already raised are backfilled the same way. Null (no town known) → Bansud
 * only.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sos_alerts', function (Blueprint $table) {
            $table->foreignId('municipality_id')->nullable()->after('delivery_id')->constrained()->nullOnDelete();
            $table->index(['municipality_id', 'status']);
        });

        DB::table('sos_alerts')->orderBy('id')->select(['id', 'service', 'order_id', 'delivery_id'])->chunkById(200, function ($alerts) {
            foreach ($alerts as $alert) {
                $municipalityId = $alert->service === 'ride'
                    ? $this->driverTown($alert->delivery_id)
                    : $this->restaurantTown($alert->order_id);

                if ($municipalityId !== null) {
                    DB::table('sos_alerts')->where('id', $alert->id)->update(['municipality_id' => $municipalityId]);
                }
            }
        });
    }

    public function down(): void
    {
        Schema::table('sos_alerts', function (Blueprint $table) {
            $table->dropIndex(['municipality_id', 'status']);
            $table->dropConstrainedForeignId('municipality_id');
        });
    }

    private function driverTown(?int $deliveryId): ?int
    {
        $riderId = $deliveryId ? DB::table('deliveries')->where('id', $deliveryId)->value('rider_id') : null;
        $town = $riderId ? DB::table('users')->where('id', $riderId)->value('municipality_id') : null;

        return $town !== null ? (int) $town : null;
    }

    private function restaurantTown(?int $orderId): ?int
    {
        if (! $orderId) {
            return null;
        }
        $businessId = DB::table('orders')->where('id', $orderId)->value('business_id')
            ?? DB::table('order_items')->where('order_id', $orderId)->whereNotNull('business_id')->orderBy('id')->value('business_id');
        $town = $businessId ? DB::table('businesses')->where('id', $businessId)->value('municipality_id') : null;

        return $town !== null ? (int) $town : null;
    }
};
