<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Http\Requests\Tourist\BookTransportRequest;
use App\Http\Requests\Tourist\RateTransportRequest;
use App\Models\Order;
use App\Models\RiderLocation;
use App\Models\Review;
use App\Services\OrderTrackingService;
use App\Services\TransportationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;

class TransportController extends Controller
{
    public function __construct(protected TransportationService $transport) {}

    public function index()
    {
        $user = request()->user();
        $trips = Order::where('customer_email', $user->email)
            ->where('order_type', 'transport')
            ->latest()
            ->paginate(20);

        return $this->paginatedResponse($trips);
    }

    /**
     * GET /tourist/transport/active — the tourist's ride that is not finished
     * yet (searching, driver on the way, in progress), or null. A new ride can
     * be booked only when this is null.
     */
    public function active(Request $request): JsonResponse
    {
        $ride = $this->transport->activeRideFor((int) $request->user()->id);
        if ($ride === null) {
            return $this->successResponse(null, 'No ride in progress.');
        }

        return $this->successResponse([
            'id' => $ride->id,
            'order_number' => $ride->order_number,
            'status' => $this->transport->getRideStatus($ride)['ride_status'],
            'delivery_address' => $ride->delivery?->delivery_address,
            'redirect' => '/tourist/transport/tracking/'.$ride->id,
        ]);
    }

    public function tripStatus(Request $request, int $id): JsonResponse
    {
        $trip = Order::where('customer_email', $request->user()->email)
            ->where('order_type', 'transport')
            ->findOrFail($id);

        $ride = $this->transport->getRideStatus($trip);
        $delivery = $ride['delivery'];
        $rider = $ride['rider'];
        $profile = $ride['rider_profile'];

        $fareBreakdown = $this->transport->getFareBreakdown(
            (string) $ride['vehicle_type'],
            (float) ($ride['booking_fare'] ?? 0),
            $ride['booking_base_fare'] ?? null,
        );

        $riderLocation = null;
        if ($delivery && $delivery->rider_id) {
            $riderLocation = RiderLocation::where('rider_id', $delivery->rider_id)
                ->latest('recorded_at')
                ->first();
        }

        // One-time destination change (2026-11-17): once finalized, the fare
        // is the final fare (verified distance, capped); until then the
        // booked fare stands and the confirmed estimate is shown beside it.
        $changes = app(\App\Services\RideDestinationChangeService::class);
        $change = $changes->changeFor($trip);
        $eligibility = $changes->eligibility($trip, $delivery);
        $fare = (float) $ride['booking_fare'];
        if ($change?->final_fare !== null) {
            $fare = (float) $change->final_fare;
            $fareBreakdown['base_fare'] = (float) $change->base_fare;
            $fareBreakdown['distance_fare'] = round($fare - (float) $change->base_fare, 2);
        }
        // Time-based charges (2026-11-18): itemised on top of the ride fare.
        $timeCharges = app(\App\Services\RideTimeChargeService::class);
        $charges = $delivery ? $timeCharges->charges($delivery->id) : [];
        $chargesTotal = round((float) collect($charges)->sum('amount'), 2);

        return $this->successResponse([
            'id' => $trip->id,
            'order_number' => $ride['order_number'],
            'status' => $ride['ride_status'],
            'pickup_address' => $ride['pickup_address'],
            'pickup_latitude' => $ride['pickup_lat'],
            'pickup_longitude' => $ride['pickup_lng'],
            'destination_address' => $ride['destination_address'],
            'destination_latitude' => $ride['destination_lat'],
            'destination_longitude' => $ride['destination_lng'],
            'vehicle_type' => $ride['vehicle_type'],
            'vehicle_color' => $ride['vehicle_color'],
            'passenger_count' => $ride['passenger_count'],
            'payment_method' => $ride['payment_method'],
            'payment_status' => (string) ($trip->payment_status ?? 'pending'),
            'paid_amount' => (float) ($trip->paid_amount ?? 0),
            // Total payable: the ride fare plus itemised additional charges.
            'fare' => round($fare + $chargesTotal, 2),
            'ride_fare' => $fare,
            'additional_charges' => $charges,
            'charges_total' => $chargesTotal,
            'pickup_waiting' => $delivery ? $timeCharges->waitingState($delivery) : null,
            'base_fare' => $fareBreakdown['base_fare'],
            'distance_fare' => $fareBreakdown['distance_fare'],
            'service_fee' => $fareBreakdown['service_fee'],
            'estimate_fare' => (float) $ride['booking_fare'],
            'distance_km' => (float) $ride['booking_distance'],
            'duration_min' => (int) $ride['booking_duration'],
            'eta_minutes' => (int) $ride['booking_duration'],
            'booking_notes' => $ride['booking_notes'],
            'rider' => $rider ? [
                'id' => $rider->id,
                'name' => $rider->fullName,
                'rating' => $rider->rating ?? null,
                'contact_number' => $profile?->mobile_number ?? null,
                'photo' => $profile?->avatar ?? null,
                'vehicle_type' => $rider->riderDetail?->vehicle_type ?? $ride['vehicle_type'],
                'vehicle_make' => $rider->riderDetail?->vehicle_make ?? null,
                'vehicle_model' => $rider->riderDetail?->vehicle_model ?? null,
                'plate_number' => $rider->riderDetail?->vehicle_plate_number ?? null,
            ] : null,
            'is_rated' => $trip->rating !== null,
            'rating' => $trip->rating,
            'review' => $trip->review,
            'rating_tags' => $trip->rating_tags ?: [],
            'allowed_rating_tags' => TransportationService::RATING_TAGS,
            'created_at' => $trip->created_at?->toIso8601String(),
            'started_at' => $delivery?->started_at?->toIso8601String(),
            'completed_at' => $trip->completed_at?->toIso8601String(),
            'cancelled_at' => $trip->cancelled_at?->toIso8601String(),
            'cancellation_reason' => $trip->cancellation_reason,
            'cancellation_fee' => 0,
            'rider_location' => $riderLocation ? [
                'latitude' => (float) $riderLocation->latitude,
                'longitude' => (float) $riderLocation->longitude,
                'recorded_at' => $riderLocation->recorded_at?->toIso8601String(),
            ] : null,
            'tracking' => app(OrderTrackingService::class)->customerBlock($trip, $delivery),
            // At the drop-off, not completed yet: the tourist pays (GCash) or
            // hands over the cash, and the driver confirms it and completes
            // the ride (2026-11-18). Rating opens once completed.
            'at_drop_off' => $trip->status !== 'completed' && in_array($delivery?->status?->value ?? $delivery?->status, ['arrived_destination', 'delivered'], true),
            'ride_completed' => $trip->status === 'completed' || ($delivery?->status?->value ?? $delivery?->status) === 'completed',
            'payment_switched_to_cash' => \App\Services\RidePaymentService::switchedToCash($trip),
            // Cancellation penalty (Stage B, 2026-11-18): before cancelling, until
            // when it is free; after, the penalty (if any) and whether it can be disputed.
            'cancellation_penalty_preview' => in_array($ride['ride_status'], ['searching', 'arriving', 'driver_arrived'], true)
                ? app(\App\Services\RideCancellationPenaltyService::class)->preview($delivery) : null,
            'cancellation_penalty' => \App\Models\RideCancellationPenalty::where('cancelled_order_id', $trip->id)->first()?->present(),
            'destination_change' => $change?->present(),
            'destination_change_allowed' => $eligibility['allowed'],
            'destination_changes_left' => $eligibility['changes_left'],
            'destination_change_unavailable_reason' => $eligibility['allowed'] ? null : $eligibility['reason'],
        ]);
    }

