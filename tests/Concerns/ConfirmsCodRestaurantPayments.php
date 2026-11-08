<?php

namespace Tests\Concerns;

use App\Models\CodPurchase;
use App\Models\Order;
use App\Services\NearestRiderService;
use App\Services\PurchasingCashService;

/**
 * Rider trip flow, Stage B (decision 2026-11-08): for COD, food may only become
 * READY after the RESTAURANT confirmed it received the rider's payment
 * (cod_purchases.payment_confirmed_at, enforced by CodPickupPaymentGuard).
 *
 * Suites that test something else (settlement math, realtime, item
 * lifecycles) use this to record the restaurants' confirmation before they
 * mark COD food ready. The confirmation endpoint itself — rider check-in,
 * restaurant scoping, idempotency — is pinned by CodPaidBeforeReadyTest.
 * No-op for prepaid orders.
 */
trait ConfirmsCodRestaurantPayments
{
    /** All restaurants in the order, or only $businessId. */
    protected function confirmRestaurantPayments(Order $order, ?int $businessId = null): void
    {
        $delivery = $order->fresh()->activeDelivery();
        if (! $delivery || ! app(NearestRiderService::class)->isCodDelivery($delivery)) {
            return;
        }

        app(PurchasingCashService::class)->initializeForDelivery($delivery);
        CodPurchase::where('delivery_id', $delivery->id)
            ->when($businessId !== null, fn ($q) => $q->where('business_id', $businessId))
            ->whereNull('payment_confirmed_at')
            ->update(['payment_confirmed_at' => now()]);
    }
}
