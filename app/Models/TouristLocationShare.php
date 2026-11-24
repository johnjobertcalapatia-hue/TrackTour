<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A tourist's opt-in to share their live location with the tourism office,
 * plus their latest position only (never a history).
 */
class TouristLocationShare extends Model
{
    /** A position older than this is no longer "live" on the admin map. */
    public const LIVE_MINUTES = 5;

    /** Positions older than this are deleted outright. */
    public const RETAIN_MINUTES = 60;

    protected $fillable = ['user_id', 'enabled', 'consented_at', 'latitude', 'longitude', 'accuracy_m', 'location_at'];

    protected function casts(): array
    {
        return [
            'enabled' => 'boolean',
            'consented_at' => 'datetime',
            'latitude' => 'float',
            'longitude' => 'float',
            'accuracy_m' => 'float',
            'location_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Sharing on, with a position from the last few minutes. */
    public function scopeLive(Builder $q): Builder
    {
        return $q->where('enabled', true)
            ->whereNotNull('latitude')
            ->where('location_at', '>=', now()->subMinutes(self::LIVE_MINUTES));
    }

    /** Forget the position (keeps the consent row). */
    public function clearPosition(): void
    {
        $this->forceFill(['latitude' => null, 'longitude' => null, 'accuracy_m' => null, 'location_at' => null])->save();
    }
}
