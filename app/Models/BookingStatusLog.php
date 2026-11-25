<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One status change of a booking (resort reservations Stage 7). Append-only. */
class BookingStatusLog extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['booking_id', 'from_status', 'to_status', 'actor_id', 'actor_type', 'reason'];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new \LogicException('Booking status history is never changed.'));
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
