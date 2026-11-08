<?php

namespace App\Services;

use App\Models\Offering;
use App\Models\OrderItem;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Dish popularity (rider trip flow, Stage D, decision 2026-11-08): ratings +
 * sales decide the "Popular" order of the tourist Food page.
 *
 * The SAME definitions the Food page shows:
 *   sold   = units of the dish in delivered/completed orders
 *   rating = approved food stars: dish reviews (Write review) for their own
 *            dish; older whole-order food ratings for every dish in orders
 *            without dish reviews (never both)
 *
 * score = 25 · bayesian_rating + 10 · ln(1 + sold)
 *   bayesian_rating = (count · avg + M · PRIOR) / (count + M)
 * The Bayesian average pulls dishes with few reviews toward a neutral prior,
 * so a single 5-star review can't jump to the top; ln keeps one bulk order
 * from dominating: five 5-star sales outrank one unrated 40-unit order
 * (ratings are what boost a dish). Stored in offerings.popularity_score for SQL sorting.
 */
class FoodPopularityService
{
    /** Reviews a dish "starts with" at the prior rating. */
    public const MIN_REVIEWS = 3;

    /** Neutral prior rating (stars). */
    public const PRIOR_RATING = 3.5;

    /** Points per (Bayesian) star. */
    public const RATING_WEIGHT = 25;

    /** Points per unit of ln(1 + sold). */
    public const SALES_WEIGHT = 10;

    /**
     * @param  array<int, int>  $offeringIds
     * @return array{sold: Collection<int, int>, ratings: Collection<int, array{average: float, count: int}>}
     */
    public function stats(array $offeringIds): array
    {
        if ($offeringIds === []) {
            return ['sold' => collect(), 'ratings' => collect()];
        }

        $sold = OrderItem::query()
            ->whereIn('offering_id', $offeringIds)
            ->whereHas('order', fn ($q) => $q->whereIn('status', ['delivered', 'completed']))
            ->selectRaw('offering_id, SUM(quantity - COALESCE(cancelled_quantity, 0)) as sold')
            ->groupBy('offering_id')
            ->pluck('sold', 'offering_id')
            ->map(fn ($v) => (int) $v);

        $dishReviews = DB::table('order_item_reviews as oir')
            ->join('reviews', 'reviews.order_id', '=', 'oir.order_id')
            ->whereIn('oir.offering_id', $offeringIds)
            ->where('reviews.status', 'approved')
            ->select('oir.offering_id', 'oir.id as rid', 'oir.rating as food_rating')
            ->get();
        $orderReviews = DB::table('reviews')
            ->join('order_items', 'order_items.order_id', '=', 'reviews.order_id')
            ->whereIn('order_items.offering_id', $offeringIds)
            ->where('reviews.status', 'approved')
            ->whereNotNull('reviews.food_rating')
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))->from('order_item_reviews')->whereColumn('order_item_reviews.order_id', 'reviews.order_id'))
            ->select('order_items.offering_id', 'reviews.id as rid', 'reviews.food_rating')
            ->distinct()
            ->get();

        $ratings = $dishReviews->concat($orderReviews)
            ->groupBy('offering_id')
            ->map(fn ($rows) => ['average' => round((float) $rows->avg('food_rating'), 1), 'count' => $rows->count()]);

        return ['sold' => $sold, 'ratings' => $ratings];
    }

    public function score(?float $averageRating, int $ratingCount, int $sold): float
    {
        $bayesian = ($ratingCount * (float) ($averageRating ?? 0) + self::MIN_REVIEWS * self::PRIOR_RATING)
            / ($ratingCount + self::MIN_REVIEWS);

        return round(self::RATING_WEIGHT * $bayesian + self::SALES_WEIGHT * log(1 + max(0, $sold)), 3);
    }

    /**
     * Recompute and store popularity_score for the given dishes (all dishes
     * when null). Returns how many dishes were updated.
     *
     * @param  array<int, int>|null  $offeringIds
     */
    public function recompute(?array $offeringIds = null): int
    {
        $updated = 0;
        $query = Offering::query()->select('id', 'popularity_score');
        if ($offeringIds !== null) {
            if ($offeringIds === []) {
                return 0;
            }
            $query->whereIn('id', $offeringIds);
        }

        $query->chunkById(200, function ($chunk) use (&$updated) {
            $ids = $chunk->pluck('id')->map(fn ($id) => (int) $id)->all();
            ['sold' => $sold, 'ratings' => $ratings] = $this->stats($ids);
            foreach ($chunk as $offering) {
                $rating = $ratings[$offering->id] ?? null;
                $score = $this->score($rating['average'] ?? null, (int) ($rating['count'] ?? 0), (int) ($sold[$offering->id] ?? 0));
                if (abs((float) $offering->popularity_score - $score) > 0.0005) {
                    Offering::whereKey($offering->id)->update(['popularity_score' => $score]);
                    $updated++;
                }
            }
        });

        return $updated;
    }

    /** Dishes of an order (after a review or rating changes). */
    public function recomputeForOrder(int $orderId): int
    {
        $ids = OrderItem::where('order_id', $orderId)->whereNotNull('offering_id')->pluck('offering_id')
            ->map(fn ($id) => (int) $id)->unique()->values()->all();

        return $this->recompute($ids);
    }
}
