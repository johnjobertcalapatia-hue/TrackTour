<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderCashFundTransaction;
use App\Models\TouristLocationShare;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Municipal Office plan Stage 2 (docs/municipal-office-plan.md): a municipal
 * Tourism Office gets Live Map, Deliveries and Rider Cash for its own
 * municipality, served by the Bansud controllers behind /municipal/*.
 */
class MunicipalLiveOperationsTest extends TestCase
{
    use RefreshDatabase;

    private Municipality $bansud;
    private Municipality $gloria;
    private User $bansudAdmin;
    private User $gloriaOffice;
    private Business $gloriaCafe;
    private Business $bansudGrill;
    private User $gloriaRider;
    private User $bansudRider;

    protected function setUp(): void
    {
        parent::setUp();
        // Real-ish centres 15 km apart, so the locator can tell them apart.
        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => '2nd', 'province' => 'Oriental Mindoro', 'latitude' => 12.8640, 'longitude' => 121.4550]);
        $this->gloria = Municipality::create(['name' => 'Gloria', 'district' => '2nd', 'province' => 'Oriental Mindoro', 'latitude' => 12.9710, 'longitude' => 121.4720]);
        $this->bansudAdmin = $this->user('bansud_tourism_office', $this->bansud);
        $this->gloriaOffice = $this->user('tourism_office', $this->gloria);

        $owner = $this->user('business_owner', $this->gloria);
        $this->gloriaCafe = Business::create(['owner_id' => $owner->id, 'municipality_id' => $this->gloria->id, 'business_name' => 'Aelia Cafe', 'status' => 'approved', 'latitude' => 12.971, 'longitude' => 121.472]);
        $this->bansudGrill = Business::create(['owner_id' => $owner->id, 'municipality_id' => $this->bansud->id, 'business_name' => 'Bansud Grill', 'status' => 'approved', 'latitude' => 12.864, 'longitude' => 121.455]);

        $this->gloriaRider = $this->rider($this->gloria, User::RIDER_STATUS_AVAILABLE);
        $this->bansudRider = $this->rider($this->bansud, User::RIDER_STATUS_AVAILABLE);
    }

    private function user(string $role, Municipality $m, string $status = 'approved'): User
    {
        return User::create([
            'name' => ucfirst($role).' '.$m->name, 'email' => Str::lower($role.'.'.Str::random(8)).'@example.com',
            'password' => 'Password123!', 'role' => $role, 'account_status' => $status, 'municipality_id' => $m->id,
        ]);
    }

    private function rider(Municipality $m, string $status): User
    {
        $rider = $this->user('rider', $m);
        $rider->riderDetail()->create(['current_service' => User::SERVICE_FOOD, 'rider_status' => $status]);

        return $rider;
    }

    private function delivery(string $number, ?Business $business, string $status, ?User $rider = null, string $type = 'delivery'): Delivery
    {
        $order = Order::create(['order_number' => $number, 'customer_name' => 'Ana', 'business_id' => $business?->id, 'order_type' => $type, 'total' => 300, 'subtotal' => 250]);

        return Delivery::create(['order_id' => $order->id, 'status' => $status, 'rider_id' => $rider?->id, 'pickup_address' => 'x', 'delivery_address' => 'y']);
    }

    private function advance(User $officer, string $base, User $rider): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($officer, 'sanctum')->postJson("/api/{$base}/riders/{$rider->id}/cash-fund/advances", [
            'amount' => 500, 'idempotency_key' => (string) Str::uuid(),
        ]);
    }

    // ─── Live Map ────────────────────────────────────────────────────────

    public function test_map_shows_only_the_municipalitys_businesses_and_town(): void
    {
        $data = $this->actingAs($this->gloriaOffice, 'sanctum')->getJson('/api/municipal/map-data')->assertOk()->json('data');

        $this->assertSame(['Aelia Cafe'], collect($data['businesses'])->pluck('name')->all());
        $this->assertSame(['Gloria'], collect($data['municipalities'])->pluck('name')->all());

        // Bansud is unchanged: every municipality.
        $all = $this->actingAs($this->bansudAdmin, 'sanctum')->getJson('/api/admin/map-data')->assertOk()->json('data');
        $this->assertCount(2, $all['businesses']);
        $this->assertCount(2, $all['municipalities']);
    }

    public function test_live_riders_are_own_riders_plus_riders_on_a_trip_for_the_municipality(): void
    {
        $visitor = $this->rider($this->bansud, User::RIDER_STATUS_BUSY);
        $this->delivery('ORD-G1', $this->gloriaCafe, 'en_route_pickup', $visitor);

        $ids = collect($this->actingAs($this->gloriaOffice, 'sanctum')->getJson('/api/municipal/live/riders')->assertOk()->json('data'))->pluck('id')->sort()->values()->all();

        $this->assertSame(collect([$this->gloriaRider->id, $visitor->id])->sort()->values()->all(), $ids);
        $this->assertNotContains($this->bansudRider->id, $ids);

        $this->assertCount(3, $this->actingAs($this->bansudAdmin, 'sanctum')->getJson('/api/admin/live/riders')->json('data'));
    }

    public function test_live_tourists_are_only_those_inside_the_municipality(): void
    {
        $inGloria = $this->user('tourist', $this->gloria);
        $inBansud = $this->user('tourist', $this->bansud);
        TouristLocationShare::create(['user_id' => $inGloria->id, 'enabled' => true, 'consented_at' => now(), 'latitude' => 12.972, 'longitude' => 121.471, 'location_at' => now()]);
        TouristLocationShare::create(['user_id' => $inBansud->id, 'enabled' => true, 'consented_at' => now(), 'latitude' => 12.865, 'longitude' => 121.456, 'location_at' => now()]);

        $ids = collect($this->actingAs($this->gloriaOffice, 'sanctum')->getJson('/api/municipal/live/tourists')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertSame([$inGloria->id], $ids);

        $this->assertCount(2, $this->actingAs($this->bansudAdmin, 'sanctum')->getJson('/api/admin/live/tourists')->json('data'));
    }

    // ─── Deliveries ──────────────────────────────────────────────────────

    public function test_deliveries_are_the_municipalitys_own_and_bansud_keeps_its_own(): void
    {
        $this->delivery('ORD-GLORIA', $this->gloriaCafe, 'picked_up', $this->gloriaRider);
        $this->delivery('ORD-BANSUD', $this->bansudGrill, 'picked_up', $this->bansudRider);
        $this->delivery('RIDE-GLORIA', null, 'in_transit', $this->gloriaRider, 'transport');

        $gloria = $this->actingAs($this->gloriaOffice, 'sanctum')->getJson('/api/municipal/live/deliveries')->assertOk();
        $this->assertEqualsCanonicalizing(['ORD-GLORIA', 'RIDE-GLORIA'], collect($gloria->json('data'))->pluck('order_number')->all());
        $this->assertSame('Gloria', $gloria->json('meta.municipality.name'));

        $bansud = $this->actingAs($this->bansudAdmin, 'sanctum')->getJson('/api/admin/live/deliveries')->assertOk();
        $this->assertSame(['ORD-BANSUD'], collect($bansud->json('data'))->pluck('order_number')->all());
    }

    // ─── Rider Cash ──────────────────────────────────────────────────────

    public function test_municipal_office_manages_cash_advances_for_its_own_riders_only(): void
    {
        $overview = $this->actingAs($this->gloriaOffice, 'sanctum')->getJson('/api/municipal/cash-advances')->assertOk()->json('data.riders');
        $this->assertSame([$this->gloriaRider->id], collect($overview)->pluck('rider_id')->all());

        $this->advance($this->gloriaOffice, 'municipal', $this->gloriaRider)->assertOk();
        $this->advance($this->gloriaOffice, 'municipal', $this->bansudRider)->assertForbidden();
        $this->actingAs($this->gloriaOffice, 'sanctum')->getJson("/api/municipal/riders/{$this->bansudRider->id}/cash-fund/daily-receipt")->assertForbidden();
        $this->actingAs($this->gloriaOffice, 'sanctum')->getJson("/api/municipal/riders/{$this->gloriaRider->id}/cash-fund/daily-receipt")->assertOk();

        $this->assertSame(1, RiderCashFundTransaction::count());
        $this->assertSame($this->gloria->id, (int) RiderCashFundTransaction::sole()->fund->municipality_id);
    }

    public function test_bansud_still_manages_only_bansud_riders_cash(): void
    {
        $this->advance($this->bansudAdmin, 'admin', $this->bansudRider)->assertOk();
        $this->advance($this->bansudAdmin, 'admin', $this->gloriaRider)->assertForbidden();

        $overview = $this->actingAs($this->bansudAdmin, 'sanctum')->getJson('/api/admin/cash-advances')->assertOk()->json('data.riders');
        $this->assertSame([$this->bansudRider->id], collect($overview)->pluck('rider_id')->all());
    }

    // ─── Access ──────────────────────────────────────────────────────────

    public function test_municipal_offices_still_cannot_use_the_bansud_admin_routes(): void
    {
        $this->actingAs($this->gloriaOffice, 'sanctum')->getJson('/api/admin/live/deliveries')->assertForbidden();
        $this->actingAs($this->gloriaOffice, 'sanctum')->getJson('/api/admin/cash-advances')->assertForbidden();
        $this->advance($this->gloriaOffice, 'admin', $this->gloriaRider)->assertForbidden();
    }

    public function test_unassigned_or_suspended_offices_and_other_roles_are_refused(): void
    {
        $suspended = $this->user('tourism_office', $this->gloria, 'suspended');
        $unassigned = User::create(['email' => 'none@example.com', 'password' => 'x', 'role' => 'tourism_office', 'account_status' => 'approved']);

        foreach ([$suspended, $unassigned, $this->gloriaRider, $this->bansudAdmin] as $user) {
            foreach (['/api/municipal/map-data', '/api/municipal/live/riders', '/api/municipal/live/deliveries', '/api/municipal/cash-advances'] as $uri) {
                $this->actingAs($user, 'sanctum')->getJson($uri)->assertForbidden();
            }
            $this->advance($user, 'municipal', $this->gloriaRider)->assertForbidden();
        }
        $this->assertSame(0, RiderCashFundTransaction::count());
    }
}
