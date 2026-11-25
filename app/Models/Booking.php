<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Booking extends Model
{
    use SoftDeletes;

    /** Booking types; resort reservations (Stage 7) are priced from resort offerings. */
    public const TYPE_RESORT = 'resort';

    public const STATUS_PENDING = 'pending';

    public const STATUS_CONFIRMED = 'confirmed';

    public const STATUS_REJECTED = 'rejected';

    public const STATUS_CANCELLED = 'cancelled';

    public const STATUS_COMPLETED = 'completed';

    public const STATUS_NO_SHOW = 'no_show';

    /** Stage 8: an unpaid GCash reservation whose 30-minute hold ran out. */
    public const STATUS_EXPIRED = 'expired';

    protected $fillable = [
        'booking_number',
        'client_reference',
        'business_id',
        'user_id',
        'customer_name',
        'customer_email',
        'customer_phone',
        'booking_type',
        'status',
        'check_in_date',
        'check_out_date',
        'check_in_time',
        'guests',
        'subtotal',
        'total_amount',
        'paid_amount',
        'payment_status',
        'payment_option',
        'payment_due_at',
        'refund_due',
        'notes',
        'cancellation_policy',
        'cancelled_by',
        'cancellation_reason',
        'cancelled_at',
        'confirmed_at',
        'completed_at',
    ];

    protected function casts(): array
    {
        return [
            'check_in_date' => 'date',
            'check_out_date' => 'date',
            'check_in_time' => 'datetime',
            'cancelled_at' => 'datetime',
            'confirmed_at' => 'datetime',
            'payment_due_at' => 'datetime',
            'completed_at' => 'datetime',
            'cancellation_policy' => 'array',
        ];
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(BookingItem::class);
    }

    public function statusLogs(): HasMany
    {
        return $this->hasMany(BookingStatusLog::class)->orderBy('created_at')->orderBy('id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function isResortReservation(): bool
    {
        return $this->booking_type === self::TYPE_RESORT;
    }
}
