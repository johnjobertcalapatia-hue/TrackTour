<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\DeliveryPickupStop;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\PickupSequenceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Trip diagnostics know the canonical food-trip path and bring a trip back
 * onto it (2026-11-12). The rider may apply FIXES (re-sync derived state to
 * the recorded facts); the Tourism Office may also RESET a recorded step so
 * it must be done again, with a written reason. Nothing is ever marked done
 * that was not done.
 */
class TripPathDiagnosticsTest extends TestCase
{
    use RefreshDatabase;

    private User $rider;
    private User $admin;
    private Business $business;

    protected function setUp(): void
    {
        parent::setUp();
        $muni = Municipality::create(['name' => 'Bansud', 'district' => '1st', 'province' => 'Oriental Mindoro']);
        $owner = User::create(['email' => 'owner@path.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->business = Business::create(['owner_id' => $owner->id, 'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id, 'municipality_id' => $muni->id,
            'business_name' => 'Ekslusibo Grill', 'status' => 'approved', 'latitude' => 12.8667, 'longitude' => 121.45, 'address' => 'Pag-asa']);
        $this->rider = User::create(['email' => 'rider@path.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'busy', 'current_service' => 'food', 'municipality_id' => $muni->id]);
        RiderDetail::create(['user_id' => $this->rider->id, 'rider_status' => 'busy', 'current_service' => 'food']);
        $this->admin = User::create(['email' => 'admin@path.test', 'password' => Hash::make('x'), 'role' => 'bansud_tourism_office', 'account_status' => 'approved']);
        // The rider stands ~30 m from the restaurant (inside the 50 m radius).
        RiderLocation::create(['rider_id' => $this->rider->id, 'latitude' => 12.86690, 'longitude' => 121.45020, 'recorded_at' => now()]);
    }

    /** A GCash food delivery with one restaurant stop. */
    private function trip(string $deliveryStatus, string $orderStatus, string $itemStatus, bool $arrived, string $stopStatus = DeliveryPickupStop::STATUS_PENDING): array
    {
        $tourist = User::create(['email' => uniqid().'@t.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $order = Order::create(['order_number' => 'TT-'.random_int(10000, 99999), 'business_id' => $this->business->id, 'user_id' => $tourist->id,
            'customer_name' => 'T', 'customer_email' => $tourist->email, 'customer_phone' => '0912', 'order_type' => 'delivery',
            'payment_method' => 'gcash', 'payment_status' => 'paid', 'status' => 'preparing', 'subtotal' => 300, 'delivery_fee' => 40, 'discount' => 0, 'total' => 340]);
        $item = OrderItem::create(['order_id' => $order->id, 'product_name' => 'Grilled Liempo', 'quantity' => 1, 'unit_price' => 300, 'subtotal' => 300, 'status' => $itemStatus]);
        // Old data may hold an order 'ready' with items behind (TT-04544):
        // written past the model so the test can start from that state.
        DB::table('orders')->where('id', $order->id)->update(['status' => $orderStatus]);
        $delivery = Delivery::create(['order_id' => $order->id, 'rider_id' => $this->rider->id, 'status' => $deliveryStatus, 'assigned_at' => now(),
            'pickup_address' => 'Pag-asa', 'delivery_address' => 'Kawit', 'rider_commission' => 40,
            'delivery_latitude' => 12.9500, 'delivery_longitude' => 121.4000]);
        $stop = DeliveryPickupStop::create(['delivery_id' => $delivery->id, 'order_id' => $order->id, 'business_id' => $this->business->id, 'sequence' => 1,
            'pickup_latitude' => 12.8667, 'pickup_longitude' => 121.45, 'pickup_address' => 'Pag-asa', 'status' => $stopStatus,
            'arrived_at' => $arrived ? now() : null, 'arrival_evidence' => $arrived ? ['server' => ['latitude' => 12.86705]] : null,
            'pickup_confirmed_at' => $stopStatus === DeliveryPickupStop::STATUS_COLLECTED ? now() : null]);

        return [$delivery, $order, $item, $stop];
    }

    private function riderDiagnostics(bool $fix): array
    {
        return $fix
            ? $this->actingAs($this->rider, 'sanctum')->postJson('/api/rider/diagnostics/repair')->assertOk()->json('data')
            : $this->actingAs($this->rider, 'sanctum')->getJson('/api/rider/diagnostics')->assertOk()->json('data');
    }

    private function stateOf(array $path, string $key): ?string
    {
        return collect($path)->firstWhere('key', $key)['state'] ?? null;
    }

    public function test_the_tt04544_mismatch_is_found_and_the_rider_can_fix_it(): void
    {
        [$delivery, , $item, $stop] = $this->trip('arrived_pickup', 'ready', 'preparing', arrived: true);
        $bid = $this->business->id;

        $report = $this->riderDiagnostics(false);
        $this->assertSame('needs_action', $report['checks'][collect($report['checks'])->search(fn ($c) => $c['key'] === 'trip')]['status']);
        $this->assertSame('current', $this->stateOf($report['trip']['path'], "ready:{$bid}"), 'the path shows it waiting on food ready');
        $this->assertSame('preparing', $item->fresh()->status, 'a report changes nothing');

        $fixed = $this->riderDiagnostics(true);
        $this->assertContains('fixed', collect($fixed['checks'])->pluck('status')->all());
        $this->assertSame('ready', $item->fresh()->status);
        $this->assertSame('current', $this->stateOf($fixed['trip']['path'], "pickup:{$bid}"));
        $this->assertTrue(app(PickupSequenceService::class)->confirmability($delivery->fresh(), $stop->fresh())['can_confirm'], 'Confirm Pick Up is unlocked');
        $this->assertSame(1, ActivityLog::where('action', 'rider_self_repair')->count());
    }

    public function test_an_arrival_saved_without_the_trip_moving_is_resynced(): void
    {
        [$delivery] = $this->trip('en_route_pickup', 'preparing', 'preparing', arrived: true);

        $this->riderDiagnostics(true);

        $this->assertSame('arrived_pickup', $delivery->fresh()->status->value);
    }

    public function test_the_path_shows_the_next_step_from_the_recorded_facts(): void
    {
        [$delivery] = $this->trip('assigned', 'accepted', 'accepted', arrived: false);
        $bid = $this->business->id;

        $trip = $this->riderDiagnostics(false)['trip'];

        $this->assertSame('done', $this->stateOf($trip['path'], 'accepted'));
        $this->assertSame('current', $this->stateOf($trip['path'], "arrive:{$bid}"));
        $this->assertSame('todo', $this->stateOf($trip['path'], 'arrive_dropoff'));
        $this->assertSame('Head to Ekslusibo Grill and confirm your arrival.', $trip['next_step']);
        $this->assertTrue($trip['path'] !== [] && $this->stateOf($trip['path'], 'settle') === null, 'no cash step for a prepaid order');
    }

    public function test_fixes_never_invent_a_step(): void
    {
        // Not arrived, food still cooking: nothing to fix, nothing marked done.
        [$delivery, $order, $item, $stop] = $this->trip('en_route_pickup', 'preparing', 'preparing', arrived: false);

        $result = $this->riderDiagnostics(true);

        $this->assertSame([], $result['repaired']);
        $this->assertNull($stop->fresh()->arrived_at);
        $this->assertSame('preparing', $item->fresh()->status);
        $this->assertSame('preparing', $order->fresh()->status);
        $this->assertSame('en_route_pickup', $delivery->fresh()->status->value);
    }

    public function test_a_trip_that_skipped_its_pickups_is_reported_not_fixed(): void
    {
        [$delivery, , , $stop] = $this->trip('picked_up', 'ready', 'ready', arrived: true);

        $result = $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/deliveries/{$delivery->id}/diagnostics/fix")->assertOk()->json('data');

        $this->assertContains('pickups_skipped', collect($result['findings'])->pluck('code')->all());
        $this->assertSame(DeliveryPickupStop::STATUS_PENDING, $stop->fresh()->status, 'never marked collected');
    }

    public function test_only_the_tourism_office_can_open_or_reset(): void
    {
        [$delivery] = $this->trip('arrived_pickup', 'preparing', 'preparing', arrived: true);

        $this->actingAs($this->rider, 'sanctum')->getJson("/api/admin/deliveries/{$delivery->id}/diagnostics")->assertForbidden();
        $this->actingAs($this->rider, 'sanctum')->postJson("/api/admin/deliveries/{$delivery->id}/diagnostics/reset", [
            'action' => 'redo_pickup_arrival', 'business_id' => $this->business->id, 'reason' => 'Rider asked to redo arrival',
        ])->assertForbidden();

        $this->actingAs($this->admin, 'sanctum')->getJson("/api/admin/deliveries/{$delivery->id}/diagnostics")->assertOk()
            ->assertJsonPath('data.resets.0.action', 'redo_pickup_arrival');
    }

    public function test_the_tourism_office_can_reopen_a_restaurant_arrival(): void
    {
        [$delivery, , , $stop] = $this->trip('arrived_pickup', 'preparing', 'preparing', arrived: true);

        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/deliveries/{$delivery->id}/diagnostics/reset", [
            'action' => 'redo_pickup_arrival', 'business_id' => $this->business->id, 'reason' => 'Arrival was recorded at the wrong place',
        ])->assertOk()->assertJsonPath('data.next_step', 'Head to Ekslusibo Grill and confirm your arrival.');

        $this->assertNull($stop->fresh()->arrived_at);
        $this->assertNull($stop->fresh()->arrival_evidence);
        $this->assertSame('en_route_pickup', $delivery->fresh()->status->value);
        $log = ActivityLog::where('action', 'trip_diagnostics.reset')->firstOrFail();
        $this->assertStringContainsString('Arrival was recorded at the wrong place', $log->description);
        $this->assertStringContainsString('arrival_evidence', $log->description, 'the previous record is kept');
        $this->assertSame($this->admin->id, $log->user_id);

        // The rider redoes the step, under the same 50 m rule.
        $again = app(PickupSequenceService::class)->confirmArrival($delivery->fresh(), $this->business->id, $this->rider->id);
        $this->assertTrue($again['success']);
        $this->assertSame('arrived_pickup', $delivery->fresh()->status->value);
    }

