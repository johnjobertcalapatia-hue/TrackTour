<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Review extends Model
{
    /**
     * Reviews tourists see (2026-11-24). A review is saved as "pending" and
     * nothing in the app ever approves it, so "approved only" hid every
     * review. It is shown unless it was rejected (the owner's Reviews page
     * already used this rule).
     */
    public const PUBLIC_STATUSES = ['approved', 'pending'];

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

    /**
     * Query: the reviews tourists see (not rejected), newest first, with the
     * reviewer's profile for publicCard().
     */
    public static function publicFor(int $businessId, int $limit = 10)
    {
        return static::query()
            ->where('business_id', $businessId)
            ->whereIn('status', self::PUBLIC_STATUSES)
            ->with('user.profile')
            ->latest()
            ->take($limit)
            ->get();
    }

    /**
     * What anyone may see of a review (public pages, no sign-in): the stars,
     * the text, the date and the reviewer's first name + last initial and
     * photo. Never their email, phone or account details.
     */
    public function publicCard(): array
    {
        $profile = $this->user?->profile;
        $first = trim((string) ($profile?->first_name ?? ''));
        $last = trim((string) ($profile?->last_name ?? ''));
        if ($first === '' && ! str_contains((string) $this->user?->name, '@')) {
            // No profile: the account name, shortened the same way ("Test User" -> "Test U.").
            $parts = preg_split('/\s+/', trim((string) $this->user?->name), -1, PREG_SPLIT_NO_EMPTY) ?: [];
            $first = $parts[0] ?? '';
            $last = count($parts) > 1 ? end($parts) : '';
        }
        $name = $first !== '' ? trim($first.' '.($last !== '' ? mb_substr($last, 0, 1).'.' : '')) : 'Tourist';

        return [
            'id' => $this->id,
            'rating' => (int) $this->rating,
            'review' => $this->review,
            'comment' => $this->review,
            'created_at' => $this->created_at?->toIso8601String(),
            'user_name' => $name,
            'user' => ['name' => $name, 'avatar' => $profile?->avatar],
        ];
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
            ->whereIn('status', self::PUBLIC_STATUSES)
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
