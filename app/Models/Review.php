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
}
