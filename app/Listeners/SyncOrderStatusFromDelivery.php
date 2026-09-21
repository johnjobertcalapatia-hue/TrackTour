<?php

namespace App\Listeners;

use App\Events\DeliveryStatusChanged;
use App\Services\OrderSettlementService;

/**
 * Keeps the order-level status in sync with the delivery-level status so that
 * the business owner order list and the tourist order tracker reflect the real
 * fulfilment progress (picked up -> on the way -> delivered) instead of staying
 * stuck on "ready".
 *
 * Runs synchronously so the order status is always updated regardless of
 * whether a queue worker is running.
 */
class SyncOrderStatusFromDelivery
{
    public function handle(DeliveryStatusChanged $event): void
    {
        $delivery = $event->delivery;
        $orders = $delivery->childOrders();

        if ($orders->isEmpty()) {
            return;
        }

        // Map a delivery status onto the corresponding order status. Only the
        // statuses that change the customer/owner-facing progress are mapped;
        // pre-pickup delivery statuses (assigned, arrived_pickup) leave the
        // order on its current (e.g. ready) state.
        $orderStatus = match ($event->newStatus) {
            'picked_up' => 'picked_up',
            'in_transit', 'en_route_destination', 'arrived_destination' => 'out_for_delivery',
            'delivered' => 'delivered',
            'completed' => 'completed',
            default => null,
        };

        if ($orderStatus === null) {
            return;
        }

        // A group delivery syncs every fulfilled restaurant order through the
        // same physical trip progress (4.4).
        foreach ($orders as $order) {
            if ($order->status === $orderStatus) {
                continue;
            }

            $data = ['status' => $orderStatus];

            // completed_at is reserved for the actual terminal state: a COD order
            // passes through 'delivered' while cash is still pending, so it must not
            // be stamped 'completed' until delivery + order truly complete.
            if ($orderStatus === 'completed') {
                $data['completed_at'] = $order->completed_at ?? now();
            }

            $order->update($data);

            if ($orderStatus === 'completed') {
                app(OrderSettlementService::class)->recordGcashSettlement($order->fresh());
            }
        }
    }
}
