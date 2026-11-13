<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use LogicException;

/**
 * One permanent movement in a rider's earnings (Stage 5). Append-only: the
 * database and this model refuse updates and deletes; corrections are new
 * compensating entries.
 */
class RiderEarningEntry extends Model
{
    public const UPDATED_AT = null;

    public const EARNING_POSTED = 'earning_posted';

    public const TIP_POSTED = 'tip_posted';

    public const ADJUSTMENT = 'adjustment';

    public const CASHOUT_RESERVED = 'cashout_reserved';

    public const RESERVATION_RELEASED = 'reservation_released';

    public const PAYOUT_COMPLETED = 'payout_completed';

    protected $fillable = [
        'rider_id', 'rider_earning_id', 'order_id', 'delivery_id', 'rider_payout_id', 'entry_type', 'bucket', 'amount',
        'service', 'channel', 'reverses_entry_id', 'reason', 'details', 'actor_id', 'actor_role', 'approved_by', 'idempotency_key',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'details' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Rider earning entries are append-only.'));
        static::deleting(fn () => throw new LogicException('Rider earning entries are append-only.'));
    }
}
