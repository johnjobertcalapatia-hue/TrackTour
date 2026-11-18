<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RiderAppointment extends Model
{
    public const STATUS_BOOKED = 'booked';
    public const STATUS_CHECKED_IN = 'checked_in';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_CANCELLED = 'cancelled';
    public const STATUS_NO_SHOW = 'no_show';

    /** Statuses that hold a seat and count as the rider's active appointment. */
    public const ACTIVE = [self::STATUS_BOOKED, self::STATUS_CHECKED_IN];

    protected $fillable = [
        'rider_id', 'schedule_id', 'status', 'active_rider_id', 'walk_in', 'booked_by', 'checked_in_at', 'cancelled_at',
    ];

    protected $casts = [
        'walk_in' => 'boolean',
        'checked_in_at' => 'datetime',
        'cancelled_at' => 'datetime',
    ];

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function schedule(): BelongsTo
    {
        return $this->belongsTo(RiderTrainingSchedule::class, 'schedule_id');
    }

    public function isActive(): bool
    {
        return in_array($this->status, self::ACTIVE, true);
    }
}
