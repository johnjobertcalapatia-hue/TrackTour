<?php

namespace App\Listeners;

use App\Events\ReviewCreated;
use App\Models\Review;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;

class UpdateBusinessRating implements ShouldQueue
{
    use InteractsWithQueue;

    public function handle(ReviewCreated $event): void
    {
        $business = $event->business;

        $stats = Review::where('business_id', $business->id)
            ->selectRaw('AVG(rating) as avg_rating, COUNT(*) as review_count')
            ->first();

        $business->update([
            'average_rating' => round($stats->avg_rating ?? 0, 2),
            'review_count' => $stats->review_count ?? 0,
        ]);

        $business->updatePopularityScore();
    }
}
