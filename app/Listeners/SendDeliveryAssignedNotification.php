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
    }
}
