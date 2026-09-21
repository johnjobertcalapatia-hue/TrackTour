<?php

namespace App\Http\Controllers\Admin;

use App\Enums\TripStatus;
use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\Delivery;
use App\Models\RiderLocation;
use Illuminate\Http\JsonResponse;

class AdminMapController extends Controller
{
    public function index(): JsonResponse
    {
        $businesses = Business::query()
            ->select(['id', 'business_name', 'latitude', 'longitude', 'address', 'status'])
            ->with('category:id,name')
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->where('status', 'approved')
            ->get()
            ->map(fn ($b) => [
                'id' => $b->id,
                'name' => $b->business_name,
                'lat' => (float) $b->latitude,
                'lng' => (float) $b->longitude,
                'address' => $b->address,
                'category' => $b->category?->name,
                'status' => $b->status,
            ]);

        $activeDeliveries = Delivery::query()
            ->select(['id', 'rider_id', 'status', 'pickup_latitude', 'pickup_longitude', 'delivery_latitude', 'delivery_longitude', 'pickup_address', 'delivery_address', 'assigned_at'])
            ->whereNull('delivered_at')
            ->whereNull('dispatch_expires_at')
            ->whereNotIn('status', [TripStatus::COMPLETED, TripStatus::CANCELLED])
            ->whereNotNull('rider_id')
            ->get()
            ->map(fn ($d) => [
                'id' => $d->id,
                'status' => $d->status->value,
                'status_label' => $d->status->label(),
                'rider_id' => $d->rider_id,
                'pickup' => [
                    'lat' => (float) $d->pickup_latitude,
                    'lng' => (float) $d->pickup_longitude,
                    'address' => $d->pickup_address,
                ],
                'delivery' => [
                    'lat' => (float) $d->delivery_latitude,
                    'lng' => (float) $d->delivery_longitude,
                    'address' => $d->delivery_address,
                ],
                'assigned_at' => $d->assigned_at?->toIso8601String(),
            ]);

        $riderLocations = RiderLocation::query()
            ->select(['rider_id', 'latitude', 'longitude', 'recorded_at'])
            ->whereIn('rider_id', fn ($q) => $q->select('rider_id')->from('rider_locations')->groupBy('rider_id'))
            ->where('recorded_at', '>=', now()->subMinutes(30))
            ->orderByDesc('recorded_at')
            ->get()
            ->unique('rider_id')
            ->values()
            ->map(fn ($loc) => [
                'rider_id' => $loc->rider_id,
                'lat' => (float) $loc->latitude,
                'lng' => (float) $loc->longitude,
                'recorded_at' => $loc->recorded_at->toIso8601String(),
            ]);

        return response()->json([
            'success' => true,
            'data' => [
                'businesses' => $businesses,
                'active_deliveries' => $activeDeliveries,
                'rider_locations' => $riderLocations,
            ],
        ]);
    }
}
