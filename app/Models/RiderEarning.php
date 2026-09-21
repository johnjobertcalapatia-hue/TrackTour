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
