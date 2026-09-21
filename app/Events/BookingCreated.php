<?php

namespace App\Events;

use App\Models\Booking;
use App\Models\Business;
use App\Models\User;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class BookingCreated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Booking $booking,
        public Business $business,
        public User $customer,
    ) {}

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('business.'.$this->business->id),
        ];
    }

    public function broadcastAs(): string
    {
        return 'booking.created';
    }

    public function broadcastWith(): array
    {
        return [
            'booking_id' => $this->booking->id,
            'booking_number' => $this->booking->booking_number,
            'customer_name' => $this->booking->customer_name,
            'check_in_date' => $this->booking->check_in_date,
            'guests' => $this->booking->guests,
            'total_amount' => $this->booking->total_amount,
            'created_at' => $this->booking->created_at,
        ];
    }
}
