<?php

namespace Tests\Feature;

use App\Events\DeliveryStatusChanged;
use App\Models\ActivityLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\DeliveryPickupStop;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Rider self-diagnostics (2026-11-10): "Run diagnostics" explains what is
 * wrong; "Fix problems" repairs out-of-sync state so the rider can repeat the
 * step — without ever bypassing a business rule (radius, food ready, payment).
 */
class RiderDiagnosticsTest extends TestCase
{
    use RefreshDatabase;

    private User $rider;
    private Business $business;

    protected function setUp(): void
    {
        parent::setUp();
        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $muni = Municipality::create(['name' => 'Bansud', 'district' => '1st', 'province' => 'Oriental Mindoro']);
        $owner = User::create(['email' => 'owner@diag.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->business = Business::create(['owner_id' => $owner->id, 'business_category_id' => $category->id, 'municipality_id' => $muni->id, 'business_name' => 'Kusina', 'status' => 'approved', 'latitude' => 12.51, 'longitude' => 121.31, 'address' => 'Poblacion']);
        $this->rider = User::create(['email' => 'rider@diag.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'available', 'current_service' => 'food', 'municipality_id' => $muni->id]);
        RiderDetail::create(['user_id' => $this->rider->id, 'rider_status' => 'available', 'current_service' => 'food']);
    }

    private function setRiderStatus(string $status): void
    {
        $this->rider->riderDetail()->update(['rider_status' => $status]);
    }

    private function riderStatus(): string
    {
        return $this->rider->riderDetail()->first()->rider_status;
    }

    private function riderAt(float $lat, float $lng, $recordedAt = null): void
    {
        RiderLocation::create(['rider_id' => $this->rider->id, 'latitude' => $lat, 'longitude' => $lng, 'recorded_at' => $recordedAt ?? now()]);
    }

    private function delivery(string $status): Delivery
    {
        $order = Order::create([
            'order_number' => 'TT-DIAG-'.random_int(1000, 9999), 'business_id' => $this->business->id, 'customer_name' => 'Tourist', 'customer_email' => 't@diag.test',
            'order_type' => 'delivery', 'payment_method' => 'gcash', 'payment_status' => 'paid', 'status' => 'ready',
            'subtotal' => 200, 'delivery_fee' => 60, 'system_fee' => 0, 'total' => 260,
            'delivery_address' => 'Tourist stay', 'delivery_latitude' => 12.60, 'delivery_longitude' => 121.40,
        ]);
        // The order is 'ready', so its item is too (an order 'ready' with a
        // pending item is the TT-04544 mismatch, covered in TripPathDiagnosticsTest).
        $order->items()->create(['business_id' => $this->business->id, 'product_name' => 'Adobo', 'quantity' => 1, 'unit_price' => 200, 'subtotal' => 200, 'preparation_time' => 10, 'status' => 'ready']);

        return Delivery::create([
            'order_id' => $order->id, 'rider_id' => $this->rider->id, 'status' => $status, 'assigned_at' => now(),
            'pickup_address' => 'Kusina', 'pickup_latitude' => 12.51, 'pickup_longitude' => 121.31,
            'delivery_address' => 'Tourist stay', 'delivery_latitude' => 12.60, 'delivery_longitude' => 121.40,
        ]);
    }

    private function stop(Delivery $delivery, string $status, bool $arrived = true): DeliveryPickupStop
    {
        return DeliveryPickupStop::create([
            'delivery_id' => $delivery->id, 'order_id' => $delivery->order_id, 'business_id' => $this->business->id, 'sequence' => 1,
            'pickup_latitude' => 12.51, 'pickup_longitude' => 121.31, 'pickup_address' => 'Kusina',
            'status' => $status, 'arrived_at' => $arrived ? now() : null,
            'pickup_confirmed_at' => $status === DeliveryPickupStop::STATUS_COLLECTED ? now() : null,
        ]);
    }

    private function check(array $json, string $key): ?array
    {
        return collect($json['data']['checks'])->firstWhere('key', $key);
    }

    public function test_only_riders_can_run_diagnostics(): void
    {
        $this->getJson('/api/rider/diagnostics')->assertUnauthorized();
        $tourist = User::create(['email' => 'tourist@diag.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->be($tourist)->getJson('/api/rider/diagnostics')->assertForbidden();
        $this->be($tourist)->postJson('/api/rider/diagnostics/repair')->assertForbidden();
    }

    public function test_a_healthy_rider_passes_every_check(): void
    {
        $this->riderAt(12.52, 121.32);

        $json = $this->be($this->rider)->getJson('/api/rider/diagnostics')->assertOk()->json();

        $this->assertTrue($json['data']['ok']);
        $this->assertSame(['account', 'location', 'status'], array_column($json['data']['checks'], 'key'));
        $this->assertSame([], $json['data']['repaired']);
    }

    public function test_a_stale_busy_status_is_reported_then_released(): void
    {
        $this->riderAt(12.52, 121.32);
        $this->setRiderStatus('busy');

        $json = $this->be($this->rider)->getJson('/api/rider/diagnostics')->json();
        $this->assertSame('needs_action', $this->check($json, 'status')['status']);
        $this->assertSame('busy', $this->riderStatus(), 'Running diagnostics alone changes nothing.');

        $json = $this->be($this->rider)->postJson('/api/rider/diagnostics/repair')->assertOk()->json();
        $this->assertSame('fixed', $this->check($json, 'status')['status']);
        $this->assertTrue($json['data']['ok']);
        $this->assertSame('available', $this->riderStatus());
        $this->assertDatabaseHas('activity_logs', ['user_id' => $this->rider->id, 'action' => 'rider_self_repair']);
    }

    public function test_a_live_delivery_sets_the_status_back_to_busy(): void
    {
        $this->riderAt(12.55, 121.35);
        $this->delivery('in_transit');

        $this->be($this->rider)->postJson('/api/rider/diagnostics/repair')->assertOk();

        $this->assertSame('busy', $this->riderStatus());
    }

    public function test_invalid_zero_locations_are_cleared_and_the_device_fix_is_saved(): void
    {
        $this->riderAt(0, 121.32, now()->subSeconds(30));

        $json = $this->be($this->rider)->getJson('/api/rider/diagnostics')->json();
        $this->assertSame('needs_action', $this->check($json, 'location')['status']);

        $json = $this->be($this->rider)->postJson('/api/rider/diagnostics/repair', ['latitude' => 12.52, 'longitude' => 121.32])->json();

        $this->assertSame('fixed', $this->check($json, 'location')['status']);
        $this->assertSame(0, RiderLocation::where('rider_id', $this->rider->id)->where('latitude', 0)->count());
        $this->assertEqualsWithDelta(12.52, (float) RiderLocation::where('rider_id', $this->rider->id)->latest('id')->first()->latitude, 0.00001);
    }

    public function test_an_impossible_jump_is_not_saved_and_the_rider_is_told_to_wait(): void
    {
        $this->riderAt(12.52, 121.32, now()->subSeconds(30));

        // ~11 km in 30 s is far beyond tracking.max_speed_kph.
        $json = $this->be($this->rider)->postJson('/api/rider/diagnostics/repair', ['latitude' => 12.62, 'longitude' => 121.32])->json();

        $this->assertSame('warn', $this->check($json, 'location')['status']);
        $this->assertStringContainsString('try again in about', $this->check($json, 'location')['message']);
        $this->assertSame(1, RiderLocation::where('rider_id', $this->rider->id)->count());
    }

    public function test_a_coarse_device_fix_is_not_saved_and_the_rider_is_told_why(): void
    {
        $this->riderAt(12.96, 121.47, now()->subMinutes(10));

        // DevTools Sensors default (150 m): the map shows it, the server must not count it.
        $json = $this->be($this->rider)->postJson('/api/rider/diagnostics/repair', ['latitude' => 12.8669, 'longitude' => 121.4501, 'accuracy' => 150])->json();

        $this->assertSame('needs_action', $this->check($json, 'location')['status']);
        $this->assertStringContainsString('not precise enough (±150 m', $this->check($json, 'location')['message']);
        $this->assertSame(1, RiderLocation::where('rider_id', $this->rider->id)->count());

        $json = $this->be($this->rider)->postJson('/api/rider/diagnostics/repair', ['latitude' => 12.8669, 'longitude' => 121.4501, 'accuracy' => 10])->json();
        $this->assertSame('fixed', $this->check($json, 'location')['status']);
    }

    public function test_a_zero_device_fix_is_never_saved(): void
    {
        $this->riderAt(12.52, 121.32, now()->subMinutes(30));

        $this->be($this->rider)->postJson('/api/rider/diagnostics/repair', ['latitude' => 0, 'longitude' => 0])->assertOk();

        $this->assertSame(1, RiderLocation::where('rider_id', $this->rider->id)->count());
    }

    public function test_a_trip_stuck_after_every_pickup_was_confirmed_moves_on(): void
    {
        Event::fake([DeliveryStatusChanged::class]);
        $this->setRiderStatus('busy');
        $this->riderAt(12.5101, 121.3101);
        $delivery = $this->delivery('arrived_pickup');
        $this->stop($delivery, DeliveryPickupStop::STATUS_COLLECTED);

        $json = $this->be($this->rider)->getJson('/api/rider/diagnostics')->json();
        $this->assertSame('needs_action', $this->check($json, 'trip')['status']);
        $this->assertSame('arrived_pickup', $delivery->fresh()->status->value);

        $json = $this->be($this->rider)->postJson('/api/rider/diagnostics/repair')->assertOk()->json();

        $this->assertSame('fixed', $this->check($json, 'trip')['status']);
        $this->assertSame('picked_up', $delivery->fresh()->status->value);
        Event::assertDispatched(DeliveryStatusChanged::class);
        $this->assertTrue(ActivityLog::where('user_id', $this->rider->id)->where('description', 'like', 'Moved order%')->exists());
    }

    public function test_a_pending_pickup_is_never_skipped_and_the_rider_is_sent_back(): void
    {
        $this->setRiderStatus('busy');
        $this->riderAt(12.60, 121.40); // ~13 km from the restaurant
        $delivery = $this->delivery('arrived_pickup');
        $this->stop($delivery, DeliveryPickupStop::STATUS_PENDING);

        $json = $this->be($this->rider)->postJson('/api/rider/diagnostics/repair')->assertOk()->json();

        $trip = $this->check($json, 'trip');
        $this->assertSame('needs_action', $trip['status']);
        $this->assertMatchesRegularExpression('/^Go back to Kusina: you are \d+\.\d km away and must be within 50 m to confirm the pickup\.$/', $trip['message']);
        $this->assertSame('arrived_pickup', $delivery->fresh()->status->value);
        $this->assertSame(DeliveryPickupStop::STATUS_PENDING, DeliveryPickupStop::where('delivery_id', $delivery->id)->value('status'));
    }

    public function test_missing_pickup_stops_are_rebuilt(): void
    {
        $this->setRiderStatus('busy');
        $this->riderAt(12.55, 121.35);
        $delivery = $this->delivery('en_route_pickup');

        $json = $this->be($this->rider)->getJson('/api/rider/diagnostics')->json();
        $this->assertSame('needs_action', $this->check($json, 'trip')['status']);
        $this->assertSame(0, DeliveryPickupStop::where('delivery_id', $delivery->id)->count());

        $json = $this->be($this->rider)->postJson('/api/rider/diagnostics/repair')->json();

        $this->assertSame('fixed', $this->check($json, 'trip')['status']);
        $this->assertSame(1, DeliveryPickupStop::where('delivery_id', $delivery->id)->count());
        $this->assertSame('en_route_pickup', $delivery->fresh()->status->value);
    }
}
