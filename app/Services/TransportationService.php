<?php

namespace App\Services;

use App\Models\Delivery;
use App\Models\Order;
use Illuminate\Support\Facades\Auth;

class TransportationService
{
    protected NearestRiderService $dispatchService;

    public function __construct(NearestRiderService $dispatchService)
    {
        $this->dispatchService = $dispatchService;
    }

    public function getVehicleTypes(): array
    {
        return [
            [
                'slug' => 'motorcycle',
                'name' => 'Motorcycle',
                'base_fare' => 50.00,
                'per_km' => 15.00,
                'max_passengers' => 1,
                'icon' => 'motorcycle',
            ],
            [
                'slug' => 'tricycle',
                'name' => 'Tricycle',
                'base_fare' => 60.00,
                'per_km' => 20.00,
                'max_passengers' => 3,
                'icon' => 'tricycle',
            ],
            [
                'slug' => 'car',
                'name' => 'Car',
                'base_fare' => 100.00,
                'per_km' => 25.00,
                'max_passengers' => 4,
                'icon' => 'car',
            ],
            [
                'slug' => 'van',
                'name' => 'Van',
                'base_fare' => 150.00,
                'per_km' => 30.00,
                'max_passengers' => 8,
                'icon' => 'van',
            ],
        ];
    }

    public function estimateFare(float $pickupLat, float $pickupLng, float $destLat, float $destLng): array
    {
        $distanceKm = $this->calculateDistance($pickupLat, $pickupLng, $destLat, $destLng);
        $durationMin = max(5, ceil($distanceKm * 3));

        $fares = [];
        foreach ($this->getVehicleTypes() as $v) {
            $fare = round(max($v['base_fare'] + ($distanceKm * $v['per_km']), $v['base_fare']), 2);
            $fares[$v['slug']] = [
                'base_fare' => $v['base_fare'],
                'per_km' => $v['per_km'],
                'fare' => $fare,
                'fare_text' => '₱'.number_format($fare, 2),
            ];
        }

        return [
            'distance_km' => round($distanceKm, 2),
            'distance_text' => $distanceKm < 1 ? round($distanceKm * 1000).' m' : round($distanceKm, 1).' km',
            'duration_min' => $durationMin,
            'duration_text' => $durationMin.' min',
            'fares' => $fares,
        ];
    }

    public function createRide(array $data): Order
    {
        $fare = (float) $data['fare'];
        $vehicleType = $data['vehicle_type'] ?? 'motorcycle';
        $passengerCount = (int) ($data['passenger_count'] ?? 1);
        $riderCommission = max(20, $fare * 0.4);

        $order = Order::create([
            'order_number' => 'TRP-'.strtoupper(uniqid()),
            'business_id' => 1,
            'customer_name' => Auth::user()->fullName,
            'customer_email' => Auth::user()->email,
            'customer_phone' => $data['customer_phone'] ?? null,
            'order_type' => 'delivery',
            'payment_method' => $data['payment_method'] ?? 'cash',
            'status' => 'pending',
            'subtotal' => $fare,
            'delivery_fee' => 0,
            'discount' => 0,
            'total' => $fare,
            'paid_amount' => 0,
        ]);

        $order->items()->create([
            'description' => 'Ride: '.ucfirst($vehicleType).' ('.$passengerCount.' pax)',
            'quantity' => 1,
            'price' => $fare,
            'subtotal' => $fare,
        ]);

        $ridePin = str_pad(random_int(1000, 9999), 4, '0', STR_PAD_LEFT);

        $delivery = Delivery::create([
            'order_id' => $order->id,
            'status' => 'waiting',
            'dispatch_status' => 'waiting_for_rider',
            'pickup_address' => $data['pickup_address'] ?? '',
            'pickup_latitude' => $data['pickup_lat'],
            'pickup_longitude' => $data['pickup_lng'],
            'delivery_address' => $data['destination_address'] ?? '',
            'delivery_latitude' => $data['destination_lat'],
            'delivery_longitude' => $data['destination_lng'],
            'rider_commission' => $riderCommission,
            'notes' => json_encode([
                'vehicle_type' => $vehicleType,
                'passenger_count' => $passengerCount,
                'estimated_distance_km' => $data['distance_km'] ?? 0,
                'estimated_duration_min' => $data['duration_min'] ?? 0,
                'booking_notes' => $data['booking_notes'] ?? '',
                'ride_pin' => $ridePin,
                'payment_method' => $data['payment_method'] ?? 'cash',
                'fare' => $fare,
            ]),
        ]);

        try {
            $this->dispatchService->dispatchToNearest($delivery, 'transport');
        } catch (\Exception $e) {
            // Dispatch failure is non-blocking
        }

        return $order;
    }

