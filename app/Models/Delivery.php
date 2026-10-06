<?php

namespace App\Models;

use App\Enums\TripStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Collection;

class Delivery extends Model
{
    protected $fillable = [
        'order_id',
        'group_checkout_id',
        'rider_id',
        'delivery_fee',
        'distance_km',
        'estimated_duration_minutes',
        'status',
        'dispatch_status',
        'dispatch_expires_at',
        'scheduled_at',
        'dispatch_attempts',
        'dispatch_retry_at',
        'dispatch_failed_at',
        'dispatch_ended_at',
        'dispatch_end_reason',
        'pickup_address',
        'pickup_latitude',
        'pickup_longitude',
        'pickup_actual_latitude',
        'pickup_actual_longitude',
        'pickup_actual_at',
        'delivery_address',
        'delivery_latitude',
        'delivery_longitude',
        'notes',
        'assigned_at',
        'arrived_pickup_at',
        'picked_up_at',
        'arrived_destination_at',
        'delivered_at',
        'delivery_confirmed_at',
        'delivery_confirmed_by',
        'rider_commission',
        'cash_due',
        'cash_received',
        'change_given',
        'cash_settled_at',
        'purchasing_cash',
        'purchasing_cash_issued_at',
        'purchasing_cash_issued_by',
        'purchasing_cash_received_at',
        'route_history',
        'location_sequence',
    ];

    protected function casts(): array
    {
        return [
            'assigned_at' => 'datetime',
            'arrived_pickup_at' => 'datetime',
            'picked_up_at' => 'datetime',
'arrived_destination_at' => 'datetime',
        'delivered_at' => 'datetime',
        'pickup_actual_at' => 'datetime',
        'delivery_confirmed_at' => 'datetime',
        'dispatch_expires_at' => 'datetime',
            'dispatched_at' => 'datetime',
            'scheduled_at' => 'datetime',
            'dispatch_retry_at' => 'datetime',
            'dispatch_failed_at' => 'datetime',
            'dispatch_ended_at' => 'datetime',
            'dispatch_attempts' => 'integer',
            'pickup_latitude' => 'decimal:7',
            'pickup_longitude' => 'decimal:7',
            'pickup_actual_latitude' => 'decimal:7',
            'pickup_actual_longitude' => 'decimal:7',
            'delivery_latitude' => 'decimal:7',
            'delivery_longitude' => 'decimal:7',
            'delivery_fee' => 'decimal:2',
            'distance_km' => 'decimal:2',
            'rider_commission' => 'decimal:2',
            'cash_due' => 'decimal:2',
            'cash_received' => 'decimal:2',
            'change_given' => 'decimal:2',
            'cash_settled_at' => 'datetime',
            'purchasing_cash' => 'decimal:2',
            'purchasing_cash_issued_at' => 'datetime',
            'purchasing_cash_received_at' => 'datetime',
            'estimated_duration_minutes' => 'integer',
            'route_history' => 'array',
            'status' => TripStatus::class,
        ];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function groupCheckout(): BelongsTo
    {
        return $this->belongsTo(GroupCheckout::class, 'group_checkout_id');
    }

    /**
     * A group checkout owns ONE physical delivery. Group deliveries have a
     * NULL order_id and are anchored on the group checkout (UNIQUE).
     */
    public function isGroup(): bool
    {
        return $this->group_checkout_id !== null;
    }

    /**
     * Primary order for a delivery: standalone orders reference themselves;
     * group deliveries resolve to the first (pickup-point) child order.
     */
    public function primaryOrder(): ?Order
    {
        if ($this->order_id !== null) {
            return $this->order;
        }

        return $this->groupCheckout?->orders()->orderBy('id')->first();
    }

    /**
     * All restaurant orders fulfilled by this delivery (one for standalone,
     * every child order for a group delivery).
     */
    public function childOrders(): Collection
    {
        if ($this->order_id !== null) {
            return $this->order ? collect([$this->order]) : collect();
        }

        return $this->groupCheckout?->orders()->orderBy('id')->get() ?? collect();
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function dispatchLogs(): HasMany
    {
        return $this->hasMany(BookingDispatchLog::class, 'delivery_id');
    }

    public function tripLog(): HasOne
    {
        return $this->hasOne(TripLog::class);
    }

    public function codPurchases(): HasMany
    {
        return $this->hasMany(CodPurchase::class);
    }
}