    /** GET /tourist/transport/penalties — the tourist's cancellation penalties. */
    public function penalties(Request $request): JsonResponse
    {
        $rows = \App\Models\RideCancellationPenalty::where('tourist_id', $request->user()->id)->latest('id')->limit(50)->get();

        return $this->successResponse([
            'penalties' => $rows->map->present()->values(),
            'outstanding_total' => round((float) $rows->where('status', \App\Models\RideCancellationPenalty::STATUS_OWED)->sum('penalty_amount'), 2),
        ]);
    }

    /** POST /tourist/transport/trip/{id}/penalty/dispute — dispute this ride's cancellation penalty. */
    public function disputePenalty(Request $request, int $id): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:500']]);
        $trip = Order::where('customer_email', $request->user()->email)->where('order_type', 'transport')->findOrFail($id);
        $penalty = \App\Models\RideCancellationPenalty::where('cancelled_order_id', $trip->id)->first();
        if ($penalty === null) {
            return $this->errorResponse('This ride has no cancellation penalty.', 404);
        }
        try {
            $penalty = app(\App\Services\RideCancellationPenaltyService::class)->dispute($penalty, $request->user(), $data['reason']);
        } catch (\App\Exceptions\RidePenaltyException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        return $this->successResponse(['penalty' => $penalty->present()], 'Your dispute was sent to the Tourism Office. Nothing is collected while it is reviewed.');
    }

