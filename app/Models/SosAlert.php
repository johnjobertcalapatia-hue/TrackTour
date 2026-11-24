<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** An SOS raised during a trip (see migration 2026_11_18_000003). */
class SosAlert extends Model
{
    public const STATUS_PENDING = 'pending';

    public const STATUS_ACKNOWLEDGED = 'acknowledged';

    public const STATUS_RESPONDING = 'responding';

    public const STATUS_RESOLVED = 'resolved';

    /** Not resolved yet: still needs the Tourism Office. */
    public const ACTIVE = [self::STATUS_PENDING, self::STATUS_ACKNOWLEDGED, self::STATUS_RESPONDING];

    public const OUTCOME_HANDLED = 'handled';

    public const OUTCOME_FALSE_ALARM = 'false_alarm';

    protected $fillable = [
        'reference', 'raised_by', 'raised_by_role', 'service', 'order_id', 'delivery_id', 'trip_status',
        'latitude', 'longitude', 'accuracy_m', 'location_at', 'location_source', 'message', 'status',
        'raised_at', 'sender_safe_at', 'acknowledged_at', 'acknowledged_by', 'responding_at', 'responding_by',
        'responder', 'response_note', 'resolved_at', 'resolved_by', 'outcome', 'resolution_note',
    ];

    protected function casts(): array
    {
        return [
            'latitude' => 'float',
            'longitude' => 'float',
            'accuracy_m' => 'float',
            'location_at' => 'datetime',
            'raised_at' => 'datetime',
            'sender_safe_at' => 'datetime',
            'acknowledged_at' => 'datetime',
            'responding_at' => 'datetime',
            'resolved_at' => 'datetime',
        ];
    }

    public function sender(): BelongsTo
    {
        return $this->belongsTo(User::class, 'raised_by');
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function delivery(): BelongsTo
    {
        return $this->belongsTo(Delivery::class);
    }

    public function acknowledger(): BelongsTo
    {
        return $this->belongsTo(User::class, 'acknowledged_by');
    }

    public function respondingAdmin(): BelongsTo
    {
        return $this->belongsTo(User::class, 'responding_by');
    }

    public function resolver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by');
    }

    public function isActive(): bool
    {
        return in_array($this->status, self::ACTIVE, true);
    }

    /** What the sender sees: status only, never admin names or notes. */
    public function presentForSender(): array
    {
        return [
            'id' => $this->id,
            'reference' => $this->reference,
            'status' => $this->status,
            'active' => $this->isActive(),
            'raised_at' => $this->raised_at?->toIso8601String(),
            'acknowledged_at' => $this->acknowledged_at?->toIso8601String(),
            'responding_at' => $this->responding_at?->toIso8601String(),
            'responder' => $this->responder,
            'sender_safe_at' => $this->sender_safe_at?->toIso8601String(),
            'resolved_at' => $this->resolved_at?->toIso8601String(),
        ];
    }
}
