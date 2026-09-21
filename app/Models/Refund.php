<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

class Refund extends Model
{
    protected $fillable = [
        'refund_number',
        'payment_id',
        'order_id',
        'provider_refund_id',
        'payable_type',
        'payable_id',
        'order_item_id',
        'user_id',
        'amount',
        'original_amount',
        'refund_deduction',
        'currency',
        'reason',
        'metadata',
        'status',
        'refunded_at',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'original_amount' => 'decimal:2',
            'refund_deduction' => 'decimal:2',
            'metadata' => 'array',
            'refunded_at' => 'datetime',
        ];
    }

    public function payment(): BelongsTo
    {
        return $this->belongsTo(Payment::class);
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function payable(): MorphTo
    {
        return $this->morphTo();
    }

    public function orderItem(): BelongsTo
    {
        return $this->belongsTo(OrderItem::class, 'order_item_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
