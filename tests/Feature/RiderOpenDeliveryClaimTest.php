<?php

namespace Tests\Feature;

use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\NearestRiderService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * OPEN (unclaimed) delivery visibility + direct claim.
 *
 * Business rule (2026-10 rider board fix): the rider order board and the
 * booking page must show EVERY delivery that is still awaiting a rider — not
 * only the ping offers this specific rider received at placement time. An
 * order whose ping wave expired or parked at no_rider_available stays visible
 * and claimable by any ELIGIBLE rider; the first accept wins.
 *
 * Pinned invariants:
 *  - one active delivery per rider (a rider with an ongoing job gets the
 *    canonical 409 and must finish it first),
 *  - eligibility gates are identical to the ping-accept path,
 *  - a claimed delivery is never claimable again (409 for everyone else),
 *  - terminal / non-dispatchable deliveries never surface as claimable.
 */
class RiderOpenDeliveryClaimTest extends TestCase
{
    use RefreshDatabase;

    private function makeBusiness(string $name = 'Open Claim Eatery'): Business
    {
        $category = BusinessCategory::firstOrCreate(['name' => 'Restaurant']);
        $municipality = Municipality::firstOrCreate(
            ['name' => 'Bansud'],
            ['district' => '1st', 'province' => 'Oriental Mindoro', 'latitude' => 12.5, 'longitude' => 121.3]
        );

        $owner = User::firstOrCreate(
            ['email' => 'open-claim-owner@example.com'],
            ['password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']
        );

        return Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => $name,
            'status' => 'approved',
            'force_closed' => false,
            'address' => '123 Poblacion, Bansud',
            'latitude' => 12.865,
            'longitude' => 121.452,
        ]);
    }

    private function makeRider(string $email, array $overrides = []): User
    {
        $rider = User::create(array_merge([
            'name' => 'Open Claim Rider',
            'email' => $email,
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
            'rider_status' => 'available',
            'current_service' => 'food',
        ], $overrides));

        RiderDetail::firstOrCreate(['user_id' => $rider->id], [
            'rider_status' => $overrides['rider_status'] ?? 'available',
            'current_service' => $overrides['current_service'] ?? 'food',
        ]);

        RiderLocation::create([
            'rider_id' => $rider->id,
            'latitude' => 12.865,
            'longitude' => 121.452,
            'recorded_at' => now(),
        ]);

        return $rider;
    }

    private function makeOrder(Business $business, array $overrides = []): Order
    {
        $order = Order::create(array_merge([
            'order_number' => 'TT-OPEN-'.uniqid(),
            'business_id' => $business->id,
            'customer_name' => 'Open Claim Customer',
            'customer_email' => 'open-claim-cust@example.com',
            'customer_phone' => '09171234567',
            'order_type' => 'delivery',
            'payment_method' => 'gcash',
            'payment_status' => 'paid',
            'status' => 'waiting_restaurant',
            'subtotal' => 300,
            'delivery_fee' => 40,
            'rider_tip' => 0,
            'system_fee' => 0,
            'rider_financed_amount' => 300,
            'total' => 340,
            'delivery_latitude' => 12.86,
            'delivery_longitude' => 121.45,
            'delivery_address' => '456 Open St, Bansud',
        ], $overrides));

        OrderItem::create([
            'order_id' => $order->id,
            'business_id' => $business->id,
            'product_name' => 'Chicken Adobo',
            'quantity' => 1,
            'unit_price' => 300,
            'subtotal' => 300,
        ]);

        return $order;
    }

    private function makeOpenDelivery(Order $order, array $overrides = []): Delivery
    {
        // A delivery nobody has claimed: parked at no_rider_available (the
        // production state of an order whose ping wave found nobody).
        return Delivery::create(array_merge([
            'order_id' => $order->id,
            'status' => 'waiting',
            'dispatch_status' => 'no_rider_available',
            'rider_commission' => 39.20,
            'delivery_fee' => 40,
            'estimated_duration_minutes' => 12,
            'pickup_address' => 'Open Claim Eatery',
            'delivery_address' => $order->delivery_address,
            'pickup_latitude' => 12.865,
            'pickup_longitude' => 121.452,
            'delivery_latitude' => $order->delivery_latitude,
            'delivery_longitude' => $order->delivery_longitude,
        ], $overrides));
    }

    private function authHeaders(User $user): array
    {
        $token = $user->createToken('test-token')->plainTextToken;

        return [
            'Authorization' => "Bearer {$token}",
            'Accept' => 'application/json',
        ];
    }

    // ---------- board visibility ----------

    public function test_board_lists_open_unclaimed_delivery_as_actionable(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-board@example.com');
        $delivery = $this->makeOpenDelivery($this->makeOrder($business));

        $response = $this->actingAs($rider, 'sanctum')->getJson('/api/rider/dispatch/board');

        $response->assertOk();
        $rows = collect($response->json('data.orders'));
        $row = $rows->firstWhere('delivery_id', $delivery->id);

        $this->assertNotNull($row, 'An unclaimed open delivery must appear on the rider board.');
        $this->assertSame('looking_for_riders', $row['rider_status']);
        $this->assertTrue($row['can_accept'], 'An eligible rider may claim an open delivery directly.');
        $this->assertNull($row['accept_blocked_reason']);
    }

    public function test_board_hides_open_deliveries_when_the_rider_has_no_location(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-board-noloc@example.com');
        RiderLocation::where('rider_id', $rider->id)->delete();
        $open = $this->makeOpenDelivery($this->makeOrder($business));

        $response = $this->actingAs($rider, 'sanctum')->getJson('/api/rider/dispatch/board');

        $response->assertOk()
            ->assertJsonPath('data.eligibility.location_ok', false);

        $rows = collect($response->json('data.orders'))->where('delivery_id', $open->id);
        $this->assertSame(0, $rows->count(), 'Without a GPS fix the open row is not placed on the (distance-bounded) board.');
    }

    public function test_board_dedupes_open_delivery_against_the_riders_own_pending_offer(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-board-dedupe@example.com');
        $delivery = $this->makeOpenDelivery($this->makeOrder($business));

        // This rider also holds a live ping for the same delivery.
        BookingDispatchLog::create([
            'delivery_id' => $delivery->id,
            'rider_id' => $rider->id,
            'distance_km' => 0.4,
            'response' => 'pending',
            'dispatched_at' => now(),
        ]);

        $response = $this->actingAs($rider, 'sanctum')->getJson('/api/rider/dispatch/board');

        $rows = collect($response->json('data.orders'))->where('delivery_id', $delivery->id);
        $this->assertSame(1, $rows->count(), 'The same delivery must never appear twice on the board.');
    }

    public function test_board_does_not_list_claimed_or_cancelled_deliveries_as_open(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-board-filter@example.com');
        $otherRider = $this->makeRider('open-board-other@example.com');

        $claimed = $this->makeOpenDelivery($this->makeOrder($business), [
            'rider_id' => $otherRider->id,
            'status' => 'in_transit',
        ]);
        $cancelled = $this->makeOpenDelivery($this->makeOrder($business), [
            'status' => 'cancelled',
        ]);

        $response = $this->actingAs($rider, 'sanctum')->getJson('/api/rider/dispatch/board');

        $rows = collect($response->json('data.orders'));
        $this->assertSame([], $rows->where('delivery_id', $claimed->id)->where('rider_status', 'looking_for_riders')->values()->all());
        $this->assertSame([], $rows->where('delivery_id', $cancelled->id)->where('rider_status', 'looking_for_riders')->values()->all());
    }

    // ---------- direct claim ----------

    public function test_eligible_rider_without_a_ping_can_claim_an_open_delivery(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-claim@example.com');
        $order = $this->makeOrder($business);
        $delivery = $this->makeOpenDelivery($order);

        $this->be($rider)
            ->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])
            ->assertOk()
            ->assertJsonPath('data.assigned', true);

        $delivery->refresh();
        $this->assertSame($rider->id, $delivery->rider_id, 'First accept wins: the delivery binds to the claiming rider.');
        $this->assertSame('assigned', $delivery->status->value);
        $this->assertNull($delivery->dispatch_status);
        $this->assertSame('rider_accepted', $delivery->dispatch_end_reason);
        $this->assertSame('busy', $rider->fresh()->riderDetail->rider_status);

        // Rider acceptance is what unlocks the restaurant (AGENTS §4.2) —
        // identical side effect to the ping-accept path.
        $this->assertSame('preparing', $order->fresh()->status);
    }

    public function test_claiming_a_delivery_cancels_the_riders_other_pending_offers(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-claim-withdraw@example.com');

        // The rider also holds a ping on ANOTHER open delivery (parked at
        // no_rider_available, i.e. no live wave to re-run here).
        $otherOrder = $this->makeOrder($business);
        $otherDelivery = $this->makeOpenDelivery($otherOrder);
        BookingDispatchLog::create([
            'delivery_id' => $otherDelivery->id,
            'rider_id' => $rider->id,
            'distance_km' => 0.5,
            'response' => 'pending',
            'dispatched_at' => now(),
        ]);

        $claimed = $this->makeOpenDelivery($this->makeOrder($business));

        $this->be($rider)
            ->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $claimed->id])
            ->assertOk();

        $this->assertSame(
            'cancelled',
            BookingDispatchLog::where('delivery_id', $otherDelivery->id)->where('rider_id', $rider->id)->first()->response,
            'One active delivery: the rider\'s other outstanding offers are withdrawn on claim.'
        );
    }

    public function test_second_rider_cannot_claim_a_delivery_already_claimed(): void
    {
        $business = $this->makeBusiness();
        $riderA = $this->makeRider('open-second-a@example.com');
        $riderB = $this->makeRider('open-second-b@example.com');
        $delivery = $this->makeOpenDelivery($this->makeOrder($business));

        $this->be($riderA)
            ->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])
            ->assertOk();

        $this->be($riderB)
            ->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])
            ->assertStatus(409)
            ->assertJsonPath('success', false);

        $this->assertSame($riderA->id, $delivery->fresh()->rider_id, 'The first claim stands.');
    }

    public function test_rider_with_an_active_delivery_must_finish_it_before_claiming_another(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-busy@example.com');

        // Ongoing job: bound and on the road.
        $this->makeOpenDelivery($this->makeOrder($business), [
            'rider_id' => $rider->id,
            'status' => 'picked_up',
            'dispatch_status' => null,
        ]);

        $open = $this->makeOpenDelivery($this->makeOrder($business));

        $this->be($rider)
            ->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $open->id])
            ->assertStatus(409)
            ->assertJsonPath('success', false);

        $this->assertNull($open->fresh()->rider_id, 'The open delivery stays unclaimed while the rider is busy.');
    }

    public function test_rider_becomes_eligible_again_after_finishing_the_active_delivery(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-finished@example.com');

        // Finished (delivered, prepaid → no cash settlement pending): it must
        // NOT keep blocking the rider.
        $this->makeOpenDelivery($this->makeOrder($business), [
            'rider_id' => $rider->id,
            'status' => 'delivered',
            'dispatch_status' => null,
        ]);
        $rider->riderDetail()->update(['rider_status' => 'available']);

        $open = $this->makeOpenDelivery($this->makeOrder($business));

        $this->be($rider)
            ->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $open->id])
            ->assertOk();

        $this->assertSame($rider->id, $open->fresh()->rider_id, 'A finished delivery frees the rider for the next order.');
    }

    // ---------- eligibility gates (identical to the ping-accept path) ----------

    public function test_offline_rider_cannot_claim_an_open_delivery(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-offline@example.com', ['rider_status' => 'offline']);
        $rider->riderDetail()->update(['rider_status' => 'offline']);
        $delivery = $this->makeOpenDelivery($this->makeOrder($business));

        $this->be($rider)
            ->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])
            ->assertStatus(422);

        $this->assertNull($delivery->fresh()->rider_id);
    }

    public function test_wrong_service_rider_cannot_claim_an_open_food_delivery(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-transport@example.com', ['current_service' => 'transport']);
        $rider->riderDetail()->update(['current_service' => 'transport']);
        $delivery = $this->makeOpenDelivery($this->makeOrder($business));

        $this->be($rider)
            ->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])
            ->assertStatus(422);

        $this->assertNull($delivery->fresh()->rider_id);
    }

    public function test_suspended_rider_cannot_claim_an_open_delivery(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-suspended@example.com', ['account_status' => 'suspended']);
        $delivery = $this->makeOpenDelivery($this->makeOrder($business));

        $this->be($rider)
            ->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])
            ->assertStatus(422);

        $this->assertNull($delivery->fresh()->rider_id);
    }

    // ---------- non-open deliveries never claimable ----------

    public function test_a_cancelled_delivery_is_never_claimable(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-cancelled@example.com');
        $delivery = $this->makeOpenDelivery($this->makeOrder($business), ['status' => 'cancelled']);

        $this->be($rider)
            ->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])
            ->assertStatus(409);

        $this->assertNull($delivery->fresh()->rider_id);
    }

    public function test_a_delivery_whose_order_is_no_longer_dispatchable_is_never_claimable(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-cancelled-order@example.com');
        $order = $this->makeOrder($business, ['status' => 'cancelled']);
        $delivery = $this->makeOpenDelivery($order);

        $this->be($rider)
            ->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])
            ->assertStatus(409);

        $this->assertNull($delivery->fresh()->rider_id);
    }

    public function test_a_delivery_with_a_scheduled_dispatch_is_never_claimable(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-scheduled@example.com');
        $delivery = $this->makeOpenDelivery($this->makeOrder($business), [
            'dispatch_status' => 'scheduled',
        ]);

        $this->be($rider)
            ->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])
            ->assertStatus(409);

        $this->assertNull($delivery->fresh()->rider_id);
    }

    public function test_decline_without_an_offer_still_returns_the_canonical_conflict(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-decline@example.com');
        $delivery = $this->makeOpenDelivery($this->makeOrder($business));

        $this->be($rider)
            ->patchJson('/api/rider/dispatch/decline', ['delivery_id' => $delivery->id])
            ->assertOk()
            ->assertJsonPath('data.success', false);

        $this->assertNull($delivery->fresh()->rider_id, 'Decline never claims anything.');
    }

    // ---------- COD specifics ----------

    public function test_cod_claim_freezes_cash_due_and_initializes_purchasing_stops(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-cod@example.com');
        $order = $this->makeOrder($business, [
            'payment_method' => 'cash',
            'payment_status' => 'pending',
            'rider_financed_amount' => 300,
            'total' => 340,
        ]);
        $delivery = $this->makeOpenDelivery($order);

        $this->be($rider)
            ->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])
            ->assertOk();

        $delivery->refresh();
        $this->assertSame($rider->id, $delivery->rider_id);
        $this->assertEquals(340.0, (float) $delivery->cash_due, 'COD claim freezes the cash due at accept.');
        $this->assertSame(1, \App\Models\CodPurchase::where('delivery_id', $delivery->id)->count(),
            'Purchasing-cash stops are created exactly like the ping-accept path.');
        $this->assertNull($delivery->fresh()->purchasing_cash_issued_at, 'Issuance stays a Tourism Office action.');
    }

    // ---------- transport (ride-hailing) ----------

    public function test_pending_transport_order_open_delivery_is_claimable(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-ride@example.com', ['current_service' => 'transport']);
        $rider->riderDetail()->update(['current_service' => 'transport']);
        $order = $this->makeOrder($business, [
            'order_type' => 'transport',
            'status' => 'pending',
        ]);
        $delivery = $this->makeOpenDelivery($order);

        $this->be($rider)
            ->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])
            ->assertOk();

        $this->assertSame($rider->id, $delivery->fresh()->rider_id, 'A pending transport order is claimable while awaiting a rider.');
    }

    // ---------- booking page ----------

    public function test_booking_page_lists_open_deliveries_without_a_ping(): void
    {
        $business = $this->makeBusiness();
        $rider = $this->makeRider('open-booking@example.com');
        $open = $this->makeOpenDelivery($this->makeOrder($business));

        $response = $this->be($rider)
            ->getJson('/api/rider/deliveries/pending')
            ->assertOk();

        $ids = collect($response->json('data'))->pluck('id');

        $this->assertContains($open->id, $ids, 'The booking page lists open deliveries the rider was never pinged for.');
    }

    // ---------- service-level claim guard ----------

    public function test_claim_is_first_accept_wins_under_the_delivery_lock(): void
    {
        $business = $this->makeBusiness();
        $riderA = $this->makeRider('open-atomic-a@example.com');
        $riderB = $this->makeRider('open-atomic-b@example.com');
        $delivery = $this->makeOpenDelivery($this->makeOrder($business));

        $service = $this->app->make(NearestRiderService::class);

        $first = $service->handleRiderResponse($delivery->id, $riderA->id, 'accepted');
        $second = $service->handleRiderResponse($delivery->id, $riderB->id, 'accepted');

        $this->assertTrue($first['success'] ?? false);
        $this->assertFalse($second['success'] ?? false);
        $this->assertTrue($second['conflict'] ?? false);
        $this->assertSame($riderA->id, $delivery->fresh()->rider_id);
    }
}
