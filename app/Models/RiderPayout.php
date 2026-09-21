<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasTimestamps;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class RiderPayout extends Model
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';
    public const STATUS_PAID = 'paid';
    public const STATUS_CANCELLED = 'cancelled';

    public const STATUSES = [
        self::STATUS_PENDING,
        self::STATUS_APPROVED,
        self::STATUS_REJECTED,
        self::STATUS_PAID,
        self::STATUS_CANCELLED,
    ];

    /**
     * Statuses under which the linked earnings are locked (cannot be drawn again).
     */
    public const LOCKING_STATUSES = [
        self::STATUS_PENDING,
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
    ];

    protected $hidden = ['active_payout_key'];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
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
