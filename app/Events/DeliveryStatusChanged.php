<?php

namespace App\Events;

use App\Models\Delivery;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class DeliveryStatusChanged implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Delivery $delivery,
        public string $oldStatus,
        public string $newStatus,
    ) {}

    public function broadcastOn(): array
    {
        $channels = [];

        if ($this->delivery->rider_id) {
            $channels[] = new PrivateChannel('rider.'.$this->delivery->rider_id);
        }

        // A group delivery notifies every restaurant owner whose order rides on
        // the shared trip; standalone deliveries notify their own business.
        foreach ($this->delivery->childOrders() as $order) {
            if ($order->business_id) {
                $channels[] = new PrivateChannel('business.'.$order->business_id);
            }
        }

        return $channels;
    }

    public function broadcastAs(): string
    {
        return 'delivery.status.changed';
    }

    public function broadcastWith(): array
    {
        return [
            'delivery_id' => $this->delivery->id,
            'order_id' => $this->delivery->order_id,
            'old_status' => $this->oldStatus,
            'new_status' => $this->newStatus,
            'updated_at' => $this->delivery->updated_at,
        ];
    }
}
