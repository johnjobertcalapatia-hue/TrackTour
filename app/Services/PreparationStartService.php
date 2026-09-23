<?php

namespace App\Services;

use App\Events\OrderStatusChanged;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RestaurantSetting;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Canonical preparation lifecycle for restaurant orders.
 *
 * Business rule (AGENTS §4.2 + restaurant order spec):
 *
 *   customer orders → waiting_restaurant (Finding Rider)
 *       → system offers the trip to riders
 *       → rider accepts
 *       → waiting_restaurant → PREPARING and the countdown starts
 *       → countdown reaches 00:00
 *       → PREPARING → READY (automatic)
 *
 * The restaurant never manually accepts or rejects an order, and the timer
 * never starts before an accepted rider exists (delivery orders), so search
 * time never eats into the kitchen's preparation window.
 *
 * The preparation duration is restaurant-defined:
 *
 *   base      = MAX(order_items.preparation_time)   (snapshot at order time)
 *   fallback  = businesses.average_wait_time ?? 15 minutes
 *   reduction = optional priority-tip reduction configured on
 *               restaurant_settings (disabled by default)
 *   effective = max(1, base - reduction)
 *
 * The effective minutes are snapshotted on orders.preparation_time so later
 * menu edits never mutate an in-flight order's timer (spec §16).
 *
 * This service is idempotent: it only ever transitions orders still sitting in
 * waiting_restaurant, under a row lock, so the rider-acceptance hook, the
 * pickup/payment paths and the minute scheduler can all call it safely.
 */
class PreparationStartService
{
    public const DEFAULT_PREPARATION_MINUTES = 15;

    /** Order types that actually cook food (transport orders never prepare). */
    public const PREPARABLE_ORDER_TYPES = ['delivery', 'pickup'];

    /**
     * Start preparation for every order riding on this delivery. One accepted
     * rider unlocks every restaurant in a group checkout (AGENTS §4.1), each
     * with its own restaurant-defined countdown.
     */
    public function startForDelivery(Delivery $delivery): void
    {
        $delivery->loadMissing('groupCheckout');

        if ($delivery->group_checkout_id !== null) {
            $orders = Order::where('group_order_id', $delivery->group_checkout_id)
                ->whereIn('status', ['waiting_restaurant'])
                ->get();
        } elseif ($delivery->order_id !== null) {
            $orders = Order::where('id', $delivery->order_id)
                ->whereIn('status', ['waiting_restaurant'])
                ->get();
        } else {
            return;
        }

        foreach ($orders as $order) {
            $this->startForOrder($order);
        }
    }

    /**
     * Transition one order into 'preparing' and start its countdown timer.
     *
     * Eligibility (checked again under the row lock):
     *   - the order is still waiting_restaurant
     *   - the order type is a food order
     *   - delivery orders have an accepted rider (AGENTS §4.2)
     *
     * Returns true when this call performed the transition.
     */
    public function startForOrder(Order $order): bool
    {
        if (! in_array($order->order_type, self::PREPARABLE_ORDER_TYPES, true)) {
            return false;
        }

        return (bool) DB::transaction(function () use ($order) {
            $locked = Order::whereKey($order->id)
                ->where('status', 'waiting_restaurant')
                ->lockForUpdate()
                ->first();

            if (! $locked) {
                return false; // Already started (or cancelled) elsewhere.
            }

            // Rider acceptance gate: a delivery order may only start cooking
            // once a rider has accepted its trip (checked under the lock so a
            // concurrent acceptance/cancellation cannot race this start).
            if ($locked->order_type === 'delivery' && ! $locked->hasAcceptedRider()) {
                return false;
            }

            $minutes = $this->effectivePreparationMinutes($locked);
            $readyAt = now()->addMinutes($minutes);

            $locked->items()
                ->whereIn('status', ['pending', 'accepted'])
                ->update([
                    'status' => 'preparing',
                    'accepted_at' => now(),
                    'preparation_started_at' => now(),
                ]);

            $orderData = [
                'status' => 'preparing',
                'accepted_at' => $locked->accepted_at ?? now(),
                'preparation_started_at' => now(),
                'predicted_ready_at' => $readyAt,
                'predicted_preparation_seconds' => $minutes * 60,
                'preparation_time' => $minutes,
                // The restaurant's menu definition is authoritative for the
                // order timer (not the historical prediction engine).
                'prediction_source' => 'restaurant_default',
            ];

            // Capture an authorized online payment now that the order is
            // confirmed into preparation (moved from the removed restaurant
            // accept endpoints; a COD order has no payment row here).
            $payment = Payment::where('payable_type', Order::class)
                ->where('payable_id', $locked->id)
                ->where('status', 'authorized')
                ->first();

            if ($payment) {
                $payment->update([
                    'status' => 'paid',
                    'paid_at' => now(),
                ]);
                $orderData['payment_status'] = 'paid';
            }

            $locked->update($orderData);

            OrderStatusChanged::dispatch(
                $locked->fresh(),
                'waiting_restaurant',
                'preparing',
            );

            return true;
        });
    }

