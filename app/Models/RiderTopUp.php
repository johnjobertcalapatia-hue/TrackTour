<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RiderTopUp extends Model
{
    protected $fillable = [
        'rider_id',
        'amount',
        'payment_method',
        'payment_reference',
        'provider',
        'provider_transaction_id',
        'status',
        'completed_at',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'completed_at' => 'datetime',
        ];
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    /**
     * Check if this top-up has already been credited.
     */
    public function isCredited(): bool
    {
        return $this->status === 'completed';
    }

    /**
     * Mark as completed.
     */
    public function markCompleted(): void
    {
        $this->update([
            'status' => 'completed',
            'completed_at' => now(),
        ]);
    }

    /**
     * Mark as failed.
     */
    public function markFailed(): void
    {
        $this->update(['status' => 'failed']);
    }

    /**
     * Mark as cancelled.
     */
    public function markCancelled(): void
    {
        $this->update(['status' => 'cancelled']);
    }

    /**
     * Scope for pending top-ups.
     */
    public function scopePending($query)
    {
        return $query->where('status', 'pending');
    }

    /**
     * Scope for completed top-ups.
     */
    public function scopeCompleted($query)
    {
        return $query->where('status', 'completed');
    }
}
