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

            // Purchasing-cash gate: a COD delivery may not leave the pickup area
            // until food from every restaurant has been bought AND collected.
            if (
                $newStatus === 'picked_up'
                && $this->dispatchService->isCodDelivery($locked)
                && ! app(\App\Services\PurchasingCashService::class)->isFullyCollected($locked)
            ) {
                return ['error' => 'not_all_collected'];
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