    public function getRideStatus(Order $order): array
    {
        $order->load('delivery.rider.profile', 'items');

        $delivery = $order->delivery;
        $rider = $delivery?->rider;
        $riderProfile = $rider?->profile;

        $statusMap = [
            'pending' => 'searching',
            'confirmed' => 'searching',
            'preparing' => 'searching',
            'assigned' => 'arriving',
            'en_route_pickup' => 'arriving',
            'arrived_pickup' => 'arriving',
            'picked_up' => 'in_progress',
            'in_transit' => 'in_progress',
            'en_route_destination' => 'in_progress',
            'arrived_destination' => 'completed',
            'completed' => 'completed',
        ];

        $deliveryStatus = $delivery?->status ?? 'waiting';
        $rideStatus = $statusMap[$order->status] ?? $statusMap[$deliveryStatus] ?? 'searching';

        $dispatchLogs = null;
        if ($delivery) {
            $dispatchLogs = $delivery->dispatchLogs()
                ->with('rider.profile')
                ->latest()
                ->get();
        }

        $vehicleType = 'motorcycle';
        $passengerCount = 1;
        $ridePin = null;
        $paymentMethod = 'cash';
        $bookingFare = 0;
        $bookingNotes = '';
        $bookingDistance = 0;
        $bookingDuration = 0;
        if ($delivery && $delivery->notes) {
            $notes = json_decode($delivery->notes, true);
            $vehicleType = $notes['vehicle_type'] ?? 'motorcycle';
            $passengerCount = $notes['passenger_count'] ?? 1;
            $ridePin = $notes['ride_pin'] ?? null;
            $paymentMethod = $notes['payment_method'] ?? 'cash';
            $bookingFare = $notes['fare'] ?? 0;
            $bookingNotes = $notes['booking_notes'] ?? '';
            $bookingDistance = $notes['estimated_distance_km'] ?? 0;
            $bookingDuration = $notes['estimated_duration_min'] ?? 0;
        }

        $vehicleColors = [
            'motorcycle' => '#16a34a',
            'tricycle' => '#2563eb',
            'car' => '#7c3aed',
            'van' => '#ea580c',
        ];

        $riderEmergency = null;
        if ($riderProfile && isset($riderProfile->emergency_contact)) {
            $riderEmergency = $riderProfile->emergency_contact;
        }

        $orderNumber = 'TR-'.date('Y', strtotime($order->created_at)).'-'.str_pad($order->id, 6, '0', STR_PAD_LEFT);

        return [
            'order' => $order,
            'order_number' => $orderNumber,
            'delivery' => $delivery,
            'ride_status' => $rideStatus,
            'rider' => $rider,
            'rider_profile' => $riderProfile,
            'vehicle_type' => $vehicleType,
            'vehicle_color' => $vehicleColors[$vehicleType] ?? '#16a34a',
            'passenger_count' => $passengerCount,
            'ride_pin' => $ridePin,
            'payment_method' => $paymentMethod,
            'booking_fare' => $bookingFare,
            'booking_notes' => $bookingNotes,
            'booking_distance' => $bookingDistance,
            'booking_duration' => $bookingDuration,
            'rider_emergency' => $riderEmergency,
            'dispatch_logs' => $dispatchLogs,
            'pickup_lat' => $delivery?->pickup_latitude ?? 13,
            'pickup_lng' => $delivery?->pickup_longitude ?? 121.4,
            'destination_lat' => $delivery?->delivery_latitude ?? 13,
            'destination_lng' => $delivery?->delivery_longitude ?? 121.4,
            'pickup_address' => $delivery?->pickup_address ?? '',
            'destination_address' => $delivery?->delivery_address ?? '',
        ];
    }

    public function cancelRide(Order $order, ?string $reason = null): bool
    {
        if (! in_array($order->status, ['pending', 'confirmed', 'preparing'])) {
            return false;
        }

        $order->update([
            'status' => 'cancelled',
            'cancelled_by' => Auth::id(),
            'cancellation_reason' => $reason,
        ]);

        if ($order->delivery) {
            $order->delivery->update([
                'status' => 'cancelled',
                'dispatch_status' => null,
            ]);
        }

        return true;
    }

    private function calculateDistance(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthRadius = 6371;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) * sin($dLat / 2) +
             cos(deg2rad($lat1)) * cos(deg2rad($lat2)) *
             sin($dLng / 2) * sin($dLng / 2);
        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));

        return $earthRadius * $c;
    }
}
