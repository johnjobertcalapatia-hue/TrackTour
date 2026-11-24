<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An owed cancellation fee that an online ride / food payment also paid
 * (owner decision 2026-11-23). Not part of the order's amounts.
 */
class PaymentPenaltyItem extends Model
{
    protected $fillable = ['payment_id', 'penalty_id', 'amount', 'applied_at'];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'applied_at' => 'datetime',
        ];
    }

    public function payment(): BelongsTo
    {
        return $this->belongsTo(Payment::class);
    }

    public function penalty(): BelongsTo
    {
        return $this->belongsTo(RideCancellationPenalty::class, 'penalty_id');
    }
}
