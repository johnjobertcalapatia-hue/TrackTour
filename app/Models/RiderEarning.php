<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Builder;

class RiderEarning extends Model
{
    protected $fillable = [
        'rider_id',
        'order_id',
        'delivery_fee',
        'rider_tip',
        'total_earning',
        'status',
        'earned_at',
    ];

    /**
     * Payouts that lock this earning.
     *
     * NOTE: the earnings are linkable only via the idempotent pivot
     * (rider_payout_rider_earning), where UNIQUE(rider_earning_id) means an
     * earning locked into a pending/approved/paid payout can never be linked
     * to any other payout — the same ₱ is never paid out twice.
     */
    public function payouts(): BelongsToMany
    {
        return $this->belongsToMany(RiderPayout::class, 'rider_payout_rider_earning')
            ->withTimestamps();
    }

    /** Amounts fixed when the earning is recorded (Stage 5: write-once). */
    public const WRITE_ONCE = ['rider_id', 'order_id', 'delivery_fee', 'rider_tip', 'total_earning'];

    protected static function booted(): void
    {
        // Every earning is posted to the append-only ledger as it is recorded.
        static::created(fn (RiderEarning $earning) => app(\App\Services\RiderEarningLedger::class)->postEarning($earning));

        // Corrections are compensating ledger adjustments, never edits.
        static::updating(function (RiderEarning $earning) {
            if ($earning->isDirty(self::WRITE_ONCE)) {
                throw new \LogicException('Rider earning amounts are write-once; record an adjustment in the earnings ledger instead.');
            }
        });
        static::deleting(fn () => throw new \LogicException('Rider earnings are never deleted; record an adjustment instead.'));
    }

    protected function casts(): array
    {
        return [
            'delivery_fee' => 'decimal:2',
            'rider_tip' => 'decimal:2',
            'total_earning' => 'decimal:2',
            'earned_at' => 'datetime',
        ];
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    /**
     * Mark this earning as earned (after successful delivery).
     */
    public function markEarned(): void
    {
        $this->update([
            'status' => 'earned',
            'earned_at' => now(),
        ]);
    }
}
