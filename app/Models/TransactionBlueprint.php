<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Secure transaction architecture, Stage 2: the digital blueprint of one food
 * delivery or ride order. It references the original order (never replaces
 * it) and carries the head of the order's hash-chained event history.
 */
class TransactionBlueprint extends Model
{
    public const TYPE_FOOD = 'food_delivery';

    public const TYPE_RIDE = 'ride_hailing';

    public const STATUS_PENDING = 'pending';

    public const STATUS_VERIFIED = 'verified';

    public const STATUS_FLAGGED = 'flagged';

    public const STATUS_INVALID = 'invalid';

    protected $fillable = [
        'blueprint_uid', 'transaction_type', 'order_id', 'customer_id', 'rider_id', 'integrity_status',
        'event_count', 'current_hash', 'legacy', 'schema_version', 'finalized_at', 'last_verified_at',
    ];

    protected function casts(): array
    {
        return [
            'event_count' => 'integer',
            'legacy' => 'boolean',
            'schema_version' => 'integer',
            'finalized_at' => 'datetime',
            'last_verified_at' => 'datetime',
        ];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class)->withTrashed();
    }

    public function events(): HasMany
    {
        return $this->hasMany(TransactionEvent::class, 'blueprint_id')->orderBy('sequence');
    }

    public function checks(): HasMany
    {
        return $this->hasMany(TransactionIntegrityCheck::class, 'blueprint_id')->latest('id');
    }
}
