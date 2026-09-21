<?php

namespace App\Events;

use App\Models\Booking;
use App\Models\User;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class BookingStatusChanged implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Booking $booking,
        public string $oldStatus,
        public string $newStatus,
        public ?User $changedBy = null,
    ) {}

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('business.'.$this->booking->business_id),
        ];
    }

    public function broadcastAs(): string
    {
        return 'booking.status.changed';
    }

    public function broadcastWith(): array
    {
        return [
            'booking_id' => $this->booking->id,
            'booking_number' => $this->booking->booking_number,
            'old_status' => $this->oldStatus,
            'new_status' => $this->newStatus,
            'changed_by' => $this->changedBy?->id,
            'updated_at' => $this->booking->updated_at,
        ];
    }
}
