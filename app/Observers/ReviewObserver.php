<?php

namespace App\Observers;

use App\Models\Business;
use App\Models\Review;

class ReviewObserver
{
    public function created(Review $review): void
    {
        $this->updateBusinessReviewMetrics($review->business_id);
    }

    public function updated(Review $review): void
    {
        $this->updateBusinessReviewMetrics($review->business_id);
    }

    public function deleted(Review $review): void
    {
        $this->updateBusinessReviewMetrics($review->business_id);
    }

    protected function updateBusinessReviewMetrics(int $businessId): void
    {
        $reviewModel = new Review;
        $avg = $reviewModel->where('business_id', $businessId)->avg('rating') ?? 0;
        $count = $reviewModel->where('business_id', $businessId)->count();

        $business = Business::find($businessId);
        if (! $business) {
            return;
        }

        $business->update([
            'review_count' => $count,
            'average_rating' => round($avg, 2),
        ]);

        $business->updatePopularityScore();
    }
}