    public function test_a_reset_needs_a_reason_and_a_reopenable_step(): void
    {
        [$delivery] = $this->trip('arrived_pickup', 'ready', 'ready', arrived: true, stopStatus: DeliveryPickupStop::STATUS_COLLECTED);
        $url = "/api/admin/deliveries/{$delivery->id}/diagnostics/reset";

        $this->actingAs($this->admin, 'sanctum')->postJson($url, ['action' => 'redo_pickup_arrival', 'business_id' => $this->business->id, 'reason' => 'short'])
            ->assertStatus(422);
        $this->actingAs($this->admin, 'sanctum')->postJson($url, ['action' => 'redo_pickup_arrival', 'business_id' => $this->business->id, 'reason' => 'Rider asked to redo it'])
            ->assertStatus(422)->assertJsonFragment(['message' => 'This restaurant pickup is already confirmed; its arrival cannot be redone.']);
        $this->actingAs($this->admin, 'sanctum')->postJson($url, ['action' => 'redo_dropoff_arrival', 'reason' => 'Rider asked to redo it'])
            ->assertStatus(422);
        $this->assertSame(0, ActivityLog::where('action', 'trip_diagnostics.reset')->count());
    }

    public function test_the_tourism_office_can_reopen_the_arrival_at_the_tourist(): void
    {
        [$delivery] = $this->trip('arrived_destination', 'ready', 'ready', arrived: true, stopStatus: DeliveryPickupStop::STATUS_COLLECTED);
        $delivery->update(['arrived_destination_at' => now()]);

        $this->actingAs($this->admin, 'sanctum')->postJson("/api/admin/deliveries/{$delivery->id}/diagnostics/reset", [
            'action' => 'redo_dropoff_arrival', 'reason' => 'Marked arrived two streets away',
        ])->assertOk();

        $fresh = $delivery->fresh();
        $this->assertSame('in_transit', $fresh->status->value);
        $this->assertNull($fresh->arrived_destination_at);
    }

    public function test_the_command_prints_the_path(): void
    {
        [$delivery, $order] = $this->trip('arrived_pickup', 'ready', 'preparing', arrived: true);

        $this->artisan('trips:diagnose', ['ref' => $order->order_number])
            ->expectsOutputToContain('▶ Food ready at Ekslusibo Grill')
            ->expectsOutputToContain('Re-run with --fix')
            ->assertSuccessful();

        $this->artisan('trips:diagnose', ['ref' => (string) $delivery->id, '--fix' => true])->assertSuccessful();
        $this->assertSame('ready', OrderItem::where('order_id', $order->id)->value('status'));
    }
}
