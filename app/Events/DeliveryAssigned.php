<?php

namespace App\Events;

use App\Models\Delivery;
use App\Models\Order;
use App\Models\User;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class DeliveryAssigned implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Delivery $delivery,
        public User $rider,
        public Order $order,
    ) {}

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('rider.'.$this->rider->id),
        ];
    }

    public function broadcastAs(): string
    {
        return 'delivery.assigned';
    }

    public function broadcastWith(): array
    {
        return [
            'delivery_id' => $this->delivery->id,
            'order_number' => $this->order->order_number,
            'pickup_address' => $this->delivery->pickup_address,
            'delivery_address' => $this->delivery->delivery_address,
            'assigned_at' => $this->delivery->assigned_at,
        ];
    }
}
