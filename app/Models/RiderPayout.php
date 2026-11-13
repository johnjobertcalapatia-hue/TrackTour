<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasTimestamps;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class RiderPayout extends Model
{
    /** Waiting for Tourism Office review ("pending review"). */
    public const STATUS_PENDING = 'pending';
    /** A staff member is investigating; the request is held. */
    public const STATUS_UNDER_REVIEW = 'under_review';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';
    public const STATUS_PAID = 'paid';
    public const STATUS_CANCELLED = 'cancelled';
    /** The manual GCash transfer failed; the earnings returned to the rider. */
    public const STATUS_FAILED = 'failed';

    public const STATUSES = [
        self::STATUS_PENDING,
        self::STATUS_UNDER_REVIEW,
        self::STATUS_APPROVED,
        self::STATUS_REJECTED,
        self::STATUS_PAID,
        self::STATUS_CANCELLED,
        self::STATUS_FAILED,
    ];

    /**
     * Statuses under which the linked earnings are locked (cannot be drawn again).
     */
    public const LOCKING_STATUSES = [
        self::STATUS_PENDING,
        self::STATUS_UNDER_REVIEW,
        self::STATUS_APPROVED,
        self::STATUS_PAID,
    ];

    /**
     * Statuses under which a payout is still "live" — i.e. it occupies the
     * one-live-payout-per-rider slot. Terminal statuses (paid/rejected/cancelled)
     * free the slot so a rider can request again. The DB backstop is the
     * UNIQUE rider_payouts.active_payout_key marker, kept in sync with this set.
     */
    public const LIVE_STATUSES = [
        self::STATUS_PENDING,
        self::STATUS_UNDER_REVIEW,
        self::STATUS_APPROVED,
    ];

    protected $fillable = [
        'rider_id',
        'payout_number',
        'amount',
        'status',
        'active_payout_key',
        'requested_at',
        'reviewed_by',
        'reviewed_at',
        'review_note',
        'paid_at',
        'destination_gcash_number',
        'destination_account_name',
        'items_snapshot',
        'review_started_by',
        'review_started_at',
        'approved_by',
        'approved_at',
        'rejection_reason',
        'paid_by',
        'payment_reference',
        'paid_amount',
        'paid_recipient_number',
        'paid_recipient_name',
        'payment_proof_path',
        'failed_by',
        'failed_at',
        'failure_reason',
    ];

    protected $hidden = ['active_payout_key', 'payment_proof_path'];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'paid_amount' => 'decimal:2',
            'items_snapshot' => 'array',
            'review_started_at' => 'datetime',
            'approved_at' => 'datetime',
            'failed_at' => 'datetime',
            'requested_at' => 'datetime',
            'reviewed_at' => 'datetime',
            'paid_at' => 'datetime',
        ];
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }

    /**
     * Earnings covered by this payout.
     *
     * NOTE: `withTimestamps` writes the created_at on the pivot only when a
     * new pivot row is inserted; UNIQUE(rider_earning_id) makes the linkage
     * idempotent — the same earning can never appear in two payouts.
     */
    public function earnings(): BelongsToMany
    {
        return $this->belongsToMany(RiderEarning::class, 'rider_payout_rider_earning')
            ->withTimestamps();
    }

    /**
     * Earnings currently available to a rider = earned earnings NOT yet locked
     * into a payout. Locked = linked to a payout whose status is pending /
     * approved / paid. Rejected & cancelled payouts release their earnings.
     *
     * A rider can never double-draw: the pivot unique key is the idempotency
     * barrier, and this query only exposes unlocked earnings for new requests.
     */
    public function scopeEligibleEarnings(Builder $query, int $riderId): Builder
    {
        return $query
            ->where('rider_id', $riderId)
            ->where('status', 'earned')
            ->whereDoesntHave('payouts', fn (Builder $q) => $q->whereIn('status', self::LOCKING_STATUSES));
    }

    /**
     * Total earnings currently available for a rider to request.
     */
    /** Locked once approved (Stage 6): a change would invalidate the approval. */
    public const LOCKED_AFTER_APPROVAL = ['rider_id', 'amount', 'destination_gcash_number', 'destination_account_name'];

    protected static function booted(): void
    {
        static::updating(function (RiderPayout $payout) {
            if (in_array($payout->getOriginal('status'), [self::STATUS_APPROVED, self::STATUS_PAID], true) && $payout->isDirty(self::LOCKED_AFTER_APPROVAL)) {
                throw new \LogicException('An approved cashout\'s amount and GCash destination are locked; reject it and request again instead.');
            }
        });
    }

    public static function availableEarningsFor(int $riderId): array
    {
        $earnings = RiderEarning::query()
            ->where('rider_id', $riderId)
            ->where('status', 'earned')
            ->whereDoesntHave('payouts', fn (Builder $q) => $q->whereIn('status', self::LOCKING_STATUSES))
            ->orderBy('earned_at')
            ->get();

        return [
            'earnings' => $earnings,
            'total' => round($earnings->sum(fn (RiderEarning $e) => (float) $e->total_earning), 2),
        ];
    }
}
