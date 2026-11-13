<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use LogicException;

/**
 * One manual Available / Unavailable change of a menu item or variation
 * (Stage 3). Append-only and SHA-256 chained per business; corrections are
 * new events. TrackTour keeps no stock quantities.
 */
class MenuAvailabilityEvent extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'business_id', 'sequence', 'offering_id', 'offering_variation_id', 'item_name', 'previous_available', 'new_available',
        'actor_id', 'actor_role', 'source', 'reason', 'recorded_at_ms', 'previous_hash', 'current_hash',
    ];

    protected function casts(): array
    {
        return [
            'business_id' => 'integer',
            'sequence' => 'integer',
            'offering_id' => 'integer',
            'offering_variation_id' => 'integer',
            'previous_available' => 'boolean',
            'new_available' => 'boolean',
            'actor_id' => 'integer',
            'recorded_at_ms' => 'integer',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Menu availability events are append-only.'));
        static::deleting(fn () => throw new LogicException('Menu availability events are append-only.'));
    }
}
