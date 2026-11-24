<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Stage D1: one numbered receipt for a rider's remittance of collected cancellation fees. */
class PenaltyCashReceipt extends Model
{
    protected $fillable = ['receipt_number', 'collecting_rider_id', 'received_amount', 'received_by', 'received_at', 'note'];

    protected function casts(): array
    {
        return ['received_amount' => 'float', 'received_at' => 'datetime'];
    }

    public function allocations(): HasMany
    {
        return $this->hasMany(PenaltyCashReceiptAllocation::class, 'receipt_id');
    }

    public function collectingRider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'collecting_rider_id');
    }

    public function receiver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'received_by');
    }
}
