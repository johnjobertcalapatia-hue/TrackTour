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

    /**
     * Which PayMongo method the customer actually used (2026-11-18): 'gcash',
     * 'qrph', 'card', … read from what PayMongo sent back (the paid payment's
     * source type, or the checkout session's payment_method_used). Null when
     * not paid or unknown. `method` stays the app's channel ('gcash' = online).
     */
    public function paidVia(): ?string
    {
        if (! in_array($this->status, ['paid', 'pending_refund', 'partially_refunded', 'refunded'], true)) {
            return null;
        }
        $meta = is_array($this->metadata) ? $this->metadata : [];
        $candidates = [];
        foreach (['checkout_session_payment_paid', 'webhook_data', 'checkout_session'] as $key) {
            $block = $meta[$key] ?? null;
            if (! is_array($block)) {
                continue;
            }
            $attrs = is_array($block['attributes'] ?? null) ? $block['attributes'] : $block;
            $candidates[] = $attrs['payment_method_used'] ?? null;
            $candidates[] = $attrs['source']['type'] ?? null;
            $candidates[] = $attrs['payments'][0]['attributes']['source']['type'] ?? null;
        }
        foreach ($candidates as $type) {
            if (is_string($type) && $type !== '') {
                $type = strtolower($type);

                return $type === 'qr_ph' ? 'qrph' : $type;
            }
        }

        return null;
    }
}
