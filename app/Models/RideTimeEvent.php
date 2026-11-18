<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Append-only ride timeline step (2026-11-18); never updated. */
class RideTimeEvent extends Model
{
    public const UPDATED_AT = null;

    public const PICKUP_ARRIVAL_CONFIRMED = 'pickup_arrival_confirmed';

    public const TRIP_STARTED = 'trip_started';

    protected $fillable = [
        'order_id', 'delivery_id', 'actor_id', 'actor_role', 'event_type', 'event_key', 'occurred_at',
        'latitude', 'longitude', 'accuracy_m', 'location_source', 'reason', 'ride_stop_id',
    ];

    protected function casts(): array
    {
        return [
            'occurred_at' => 'datetime',
            'latitude' => 'float',
            'longitude' => 'float',
            'accuracy_m' => 'float',
        ];
    }
}
