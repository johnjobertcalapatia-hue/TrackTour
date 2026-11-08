<?php

namespace App\Services;

use App\Models\Business;
use App\Models\CodPurchase;
use App\Models\Delivery;
use App\Models\DeliveryPickupStop;
use App\Models\Order;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * The restaurant's "Payment received" action (rider trip flow, Stage B).
 *
 * For a COD delivery the rider pays the restaurant at its pickup stop; the
 * RESTAURANT confirms receipt. Only that confirmation unlocks READY for the
 * restaurant's items (CodPickupPaymentGuard). Preconditions, re-checked under
 * the cod_purchases row lock:
 *   - COD delivery order with an assigned rider still in the pickup stage
 *   - the restaurant has active items in the order
 *   - the rider confirmed arrival at THIS restaurant (≤ pickup radius, 50 m)
 * Idempotent: a second confirmation is a harmless no-op. If the preparation
 * timer already ran out, the paid restaurant's food becomes ready at once.
 */
class CodPaymentConfirmationService
{
    public const PICKUP_STAGE = ['assigned', 'en_route_pickup', 'arrived_pickup'];

    public function __construct(private CodPickupPaymentGuard $guard) {}

    /**
     * @return array{already_confirmed: bool, payment_confirmed_at: string, business_id: int, order_ready: bool}
     *
     * @throws InvalidArgumentException
     */
    public function confirm(Order $order, Business $business, User $by): array
    {
        if (! $this->guard->appliesTo($order)) {
            throw new InvalidArgumentException('This is not a cash-on-delivery order.');
        }

        $delivery = $order->activeDelivery();
        if (! $delivery || $delivery->rider_id === null) {
            throw new InvalidArgumentException('No rider has accepted this delivery yet.');
        }

        $hasItems = $order->items()
            ->whereNotIn('status', ['cancelled', 'rejected'])
            ->where(fn ($q) => $q->where('business_id', $business->id)
                ->orWhere(fn ($n) => $n->whereNull('business_id')->whereRaw('? = ?', [(int) $order->business_id, $business->id])))
            ->exists();
        if (! $hasItems) {
            throw new InvalidArgumentException('Your restaurant has no items in this order.');
        }

        $result = DB::transaction(function () use ($delivery, $business, $by, $order) {
            $lockedDelivery = Delivery::lockForUpdate()->find($delivery->id);
            $status = $lockedDelivery?->status?->value ?? $lockedDelivery?->status;
            if (! $lockedDelivery || ! in_array($status, self::PICKUP_STAGE, true)) {
                throw new InvalidArgumentException('Payment can only be confirmed while the rider is picking up the food.');
            }

            app(PickupSequenceService::class)->ensureStops($lockedDelivery);
            $stop = DeliveryPickupStop::where('delivery_id', $lockedDelivery->id)
                ->where('business_id', $business->id)
                ->first();
            if (! $stop || $stop->arrived_at === null) {
                throw new InvalidArgumentException('The rider has not arrived at your restaurant yet. Confirm payment once the rider is here and has paid.');
            }

            app(PurchasingCashService::class)->initializeForDelivery($lockedDelivery);
            $purchase = CodPurchase::where('delivery_id', $lockedDelivery->id)
                ->where('business_id', $business->id)
                ->lockForUpdate()
                ->first();
            if (! $purchase) {
                throw new InvalidArgumentException('No payment record exists for your restaurant on this delivery.');
            }

            if ($purchase->payment_confirmed_at !== null) {
                return ['already_confirmed' => true, 'purchase' => $purchase];
            }

            $purchase->update(array_filter([
                'payment_confirmed_at' => now(),
                'payment_confirmed_by' => $by->id,
                // Keep the rider's ledger in step: paid means purchased.
                'status' => $purchase->status === CodPurchase::STATUS_PENDING ? CodPurchase::STATUS_PURCHASED : null,
                'purchased_at' => $purchase->purchased_at === null ? now() : null,
            ], fn ($v) => $v !== null));

            return ['already_confirmed' => false, 'purchase' => $purchase->fresh()];
        });

        // Timer already ran out: ready this restaurant's food now (the guard
        // inside the preparation service decides what may become ready).
        app(PreparationStartService::class)->completeIfDue($order->fresh());

        return [
            'already_confirmed' => $result['already_confirmed'],
            'payment_confirmed_at' => $result['purchase']->payment_confirmed_at->toIso8601String(),
            'business_id' => $business->id,
            'order_ready' => $order->fresh()->status === 'ready',
        ];
    }
}
