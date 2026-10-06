<?php

namespace Tests\Feature;

use App\Enums\TripStatus;
use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Rider "Auto accept" preference.
 *
 * Architecture under test:
 *
 *     rider taps Auto accept
 *              ↓
 *     rider_details.auto_accept = 1        ← state ONLY (this endpoint)
 *              ↓
 *     first ping arrives → the rider's device calls the SAME canonical
 *     PATCH /rider/dispatch/accept the manual button uses
 *
 * This class therefore pins two separate things:
 *
 *  1. The preference itself — rider-only RBAC, boolean validation,
 *     persistence through rider_details, and exposure on /api/user so the
 *     rider's device can read it back.
 *
 *  2. That flipping the preference has ZERO dispatch side effects. Toggling
 *     it must never accept an offer, never assign a delivery, and never move
 *     rider_status. Acceptance stays the exclusive job of the atomic accept
 *     path, which is what still enforces one active delivery per rider,
 *     offer expiry, and COD eligibility (AGENTS.md §4.3 / §9).
 */
class RiderAutoAcceptTest extends TestCase
{
    use RefreshDatabase;

    private User $rider;

    protected function setUp(): void
    {
        parent::setUp();

        $municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
        ]);

        $this->rider = User::create([
            'name' => 'Rider One',
            'email' => 'rider-auto-accept@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
            'municipality_id' => $municipality->id,
        ]);
    }

    // ── 1. The preference ─────────────────────────────────────────────

    public function test_guest_cannot_toggle_auto_accept(): void
    {
        $this->patchJson('/api/rider/auto-accept', ['auto_accept' => true])
            ->assertStatus(401);
    }

    public function test_non_rider_cannot_toggle_auto_accept(): void
    {
        $tourist = User::create([
            'name' => 'Tourist One',
            'email' => 'tourist-auto-accept@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->actingAs($tourist, 'sanctum')
            ->patchJson('/api/rider/auto-accept', ['auto_accept' => true])
            ->assertStatus(403);
    }

    public function test_auto_accept_is_off_by_default(): void
    {
        // No rider_details row yet — the rider has never touched the toggle.
        $this->assertNull(RiderDetail::where('user_id', $this->rider->id)->first());

        $this->actingAs($this->rider, 'sanctum')
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.auto_accept', false);
    }

    public function test_rider_can_enable_auto_accept(): void
    {
        $response = $this->actingAs($this->rider, 'sanctum')
            ->patchJson('/api/rider/auto-accept', ['auto_accept' => true]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.auto_accept', true);

        $this->assertSame('Auto accept enabled.', $response->json('message'));

        $detail = RiderDetail::where('user_id', $this->rider->id)->sole();
        $this->assertTrue((bool) $detail->auto_accept);
    }

    public function test_rider_can_disable_auto_accept_without_duplicating_the_row(): void
    {
        $this->actingAs($this->rider, 'sanctum')
            ->patchJson('/api/rider/auto-accept', ['auto_accept' => true])
            ->assertOk();

        $response = $this->actingAs($this->rider, 'sanctum')
            ->patchJson('/api/rider/auto-accept', ['auto_accept' => false]);

        $response->assertOk()
            ->assertJsonPath('data.auto_accept', false);

        $this->assertSame('Auto accept disabled.', $response->json('message'));

        // rider_details.user_id is UNIQUE — updateOrCreate, never a second row.
        $this->assertSame(1, RiderDetail::where('user_id', $this->rider->id)->count());
        $this->assertFalse((bool) RiderDetail::where('user_id', $this->rider->id)->sole()->auto_accept);
    }

    public function test_auto_accept_value_survives_a_fresh_request(): void
    {
        $this->actingAs($this->rider, 'sanctum')
            ->patchJson('/api/rider/auto-accept', ['auto_accept' => true])
            ->assertOk();

        // A later request (new login / token refresh) must still see it.
        $this->actingAs($this->rider, 'sanctum')
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.auto_accept', true);
    }

    public function test_auto_accept_rejects_a_non_boolean_value(): void
    {
        $this->actingAs($this->rider, 'sanctum')
            ->patchJson('/api/rider/auto-accept', ['auto_accept' => 'maybe'])
            ->assertStatus(422);

        $this->assertNull(RiderDetail::where('user_id', $this->rider->id)->first());
    }

    public function test_auto_accept_requires_the_field(): void
    {
        $this->actingAs($this->rider, 'sanctum')
            ->patchJson('/api/rider/auto-accept', [])
            ->assertStatus(422);
    }

    // ── 2. No dispatch side effects ───────────────────────────────────

    public function test_enabling_auto_accept_never_accepts_a_pending_offer_by_itself(): void
    {
        [$delivery, $log] = $this->makePendingOffer();

        $this->actingAs($this->rider, 'sanctum')
            ->patchJson('/api/rider/auto-accept', ['auto_accept' => true])
            ->assertOk();

        $delivery->refresh();
        $log->refresh();

        // The offer is untouched: still waiting for the canonical accept call.
        $this->assertSame(TripStatus::WAITING, $delivery->status);
        $this->assertNull($delivery->rider_id);
        $this->assertSame('pending', $log->response);

        // rider_status must not move either — the toggle is not a Go Online.
        $this->assertSame('offline', RiderDetail::where('user_id', $this->rider->id)->sole()->rider_status);
        $this->assertSame(0, Delivery::where('rider_id', $this->rider->id)->count());
    }

    public function test_disabling_auto_accept_never_releases_an_active_delivery(): void
    {
        $this->rider->riderDetail()->create(['rider_status' => 'busy']);

        $delivery = Delivery::create([
            'order_id' => $this->makeOrder('ORD-AUTO002')->id,
            'rider_id' => $this->rider->id,
            'status' => 'assigned',
            'pickup_address' => 'Auto Accept Kitchen',
            'delivery_address' => '123 Main St',
        ]);

        $this->actingAs($this->rider, 'sanctum')
            ->patchJson('/api/rider/auto-accept', ['auto_accept' => false])
            ->assertOk();

        $delivery->refresh();

        $this->assertSame($this->rider->id, $delivery->rider_id);
        $this->assertSame(TripStatus::ASSIGNED, $delivery->status);
        $this->assertSame(
            'busy',
            RiderDetail::where('user_id', $this->rider->id)->sole()->rider_status
        );
    }

    // ── helpers ───────────────────────────────────────────────────────

    private function makeOrder(string $orderNumber): Order
    {
        $owner = User::create([
            'name' => 'Owner Auto',
            'email' => 'owner-auto-accept@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $business = Business::create([
            'owner_id' => $owner->id,
            'business_name' => 'Auto Accept Kitchen',
            'status' => 'approved',
        ]);

        return Order::create([
            'order_number' => $orderNumber,
            'business_id' => $business->id,
            'customer_name' => 'Customer 1',
            'customer_email' => 'customer@example.com',
            'order_type' => 'delivery',
            'status' => 'ready',
            'subtotal' => 250.00,
            'total' => 300.00,
        ]);
    }

    /**
     * Canonical live ping: a waiting delivery plus a pending dispatch offer
     * already addressed to this rider.
     *
     * @return array{0: Delivery, 1: BookingDispatchLog}
     */
    private function makePendingOffer(): array
    {
        $delivery = Delivery::create([
            'order_id' => $this->makeOrder('ORD-AUTO001')->id,
            'status' => 'waiting',
            'pickup_address' => 'Auto Accept Kitchen',
            'delivery_address' => '123 Main St',
        ]);

        $log = BookingDispatchLog::create([
            'delivery_id' => $delivery->id,
            'rider_id' => $this->rider->id,
            'distance_km' => 1.5,
            'response' => 'pending',
            'dispatched_at' => now(),
        ]);

        return [$delivery, $log];
    }
}
