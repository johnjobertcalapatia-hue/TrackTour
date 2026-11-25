<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An owner closure (resort reservations Stage 6): the whole resort when
 * resort_offering_id is NULL, otherwise one offering; start and end dates
 * are inclusive.
 */
class ResortBlockedDate extends Model
{
    protected $fillable = ['business_id', 'resort_offering_id', 'start_date', 'end_date', 'reason', 'created_by'];

    protected function casts(): array
    {
        return [
            'start_date' => 'date:Y-m-d',
            'end_date' => 'date:Y-m-d',
        ];
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function offering(): BelongsTo
    {
        return $this->belongsTo(ResortOffering::class, 'resort_offering_id')->withTrashed();
    }

    /** Ranges that touch [from, to] (Y-m-d strings). */
    public function scopeOverlapping(Builder $q, string $from, string $to): Builder
    {
        return $q->where('start_date', '<=', $to)->where('end_date', '>=', $from);
    }
}
