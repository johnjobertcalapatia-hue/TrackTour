<?php

namespace App\Observers;

use App\Models\Business;
use App\Models\Review;
use App\Services\FoodPopularityService;

class ReviewObserver
{
    public function created(Review $review): void
    {
        $this->updateBusinessReviewMetrics($review->business_id);
        $this->updateDishPopularity($review);
    }

    public function updated(Review $review): void
    {
        $this->updateBusinessReviewMetrics($review->business_id);
        $this->updateDishPopularity($review);
    }

    public function deleted(Review $review): void
    {
        $this->updateBusinessReviewMetrics($review->business_id);
        $this->updateDishPopularity($review);
    }

    /**
     * Stage D: food ratings boost dish popularity. A review's save, approval
     * or removal re-scores the dishes of its order right away (only approved
     * reviews count). Ranking is never allowed to break a review write; the
     * 10-minute food:recompute-popularity refresh catches anything missed.
     */
    protected function updateDishPopularity(Review $review): void
    {
        if (! $review->order_id) {
            return;
        }
        try {
            app(FoodPopularityService::class)->recomputeForOrder((int) $review->order_id);
        } catch (\Throwable $e) {
            report($e);
        }
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
