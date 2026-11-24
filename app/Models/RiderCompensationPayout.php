<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Stage D2: the cancellation-compensation part of a rider's payout — linked to
 * the existing earnings cashout (rider_payout_id) or on its own. Statuses
 * mirror RiderPayout. See docs/secure-transaction-audit.md §P.5.
 */
class RiderCompensationPayout extends Model
{
    public const STATUS_PENDING = 'pending';

    public const STATUS_UNDER_REVIEW = 'under_review';

    public const STATUS_APPROVED = 'approved';

    public const STATUS_PAID = 'paid';

    public const STATUS_REJECTED = 'rejected';

    public const STATUS_CANCELLED = 'cancelled';

    public const STATUS_FAILED = 'failed';

    public const LIVE_STATUSES = [self::STATUS_PENDING, self::STATUS_UNDER_REVIEW, self::STATUS_APPROVED];

    protected $fillable = [
        'payout_number', 'rider_id', 'rider_payout_id', 'amount', 'status', 'active_key',
        'destination_gcash_number', 'destination_account_name', 'requested_at',
        'review_started_by', 'review_started_at', 'approved_by', 'approved_at', 'review_note', 'rejection_reason',
        'paid_by', 'paid_at', 'payment_reference', 'paid_amount', 'transferred_total', 'paid_recipient_number', 'paid_recipient_name', 'payment_proof_path',
        'failed_by', 'failed_at', 'failure_reason',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'float',
            'paid_amount' => 'float',
            'transferred_total' => 'float',
            'requested_at' => 'datetime',
            'review_started_at' => 'datetime',
            'approved_at' => 'datetime',
            'paid_at' => 'datetime',
            'failed_at' => 'datetime',
        ];
    }

    public function items(): HasMany
    {
        return $this->hasMany(RiderCompensationPayoutItem::class, 'payout_id');
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function earningsPayout(): BelongsTo
    {
        return $this->belongsTo(RiderPayout::class, 'rider_payout_id');
    }

    public function isLive(): bool
    {
        return in_array($this->status, self::LIVE_STATUSES, true);
    }

    public function present(): array
    {
        $this->loadMissing('items.compensation.cancelledOrder:id,order_number');

        return [
            'id' => $this->id,
            'payout_number' => $this->payout_number,
            'rider_id' => $this->rider_id,
            'rider_payout_id' => $this->rider_payout_id,
            'amount' => (float) $this->amount,
            'status' => $this->status,
            'requested_at' => $this->requested_at?->toIso8601String(),
            'approved_at' => $this->approved_at?->toIso8601String(),
            'paid_at' => $this->paid_at?->toIso8601String(),
            'payment_reference' => $this->payment_reference,
            'transferred_total' => $this->transferred_total,
            'rejection_reason' => $this->rejection_reason,
            'failure_reason' => $this->failure_reason,
            'items' => $this->items->map(fn ($i) => [
                'compensation_id' => $i->compensation_id,
                'penalty_id' => $i->compensation?->penalty_id,
                'order_number' => $i->compensation?->cancelledOrder?->order_number,
                'funding' => $i->compensation?->funding,
                'amount' => (float) $i->amount,
            ])->values(),
        ];
    }
}
