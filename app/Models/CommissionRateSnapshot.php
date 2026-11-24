<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The commission rates an order or ride was booked with (Earnings Stage 1,
 * docs/secure-transaction-audit.md §R2). Written once; never updated or
 * deleted (the order's own history: orders are only ever soft-deleted, and the
 * foreign keys refuse a hard delete of the order or town it belongs to).
 */
class CommissionRateSnapshot extends Model
{
    public const CONTEXT_FOOD_CHECKOUT = 'food_checkout';

    public const CONTEXT_RIDE_ACCEPTED = 'ride_accepted';

    protected $fillable = ['order_id', 'municipality_id', 'context', 'rates', 'fingerprint', 'captured_at'];

    protected function casts(): array
    {
        return [
            'rates' => 'array',
            'captured_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function () {
            throw new \LogicException('A commission rate snapshot is never changed after it is recorded.');
        });
        static::deleting(function () {
            throw new \LogicException('A commission rate snapshot is never deleted: it is part of the order history.');
        });
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function municipality(): BelongsTo
    {
        return $this->belongsTo(Municipality::class);
    }
}
