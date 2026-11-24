<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Stage D1: the ₱50 owed to the rider who ACCEPTED a cancelled booking.
 * One per penalty; created when the penalty is fully received, or earlier
 * by an approved advance. See docs/secure-transaction-audit.md §P.
 */
class RiderCancellationCompensation extends Model
{
    /** Explicit: Laravel's pluralizer treats "compensation" as uncountable. */
    protected $table = 'rider_cancellation_compensations';

    public const FUNDING_COLLECTION = 'collection';

    public const FUNDING_ADVANCE = 'advance';

    public const STATUS_PAYABLE = 'payable';

    /** An advance at or above the two-person threshold, waiting for a second staff member. */
    public const STATUS_PENDING_APPROVAL = 'pending_approval';

    public const STATUS_HELD = 'held';

    public const STATUS_RESERVED = 'reserved';

    public const STATUS_PAID = 'paid';

    public const STATUS_VOIDED = 'voided';

    public const STATUS_WRITTEN_OFF = 'written_off';

    protected $fillable = [
        'penalty_id', 'rider_id', 'cancelled_order_id', 'amount', 'funding', 'status', 'earned_at',
        'advance_reason', 'advance_reference', 'advanced_by', 'advance_approved_by',
        'recovered_at', 'voided_at', 'written_off_at', 'resolution_reason',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'float',
            'earned_at' => 'datetime',
            'recovered_at' => 'datetime',
            'voided_at' => 'datetime',
            'written_off_at' => 'datetime',
        ];
    }

    public function penalty(): BelongsTo
    {
        return $this->belongsTo(RideCancellationPenalty::class, 'penalty_id');
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function cancelledOrder(): BelongsTo
    {
        return $this->belongsTo(Order::class, 'cancelled_order_id');
    }

    public function entries(): HasMany
    {
        return $this->hasMany(RiderCompensationEntry::class, 'compensation_id');
    }

    public function present(): array
    {
        return [
            'id' => $this->id,
            'penalty_id' => $this->penalty_id,
            'rider_id' => $this->rider_id,
            'cancelled_order_id' => $this->cancelled_order_id,
            'order_number' => $this->cancelledOrder?->order_number,
            'amount' => (float) $this->amount,
            'funding' => $this->funding,
            'status' => $this->status,
            'earned_at' => $this->earned_at?->toIso8601String(),
            'advance_reason' => $this->advance_reason,
            'advance_reference' => $this->advance_reference,
            'recovered_at' => $this->recovered_at?->toIso8601String(),
            'voided_at' => $this->voided_at?->toIso8601String(),
            'written_off_at' => $this->written_off_at?->toIso8601String(),
            'resolution_reason' => $this->resolution_reason,
        ];
    }
}
