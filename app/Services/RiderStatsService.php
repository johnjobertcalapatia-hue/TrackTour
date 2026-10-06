<?php

namespace App\Services;

use App\Models\Delivery;
use Illuminate\Support\Facades\DB;

/**
 * Read-only rider scoreboard used by the tourist order-status payload:
 *
 *   - rating            AVG of the tourist's persisted delivery_rating
 *   - rating_count      number of rated deliveries
 *   - completed_deliveries  count of completed trips by this rider
 *
 * Ratings are attributed to the rider who fulfilled the delivery. A standalone
 * order matches its delivery by order_id (UNIQUE); the children of a group
 * checkout match the shared group delivery by group_checkout_id, so every
 * restaurant order in a group contributes its delivery_rating to the SAME
 * rider — never double-counted for the wrong rider.
 *
 * This service is strictly read-only: it never mutates money, order or
 * delivery state.
 */
class RiderStatsService
{
    /**
     * @return array{rating: float|null, rating_count: int, completed_deliveries: int}
     */
    public function scores(int $riderId): array
    {
        $row = DB::table('orders as o')
            ->join('deliveries as d', function ($join) {
                $join->on(function ($query) {
                    $query->whereColumn('d.order_id', 'o.id')
                        ->orWhere(function ($group) {
                            $group->whereNotNull('o.group_order_id')
                                ->whereColumn('d.group_checkout_id', 'o.group_order_id');
                        });
                });
            })
            ->where('d.rider_id', $riderId)
            ->whereNotNull('o.delivery_rating')
            ->selectRaw('AVG(o.delivery_rating) as rating, COUNT(o.delivery_rating) as rating_count')
            ->first();

        $completedDeliveries = Delivery::where('rider_id', $riderId)
            ->where('status', 'completed')
            ->count();

        $avg = $row?->rating;

        return [
            'rating' => $avg !== null && $avg !== '' ? round((float) $avg, 1) : null,
            'rating_count' => (int) ($row?->rating_count ?? 0),
            'completed_deliveries' => (int) $completedDeliveries,
        ];
    }
}