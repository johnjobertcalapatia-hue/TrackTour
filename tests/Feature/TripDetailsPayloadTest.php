<?php

namespace Tests\Feature;

use App\Models\Delivery;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderDetail;
use App\Models\User;
use App\Services\TransportationService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Trip details from My Activities › Travels (2026-11-18): each step's time
 * (date, times, durations) and the online payment's reference, next to the
 * route coordinates, fare breakdown and driver the status already returns.
 */
class TripDetailsPayloadTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_completed_ride_returns_its_step_times_route_fare_payment_and_driver(): void
    {
        Http::fake();
        $t0 = CarbonImmutable::parse('2026-11-18 08:00:00');
        $this->travelTo($t0);
        $tourist = User::create(['name' => 'Jayvie De Torres', 'email' => 'tourist@trip.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $rider = User::create(['name' => 'Aldrin Robledo', 'email' => 'rider@trip.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved']);
        RiderDetail::create(['user_id' => $rider->id, 'rider_status' => 'available', 'current_service' => 'transport', 'vehicle_type' => 'motorcycle', 'vehicle_plate_number' => 'ABC 1234']);

        $this->actingAs($tourist);
        $order = app(TransportationService::class)->createRide([
            'pickup_lat' => 12.86, 'pickup_lng' => 121.45, 'pickup_address' => 'Gloria, Oriental Mindoro',
            'destination_lat' => 12.81, 'destination_lng' => 121.47, 'destination_address' => 'Ekslusibo Grill and Restaurant',
            'vehicle_type' => 'motorcycle', 'passenger_count' => 1, 'payment_method' => 'gcash', 'booking_notes' => '',
        ]);
        Delivery::where('order_id', $order->id)->update([
            'rider_id' => $rider->id, 'status' => 'completed',
            'assigned_at' => $t0->addMinute(), 'arrived_pickup_at' => $t0->addMinutes(6), 'picked_up_at' => $t0->addMinutes(8),
            'arrived_destination_at' => $t0->addMinutes(28), 'delivered_at' => $t0->addMinutes(30),
        ]);
        $order->update(['status' => 'completed', 'completed_at' => $t0->addMinutes(30), 'payment_status' => 'paid', 'paid_amount' => $order->total]);
        Payment::create([
            'payment_number' => 'PAY-TRIPDETAIL', 'payable_type' => Order::class, 'payable_id' => $order->id, 'user_id' => $tourist->id,
            'amount' => $order->total, 'method' => 'gcash', 'provider' => 'paymongo', 'status' => 'paid', 'paid_at' => $t0->addMinutes(29),
            'metadata' => ['checkout_session_payment_paid' => ['attributes' => ['source' => ['type' => 'qrph']]]],
        ]);

        $response = $this->actingAs($tourist, 'sanctum')->getJson("/api/tourist/transport/trip/{$order->id}/status");
        // Coordinates are decimal strings ("12.8600000"); the page formats them.
        $this->assertEquals(12.86, (float) $response->json('data.pickup_latitude'));
        $this->assertEquals(121.47, (float) $response->json('data.destination_longitude'));
        $response
            ->assertOk()
            ->assertJsonPath('data.pickup_address', 'Gloria, Oriental Mindoro')
            ->assertJsonPath('data.trip_times.accepted_at', $t0->addMinute()->toIso8601String())
            ->assertJsonPath('data.trip_times.arrived_pickup_at', $t0->addMinutes(6)->toIso8601String())
            ->assertJsonPath('data.trip_times.picked_up_at', $t0->addMinutes(8)->toIso8601String())
            ->assertJsonPath('data.trip_times.arrived_destination_at', $t0->addMinutes(28)->toIso8601String())
            ->assertJsonPath('data.trip_times.completed_at', $t0->addMinutes(30)->toIso8601String())
            ->assertJsonPath('data.payment_reference', 'PAY-TRIPDETAIL')
            ->assertJsonPath('data.paid_via', 'qrph')
            ->assertJsonPath('data.rider.name', 'Aldrin Robledo')
            ->assertJsonPath('data.rider.plate_number', 'ABC 1234');
    }
}
