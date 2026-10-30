<?php

namespace App\Events;

use App\Models\Delivery;
use App\Models\DeliveryPickupStop;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class DeliveryPickupStopChanged
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public Delivery $delivery,
        public DeliveryPickupStop $stop,
        public string $change,
    ) {}

    public function broadcastAs(): string
    {
        return 'delivery.pickup.stop.changed';
    }

    public function broadcastWith(): array
    {
        return [
            'delivery_id' => $this->delivery->id,
            'order_id' => $this->delivery->order_id,
            'stop_id' => $this->stop->id,
            'business_id' => $this->stop->business_id,
            'sequence' => $this->stop->sequence,
            'change' => $this->change,
            'status' => $this->stop->status,
            'arrived_at' => $this->stop->arrived_at?->toIso8601String(),
            'pickup_confirmed_at' => $this->stop->pickup_confirmed_at?->toIso8601String(),
        ];
    }
}
