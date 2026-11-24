<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The restaurant's "Handed to rider" confirmation (Staff Management §5): who
 * confirmed, when, for which restaurant and rider. Written once per delivery
 * and restaurant; never changed. Separate from the rider's own pickup
 * confirmation (delivery_pickup_stops), which is unchanged.
 */
class RestaurantHandover extends Model
{
    protected $fillable = ['delivery_id', 'order_id', 'business_id', 'rider_id', 'confirmed_by', 'confirmed_at'];

    protected function casts(): array
    {
        return ['confirmed_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new \LogicException('A handover confirmation is never changed.'));
    }

    public function confirmer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'confirmed_by');
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }
}
