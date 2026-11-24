<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Stage D1: the part of a cash receipt applied to one cancellation penalty. */
class PenaltyCashReceiptAllocation extends Model
{
    protected $fillable = ['receipt_id', 'penalty_id', 'amount'];

    protected function casts(): array
    {
        return ['amount' => 'float'];
    }

    public function receipt(): BelongsTo
    {
        return $this->belongsTo(PenaltyCashReceipt::class, 'receipt_id');
    }

    public function penalty(): BelongsTo
    {
        return $this->belongsTo(RideCancellationPenalty::class, 'penalty_id');
    }
}
