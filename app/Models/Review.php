<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Review extends Model
{
    protected $fillable = [
        'business_id',
        'user_id',
        'order_id',
        'rating',
        'food_rating',
        'service_rating',
        'delivery_rating',
        'cleanliness_rating',
        'atmosphere_rating',
        'value_rating',
        'review',
        'visit_type',
        'would_recommend',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'would_recommend' => 'boolean',
            'rating' => 'integer',
            'food_rating' => 'integer',
            'service_rating' => 'integer',
            'delivery_rating' => 'integer',
            'cleanliness_rating' => 'integer',
            'atmosphere_rating' => 'integer',
            'value_rating' => 'integer',
        ];
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function getAverageDimensionalRating(): ?float
    {
        $ratings = array_filter([
            $this->food_rating,
            $this->service_rating,
            $this->cleanliness_rating,
            $this->atmosphere_rating,
            $this->value_rating,
        ]);

        return count($ratings) > 0 ? round(array_sum($ratings) / count($ratings), 1) : null;
    }

    /**
     * Rating summary over ALL approved reviews of a business, so the average,
     * the count and the per-star breakdown always describe the same set.
     *
     * @return array{average: float, count: int, breakdown: array<string, int>}
     */
    public static function approvedSummaryFor(int $businessId): array
    {
        $counts = static::query()
            ->where('business_id', $businessId)
            ->where('status', 'approved')
            ->selectRaw('rating, COUNT(*) as total')
            ->groupBy('rating')
            ->pluck('total', 'rating');

        $breakdown = [];
        $weighted = 0;
        foreach ([5, 4, 3, 2, 1] as $star) {
            $breakdown[(string) $star] = (int) ($counts[$star] ?? 0);
            $weighted += $star * $breakdown[(string) $star];
        }
        $count = array_sum($breakdown);

        return [
            'average' => $count > 0 ? round($weighted / $count, 2) : 0.0,
            'count' => $count,
            'breakdown' => $breakdown,
        ];
    }
}
