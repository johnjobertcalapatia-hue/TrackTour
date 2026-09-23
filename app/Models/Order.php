<?php

namespace App\Models;

use App\Events\OrderStatusChanged;
use App\Services\OrderSizeClassifier;
use App\Services\SmartDispatchService;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\Log;

class Order extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'order_number',
        'business_id',
        'group_order_id',
        'user_id',
        'customer_name',
        'customer_email',
        'customer_phone',
        'order_type',
        'size_class',
        'delivery_speed',
        'payment_method',
        'payment_status',
        'status',
        'subtotal',
        'delivery_fee',
        'rider_tip',
        'delivery_distance_km',
        'delivery_duration_minutes',
        'pickup_latitude',
        'pickup_longitude',
        'delivery_latitude',
        'delivery_longitude',
        'delivery_fee_calculated_at',
        'delivery_distance_is_estimated',
        'discount',
        'system_fee',
        'rider_financed_amount',
        'rider_delivery_earnings',
        'total',
        'paid_amount',
        'refunded_amount',
        'rating',
        'review',
        'notes',
        'delivery_address',
        'cancelled_by',
        'cancellation_reason',
        'cancelled_at',
        'completed_at',
        'acceptance_started_at',
        'accepted_at',
        'acceptance_deadline',
        'refund_status',
        'refund_amount',
        'paymongo_refund_id',
        'refund_requested_at',
        'refunded_at',
        'refund_failure_reason',
        'predicted_preparation_seconds',
        'predicted_ready_at',
        'preparation_started_at',
        'food_ready_at',
        'actual_preparation_seconds',
        'prediction_error_seconds',
        'prediction_source',
        'preparation_time',
        'dispatch_scheduled_at',
        'dispatch_started_at',
        'selected_rider_id',
        'rider_eta_seconds',
        'pickup_buffer_seconds',
        'estimated_rider_arrival_at',
        'actual_rider_arrival_at',
        'actual_pickup_at',
    ];

    protected function casts(): array
    {
        return [
            'cancelled_at' => 'datetime',
            'completed_at' => 'datetime',
            'acceptance_started_at' => 'datetime',
            'accepted_at' => 'datetime',
            'acceptance_deadline' => 'datetime',
            'refund_requested_at' => 'datetime',
            'refunded_at' => 'datetime',
            'predicted_ready_at' => 'datetime',
            'preparation_started_at' => 'datetime',
            'food_ready_at' => 'datetime',
            'dispatch_scheduled_at' => 'datetime',
            'dispatch_started_at' => 'datetime',
            'estimated_rider_arrival_at' => 'datetime',
            'actual_rider_arrival_at' => 'datetime',
            'actual_pickup_at' => 'datetime',
            'delivery_distance_km' => 'decimal:2',
            'delivery_duration_minutes' => 'integer',
            'pickup_latitude' => 'decimal:7',
            'pickup_longitude' => 'decimal:7',
            'delivery_latitude' => 'decimal:7',
            'delivery_longitude' => 'decimal:7',
            'delivery_fee_calculated_at' => 'datetime',
            'delivery_distance_is_estimated' => 'boolean',
            'rider_tip' => 'decimal:2',
            'system_fee' => 'decimal:2',
            'rider_financed_amount' => 'decimal:2',
            'rider_delivery_earnings' => 'decimal:2',
            'refund_amount' => 'decimal:2',
            'predicted_preparation_seconds' => 'integer',
            'actual_preparation_seconds' => 'integer',
            'prediction_error_seconds' => 'integer',
            'preparation_time' => 'integer',
            'rider_eta_seconds' => 'integer',
            'pickup_buffer_seconds' => 'integer',
        ];
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function isManagedBy(User $user): bool
    {
        if ($this->business?->owner_id === $user->id) {
            return true;
        }

        return $this->items()
            ->whereHas('business', fn ($query) => $query->where('owner_id', $user->id))
            ->exists();
    }

    public function groupOrder(): BelongsTo
    {
        return $this->belongsTo(GroupCheckout::class, 'group_order_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    /**
     * Recompute and persist the P5.2 order-size tag ('normal' | 'large').
     */
    public function refreshSizeClass(): string
    {
        return app(OrderSizeClassifier::class)->sync($this);
    }

    public function delivery(): HasOne
    {
        return $this->hasOne(Delivery::class);
    }

    /** The single delivery trip that fulfills this order. */
    public function activeDelivery(): ?Delivery
    {
        return $this->delivery ?? $this->groupOrder?->delivery;
    }

    public function settlement(): HasOne
    {
        return $this->hasOne(OrderSettlement::class);
    }

    /**
     * A rider has accepted the delivery trip for this order.
     *
    * The P11.2 contract requires an accepted/assigned rider before any
    * restaurant item in this order may start preparing.
     */
    public function hasAcceptedRider(): bool
    {
        $delivery = $this->activeDelivery();

        return $delivery !== null && $delivery->rider_id !== null;
    }

    public function canceller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'cancelled_by');
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class, 'payable_id')
            ->where('payable_type', self::class);
    }

    public function refunds(): MorphMany
    {
        return $this->morphMany(Refund::class, 'payable');
    }

    public function cancellations()
    {
        return $this->hasMany(OrderCancellation::class);
    }

    public function preparationRecords()
    {
        return $this->hasMany(FoodPreparationRecord::class, 'restaurant_order_id');
    }

    public function predictionLogs()
    {
        return $this->hasMany(PreparationPredictionLog::class, 'restaurant_order_id');
    }

    public function selectedRider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'selected_rider_id');
    }

    public function riderEarnings()
    {
        return $this->hasMany(RiderEarning::class);
    }

    /**
     * Calculate the system fee (configurable percentage of food subtotal, default 10%).
     */
    public static function calculateSystemFee(float $subtotal): float
    {
        $percentage = (float) config('delivery.system_fee_percentage', 10.0);

        return round($subtotal * ($percentage / 100), 2);
    }

    /**
     * Calculate the rider financed amount (food subtotal + system fee).
     * This is the amount reserved from rider credits for COD orders.
     */
    public static function calculateRiderFinancedAmount(float $subtotal, float $systemFee): float
    {
        return round($subtotal + $systemFee, 2);
    }

    /**
     * Calculate the customer COD total (food subtotal + delivery fee + system fee).
     */
    public static function calculateCustomerCodTotal(float $subtotal, float $deliveryFee, float $systemFee): float
    {
        return round($subtotal + $deliveryFee + $systemFee, 2);
    }

    /**
     * Refresh the restaurant sub-order status based on the preparation statuses of all its items.
     * Rule:
     * - A restaurant sub-order CANNOT become 'ready' (READY_FOR_PICKUP) until ALL active items
     *   belonging to that restaurant are ready.
     * - If all items are cancelled or rejected -> 'cancelled'.
     * - If all active items are 'ready' -> 'ready' (READY_FOR_PICKUP) & trigger smart dispatch.
     * - If at least one active item is actually 'preparing' -> 'preparing' (the kitchen is cooking).
     * - Otherwise, if at least one active item is 'accepted' -> 'accepted'. Merely-accepted or
     *   still-pending items (e.g. a sibling rejected through the item-status endpoint, or one
     *   accepted while another stays pending) must NEVER authorize 'preparing' on their own — a
     *   reject is a refusal, not a cooking action, and a single item acceptance does not start
     *   the kitchen (P11.6).
     */
    public function refreshStatusFromItems(): void
    {
        $items = $this->items()->get();
        if ($items->isEmpty()) {
            return;
        }

        $previousStatus = (string) $this->status;

        $cancelledStatuses = ['cancelled', 'rejected'];
        $activeItems = $items->reject(fn ($item) => in_array($item->status, $cancelledStatuses, true));
        $totalItems = $items->count();
        $cancelledCount = $items->filter(fn ($item) => in_array($item->status, $cancelledStatuses, true))->count();

        // 1. All items rejected or cancelled -> sub-order cancelled
        if ($cancelledCount === $totalItems) {
            $this->update(['status' => 'cancelled']);
            $this->groupOrder?->refreshAggregateStatus();
            $this->broadcastStatusChange($previousStatus);

            return;
        }

        // 2. All active items ready -> READY_FOR_PICKUP ('ready')
        if ($activeItems->isNotEmpty() && $activeItems->every(fn ($item) => $item->status === 'ready')) {
            $this->update([
                'status' => 'ready',
                'food_ready_at' => $this->food_ready_at ?? now(),
            ]);

            if ($this->delivery && $this->delivery->dispatch_status === 'scheduled') {
                try {
                    app(SmartDispatchService::class)->dispatchNow($this, $this->delivery);
                } catch (\Exception $e) {
                    Log::warning('Dispatch-on-ready failed via refreshStatusFromItems', [
                        'order_id' => $this->id,
                        'delivery_id' => $this->delivery->id,
                        'error' => $e->getMessage(),
                    ]);
                }
            }

            $this->groupOrder?->refreshAggregateStatus();
            $this->broadcastStatusChange($previousStatus);

            return;
        }

        // 3. 'preparing' requires at least one active item actually being prepared;
        // accepted-only item sets stay 'accepted'. A pending resume is a started
        // preparation, so a sub-order never enters 'preparing' just because a
        // sibling item remains pending.
        // Don't regress terminal or active delivery states (picked_up, in_transit, delivered, completed)
        $deliveryOrTerminalStatuses = [
            'picked_up', 'in_transit', 'out_for_delivery', 'en_route_destination',
            'arrived_destination', 'delivered', 'completed', 'cancelled',
        ];

        if (! in_array($this->status, $deliveryOrTerminalStatuses, true)) {
            $preparingCount = $activeItems->where('status', 'preparing')->count();
            $acceptedCount = $activeItems->where('status', 'accepted')->count();

            $preparationUnlocked = $this->order_type !== 'delivery' || $this->hasAcceptedRider();

            if ($preparationUnlocked && $preparingCount > 0) {
                $this->update(['status' => 'preparing']);
            } elseif ($acceptedCount > 0) {
                $this->update(['status' => 'accepted']);
            }
        }

        $this->groupOrder?->refreshAggregateStatus();
        $this->broadcastStatusChange($previousStatus);
    }

    /**
     * P11.5 — Emit the canonical OrderStatusChanged event whenever the item
     * recalculation moved this order to a different status. The event is only
     * dispatched when a real transition occurred (duplicate-safe), and the
     * bridge listener routes it to the business/user/trip/rider rooms.
     */
    private function broadcastStatusChange(string $previousStatus): void
    {
        $nextStatus = (string) $this->fresh()->status;

        if ($nextStatus === $previousStatus) {
            return;
        }

        OrderStatusChanged::dispatch($this->fresh(), $previousStatus, $nextStatus);
    }
}
