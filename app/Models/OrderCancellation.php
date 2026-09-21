<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OrderCancellation extends Model
{
    protected $fillable = [
        'order_id',
        'cancelled_by',
        'reason_code',
        'reason',
        'cancelled_at',
        'refund_status',
        'refund_amount',
        'refunded_at',
    ];

    protected function casts(): array
    {
        return [
            'cancelled_at' => 'datetime',
            'refunded_at' => 'datetime',
            'refund_amount' => 'decimal:2',
        ];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }
}
