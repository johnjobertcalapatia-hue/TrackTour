<?php

namespace App\Listeners;

use App\Events\DeliveryAssigned;
use App\Events\DeliveryStatusChanged;
use App\Events\OrderStatusChanged;
use App\Services\WebsocketNotifierService;

/**
 * P11.5 — Bridge the canonical Laravel status events to the independent
 * Socket.IO engine over the authenticated HTTP bridge.
 *
 * Laravel/MySQL remains the authoritative source of truth. This listener only
 * routes realtime notifications to the audience rooms that own the transition:
 *
 *     business:{businessId}  restaurant/kitchen & their POS
 *     user:{userId}          the tourist
 *     rider:{riderId}        the assigned rider
 *     trip:{deliveryId}      active live-tracking participants
 *
 * Consumers receive only the rooms they are authorized to join (enforced
 * server-side; never rely on client filtering alone).
 */
class ForwardStatusEventsToBridge
{
    public function handle(OrderStatusChanged|DeliveryAssigned|DeliveryStatusChanged $event): void
    {
        [$rooms, $data] = match (true) {
            $event instanceof DeliveryAssigned => $this->forDeliveryAssigned($event),
            $event instanceof OrderStatusChanged => $this->forOrderStatusChanged($event),
            $event instanceof DeliveryStatusChanged => $this->forDeliveryStatusChanged($event),
        };

        if ($rooms === []) {
            return;
        }

        app(WebsocketNotifierService::class)->notifyStatusEvent(
            $event->broadcastAs(),
            $rooms,
            $data,
        );
    }

    private function forDeliveryAssigned(DeliveryAssigned $event): array
    {
        $order = $event->order;
        $delivery = $event->delivery;

        $rooms = ['rider:'.$event->rider->id, 'trip:'.$delivery->id];

        foreach ($this->businessIdsForOrder($order) as $businessId) {
            $rooms[] = 'business:'.$businessId;
        }

        if ($order->user_id) {
            $rooms[] = 'user:'.$order->user_id;
        }

        $data = $event->broadcastWith();
        $data['order_id'] = $order->id;
        $data['business_id'] = $order->business_id;
        $data['user_id'] = $order->user_id;
        $data['rider_id'] = $event->rider->id;
        $data['trip'] = "trip:{$delivery->id}";
        $data['business_ids'] = $this->businessIdsForOrder($order);

        return [$rooms, $data];
    }

    private function forOrderStatusChanged(OrderStatusChanged $event): array
    {
        $order = $event->order;
        $delivery = $order->activeDelivery();

        $rooms = [];

        foreach ($this->businessIdsForOrder($order) as $businessId) {
            $rooms[] = 'business:'.$businessId;
        }

        if ($order->user_id) {
            $rooms[] = 'user:'.$order->user_id;
        }

        if ($delivery) {
            $rooms[] = 'trip:'.$delivery->id;

            if ($delivery->rider_id) {
                $rooms[] = 'rider:'.$delivery->rider_id;
            }
        }

        $data = $event->broadcastWith();
        $data['business_id'] = $order->business_id;
        $data['user_id'] = $order->user_id;
        $data['delivery_id'] = $delivery?->id;
        $data['rider_id'] = $delivery?->rider_id;
        $data['business_ids'] = $this->businessIdsForOrder($order);

        return [$rooms, $data];
    }

    private function forDeliveryStatusChanged(DeliveryStatusChanged $event): array
    {
        $delivery = $event->delivery;
        $orders = $delivery->childOrders();
        $primaryOrder = $orders->first();

        $rooms = ['trip:'.$delivery->id];

        if ($delivery->rider_id) {
            $rooms[] = 'rider:'.$delivery->rider_id;
        }

        // Fan out to every restaurant represented by the shared order items.
        foreach ($orders as $order) {
            foreach ($this->businessIdsForOrder($order) as $businessId) {
                $rooms[] = 'business:'.$businessId;
            }
        }

        if ($primaryOrder?->user_id) {
            $rooms[] = 'user:'.$primaryOrder->user_id;
        }

        $data = $event->broadcastWith();
        $data['business_id'] = $primaryOrder?->business_id;
        $data['user_id'] = $primaryOrder?->user_id;
        $data['rider_id'] = $delivery->rider_id;

        return [$rooms, $data];
    }

    private function businessIdsForOrder($order): array
    {
        $ids = $order->items()
            ->whereNotNull('business_id')
            ->distinct()
            ->pluck('business_id')
            ->map(fn ($id) => (int) $id)
            ->all();

        if ($ids === [] && $order->business_id) {
            $ids[] = (int) $order->business_id;
        }

        return array_values(array_unique($ids));
    }
}