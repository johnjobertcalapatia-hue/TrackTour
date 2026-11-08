<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A tourist's review of one ordered dish (My Orders → To Review → Write review).
 * Moderation follows the order's business review (`reviews.status`).
 */
class OrderItemReview extends Model
{
    protected $fillable = [
        'order_item_id',
        'order_id',
        'offering_id',
        'business_id',
        'user_id',
        'rating',
        'review',
        'images',
    ];

    protected function casts(): array
    {
        return [
            'rating' => 'integer',
            'images' => 'array',
        ];
    }

    public function orderItem(): BelongsTo
    {
        return $this->belongsTo(OrderItem::class);
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function offering(): BelongsTo
    {
        return $this->belongsTo(Offering::class);
    }
}
