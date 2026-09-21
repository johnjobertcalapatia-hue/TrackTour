<?php

namespace App\Listeners;

use App\Events\OrderStatusChanged;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;

class SendOrderStatusNotification implements ShouldQueue
{
    use InteractsWithQueue;

    public function handle(OrderStatusChanged $event): void
    {
        $order = $event->order;
        $statusMessages = [
            'confirmed' => 'Your order has been confirmed.',
            'preparing' => 'Your order is now being prepared.',
            'ready' => 'Your order is ready for pickup/delivery.',
            'out_for_delivery' => 'Your order is on its way!',
            'delivered' => 'Your order has been delivered.',
            'completed' => 'Your order has been completed.',
            'cancelled' => 'Your order has been cancelled.',
        ];

        $message = $statusMessages[$event->newStatus]
            ?? "Your order status has been updated to: {$event->newStatus}.";

        $user = User::where('email', $order->customer_email)->first();

        if ($user) {
            Notification::create([
                'user_id' => $user->id,
                'title' => 'Order Status Updated',
                'message' => "Order #{$order->order_number}: {$message}",
                'type' => 'order_status_changed',
            ]);
        }
    }
}
