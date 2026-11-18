<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A bookable rider onboarding session at a Tourism Office. */
class RiderTrainingSchedule extends Model
{
    public const STATUS_OPEN = 'open';
    public const STATUS_CLOSED = 'closed';

    protected $fillable = [
        'municipality_id', 'starts_at', 'capacity', 'booked_count', 'location_name', 'location_address', 'status', 'created_by',
    ];

    protected $casts = [
        'starts_at' => 'datetime',
        'capacity' => 'integer',
        'booked_count' => 'integer',
    ];

    public function municipality(): BelongsTo
    {
        return $this->belongsTo(Municipality::class);
    }

    public function appointments(): HasMany
    {
        return $this->hasMany(RiderAppointment::class, 'schedule_id');
    }

    public function remaining(): int
    {
        return max(0, $this->capacity - $this->booked_count);
    }
}
