<?php

namespace App\Services;

use App\Models\Delivery;

/**
 * Canonical guarded transitions into and out of the restaurant pickup leg.
 *
 * Callers must hold the delivery row lock and emit DeliveryStatusChanged only
 * after their surrounding transaction commits.
 */
class PickupDeliveryTransitionService
{
    public function __construct(
        private PickupSequenceService $pickupSequence,
        private PurchasingCashService $purchasingCash,
        private NearestRiderService $dispatch,
    ) {}

    /**
     * Mark arrival at the shared pickup phase. Repeated calls preserve the
     * original timestamp and return null when no state transition occurred.
     *
     * @return array{old_status: string, new_status: string}|null
     */
    public function arriveAtPickup(Delivery $delivery): ?array
    {
        $status = $delivery->status->value ?? $delivery->status;

        if ($status === 'arrived_pickup') {
            return null;
        }

        if (! in_array($status, ['assigned', 'en_route_pickup'], true)) {
            return null;
        }

        $delivery->update([
            'status' => 'arrived_pickup',
            'arrived_pickup_at' => $delivery->arrived_pickup_at ?? now(),
        ]);

        return ['old_status' => $status, 'new_status' => 'arrived_pickup'];
    }

    /**
     * Apply the existing food-delivery pickup guards and transition while the
     * caller holds the delivery lock and all pickup-stop locks.
     *
     * @return array{old_status: string, new_status: string}|null Null means a
     *         business-rule guard rejected the transition.
     */
    public function pickUp(Delivery $delivery): ?array
    {
        $status = $delivery->status->value ?? $delivery->status;
        if ($status !== 'arrived_pickup' || ! $this->pickupSequence->allConfirmed($delivery)) {
            return null;
        }

        if (
            $this->dispatch->isCodDelivery($delivery)
            && ! $this->purchasingCash->isFullyCollected($delivery->fresh()->load('codPurchases'))
        ) {
            return null;
        }

        $delivery->update([
            'status' => 'picked_up',
            'picked_up_at' => $delivery->picked_up_at ?? now(),
        ]);

        return ['old_status' => 'arrived_pickup', 'new_status' => 'picked_up'];
    }
}
