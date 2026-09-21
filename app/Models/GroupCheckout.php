<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Relations\MorphMany;

class GroupCheckout extends Model
{
    protected $table = 'group_checkouts';

    protected $fillable = [
        'reference_number',
        'user_id',
        'customer_name',
        'customer_email',
        'customer_phone',
        'order_type',
        'delivery_speed',
        'subtotal',
        'delivery_total',
        'system_fee_total',
        'rider_tip',
        'discount',
        'grand_total',
        'paid_amount',
        'refunded_amount',
        'payment_method',
        'payment_status',
        'status',
        'delivery_address',
        'delivery_latitude',
        'delivery_longitude',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'delivery_latitude' => 'decimal:7',
            'delivery_longitude' => 'decimal:7',
            'rider_tip' => 'decimal:2',
        ];
    }

    public function refunds(): MorphMany
    {
        return $this->morphMany(Refund::class, 'payable');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class, 'group_order_id');
    }

    /**
     * One group checkout -> ONE physical delivery (UNIQUE deliveries.group_checkout_id).
     */
    public function delivery(): HasOne
    {
        return $this->hasOne(Delivery::class, 'group_checkout_id');
    }

    public function payments(): MorphMany
    {
        return $this->morphMany(Payment::class, 'payable');
    }

    /**
     * Compute the aggregate status from the individual child orders.
     */
    public function refreshAggregateStatus(): void
    {
        $orders = $this->orders()->get();

        if ($orders->isEmpty()) {
            return;
        }

        $completedStatuses = ['delivered', 'completed'];
        $revertedStatuses = ['cancelled', 'cancelled_by_tourist', 'rejected', 'refunded'];
        $processingStatuses = ['waiting_restaurant', 'accepted', 'preparing', 'ready', 'assigned', 'en_route_pickup', 'picked_up', 'in_transit', 'out_for_delivery', 'en_route_destination', 'arrived_destination'];
        $allTerminal = $orders->every(fn ($o) => in_array($o->status, [...$completedStatuses, ...$revertedStatuses], true));

        if ($allTerminal) {
            $allReverted = $orders->every(fn ($o) => in_array($o->status, $revertedStatuses, true));
            $allCompleted = $orders->every(fn ($o) => in_array($o->status, $completedStatuses, true));

            $this->update([
                'status' => $allCompleted
                    ? 'completed'
                    : ($allReverted ? 'cancelled' : 'partially_completed'),
            ]);

            return;
        }

        $anyCompleted = $orders->contains(fn ($o) => in_array($o->status, $completedStatuses, true));
        $anyReverted = $orders->contains(fn ($o) => in_array($o->status, $revertedStatuses, true));
        $anyStarted = $orders->contains(fn ($o) => ! in_array($o->status, ['pending_payment', 'pending', 'waiting_restaurant'], true)
            && ! in_array($o->status, [...$completedStatuses, ...$revertedStatuses], true));
        $anyProcessing = $orders->contains(fn ($o) => in_array($o->status, $processingStatuses, true));

        $this->update([
            'status' => $anyCompleted || $anyReverted ? 'partially_completed' : ($anyStarted || $anyProcessing ? 'partially_processing' : 'pending'),
        ]);
    }
}
