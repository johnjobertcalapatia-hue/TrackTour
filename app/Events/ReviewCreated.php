<?php

namespace App\Events;

use App\Models\Business;
use App\Models\Review;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class ReviewCreated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Review $review,
        public Business $business,
    ) {}

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('business.'.$this->business->id),
        ];
    }

    public function broadcastAs(): string
    {
        return 'review.created';
    }

    public function broadcastWith(): array
    {
        return [
            'review_id' => $this->review->id,
            'business_id' => $this->business->id,
            'rating' => $this->review->rating,
            'user_name' => $this->review->user?->name,
            'created_at' => $this->review->created_at,
        ];
    }
}
