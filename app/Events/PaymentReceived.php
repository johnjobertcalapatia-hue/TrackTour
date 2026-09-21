<?php

namespace App\Events;

use App\Models\Payment;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class PaymentReceived implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Payment $payment,
        public ?int $businessId = null,
    ) {}

    public function broadcastOn(): array
    {
        $channels = [];
        if ($this->businessId) {
            $channels[] = new PrivateChannel('business.'.$this->businessId);
        }

        return $channels;
    }

    public function broadcastAs(): string
    {
        return 'payment.received';
    }

    public function broadcastWith(): array
    {
        $payable = $this->payment->payable;

        return [
            'payment_id' => $this->payment->id,
            'payment_number' => $this->payment->payment_number,
            'amount' => $this->payment->amount,
            'method' => $this->payment->method,
            'status' => $this->payment->status,
            'paid_at' => $this->payment->paid_at,
            'order_number' => $payable?->order_number,
            'business_id' => $this->businessId,
            'created_at' => $this->payment->created_at,
        ];
    }
}
