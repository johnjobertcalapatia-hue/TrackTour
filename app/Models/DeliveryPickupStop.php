<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Payment-agnostic per-restaurant pickup stop for a delivery.
 *
 * Lifecycle:
 *
 *     pending → collected (rider confirms they received the order items there)
 *
 * Gated system-side by PickupSequenceService::confirmStop: the stop must be
 * the current (next unconfirmed) stop in route order, the rider must be within
 * the configured pickup radius of the restaurant, and the restaurant's order
 * items must all be READY before the rider may confirm the pickup.
 *
 * For COD deliveries the matching cod_purchases row is collected together with
 * this stop so the money ledger (purchasing-cash / settlement base) and the
 * pickup-confirmation sequence never drift apart.
 */
class DeliveryPickupStop extends Model
{
    public const STATUS_PENDING = 'pending';

    public const STATUS_COLLECTED = 'collected';

    protected $table = 'delivery_pickup_stops';

    protected $fillable = [
        'delivery_id',
        'order_id',
        'business_id',
        'sequence',
        'preparation_time',
        'pickup_latitude',
        'pickup_longitude',
        'pickup_address',
        'status',
        'pickup_confirmed_at',
    ];

    protected function casts(): array
    {
        return [
            'sequence' => 'integer',
            'preparation_time' => 'integer',
            'pickup_latitude' => 'decimal:7',
            'pickup_longitude' => 'decimal:7',
            'pickup_confirmed_at' => 'datetime',
        ];
    }

    public function delivery(): BelongsTo
    {
        return $this->belongsTo(Delivery::class);
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }
}