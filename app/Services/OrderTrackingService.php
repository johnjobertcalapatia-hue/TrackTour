<?php

namespace App\Services;

use App\Models\Delivery;
use App\Models\Order;
use RuntimeException;

/**
 * Builds the authorized live-tracking block handed to a tourist so their
 * socket can join `trip:<deliveryId>` (socket-primary tracking with HTTP-poll
 * fallback). Shared by the food-delivery and transport (ride) order-status
 * contracts so both surfaces behave identically.
 *
 * Null when there is no assigned rider, the order reached a terminal state, or
 * the order has no user id (the token subject).
 */
class OrderTrackingService
{
    public function customerBlock(Order $order, ?Delivery $delivery): ?array
    {
        if (! $delivery || ! $delivery->rider_id) {
            return null;
        }

        $terminalStatuses = ['delivered', 'completed', 'cancelled', 'cancelled_by_tourist', 'rejected', 'refunded'];
        if (in_array($order->status, $terminalStatuses, true)) {
            return null;
        }

        if (! $order->user_id) {
            return null;
        }

        try {
            $token = app(TripTokenService::class)->issue($delivery->id, 'customer', (int) $order->user_id);
        } catch (RuntimeException) {
            return null;
        }

        return [
            'delivery_id' => $delivery->id,
            'room' => "trip:{$delivery->id}",
            'token' => $token,
            'role' => 'customer',
        ];
    }
}