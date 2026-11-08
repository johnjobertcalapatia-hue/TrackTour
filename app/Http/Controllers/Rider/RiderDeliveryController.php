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
use App\Services\OfferReviewService;
use App\Services\PickupDeliveryTransitionService;
use App\Services\RiderOfferPresenter;
use App\Services\TransportationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\DB;

class RiderDeliveryController extends Controller
{
    public function __construct(
        private DeliveryService $deliveryService,
        private NearestRiderService $dispatchService,
        private PickupDeliveryTransitionService $pickupTransitions,
    ) {}

    public function pending(Request $request): JsonResponse
    {
        $riderId = (int) $request->user()->id;
        $deliveries = $this->deliveryService->getPendingDeliveries($riderId, 15);
        $presenter = app(RiderOfferPresenter::class);
        $reviews = app(OfferReviewService::class);

        // Card line (Stage 3): "0.8 km to first pickup · Restaurant C · 3 items · 2 pickup stops".
        $distances = $this->deliveryService->pickupDistancesKm($riderId, $deliveries);
        $board = fn (Delivery $d, array $row) => $row + [
            'pickup_distance_km' => isset($distances[$d->id]) ? round($distances[$d->id], 1) : null,
            'pickup_stops' => count($row['pickup_names'] ?? []),
        ];

        $available = $deliveries->map(fn (Delivery $d) => $board($d, $reviews->isHeldByOther($d, $riderId)
            // Another rider has it open: listed, but details withheld and not actionable.
            ? $presenter->reviewingSummary($d)
            : array_merge(
                (new DeliveryResource($d))->resolve($request),
                $presenter->summary($d),
                ['availability' => 'available', 'reviewing_by_me' => $reviews->isHeldBy($d, $riderId)],
            )));

        // Decision D3 (docs/dispatch-escalation-plan.md): an offer another
        // rider won leaves the board immediately. A rider who still has its
        // offer page open is told "Already accepted by another rider" there.
        return $this->successResponse($available->values(), 'Pending deliveries retrieved.');
    }

    /**
     * GET /rider/deliveries/{delivery}/offer — read-only offer state.
     *
     * Visible only to a rider who would see it on Available Deliveries (the
     * canonical pending query: pinged, or open and within range) or who has
     * already accepted it. While another rider reviews it, or after another
     * rider won it, only a restricted summary is returned. Anything else is 404.
     */
    public function offer(Request $request, Delivery $delivery): JsonResponse
    {
        return $this->offerResponse($request, $delivery, false);
    }

    /**
     * POST /rider/deliveries/{delivery}/review — open the offer for review.
     *
     * The first rider to open it gets an exclusive hold (OfferReviewService):
     * full details plus review_expires_at. Others get "Another rider is
     * reviewing this offer" with no details and cannot accept until the hold
     * is accepted, released or expires.
     */
    public function review(Request $request, Delivery $delivery): JsonResponse
    {
        return $this->offerResponse($request, $delivery, true);
    }

    /**
     * PATCH /rider/deliveries/{delivery}/review — heartbeat while the review
     * page is open. Keeps this rider's hold alive (no visible timer).
     */
    public function renewReview(Request $request, Delivery $delivery): JsonResponse
    {
        $riderId = (int) $request->user()->id;
        $isVisible = ($delivery->rider_id === null)
            && $this->deliveryService->getPendingDeliveries($riderId, 100)->contains('id', $delivery->id);

        if (! $isVisible) {
            return $this->successResponse(['held' => false, 'reason' => $delivery->rider_id !== null ? 'taken' : 'unavailable'], 'Offer no longer available.');
        }

        return $this->successResponse(app(OfferReviewService::class)->renew($delivery->id, $riderId), 'Review hold renewed.');
    }

    /** DELETE /rider/deliveries/{delivery}/review — "find other offers": release my hold. */
    public function releaseReview(Request $request, Delivery $delivery): JsonResponse
    {
        app(OfferReviewService::class)->release($delivery->id, (int) $request->user()->id);

        return $this->successResponse(null, 'Offer released.');
    }

