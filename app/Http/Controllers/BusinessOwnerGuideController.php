<?php

namespace App\Http\Controllers;

use App\Models\Delivery;
use App\Models\User;
use Illuminate\Http\JsonResponse;

class BusinessOwnerGuideController extends Controller
{
    public function show(int $guideId): JsonResponse
    {
        $guide = User::where('id', $guideId)->where('role', User::ROLE_RIDER)->first();

        if (! $guide) {
            return response()->json(['success' => false, 'message' => 'Guide not found.'], 404);
        }

        $currentTrip = Delivery::where('rider_id', $guide->id)
            ->whereIn('status', ['assigned', 'en_route_pickup', 'arrived_pickup', 'tour_started', 'en_route_destination', 'arrived_destination'])
            ->with('order.business', 'order.customer.profile')
            ->first();

        $tripData = null;
        if ($currentTrip) {
            $order = $currentTrip->order;
            $tourist = $order?->customer;
            $tripData = [
                'trip_id' => $currentTrip->id,
                'status' => $currentTrip->status,
                'started_at' => $currentTrip->started_at?->timestamp,
                'pickup_address' => $currentTrip->pickup_address,
                'pickup_lat' => $currentTrip->pickup_latitude,
                'pickup_lng' => $currentTrip->pickup_longitude,
                'delivery_address' => $currentTrip->delivery_address,
                'delivery_lat' => $currentTrip->delivery_latitude,
                'delivery_lng' => $currentTrip->delivery_longitude,
                'business_name' => $order?->business?->business_name,
                'business_id' => $order?->business_id,
                'tourist' => $tourist ? [
                    'id' => $tourist->id,
                    'name' => $tourist->name,
                    'photo_url' => $tourist->profile?->photo_url,
                ] : null,
            ];
        }

        return response()->json([
            'success' => true,
            'data' => [
                'id' => $guide->id,
                'name' => $guide->name,
                'email' => $guide->email,
                'firebase_uid' => $guide->firebase_uid,
                'rider_status' => $guide->riderDetail?->rider_status,
                'current_service' => $guide->riderDetail?->current_service,
                'vehicle_type' => $guide->riderDetail?->vehicle_type,
                'vehicle_plate' => $guide->riderDetail?->vehicle_plate_number,
                'rating' => $guide->reviews_avg_rating ?? null,
                'current_trip' => $tripData,
            ],
        ]);
    }
}
