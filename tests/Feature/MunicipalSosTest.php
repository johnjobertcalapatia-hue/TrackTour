<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\SosAlert;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Municipal Office plan Stage 3 (decision D1): an SOS belongs to the municipal
 * Tourism Office of the trip's town (food → restaurant's town, ride → driver's
 * town). That office sees and handles it; Bansud always sees every alert and
 * can take any over.
 */
class MunicipalSosTest extends TestCase
{
    use RefreshDatabase;

    private Municipality $bansud;
    private Municipality $gloria;
    private User $bansudAdmin;
    private User $gloriaOffice;
    private User $bansudOffice;
    private Business $gloriaCafe;
    private User $bansudRider;
    private User $gloriaRider;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake();
        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => '2nd', 'province' => 'Oriental Mindoro']);
        $this->gloria = Municipality::create(['name' => 'Gloria', 'district' => '2nd', 'province' => 'Oriental Mindoro']);
        $this->bansudAdmin = $this->user('bansud_tourism_office', $this->bansud);
        $this->gloriaOffice = $this->user('tourism_office', $this->gloria);
        // A municipal account for Bansud itself is still a town office (not the district admin).
        $this->bansudOffice = $this->user('tourism_office', $this->bansud);
        $owner = $this->user('business_owner', $this->gloria);
        $this->gloriaCafe = Business::create(['owner_id' => $owner->id, 'municipality_id' => $this->gloria->id, 'business_name' => 'Aelia Cafe', 'status' => 'approved']);
        $this->bansudRider = $this->rider($this->bansud);
        $this->gloriaRider = $this->rider($this->gloria);
    }

    private function user(string $role, Municipality $m): User
    {
        return User::create([
            'name' => ucfirst($role).' '.$m->name, 'email' => Str::lower($role.'.'.Str::random(8)).'@sos.test',
            'password' => 'x', 'role' => $role, 'account_status' => 'approved', 'municipality_id' => $m->id,
        ]);
    }

    private function rider(Municipality $m): User
    {
        $rider = $this->user('rider', $m);
        RiderDetail::create(['user_id' => $rider->id, 'rider_status' => 'busy', 'current_service' => 'food']);

        return $rider;
    }

    private function trip(User $rider, ?Business $business, string $type): Delivery
    {
        $order = Order::create(['order_number' => 'TT-'.Str::random(6), 'customer_name' => 'Ana', 'business_id' => $business?->id, 'order_type' => $type, 'total' => 300, 'subtotal' => 250]);

        return Delivery::create(['order_id' => $order->id, 'status' => 'in_transit', 'rider_id' => $rider->id, 'pickup_address' => 'x', 'delivery_address' => 'y']);
    }

    private function raise(User $rider, Delivery $delivery): SosAlert
    {
        $this->actingAs($rider, 'sanctum')->postJson("/api/rider/deliveries/{$delivery->id}/sos", [])->assertCreated();

        return SosAlert::where('delivery_id', $delivery->id)->sole();
    }

    public function test_a_food_sos_belongs_to_the_restaurants_town_even_with_a_rider_from_elsewhere(): void
    {
        $alert = $this->raise($this->bansudRider, $this->trip($this->bansudRider, $this->gloriaCafe, 'delivery'));

        $this->assertSame($this->gloria->id, $alert->municipality_id);
    }

    public function test_a_ride_sos_belongs_to_the_drivers_town(): void
    {
        $alert = $this->raise($this->gloriaRider, $this->trip($this->gloriaRider, null, 'transport'));

        $this->assertSame($this->gloria->id, $alert->municipality_id);
    }

    public function test_the_municipal_office_sees_and_handles_only_its_own_alerts(): void
    {
        $gloriaAlert = $this->raise($this->bansudRider, $this->trip($this->bansudRider, $this->gloriaCafe, 'delivery'));
        $bansudAlert = $this->raise($this->bansudRider, $this->trip($this->bansudRider, null, 'transport'));

        $this->actingAs($this->gloriaOffice, 'sanctum');
        $list = $this->getJson('/api/municipal/live/sos')->assertOk();
        $this->assertSame([$gloriaAlert->id], collect($list->json('data.data'))->pluck('id')->all());
        $this->assertSame('Gloria', $list->json('data.data.0.municipality.name'));
        $this->assertSame(['active' => 1, 'pending' => 1], $list->json('data.summary'));
        $summary = $this->getJson('/api/municipal/live/sos/summary')->assertOk();
        $this->assertSame($gloriaAlert->id, $summary->json('data.latest_pending.id'));

        // Its own alert: acknowledge → send help → resolve.
        $this->postJson("/api/municipal/live/sos/{$gloriaAlert->id}/acknowledge")->assertOk();
        $this->postJson("/api/municipal/live/sos/{$gloriaAlert->id}/respond", ['responder' => 'PNP Gloria'])->assertOk();
        $this->postJson("/api/municipal/live/sos/{$gloriaAlert->id}/resolve", ['outcome' => 'handled', 'note' => 'Rider safe at the station.'])->assertOk()
            ->assertJsonPath('data.bansud_involved', false);
        $this->assertSame(SosAlert::STATUS_RESOLVED, $gloriaAlert->fresh()->status);
        $this->assertSame($this->gloriaOffice->id, $gloriaAlert->fresh()->resolved_by);

        // Another town's alert: not found, and untouched.
        $this->postJson("/api/municipal/live/sos/{$bansudAlert->id}/acknowledge")->assertNotFound();
        $this->postJson("/api/municipal/live/sos/{$bansudAlert->id}/resolve", ['outcome' => 'false_alarm', 'note' => 'Not ours.'])->assertNotFound();
        $this->assertSame(SosAlert::STATUS_PENDING, $bansudAlert->fresh()->status);
    }

    public function test_bansud_sees_every_alert_and_can_take_one_over(): void
    {
        $gloriaAlert = $this->raise($this->bansudRider, $this->trip($this->bansudRider, $this->gloriaCafe, 'delivery'));
        $this->raise($this->bansudRider, $this->trip($this->bansudRider, null, 'transport'));

        $this->actingAs($this->gloriaOffice, 'sanctum')->postJson("/api/municipal/live/sos/{$gloriaAlert->id}/acknowledge")->assertOk();

        $this->actingAs($this->bansudAdmin, 'sanctum');
        $this->assertCount(2, $this->getJson('/api/admin/live/sos')->assertOk()->json('data.data'));
        $this->assertSame(2, $this->getJson('/api/admin/live/sos/summary')->json('data.active'));

        $this->postJson("/api/admin/live/sos/{$gloriaAlert->id}/respond", ['responder' => 'PNP Bansud'])->assertOk()
            ->assertJsonPath('data.bansud_involved', true)
            ->assertJsonPath('data.acknowledged_by', $this->gloriaOffice->name)
            ->assertJsonPath('data.responding_by', $this->bansudAdmin->name);
    }

    public function test_an_alert_with_no_known_town_reaches_bansud_only(): void
    {
        $nowhere = User::create(['name' => 'Rider Nowhere', 'email' => 'nowhere@sos.test', 'password' => 'x', 'role' => 'rider', 'account_status' => 'approved']);
        RiderDetail::create(['user_id' => $nowhere->id, 'rider_status' => 'busy', 'current_service' => 'transport']);
        $alert = $this->raise($nowhere, $this->trip($nowhere, null, 'transport'));

        $this->assertNull($alert->municipality_id);
        $this->assertSame([], $this->actingAs($this->bansudOffice, 'sanctum')->getJson('/api/municipal/live/sos')->json('data.data'));
        $this->assertCount(1, $this->actingAs($this->bansudAdmin, 'sanctum')->getJson('/api/admin/live/sos')->json('data.data'));
    }

    public function test_other_roles_and_municipal_offices_on_admin_routes_are_refused(): void
    {
        $alert = $this->raise($this->bansudRider, $this->trip($this->bansudRider, $this->gloriaCafe, 'delivery'));

        $this->actingAs($this->gloriaOffice, 'sanctum')->getJson('/api/admin/live/sos')->assertForbidden();
        $this->actingAs($this->gloriaOffice, 'sanctum')->postJson("/api/admin/live/sos/{$alert->id}/acknowledge")->assertForbidden();
        $this->actingAs($this->gloriaRider, 'sanctum')->getJson('/api/municipal/live/sos')->assertForbidden();
        $this->actingAs($this->bansudAdmin, 'sanctum')->getJson('/api/municipal/live/sos')->assertForbidden();
        $this->assertSame(SosAlert::STATUS_PENDING, $alert->fresh()->status);
    }

    public function test_alerts_raised_before_this_stage_are_given_their_town(): void
    {
        $food = $this->raise($this->bansudRider, $this->trip($this->bansudRider, $this->gloriaCafe, 'delivery'));
        $ride = $this->raise($this->gloriaRider, $this->trip($this->gloriaRider, null, 'transport'));

        $migration = require database_path('migrations/2026_11_28_000006_add_municipality_to_sos_alerts.php');
        $migration->down();
        $migration->up();

        $this->assertSame($this->gloria->id, (int) DB::table('sos_alerts')->where('id', $food->id)->value('municipality_id'));
        $this->assertSame($this->gloria->id, (int) DB::table('sos_alerts')->where('id', $ride->id)->value('municipality_id'));
    }
}