    private function offerResponse(Request $request, Delivery $delivery, bool $acquire): JsonResponse
    {
        $riderId = (int) $request->user()->id;
        $presenter = app(RiderOfferPresenter::class);
        $reviews = app(OfferReviewService::class);
        $isMine = $delivery->rider_id !== null && (int) $delivery->rider_id === $riderId;

        if ($isMine) {
            return $this->successResponse(
                $presenter->detail($delivery) + $presenter->assignedExtras($delivery) + ['availability' => 'mine'],
                'Delivery offer retrieved.',
            );
        }

        $isOffered = $this->deliveryService->getPendingDeliveries($riderId, 100)->contains('id', $delivery->id);

        if (! $isOffered) {
            // Won by another rider while this rider could see it: report that
            // state (no customer/route details), never offer it as acceptable.
            if ($this->deliveryService->getRecentlyTakenForRider($riderId, 10, 50)->contains('id', $delivery->id)) {
                return $this->successResponse($presenter->takenSummary($delivery), 'Already accepted by another rider.');
            }

            return $this->notFoundResponse('This delivery offer is no longer available.');
        }

        if ($acquire) {
            $hold = $reviews->acquire($delivery->id, $riderId);
            $delivery->refresh();

            if (! $hold['held']) {
                return match ($hold['reason']) {
                    'reviewing' => $this->successResponse($presenter->reviewingSummary($delivery), 'Another rider is reviewing this offer.'),
                    'taken' => $this->successResponse($presenter->takenSummary($delivery), 'Already accepted by another rider.'),
                    default => $this->notFoundResponse('This delivery offer is no longer available.'),
                };
            }
        } elseif ($reviews->isHeldByOther($delivery, $riderId)) {
            return $this->successResponse($presenter->reviewingSummary($delivery), 'Another rider is reviewing this offer.');
        }

        $mine = $reviews->isHeldBy($delivery, $riderId);

        return $this->successResponse($presenter->detail($delivery) + [
            'availability' => 'available',
            'reviewing_by_me' => $mine,
            'review_expires_at' => $mine ? $delivery->review_expires_at : null,
            'review_seconds' => $reviews->seconds(),
        ], 'Delivery offer retrieved.');
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
            'arrived_pickup' => ['field' => 'arrived_pickup_at', 'from' => ['assigned', 'en_route_pickup', 'arrived_pickup']],
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

            if ($newStatus === 'arrived_pickup') {
                $transition = $this->pickupTransitions->arriveAtPickup($locked);

                return [
                    'error' => null,
                    'old_status' => $transition['old_status'] ?? $currentStatus,
                    'new_status' => 'arrived_pickup',
                    'final_status' => 'arrived_pickup',
                ];
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

            if ($newStatus === 'picked_up') {
                $transition = $this->pickupTransitions->pickUp($locked);
                if (! $transition) {
                    return ['error' => 'not_all_collected'];
                }

                return [
                    'error' => null,
                    'old_status' => $transition['old_status'],
                    'new_status' => 'picked_up',
                    'final_status' => 'picked_up',
                ];
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
                'Take a photo of the delivered food at the drop-off to complete this delivery.',
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

    /**
     * POST /rider/deliveries/{delivery}/complete  (multipart: photo)
     *
     * Rider completes a FOOD delivery with proof (decision 2026-11-08): within
     * tracking.dropoff_radius_meters (50 m) of the delivery address — judged
     * from the rider's own fresh saved GPS fix, never a client-sent number —
     * and a photo of the delivered food. Confirming also means the tourist
     * paid the rider (COD is settled for exactly the cash due).
     */
    public function complete(Request $request, Delivery $delivery): JsonResponse
    {
        $riderId = (int) $request->user()->id;
        if ((int) $delivery->rider_id !== $riderId) {
            return $this->forbiddenResponse('You are not assigned to this delivery.');
        }
        if (strtolower((string) ($delivery->primaryOrder()?->order_type ?? '')) === 'transport') {
            return $this->errorResponse('Rides are completed from the trip screen.', 422);
        }

        $request->validate([
            'photo' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', 'max:8192'],
        ], [
            'photo.required' => 'Take a photo of the delivered food first.',
            'photo.image' => 'The proof must be a photo.',
        ]);

        if ($delivery->delivery_latitude === null || $delivery->delivery_longitude === null) {
            return $this->errorResponse('This delivery has no drop-off location.', 422);
        }

        $location = app(\App\Services\PickupSequenceService::class)->latestRiderLocation($riderId);
        $maxAge = (int) config('tracking.proof_location_max_age_seconds', 120);
        if (! $location || ! $location['recorded_at'] || $location['recorded_at']->lt(now()->subSeconds($maxAge))) {
            return $this->errorResponse('We need your current location. Keep the map open with location on, then try again.', 422);
        }

        $distance = app(\App\Services\PickupSequenceService::class)->distanceMeters(
            (float) $location['latitude'],
            (float) $location['longitude'],
            (float) $delivery->delivery_latitude,
            (float) $delivery->delivery_longitude,
        );
        $radius = (float) config('tracking.dropoff_radius_meters', 50);
        if ($distance > $radius) {
            return $this->errorResponse(
                sprintf('You must be within %d m of the delivery address to complete it (you are %d m away).', (int) $radius, (int) round($distance)),
                422
            );
        }

        $path = $request->file('photo')->store('delivery-proofs', 'public');

        try {
            $result = $this->dispatchService->completeDeliveryByRider($delivery, $riderId, $path, $distance);
        } catch (\InvalidArgumentException $e) {
            Storage::disk('public')->delete($path);

            return $this->errorResponse($e->getMessage(), 422);
        } catch (\Throwable $e) {
            Storage::disk('public')->delete($path);
            throw $e;
        }

        $fresh = $delivery->fresh()->load('order.business');
        DeliveryStatusChanged::dispatch($fresh, $result['old_status'], $result['new_status']);

        return $this->successResponse(array_merge($result, [
            'delivery_proof_url' => Storage::disk('public')->url($path),
            'delivery' => DeliveryResource::make($fresh),
        ]), 'Delivery completed. Thank you!');
    }
}
