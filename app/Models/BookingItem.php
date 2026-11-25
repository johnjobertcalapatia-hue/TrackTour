<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A booked line. For resort reservations (Stage 7) it is a priced snapshot of
 * a resort offering: what it was called and cost when booked, how many units /
 * guests / nights, its dates or time slot, and how much inventory it holds per
 * date (allocated_quantity) so a cancellation releases exactly that.
 */
class BookingItem extends Model
{
    protected $fillable = [
        'booking_id',
        'resort_offering_id',
        'description',
        'category',
        'booking_mode',
        'pricing_basis',
        'quantity',
        'units',
        'guests',
        'nights',
        'allocated_quantity',
        'price',
        'subtotal',
        'date',
        'start_date',
        'end_date',
        'slot',
        'snapshot',
    ];

    protected function casts(): array
    {
        return [
            'date' => 'date',
            'start_date' => 'date:Y-m-d',
            'end_date' => 'date:Y-m-d',
            'snapshot' => 'array',
            'units' => 'integer',
            'guests' => 'integer',
            'nights' => 'integer',
            'allocated_quantity' => 'integer',
        ];
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function resortOffering(): BelongsTo
    {
        return $this->belongsTo(ResortOffering::class)->withTrashed();
    }
}
