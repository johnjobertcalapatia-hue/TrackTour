<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * How much of an offering is reserved on one date (and time slot) —
 * resort reservations Stage 6. Changed only by ResortAvailabilityService,
 * inside a transaction under a row lock.
 */
class ResortOfferingAllocation extends Model
{
    protected $fillable = ['resort_offering_id', 'date', 'slot', 'reserved_quantity'];

    protected function casts(): array
    {
        return [
            'date' => 'date:Y-m-d',
            'reserved_quantity' => 'integer',
        ];
    }

    public function offering(): BelongsTo
    {
        return $this->belongsTo(ResortOffering::class, 'resort_offering_id')->withTrashed();
    }
}
