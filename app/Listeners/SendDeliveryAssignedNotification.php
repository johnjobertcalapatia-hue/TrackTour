<?php

namespace App\Listeners;

use App\Events\DeliveryAssigned;
use App\Models\Notification;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;

class SendDeliveryAssignedNotification implements ShouldQueue
{
    use InteractsWithQueue;

    public function handle(DeliveryAssigned $event): void
    {
        $rider = $event->rider;
        $order = $event->order;
        $delivery = $event->delivery;

        Notification::create([
            'user_id' => $rider->id,
            'title' => 'New Delivery Assignment',
            'message' => "You have been assigned delivery for Order #{$order->order_number}. Pickup: {$delivery->pickup_address}.",
            'type' => 'delivery_assigned',
        ]);

        // Ride-hailing: also persist an in-app Notification row for the tourist
        // so the "driver accepted / on the way" transition survives outside the
        // realtime room (the socket bridge handles the live user:{id} broadcast).
        if ($order->order_type === 'transport' && $order->user_id) {
            Notification::create([
                'user_id' => $order->user_id,
                'title' => 'Ride Status Updated',
                'message' => "Ride #{$order->order_number}: Your driver {$rider->fullName} is on the way to your pickup location.",
                'type' => 'ride_status_changed',
            ]);
        }
    }
}
