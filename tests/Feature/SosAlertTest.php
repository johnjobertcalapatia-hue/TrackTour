<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\SosAlert;
use App\Models\User;
use App\Services\TransportationService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * SOS (owner decisions 2026-11-18): a tourist during a ride or a rider during
 * any trip raises an SOS; it goes to the Bansud Tourism Office (in-app only),
 * which acknowledges, sends help and resolves it. One active alert per sender
 * per trip; the other party on the trip is never told.
 */
class SosAlertTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    private User $rider;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake();
        Cache::flush();
        $this->travelTo(CarbonImmutable::parse('2026-11-18 10:00:00'));
        $this->tourist = User::create(['name' => 'Jayvie De Torres', 'email' => 'tourist@sos.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->rider = User::create(['name' => 'Aldrin Robledo', 'email' => 'rider@sos.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'busy', 'current_service' => 'transport']);
        RiderDetail::create(['user_id' => $this->rider->id, 'rider_status' => 'busy', 'current_service' => 'transport', 'vehicle_type' => 'motorcycle', 'vehicle_plate_number' => 'ABC 1234']);
        $this->admin = User::create(['name' => 'Bansud Tourism Office', 'email' => 'office@sos.test', 'password' => Hash::make('x'), 'role' => 'bansud_tourism_office', 'account_status' => 'approved']);
    }

    private function ride(string $status = 'in_transit', bool $assigned = true): Order
    {
        $this->actingAs($this->tourist);
        $order = app(TransportationService::class)->createRide([
            'pickup_lat' => 12.51, 'pickup_lng' => 121.31, 'pickup_address' => 'Bansud Plaza',
            'destination_lat' => 12.60, 'destination_lng' => 121.40, 'destination_address' => 'Pagasa',
            'vehicle_type' => 'motorcycle', 'passenger_count' => 1, 'payment_method' => 'cash', 'booking_notes' => '',
        ]);
        if ($assigned) {
            Delivery::where('order_id', $order->id)->update(['rider_id' => $this->rider->id, 'status' => $status, 'assigned_at' => now()]);
        }

        return $order->fresh();
    }

    private function delivery(Order $order): Delivery
    {
        return Delivery::where('order_id', $order->id)->sole();
    }

    private function touristSos(Order $order, array $body = ['latitude' => 12.55, 'longitude' => 121.35, 'accuracy' => 12])
    {
        return $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/transport/trip/{$order->id}/sos", $body);
    }

    public function test_a_tourist_sends_an_sos_during_a_ride_and_the_tourism_office_sees_it(): void
    {
        $order = $this->ride();
        RiderLocation::create(['rider_id' => $this->rider->id, 'latitude' => 12.556, 'longitude' => 121.351, 'accuracy_m' => 9, 'recorded_at' => now()]);

        $this->touristSos($order, ['latitude' => 12.55, 'longitude' => 121.35, 'accuracy' => 12, 'message' => 'Driver is going the wrong way'])
            ->assertCreated()
            ->assertJsonPath('data.sos.status', 'pending')
            ->assertJsonPath('data.sos.active', true);

        $alert = SosAlert::sole();
        $this->assertSame('tourist', $alert->raised_by_role);
        $this->assertSame('ride', $alert->service);
        $this->assertSame('device', $alert->location_source);
        $this->assertSame('in_transit', $alert->trip_status);
        $this->assertSame(1, ActivityLog::where('action', 'sos.raised')->count());

        $list = $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/live/sos')->assertOk();
        $list->assertJsonPath('data.data.0.reference', $alert->reference)
            ->assertJsonPath('data.data.0.reporter.name', 'Jayvie De Torres')
            ->assertJsonPath('data.data.0.other_party.role', 'driver')
            ->assertJsonPath('data.data.0.other_party.name', 'Aldrin Robledo')
            ->assertJsonPath('data.data.0.other_party.plate_number', 'ABC 1234')
            ->assertJsonPath('data.data.0.message', 'Driver is going the wrong way')
            ->assertJsonPath('data.data.0.order.order_number', $order->order_number)
            ->assertJsonPath('data.data.0.live_location.latitude', 12.556)
            ->assertJsonPath('data.summary.pending', 1);

        $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/live/sos/summary')->assertOk()
            ->assertJsonPath('data.active', 1)
            ->assertJsonPath('data.latest_pending.name', 'Jayvie De Torres');

        // The tourist's trip screen shows their own SOS status.
        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/transport/trip/{$order->id}/status")->assertOk()
            ->assertJsonPath('data.sos.reference', $alert->reference);
    }

    public function test_a_double_press_keeps_one_alert_and_refreshes_its_location(): void
    {
        $order = $this->ride();
        $this->touristSos($order)->assertCreated();
        $this->touristSos($order, ['latitude' => 12.57, 'longitude' => 121.37])->assertOk();

        $this->assertSame(1, SosAlert::count());
        $this->assertEqualsWithDelta(12.57, SosAlert::sole()->latitude, 0.00001);
    }

    public function test_sos_only_while_the_ride_is_in_progress_and_only_on_your_own_ride(): void
    {
        // (Each ride is ended before the next: one ride at a time.)
        $end = function (Order $o): void {
            $o->update(['status' => 'cancelled']);
            Delivery::where('order_id', $o->id)->update(['status' => 'cancelled']);
        };
        $this->touristSos($waiting = $this->ride(assigned: false))->assertStatus(422); // no rider yet
        $end($waiting);
        $done = $this->ride('delivered');
        $this->touristSos($done)->assertStatus(422);                                  // ended
        $end($done);

        $other = User::create(['name' => 'Someone Else', 'email' => 'else@sos.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $mine = $this->ride();
        $this->actingAs($other, 'sanctum')->postJson("/api/tourist/transport/trip/{$mine->id}/sos", [])->assertNotFound();

        $this->assertSame(0, SosAlert::count());
    }

    public function test_a_rider_sends_an_sos_during_a_food_delivery_using_their_gps(): void
    {
        $order = $this->ride('picked_up');
        $order->update(['order_type' => 'food']);
        RiderLocation::create(['rider_id' => $this->rider->id, 'latitude' => 12.52, 'longitude' => 121.32, 'accuracy_m' => 7, 'recorded_at' => now()->subMinute()]);
        $delivery = $this->delivery($order);

        $this->actingAs($this->rider, 'sanctum')->postJson("/api/rider/deliveries/{$delivery->id}/sos", [])->assertCreated();

        $alert = SosAlert::sole();
        $this->assertSame('rider', $alert->raised_by_role);
        $this->assertSame('food', $alert->service);
        $this->assertSame('rider_gps', $alert->location_source);
        $this->assertEqualsWithDelta(12.52, $alert->latitude, 0.00001);

        $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/live/sos')->assertOk()
            ->assertJsonPath('data.data.0.other_party.role', 'customer');

        // Another rider cannot raise one on this trip.
        $otherRider = User::create(['name' => 'Other Rider', 'email' => 'other@sos.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved']);
        RiderDetail::create(['user_id' => $otherRider->id, 'rider_status' => 'available', 'current_service' => 'food', 'vehicle_type' => 'motorcycle']);
        $this->actingAs($otherRider, 'sanctum')->postJson("/api/rider/deliveries/{$delivery->id}/sos", [])->assertForbidden();
    }

    public function test_the_other_party_is_never_told(): void
    {
        $order = $this->ride();
        $this->touristSos($order)->assertCreated();

        // The driver's view of the trip carries no SOS from the passenger.
        $this->actingAs($this->rider, 'sanctum')->getJson("/api/rider/deliveries/{$this->delivery($order)->id}/sos")->assertOk()
            ->assertJsonPath('data.sos', null);
    }

    public function test_the_tourism_office_acknowledges_sends_help_and_resolves(): void
    {
        $order = $this->ride();
        $this->touristSos($order)->assertCreated();
        $id = SosAlert::sole()->id;
        $as = $this->actingAs($this->admin, 'sanctum');

        $as->postJson("/api/admin/live/sos/{$id}/acknowledge")->assertOk()->assertJsonPath('data.status', 'acknowledged')->assertJsonPath('data.acknowledged_by', 'Bansud Tourism Office');
        $as->postJson("/api/admin/live/sos/{$id}/respond", [])->assertStatus(422); // who was sent is required
        $as->postJson("/api/admin/live/sos/{$id}/respond", ['responder' => 'PNP Bansud', 'note' => 'Patrol car on the way'])->assertOk()
            ->assertJsonPath('data.status', 'responding')->assertJsonPath('data.responder', 'PNP Bansud');

        // The tourist sees help is on the way (and can say they're safe; it stays open).
        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/transport/trip/{$order->id}/status")
            ->assertJsonPath('data.sos.status', 'responding')->assertJsonPath('data.sos.responder', 'PNP Bansud');
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/transport/trip/{$order->id}/sos/safe")->assertOk()
            ->assertJsonPath('data.sos.active', true);
        $this->assertNotNull(SosAlert::sole()->sender_safe_at);

        $as = $this->actingAs($this->admin, 'sanctum');
        $as->postJson("/api/admin/live/sos/{$id}/resolve", ['outcome' => 'handled'])->assertStatus(422); // note required
        $as->postJson("/api/admin/live/sos/{$id}/resolve", ['outcome' => 'handled', 'note' => 'Passenger dropped safely at the police station.'])->assertOk()
            ->assertJsonPath('data.status', 'resolved')->assertJsonPath('data.outcome', 'handled')->assertJsonPath('data.resolved_by', 'Bansud Tourism Office');
        $as->postJson("/api/admin/live/sos/{$id}/acknowledge")->assertStatus(422); // already resolved

        $this->assertSame(['sos.acknowledged', 'sos.responding', 'sos.resolved'], ActivityLog::where('action', 'like', 'sos.%')->whereNotIn('action', ['sos.raised', 'sos.sender_safe'])->orderBy('id')->pluck('action')->all());
        $as->getJson('/api/admin/live/sos/summary')->assertJsonPath('data.active', 0);
        $as->getJson('/api/admin/live/sos?filter=resolved')->assertJsonPath('data.data.0.id', $id);

        // A new emergency on the same trip opens a new alert.
        $this->touristSos($order)->assertCreated();
        $this->assertSame(2, SosAlert::count());
    }

    public function test_only_the_tourism_office_can_see_and_handle_sos_alerts(): void
    {
        $order = $this->ride();
        $this->touristSos($order)->assertCreated();
        $id = SosAlert::sole()->id;

        $this->actingAs($this->tourist, 'sanctum')->getJson('/api/admin/live/sos')->assertForbidden();
        $this->actingAs($this->rider, 'sanctum')->postJson("/api/admin/live/sos/{$id}/resolve", ['outcome' => 'false_alarm', 'note' => 'nope'])->assertForbidden();
        $this->assertSame('pending', SosAlert::sole()->status);
    }
}
