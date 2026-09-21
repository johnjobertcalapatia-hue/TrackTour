<?php

namespace App\Listeners;

use App\Events\OrderCreated;
use App\Models\Notification;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;

class SendOrderCreatedNotifications implements ShouldQueue
{
    use InteractsWithQueue;

    public function handle(OrderCreated $event): void
    {
        $business = $event->business;
        $order = $event->order;

        $owner = $business->owner;

        if ($owner) {
            Notification::create([
                'user_id' => $owner->id,
                'title' => 'New Order Received',
                'message' => "Order #{$order->order_number} has been placed. Total: ₱{$order->total}.",
                'type' => 'order_created',
            ]);
        }

        $staffMembers = $business->staff()
            ->where('status', 'active')
            ->whereHas('permissions', function ($query) {
                $query->where('module_code', 'orders')->where('can_view', true);
            })
            ->get();

        foreach ($staffMembers as $staff) {
            Notification::create([
                'user_id' => $staff->user_id,
                'title' => 'New Order Received',
                'message' => "Order #{$order->order_number} has been placed. Total: ₱{$order->total}.",
                'type' => 'order_created',
            ]);
        }
    }
}
