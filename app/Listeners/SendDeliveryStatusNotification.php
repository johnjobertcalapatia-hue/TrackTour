<?php

namespace App\Listeners;

use App\Events\DeliveryStatusChanged;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;

class SendDeliveryStatusNotification implements ShouldQueue
{
    use InteractsWithQueue;

    public function handle(DeliveryStatusChanged $event): void
    {
        $delivery = $event->delivery;
        $orders = $delivery->childOrders();

        if ($orders->isEmpty()) {
            return;
        }

        $statusMessages = [
            'arrived_pickup' => 'The rider has arrived at the pickup point.',
            'picked_up' => 'Your order has been picked up by the rider.',
            'in_transit' => 'Your order is on its way.',
            'arrived_destination' => 'The rider has arrived at your delivery location.',
            'delivered' => 'Your order has been delivered.',
            'completed' => 'Your order has been delivered and completed.',
            'failed' => 'Delivery attempt failed.',
        ];

        $rideMessages = [
            'assigned' => 'Your driver is on the way to your pickup location.',
            'en_route_pickup' => 'Your driver is on the way to your pickup location.',
            'arrived_pickup' => 'Your driver has arrived at your pickup location.',
            'picked_up' => 'Your ride is on its way to your destination.',
            'in_transit' => 'Your ride is on its way to your destination.',
            'arrived_destination' => 'You have arrived at your destination.',
            'completed' => 'Your ride is complete.',
        ];

        // One notification per fulfilled restaurant order (a group trip notifies
        // every restaurant whose order rides on the shared delivery).
        foreach ($orders as $order) {
            $customer = User::where('email', $order->customer_email)->first();

            if ($order->order_type === 'transport') {
                $rideMessage = $rideMessages[$event->newStatus]
                    ?? "Ride status updated to: {$event->newStatus}.";

                if ($customer) {
                    Notification::create([
                        'user_id' => $customer->id,
                        'title' => 'Ride Status Updated',
                        'message' => "Ride #{$order->order_number}: {$rideMessage}",
                        'type' => 'ride_status_changed',
                    ]);
                }

                continue;
            }

            $message = $statusMessages[$event->newStatus]
                ?? "Delivery status updated to: {$event->newStatus}.";

            if ($customer) {
                Notification::create([
                    'user_id' => $customer->id,
                    'title' => 'Delivery Status Updated',
                    'message' => "Order #{$order->order_number}: {$message}",
                    'type' => 'delivery_status_changed',
                ]);
            }

            $business = $order->business;
            if ($business && $business->owner_id) {
                Notification::create([
                    'user_id' => $business->owner_id,
                    'title' => 'Delivery Status Updated',
                    'message' => "Order #{$order->order_number}: {$message}",
                    'type' => 'delivery_status_changed',
                ]);
            }
        }
    }
}
