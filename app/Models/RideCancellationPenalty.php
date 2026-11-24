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

    /** Stage C (2026-11-18): paid in cash to the next driver, or online. */
    public const STATUS_COLLECTED = 'collected';

    /** Stage D1: a received payment was refunded to the tourist. */
    public const STATUS_REFUNDED = 'refunded';

    protected $fillable = [
        'cancelled_order_id', 'delivery_id', 'tourist_id', 'compensated_rider_id', 'penalty_amount',
        'acceptance_at', 'cancelled_at', 'seconds_after_acceptance', 'status', 'evidence', 'review_reasons',
        'disputed_at', 'dispute_reason', 'resolved_at', 'resolved_by', 'resolution_note',
        'collected_at', 'collection_method', 'collected_by', 'collection_order_id', 'collection_delivery_id', 'collection_payment_id',
        'received_amount', 'received_at', 'received_by', 'refunded_at', 'refund_reference',
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
            'collected_at' => 'datetime',
            'received_amount' => 'float',
            'received_at' => 'datetime',
            'refunded_at' => 'datetime',
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

    /** Stage C/D1: the rider who collected it in cash (never its owner). */
    public function collector(): BelongsTo
    {
        return $this->belongsTo(User::class, 'collected_by');
    }

    /** The Tourism Office user who waived (or resolved) it. */
    public function resolver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by');
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
            // 2026-11-23: no dispute; an owed fee is added to the next ride or food order payment.
            'can_dispute' => false,
            // Only an OWED penalty is collected (with the next ride or food order: cash or online).
            'can_pay' => $this->status === self::STATUS_OWED,
            'collected_at' => $this->collected_at?->toIso8601String(),
            'collection_method' => $this->collection_method,
            // Stage C2: a Tourism Office waiver and its reason.
            'waived_at' => $this->status === self::STATUS_WAIVED ? $this->resolved_at?->toIso8601String() : null,
            'waiver_reason' => $this->status === self::STATUS_WAIVED ? $this->resolution_note : null,
        ];
    }

    /**
     * The tourist's notification about this penalty (2026-11-18): the ₱50,
     * why, and what happens next.
     *
     * @return array{title: string, message: string}
     */
    public function notice(): array
    {
        $amount = '₱'.number_format((float) $this->penalty_amount, 2);
        $minutes = max(1, (int) round(($this->seconds_after_acceptance ?? 0) / 60));
        $ride = $this->cancelledOrder?->order_number ? "ride {$this->cancelledOrder->order_number}" : 'your ride';
        $why = "You cancelled {$ride} {$minutes} min after your driver accepted (cancelling is free for the first 5 minutes).";

        return match ($this->status) {
            self::STATUS_OWED => [
                'title' => "{$amount} cancellation fee",
                'message' => "{$why} A {$amount} cancellation fee applies and goes to that driver. It will be added to your next ride or food order payment, or you can pay it now from Book a ride.",
            ],
            self::STATUS_WAIVED => [
                'title' => "{$amount} cancellation fee waived",
                'message' => "The Tourism Office waived your {$amount} cancellation fee for {$ride}. You owe nothing for it.".($this->resolution_note ? " Reason: {$this->resolution_note}" : ''),
            ],
            self::STATUS_COLLECTED => [
                'title' => "{$amount} cancellation fee paid",
                'message' => "Your {$amount} cancellation fee for {$ride} was paid".($this->collection_method === 'online' ? ' online' : ' in cash to your driver').'. Thank you.',
            ],
            default => [
                'title' => "{$amount} cancellation fee",
                'message' => "{$why} A {$amount} cancellation fee applies. It will be added to your next ride or food order payment.",
            ],
        };
    }
}
