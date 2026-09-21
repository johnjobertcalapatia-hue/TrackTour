<?php

namespace App\Notifications;

use App\Models\Order;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Notification;

class OrderAutoCancelled extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public Order $order,
        public string $reason,
    ) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        $restaurant = $this->order->business?->name ?? 'The restaurant';

        return [
            'title' => 'Order Auto-Cancelled',
            'message' => "{$restaurant} did not respond to your order #{$this->order->order_number} within the required time. The order has been automatically cancelled and your refund of ₱" . number_format($this->order->total, 2) . ' is being processed.',
            'icon' => 'alert-circle',
            'type' => 'warning',
            'data' => [
                'order_id' => $this->order->id,
                'order_number' => $this->order->order_number,
                'reason' => $this->reason,
                'refund_amount' => $this->order->total,
            ],
        ];
    }
}
