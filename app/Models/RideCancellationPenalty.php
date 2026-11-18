<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A ₱50 tourist cancellation penalty owed to the rider who accepted (2026-11-18). */
class RideCancellationPenalty extends Model
{
    public const STATUS_OWED = 'owed';

    public const STATUS_UNDER_REVIEW = 'under_review';

    public const STATUS_DISPUTED = 'disputed';

    public const STATUS_WAIVED = 'waived';

    protected $fillable = [
        'cancelled_order_id', 'delivery_id', 'tourist_id', 'compensated_rider_id', 'penalty_amount',
        'acceptance_at', 'cancelled_at', 'seconds_after_acceptance', 'status', 'evidence', 'review_reasons',
        'disputed_at', 'dispute_reason', 'resolved_at', 'resolved_by', 'resolution_note',
    ];

    protected function casts(): array
    {
        return [
            'penalty_amount' => 'float',
            'acceptance_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'seconds_after_acceptance' => 'integer',
            'evidence' => 'array',
            'review_reasons' => 'array',
            'disputed_at' => 'datetime',
            'resolved_at' => 'datetime',
        ];
    }

    public function cancelledOrder(): BelongsTo
    {
        return $this->belongsTo(Order::class, 'cancelled_order_id');
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'compensated_rider_id');
    }

    /** What the tourist sees (no rider contact details). */
    public function present(): array
    {
        return [
            'id' => $this->id,
            'cancelled_order_id' => $this->cancelled_order_id,
            'order_number' => $this->cancelledOrder?->order_number,
            'amount' => $this->penalty_amount,
            'status' => $this->status,
            'rider_name' => $this->rider?->fullName ?? $this->rider?->name,
            'seconds_after_acceptance' => $this->seconds_after_acceptance,
            'acceptance_at' => $this->acceptance_at?->toIso8601String(),
            'cancelled_at' => $this->cancelled_at?->toIso8601String(),
            'review_reasons' => $this->review_reasons ?? [],
            'disputed_at' => $this->disputed_at?->toIso8601String(),
            'dispute_reason' => $this->dispute_reason,
            'can_dispute' => in_array($this->status, [self::STATUS_OWED, self::STATUS_UNDER_REVIEW], true),
        ];
    }
}
