<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Stage D2: one compensation in a compensation payout (live_key = compensation id while live). */
class RiderCompensationPayoutItem extends Model
{
    protected $fillable = ['payout_id', 'compensation_id', 'amount', 'live_key'];

    protected function casts(): array
    {
        return ['amount' => 'float'];
    }

    public function payout(): BelongsTo
    {
        return $this->belongsTo(RiderCompensationPayout::class, 'payout_id');
    }

    public function compensation(): BelongsTo
    {
        return $this->belongsTo(RiderCancellationCompensation::class, 'compensation_id');
    }
}
