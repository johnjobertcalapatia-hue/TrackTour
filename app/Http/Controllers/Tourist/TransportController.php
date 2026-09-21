<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Http\Requests\Tourist\BookTransportRequest;
use App\Http\Requests\Tourist\RateTransportRequest;
use App\Models\Order;
use App\Models\Review;
use App\Services\TransportationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class TransportController extends Controller
{
    public function __construct(protected TransportationService $transport) {}

    public function index()
    {
        if (request()->expectsJson()) {
            $user = request()->user();
            $trips = Order::where('customer_email', $user->email)
                ->where('order_type', 'transport')
                ->latest()
                ->paginate(20);

            return $this->paginatedResponse($trips);
        }

        return redirect()->route('tourist.map', ['ride' => 1]);
    }

    public function tripStatus(Request $request, int $id): JsonResponse
    {
        $trip = Order::where('customer_email', $request->user()->email)->findOrFail($id);

        return $this->successResponse($trip);
    }

    public function cancelTrip(Request $request, int $id): JsonResponse
    {
        $trip = Order::where('customer_email', $request->user()->email)->findOrFail($id);
        $trip->update(['status' => 'cancelled']);

        return $this->successResponse(null, 'Trip cancelled.');
    }

    public function rateTrip(Request $request, int $id): JsonResponse
    {
        $validated = $request->validate([
            'rating' => 'required|integer|min:1|max:5',
            'review' => 'nullable|string|max:1000',
        ]);

        $trip = Order::where('customer_email', $request->user()->email)->findOrFail($id);
        $trip->update(['rating' => $validated['rating'], 'review' => $validated['review'] ?? null]);

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

    public function book(BookTransportRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $order = $this->transport->createRide($validated);

        if ($request->expectsJson() || $request->header('X-Requested-With') === 'XMLHttpRequest') {
            return $this->createdResponse([
                'order_id' => $order->id,
                'redirect' => route('tourist.transport.tracking', $order),
            ], 'Ride requested! Looking for a nearby rider.');
        }

        return redirect()->route('tourist.transport.tracking', $order)
            ->with('success', 'Ride requested! Looking for a nearby rider.');
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
