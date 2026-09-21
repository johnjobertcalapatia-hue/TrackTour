<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Payment extends Model
{
    protected $fillable = [
        'payment_number',
        'payable_type',
        'payable_id',
        'user_id',
        'amount',
        'currency',
        'method',
        'provider',
        'provider_payment_id',
        'provider_source_id',
        'status',
        'description',
        'metadata',
        'paid_at',
        'failed_at',
        'refunded_at',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'metadata' => 'array',
            'paid_at' => 'datetime',
            'failed_at' => 'datetime',
            'refunded_at' => 'datetime',
        ];
    }

    public function payable(): \Illuminate\Database\Eloquent\Relations\MorphTo
    {
        return $this->morphTo();
    }

    public function refunds(): HasMany
    {
        return $this->hasMany(Refund::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * State-machine gate for provider verdicts (P11.4).
     *
     * The provider's verdict is only applied when it is a legal transition
     * from the current status — a payment that is already 'paid' can never be
     * downgraded back to 'pending'/'failed', and a refunded / in-flight-refund
     * payment can never be resurrected to 'paid' by a late or duplicate event.
     *
     * Verdict 'paid' is allowed from any status except refunded / pending_refund
     * (it converges pending/authorized/failed/cancelled attempts and is a no-op
     * on paid); verdict 'failed' only ever applies to an attempt that is not
     * yet successful (pending/authorized).
     */
    public function canApplyProviderVerdict(string $verdict): bool
    {
        return match ($verdict) {
            'paid' => ! in_array($this->status, ['refunded', 'pending_refund'], true),
            'failed' => in_array($this->status, ['pending', 'authorized'], true),
            default => false,
        };
    }

    public function scopeForModel($query, $payableType, $payableId)
    {
        return $query->where('payable_type', $payableType)
            ->where('payable_id', $payableId);
    }

    public function scopePaid($query)
    {
        return $query->where('status', 'paid');
    }
}
