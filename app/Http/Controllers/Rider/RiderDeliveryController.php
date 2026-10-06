<?php

namespace App\Http\Controllers\Rider;

use App\Enums\TripStatus;
use App\Events\DeliveryStatusChanged;
use App\Http\Controllers\Controller;
use App\Http\Resources\DeliveryResource;
use App\Models\Delivery;
use App\Models\User;
use App\Services\DeliveryService;
use App\Services\NearestRiderService;
use App\Services\TransportationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class RiderDeliveryController extends Controller
{
    public function __construct(
        private DeliveryService $deliveryService,
        private NearestRiderService $dispatchService
    ) {}

    public function pending(Request $request): JsonResponse
    {
        $deliveries = $this->deliveryService->getPendingDeliveries($request->user()->id, 15);

        return $this->successResponse(
            DeliveryResource::collection($deliveries),
            'Pending deliveries retrieved.'
        );
    }

    public function active(Request $request): JsonResponse
    {
        $deliveries = $this->deliveryService->getActiveDeliveries($request->user()->id);

        return $this->successResponse(
            DeliveryResource::collection($deliveries),
            'Active deliveries retrieved.'
        );
    }

    public function completed(Request $request): JsonResponse
    {
        $deliveries = $this->deliveryService->getCompletedDeliveries($request->user()->id, 15);

        return $this->paginatedResponse($deliveries, 'Completed deliveries retrieved.');
    }

    public function updateStatus(Request $request, Delivery $delivery): JsonResponse
    {
        if ((int) $delivery->rider_id !== (int) $request->user()?->id) {
            return $this->forbiddenResponse('You are not assigned to this delivery.');
        }

        $validTransitions = [
            'arrived_pickup' => ['field' => 'arrived_pickup_at', 'from' => ['assigned', 'arrived_pickup']],
            'picked_up' => ['field' => 'picked_up_at', 'from' => ['arrived_pickup']],
            'in_transit' => ['field' => null, 'from' => ['arrived_pickup', 'picked_up']],
            'arrived_destination' => ['field' => 'arrived_destination_at', 'from' => ['picked_up', 'in_transit', 'arrived_destination']],
            'delivered' => ['field' => 'delivered_at', 'from' => ['arrived_destination']],
        ];

        $newStatus = $request->input('status');

        if (! isset($validTransitions[$newStatus])) {
            return $this->errorResponse('Invalid status transition.', 422);
        }

        // Perform the transition under a row lock on the delivery so the terminal
        // decision (delivered vs auto-cancel / restaurant-cancel racing in) is made
        // from the authoritative committed state, not a stale pre-read.
        $outcome = DB::transaction(function () use ($request, $delivery, $newStatus, $validTransitions) {
            $locked = Delivery::lockForUpdate()->find($delivery->id);

            if (! $locked || (int) $locked->rider_id !== (int) $request->user()?->id) {
                return ['error' => 'forbidden'];
            }

            $currentStatus = $locked->status->value ?? $locked->status;
            if (! in_array($currentStatus, $validTransitions[$newStatus]['from'])) {
                return ['error' => 'invalid_transition', 'current' => $currentStatus];
            }

            $oldStatus = $currentStatus;
            $updateData = ['status' => $newStatus];
            $timestampField = $validTransitions[$newStatus]['field'];
            if ($timestampField) {
                $updateData[$timestampField] = now();
            }

            // Every food delivery must confirm each restaurant pickup before
            // leaving the pickup area. COD additionally requires the matching
            // purchasing-cash ledger to be fully collected.
            if (
                in_array($newStatus, ['picked_up', 'in_transit'], true)
                && ! app(\App\Services\PickupSequenceService::class)->allConfirmed($locked)
            ) {
                return ['error' => 'not_all_collected'];
            }

            if (
                $newStatus === 'picked_up'
                && $this->dispatchService->isCodDelivery($locked)
                && ! app(\App\Services\PurchasingCashService::class)->isFullyCollected($locked)
            ) {
                return ['error' => 'not_all_collected'];
            }

            // P14 — tourist delivery-confirmation gate. Evaluated BEFORE the
            // status write so a rejected rider 'delivered' never mutates the
            // delivery (food deliveries only reach 'delivered' when the TOURIST
            // confirms receipt at the drop-off via POST /tourist/food/order/{order}/confirm-delivery).
            if (
                $newStatus === 'delivered'
                && $this->dispatchService->requiresTouristConfirmation($locked)
            ) {
                return ['error' => 'tourist_confirmation_required'];
            }

            $locked->update($updateData);

            $finalStatus = $newStatus;

            if ($newStatus === 'delivered') {
                if ($this->dispatchService->isCodDelivery($locked)) {
                    // COD: freeze the cash snapshot and keep the rider busy until the
                    // cash settlement step (settle-cod) completes the delivery.
                    $this->dispatchService->markCodDelivered($locked);
                } else {
                    // Prepaid: the delivery is complete once confirmed delivered, so
                    // the order reaches the canonical 'completed' terminal state too.
                    $this->dispatchService->completeDelivery($locked);
                    $locked->update(['status' => TripStatus::COMPLETED->value]);
                    $finalStatus = TripStatus::COMPLETED->value;
                    $user = User::find($locked->rider_id);
                    $user?->riderDetail()?->updateOrCreate(
                        ['user_id' => $locked->rider_id],
                        ['rider_status' => User::RIDER_STATUS_AVAILABLE, 'rider_status_updated_at' => now()]
                    );
                }
            }

            return ['error' => null, 'old_status' => $oldStatus, 'new_status' => $newStatus, 'final_status' => $finalStatus];
        });

        if ($outcome['error'] === 'forbidden') {
            return $this->forbiddenResponse('You are not assigned to this delivery.');
        }

        if ($outcome['error'] === 'invalid_transition') {
            return $this->errorResponse(
                'Delivery must be ' . strtoupper(str_replace('_', ' ', $outcome['current'])) .
                ' before moving to ' . strtoupper(str_replace('_', ' ', $newStatus)) . '.',
                409
            );
        }

        if ($outcome['error'] === 'not_all_collected') {
            return $this->errorResponse(
                'Collect food from every restaurant before leaving the pickup area.',
                422
            );
        }

        if ($outcome['error'] === 'tourist_confirmation_required') {
            return $this->errorResponse(
                'The tourist must confirm the delivery before it can be marked as delivered.',
                422
            );
        }

        // Emit the real-time event only after commit, so listeners never run
        // while the row lock is held. The event carries the delivery's ACTUAL
        // end state after the transition (prepaid confirmation completes the
        // delivery, so the order follows to 'completed').
        $fresh = $delivery->fresh()->load('order.business');
        DeliveryStatusChanged::dispatch($fresh, $outcome['old_status'], $outcome['final_status']);

        return $this->successResponse(
            DeliveryResource::make($fresh),
            'Delivery status updated to ' . ucfirst(str_replace('_', ' ', $newStatus)) . '.'
        );
    }

    /**
     * The grouped pickup route for an assigned delivery (COD or prepaid):
     * every fulfilling restaurant in preparation-time order, the longest-prep
     * restaurant as the drop-off origin, and the tourist destination as the
     * drop-off point.
     */
    public function pickupRoute(Request $request, Delivery $delivery): JsonResponse
    {
        if ((int) $delivery->rider_id !== (int) $request->user()?->id) {
            return $this->forbiddenResponse('You are not assigned to this delivery.');
        }

        $delivery->load('codPurchases');

        return $this->successResponse(app(\App\Services\PurchasingCashService::class)->pickupRoute($delivery));
    }

    /**
     * Driver-initiated cancellation of an accepted ride (Phase 6).
     *
     * Allowed only for transport rides while the driver is on the way to / at
     * the pickup (assigned, en_route_pickup, arrived_pickup). After pickup the
     * ride is governed by the delivery lifecycle and may not be cancelled here.
     */
    public function cancelRide(Request $request, Delivery $delivery): JsonResponse
    {
        if ((int) $delivery->rider_id !== (int) $request->user()?->id) {
            return $this->forbiddenResponse('You are not assigned to this ride.');
        }

        try {
            $result = app(TransportationService::class)->cancelRideByDriver(
                $delivery,
                $request->user(),
                $request->input('reason'),
            );
        } catch (\InvalidArgumentException $exception) {
            return $this->errorResponse($exception->getMessage(), 422);
        }

        return $this->successResponse($result, 'Ride cancelled. The tourist has been notified.');
    }

    /**
     * Collect cash at the drop-off and complete a COD delivery.
     */
    public function settleCod(Request $request, Delivery $delivery): JsonResponse
    {
        if ((int) $delivery->rider_id !== (int) auth()->id()) {
            return $this->forbiddenResponse('You are not assigned to this delivery.');
        }

        $data = $request->validate([
            'cash_received' => ['required', 'numeric', 'min:0'],
        ]);

        try {
            $result = $this->dispatchService->settleCodDelivery($delivery, (float) $data['cash_received']);
        } catch (\InvalidArgumentException $exception) {
            return $this->errorResponse($exception->getMessage(), 422);
        }

        return $this->successResponse(
            array_merge($result, [
                'delivery' => DeliveryResource::make($delivery->fresh()->load('order.business')),
            ]),
            'Cash on delivery settled successfully.'
        );
    }
}