    /**
     * POST /tourist/transport/trip/{id}/destination-change/preview — the
     * revised route and fare for a new destination. Stores nothing, so an
     * abandoned or refused preview never uses the one change.
     */
    public function previewDestinationChange(Request $request, int $id): JsonResponse
    {
        $data = $request->validate([
            'destination_name' => ['nullable', 'string', 'max:255'],
            'destination_address' => ['nullable', 'string', 'max:500'],
            'destination_lat' => ['required', 'numeric', 'between:-90,90'],
            'destination_lng' => ['required', 'numeric', 'between:-180,180'],
        ]);
        $trip = Order::where('customer_email', $request->user()->email)->where('order_type', 'transport')->findOrFail($id);

        try {
            $preview = app(\App\Services\RideDestinationChangeService::class)->preview($trip, [
                'name' => $data['destination_name'] ?? null,
                'address' => $data['destination_address'] ?? null,
                'latitude' => (float) $data['destination_lat'],
                'longitude' => (float) $data['destination_lng'],
            ], $request->user());
        } catch (\App\Exceptions\RideDestinationChangeException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        return $this->successResponse($preview, 'Review the new route and fare, then confirm.');
    }

    /**
     * POST /tourist/transport/trip/{id}/destination-change — confirm the
     * previewed change (signed quote + idempotency key). Once per trip.
     */
    public function confirmDestinationChange(Request $request, int $id): JsonResponse
    {
        $data = $request->validate([
            'quote_token' => ['required', 'string'],
            'idempotency_key' => ['required', 'string', 'min:8', 'max:64'],
        ]);
        $trip = Order::where('customer_email', $request->user()->email)->where('order_type', 'transport')->findOrFail($id);

        try {
            $result = app(\App\Services\RideDestinationChangeService::class)
                ->confirm($trip, $data['quote_token'], $data['idempotency_key'], $request->user());
        } catch (\App\Exceptions\RideDestinationChangeException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        return $this->successResponse(
            ['destination_change' => $result['change']->present(), 'replayed' => $result['replayed']],
            'Destination changed. Your driver has been told.',
            $result['replayed'] ? 200 : 201,
        );
    }

    public function cancelTrip(Request $request, int $id): JsonResponse
    {
        $trip = Order::where('customer_email', $request->user()->email)
            ->where('order_type', 'transport')
            ->findOrFail($id);

        $current = $this->transport->getRideStatus($trip)['ride_status'];

        if (! in_array($current, ['searching', 'arriving', 'driver_arrived'], true)) {
            return $this->errorResponse('This trip can no longer be cancelled.', 422);
        }

        $cancelled = $this->transport->cancelRide($trip, $request->input('reason'));

        if (! $cancelled) {
            return $this->errorResponse('This trip can no longer be cancelled.', 422);
        }

        return $this->successResponse([
            'status' => 'cancelled',
            'cancellation_fee' => 0,
        ], 'Trip cancelled.');
    }

    public function rateTrip(Request $request, int $id): JsonResponse
    {
        $validated = $request->validate([
            'rating' => 'required|integer|min:1|max:5',
            'review' => 'nullable|string|max:1000',
            'tags' => ['nullable', 'array', 'max:5'],
            'tags.*' => ['string', 'distinct', Rule::in(TransportationService::RATING_TAGS)],
        ]);

        $trip = Order::where('customer_email', $request->user()->email)
            ->where('order_type', 'transport')
            ->findOrFail($id);

        if ($trip->status !== 'completed') {
            return $this->errorResponse('You can only rate completed rides.', 422);
        }

        if ($trip->rating !== null) {
            return $this->errorResponse('This ride has already been rated.', 422);
        }

        $trip->update([
            'rating' => $validated['rating'],
            'review' => $validated['review'] ?? null,
            'rating_tags' => $validated['tags'] ?? [],
        ]);

        if ($trip->business_id) {
            Review::create([
                'business_id' => $trip->business_id,
                'user_id' => Auth::id(),
                'rating' => $validated['rating'],
                'review' => $validated['review'] ?? null,
                'status' => 'pending',
            ]);
        }

        return $this->successResponse(null, 'Thank you for your rating!');
    }

    public function estimate(Request $request): JsonResponse
    {
        $request->validate([
            'pickup_lat' => 'required|numeric',
            'pickup_lng' => 'required|numeric',
            'destination_lat' => 'required|numeric',
            'destination_lng' => 'required|numeric',
        ]);

        $estimate = $this->transport->estimateFare(
            (float) $request->pickup_lat,
            (float) $request->pickup_lng,
            (float) $request->destination_lat,
            (float) $request->destination_lng,
        );

        // Vehicle types come from riders' registered vehicles: only types with
        // an approved ride-hailing rider are bookable.
        $vehicleTypes = app(\App\Services\RideVehicles::class)->bookable();
        $bookable = array_column(array_filter($vehicleTypes, fn ($v) => $v['available']), 'slug');
        $estimate['vehicle_types'] = $vehicleTypes;
        $estimate['fares'] = array_intersect_key($estimate['fares'], array_flip($bookable));

        return $this->successResponse($estimate);
    }

    /** Ride vehicle types tourists can book, from riders' registered vehicles. */
    public function vehicleTypes(): JsonResponse
    {
        return $this->successResponse(app(\App\Services\RideVehicles::class)->bookable());
    }

    public function route(Request $request): JsonResponse
    {
        $request->validate([
            'pickup_lat' => 'required|numeric',
            'pickup_lng' => 'required|numeric',
            'destination_lat' => 'required|numeric',
            'destination_lng' => 'required|numeric',
        ]);

        $route = $this->transport->getRoute(
            (float) $request->pickup_lat,
            (float) $request->pickup_lng,
            (float) $request->destination_lat,
            (float) $request->destination_lng,
        );

        return $this->successResponse($route);
    }

    public function book(BookTransportRequest $request): JsonResponse
    {
        $validated = $request->validated();

        // createRide() re-derives the authoritative fare server-side (spec §64),
        // so any client-supplied fare/distance/duration is advisory only.
        try {
            $order = $this->transport->createRide($validated);
        } catch (\App\Exceptions\ActiveRideExistsException $e) {
            // One ride at a time: send the tourist back to the ride they have.
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
                'data' => [
                    'code' => 'active_ride',
                    'order_id' => $e->ride->id,
                    'order_number' => $e->ride->order_number,
                    'redirect' => '/tourist/transport/tracking/'.$e->ride->id,
                ],
            ], 409);
        } catch (\App\Exceptions\RideFareChangedException $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
                'data' => ['fare' => $e->currentFare, 'quoted_fare' => $e->quotedFare],
            ], 409);
        }

        return $this->createdResponse([
            'order_id' => $order->id,
            'redirect' => '/tourist/transport/tracking/'.$order->id,
            'fare' => (float) $order->total,
        ], 'Ride requested! Looking for a nearby rider.');
    }

    public function tracking(Order $order)
    {
        if ($order->customer_email !== Auth::user()->email) {
            abort(403);
        }

        $ride = $this->transport->getRideStatus($order);

        if (request()->expectsJson() || request()->header('X-Requested-With') === 'XMLHttpRequest') {
            $rider = $ride['rider'];
            $profile = $ride['rider_profile'];

            return $this->successResponse([
                'ride_status' => $ride['ride_status'],
                'order_number' => $ride['order_number'],
                'vehicle_type' => $ride['vehicle_type'],
                'vehicle_color' => $ride['vehicle_color'],
                'payment_method' => $ride['payment_method'],
                'booking_fare' => $ride['booking_fare'],
                'passenger_count' => $ride['passenger_count'],
                'booking_distance' => $ride['booking_distance'],
                'booking_duration' => $ride['booking_duration'],
                'booking_notes' => $ride['booking_notes'],
                'rider_emergency' => $ride['rider_emergency'],
                'pickup_address' => $ride['pickup_address'],
                'destination_address' => $ride['destination_address'],
                'rider' => $rider ? [
                    'id' => $rider->id,
                    'name' => $rider->name,
                    'rating' => $rider->rating,
                    'plate_number' => $rider->plate_number ?? null,
                    'contact_number' => $rider->contact_number ?? $rider->phone ?? null,
                    'profile_photo' => $rider->profile_photo ?? null,
                ] : null,
                'rider_profile' => $profile ? [
                    'full_name' => $profile->full_name ?? null,
                    'photo' => $profile->photo ?? null,
                    'phone' => $profile->phone ?? null,
                ] : null,
            ]);
        }

        return response()->json($ride);
    }

    public function cancel(Request $request, Order $order)
    {
        if ($order->customer_email !== Auth::user()->email) {
            abort(403);
        }

        $reason = $request->input('reason');
        $this->transport->cancelRide($order, $reason);

        return back()->with('success', 'Ride cancelled.');
    }

    public function rate(RateTransportRequest $request, Order $order): JsonResponse
    {
        if ($order->customer_email !== Auth::user()->email) {
            abort(403);
        }

        if ($order->status !== 'completed') {
            return $this->errorResponse('You can only rate completed rides.', 422);
        }

        $validated = $request->validated();

        $order->update([
            'rating' => $validated['rating'],
            'review' => $validated['review'],
        ]);

        if ($order->business_id) {
            Review::create([
                'business_id' => $order->business_id,
                'user_id' => Auth::id(),
                'rating' => $validated['rating'],
                'review' => $validated['review'] ?? null,
                'status' => 'pending',
            ]);
        }

        if ($request->expectsJson() || $request->header('X-Requested-With') === 'XMLHttpRequest') {
            return $this->successResponse(null, 'Thank you for your feedback!');
        }

        return redirect()->route('tourist.transport.tracking', $order)
            ->with('success', 'Thank you for your feedback!');
    }
}
