<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A ride's one confirmed destination change (2026-11-17). See
 * App\Services\RideDestinationChangeService for the fare and GPS rules.
 */
class RideDestinationChange extends Model
{
    public const STATUS_CONFIRMED = 'confirmed';

    public const STATUS_FINALIZED = 'finalized';

    public const REVIEW_OK = 'ok';

    public const REVIEW_NEEDED = 'needs_review';

    protected $fillable = [
        'order_id', 'delivery_id', 'requested_by', 'idempotency_key', 'status',
        'original_address', 'original_latitude', 'original_longitude',
        'new_address', 'new_name', 'new_latitude', 'new_longitude',
        'original_fare', 'original_commission', 'vehicle_type', 'base_fare', 'per_km', 'fare_settings_fingerprint',
        'traveled_km_at_change', 'remaining_km_estimate', 'remaining_route_source', 'estimated_fare', 'max_fare', 'confirmed_at',
        'rider_notification_status', 'rider_notified_at', 'rider_acknowledged_at',
        'verified_km', 'unverified_km', 'track_summary', 'computed_fare', 'final_fare', 'cap_adjustment', 'final_commission',
        'fare_review_status', 'review_reasons', 'finalized_at',
    ];

    protected function casts(): array
    {
        return [
            'original_latitude' => 'float',
            'original_longitude' => 'float',
            'new_latitude' => 'float',
            'new_longitude' => 'float',
            'original_fare' => 'float',
            'original_commission' => 'float',
            'base_fare' => 'float',
            'per_km' => 'float',
            'traveled_km_at_change' => 'float',
            'remaining_km_estimate' => 'float',
            'estimated_fare' => 'float',
            'max_fare' => 'float',
            'verified_km' => 'float',
            'unverified_km' => 'float',
            'computed_fare' => 'float',
            'final_fare' => 'float',
            'cap_adjustment' => 'float',
            'final_commission' => 'float',
            'track_summary' => 'array',
            'review_reasons' => 'array',
            'confirmed_at' => 'datetime',
            'rider_notified_at' => 'datetime',
            'rider_acknowledged_at' => 'datetime',
            'finalized_at' => 'datetime',
        ];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function delivery(): BelongsTo
    {
        return $this->belongsTo(Delivery::class);
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }

    /** What the tourist, the rider and the admin see. */
    public function present(): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'original' => ['address' => $this->original_address, 'latitude' => $this->original_latitude, 'longitude' => $this->original_longitude],
            'new' => ['name' => $this->new_name, 'address' => $this->new_address, 'latitude' => $this->new_latitude, 'longitude' => $this->new_longitude],
            'confirmed_at' => $this->confirmed_at?->toIso8601String(),
            'original_fare' => $this->original_fare,
            'estimated_fare' => $this->estimated_fare,
            'max_fare' => $this->max_fare,
            'traveled_km_at_change' => $this->traveled_km_at_change,
            'remaining_km_estimate' => $this->remaining_km_estimate,
            'rider_notification_status' => $this->rider_notification_status,
            'rider_acknowledged_at' => $this->rider_acknowledged_at?->toIso8601String(),
            'verified_km' => $this->verified_km,
            'unverified_km' => $this->unverified_km,
            'computed_fare' => $this->computed_fare,
            'final_fare' => $this->final_fare,
            'cap_adjustment' => $this->cap_adjustment,
            'original_commission' => $this->original_commission,
            'final_commission' => $this->final_commission,
            'fare_review_status' => $this->fare_review_status,
            'review_reasons' => $this->review_reasons ?? [],
            'finalized_at' => $this->finalized_at?->toIso8601String(),
        ];
    }
}
