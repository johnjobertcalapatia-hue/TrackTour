<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Ledger row for a provider webhook event (P11.4).
 *
 * provider_event_id is the stable PayMongo event ID (data.id); its UNIQUE
 * constraint is the DB-level "already processed" backstop — a retried or
 * concurrently delivered webhook can never run its handler twice.
 */
class PaymentWebhookEvent extends Model
{
    use HasFactory;

    protected $fillable = [
        'provider_event_id',
        'event_type',
        'payment_id',
        'payload',
        'processed_at',
    ];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'processed_at' => 'datetime',
        ];
    }

    public function payment(): BelongsTo
    {
        return $this->belongsTo(Payment::class);
    }
}