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
        );

        $riderLocation = null;
        if ($delivery && $delivery->rider_id) {
            $riderLocation = RiderLocation::where('rider_id', $delivery->rider_id)
                ->latest('recorded_at')
                ->first();
        }

        return $this->successResponse([
            'id' => $trip->id,
            'order_number' => $ride['order_number'],
            'status' => $ride['ride_status'],
            'ride_pin' => $ride['ride_pin'],
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
            'fare' => (float) $ride['booking_fare'],
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
        ]);
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

        return $this->successResponse($estimate);
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
        $order = $this->transport->createRide($validated);

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
                'ride_pin' => $ride['ride_pin'],
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
