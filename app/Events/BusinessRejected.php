<?php

namespace App\Events;

use App\Models\Business;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class BusinessRejected implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Business $business,
        public ?string $reason = null,
    ) {}

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('user.'.$this->business->owner_id),
        ];
    }

    public function broadcastAs(): string
    {
        return 'business.rejected';
    }

    public function broadcastWith(): array
    {
        return [
            'business_id' => $this->business->id,
            'business_name' => $this->business->business_name,
            'status' => $this->business->status,
            'reason' => $this->reason,
            'updated_at' => $this->business->updated_at,
        ];
    }
}