    /**
     * Auto-complete every countdown that has reached 00:00:
     * preparing → ready (order + active items), with the canonical
     * OrderStatusChanged broadcast so restaurant, rider and tourist rooms all
     * learn the food is ready for pickup without a manual refresh.
     *
     * Returns the number of orders advanced to ready.
     */
    public function completeDuePreparations(): int
    {
        $dueIds = Order::where('status', 'preparing')
            ->whereNotNull('predicted_ready_at')
            ->where('predicted_ready_at', '<=', now())
            ->pluck('id');

        $completed = 0;

        foreach ($dueIds as $orderId) {
            if ($this->completePreparation((int) $orderId)) {
                $completed++;
            }
        }

        return $completed;
    }

    /**
     * Promote waiting orders that are already preparation-eligible but were
     * never transitioned (missed event, legacy row, payment-path gap).
     * The scheduler calls this so no order can silently strand itself in
     * 'Finding Rider' after its rider already accepted.
     *
     * Returns the number of orders promoted to preparing.
     */
    public function startEligibleWaitingOrders(): int
    {
        $candidateIds = Order::where('status', 'waiting_restaurant')
            ->whereIn('order_type', self::PREPARABLE_ORDER_TYPES)
            ->where(function ($q) {
                $q->where('order_type', '!=', 'delivery') // pickup: no rider needed
                    ->orWhereHas('delivery', fn ($d) => $d->whereNotNull('rider_id'))
                    ->orWhereHas('groupOrder.delivery', fn ($d) => $d->whereNotNull('rider_id'));
            })
            ->pluck('id');

        $started = 0;

        foreach ($candidateIds as $orderId) {
            if ($this->startForOrder(Order::find($orderId))) {
                $started++;
            }
        }

        return $started;
    }

    /**
     * The effective countdown length for this order, in whole minutes.
     */
    public function effectivePreparationMinutes(Order $order): int
    {
        $base = $this->basePreparationMinutes($order);
        $reduction = $this->priorityReductionMinutes($order);

        return max(1, $base - $reduction);
    }

    /**
     * Longest preparation time among the active ordered items (items cook in
     * parallel, so quantity never multiplies the time). Items ordered before
     * the snapshot existed fall back to the business wait time, then the
     * historical 15-minute default.
     */
    public function basePreparationMinutes(Order $order): int
    {
        $maxItemMinutes = (int) $order->items()
            ->whereNotIn('status', ['cancelled', 'rejected'])
            ->whereNotNull('preparation_time')
            ->max('preparation_time');

        if ($maxItemMinutes > 0) {
            return $maxItemMinutes;
        }

        $business = $order->business()->first();

        if ($business?->average_wait_time) {
            return (int) $business->average_wait_time;
        }

        return self::DEFAULT_PREPARATION_MINUTES;
    }

    /**
     * Optional restaurant-configured reduction for priority tips
     * (₱25 / ₱50 / ₱100 tiers). Zero unless the restaurant opted in.
     */
    public function priorityReductionMinutes(Order $order): int
    {
        $settings = RestaurantSetting::where('restaurant_id', $order->business_id)->first();

        if (! $settings || ! $settings->priority_preparation_reduction_enabled) {
            return 0;
        }

        $tip = (int) round((float) ($order->rider_tip ?? 0));

        return match (true) {
            $tip >= 100 => (int) $settings->priority_reduction_minutes_100,
            $tip >= 50 => (int) $settings->priority_reduction_minutes_50,
            $tip >= 25 => (int) $settings->priority_reduction_minutes_25,
            default => 0,
        };
    }

    /**
     * Flip one due order to 'ready'. Runs under the row lock so a manual
     * mark-ready racing the scheduler can never double-fire the transition.
     */
    private function completePreparation(int $orderId): bool
    {
        try {
            return (bool) DB::transaction(function () use ($orderId) {
                $locked = Order::whereKey($orderId)
                    ->where('status', 'preparing')
                    ->lockForUpdate()
                    ->first();

                if (! $locked) {
                    return false; // Already readied manually or cancelled.
                }

                $locked->items()
                    ->whereNotIn('status', ['cancelled', 'rejected'])
                    ->update([
                        'status' => 'ready',
                        'ready_at' => now(),
                    ]);

                $locked->update([
                    'status' => 'ready',
                    'food_ready_at' => $locked->food_ready_at ?? now(),
                ]);

                // Same safety valve as the manual mark-ready path: if smart
                // dispatch parked a future wave, fire it now that food exists.
                if ($locked->delivery && $locked->delivery->dispatch_status === 'scheduled') {
                    try {
                        app(SmartDispatchService::class)->dispatchNow($locked, $locked->delivery);
                    } catch (\Exception $e) {
                        Log::warning('Dispatch-on-ready failed via auto completion', [
                            'order_id' => $locked->id,
                            'delivery_id' => $locked->delivery->id,
                            'error' => $e->getMessage(),
                        ]);
                    }
                }

                $locked->groupOrder?->refreshAggregateStatus();

                // Keep the prediction/learning tables accurate, exactly like
                // the manual mark-ready endpoint does.
                try {
                    app(PreparationPredictionService::class)->recordActualPreparation($locked->fresh());
                } catch (\Exception $e) {
                    Log::warning('Failed to record preparation data on auto-ready', [
                        'order_id' => $locked->id,
                        'error' => $e->getMessage(),
                    ]);
                }

                OrderStatusChanged::dispatch(
                    $locked->fresh(),
                    'preparing',
                    'ready',
                );

                return true;
            });
        } catch (\Throwable $e) {
            Log::warning('Auto completion of preparation failed', [
                'order_id' => $orderId,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }
}
