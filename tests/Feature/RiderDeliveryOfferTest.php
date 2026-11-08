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
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Rider delivery offer details (Available Deliveries → offer page).
 *
 *  - GET /rider/deliveries/pending cards carry order number, delivery type,
 *    fee, tip, distance, pickup names and item count from real columns.
 *  - GET /rider/deliveries/{id}/offer is visible only to a rider who would
 *    see the offer (canonical pending query) or who accepted it; otherwise
 *    404. It is read-only: no dispatch state changes.
 */
class RiderDeliveryOfferTest extends TestCase
{
    use RefreshDatabase;

    private function business(string $name, string $address = 'Poblacion, Bansud'): Business
    {
        $category = BusinessCategory::firstOrCreate(['name' => 'Restaurant']);
        $municipality = Municipality::firstOrCreate(
            ['name' => 'Bansud'],
            ['district' => '1st', 'province' => 'Oriental Mindoro', 'latitude' => 12.86, 'longitude' => 121.45]
        );
        $owner = User::firstOrCreate(
            ['email' => 'offer-owner@example.com'],
            ['password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']
        );

        return Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => $name,
            'status' => 'approved',
            'force_closed' => false,
            'address' => $address,
            'latitude' => 12.865,
            'longitude' => 121.452,
        ]);
    }

    private function rider(string $email, float $lat = 12.865, float $lng = 121.452): User
    {
        $rider = User::create([
            'name' => 'Offer Rider',
            'email' => $email,
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
            'rider_status' => 'available',
            'current_service' => 'food',
        ]);
        RiderDetail::firstOrCreate(['user_id' => $rider->id], ['rider_status' => 'available', 'current_service' => 'food']);
        RiderLocation::create(['rider_id' => $rider->id, 'latitude' => $lat, 'longitude' => $lng, 'recorded_at' => now()]);

        return $rider;
    }

    /** @param array<int, array{0: Business, 1: string, 2: int, 3: float}> $lines */
    private function order(Business $business, array $lines, array $overrides = []): Order
    {
        $order = Order::create(array_merge([
            'order_number' => 'TT-OFFER-'.uniqid(),
            'business_id' => $business->id,
            'customer_name' => 'Offer Customer',
            'customer_email' => 'offer-cust@example.com',
            'customer_phone' => '09171234567',
            'order_type' => 'delivery',
            'delivery_speed' => 'standard',
            'payment_method' => 'gcash',
            'payment_status' => 'paid',
            'status' => 'waiting_restaurant',
            'subtotal' => 300,
            'delivery_fee' => 60,
            'rider_tip' => 0,
            'system_fee' => 0,
            'rider_financed_amount' => 300,
            'total' => 360,
            'delivery_latitude' => 12.86,
            'delivery_longitude' => 121.45,
            'delivery_address' => 'Batingan, Gloria',
        ], $overrides));

        foreach ($lines as [$biz, $name, $qty, $price]) {
            OrderItem::create([
                'order_id' => $order->id,
                'business_id' => $biz->id,
                'product_name' => $name,
                'quantity' => $qty,
                'unit_price' => $price,
                'subtotal' => $qty * $price,
            ]);
        }

        return $order;
    }

    private function delivery(Order $order, array $overrides = []): Delivery
    {
        return Delivery::create(array_merge([
            'order_id' => $order->id,
            'status' => 'waiting',
            'dispatch_status' => 'no_rider_available',
            'rider_commission' => 40,
            'delivery_fee' => 60,
            'distance_km' => 4.8,
            'estimated_duration_minutes' => 12,
            'pickup_address' => 'Poblacion, Bansud',
            'delivery_address' => $order->delivery_address,
            'pickup_latitude' => 12.865,
            'pickup_longitude' => 121.452,
            'delivery_latitude' => $order->delivery_latitude,
            'delivery_longitude' => $order->delivery_longitude,
        ], $overrides));
    }

    public function test_pending_cards_carry_offer_summary_fields(): void
    {
        $grill = $this->business('Eksklusibo Grill');
        $order = $this->order($grill, [[$grill, 'Chicken BBQ', 2, 120], [$grill, 'Pork Sisig', 1, 180]], [
            'order_number' => 'TT-2026-00128', 'delivery_speed' => 'fast', 'rider_tip' => 20,
        ]);
        $delivery = $this->delivery($order);

        $card = collect($this->actingAs($this->rider('r1@example.com'))->getJson('/api/rider/deliveries/pending')->assertOk()->json('data'))
            ->firstWhere('id', $delivery->id);

        $this->assertNotNull($card);
        $this->assertSame($order->id, $card['order_id']);
        $this->assertSame('TT-2026-00128', $card['order_number']);
        $this->assertSame('fast', $card['delivery_speed']);
        $this->assertSame('Priority Delivery', $card['delivery_type_label']);
        $this->assertSame(['Eksklusibo Grill'], $card['pickup_names']);
        $this->assertSame(3, $card['items_count']);
        $this->assertEquals(20, $card['rider_tip']);
        $this->assertEquals(60, $card['delivery_fee']);
        $this->assertEquals(4.8, $card['distance_km']);
        // Existing DeliveryResource fields are still present.
        $this->assertSame('Batingan, Gloria', $card['delivery_address']);
        $this->assertSame('waiting', $card['status']);
    }

    public function test_offer_details_show_order_type_money_route_and_items(): void
    {
        $grill = $this->business('Eksklusibo Grill', 'Pag-asa, Bansud');
        $order = $this->order($grill, [[$grill, 'Chicken BBQ', 2, 120], [$grill, 'Pork Sisig', 1, 180]], [
            'order_number' => 'TT-2026-00128', 'delivery_speed' => 'fast', 'rider_tip' => 20, 'payment_method' => 'cash',
        ]);
        OrderItem::create(['order_id' => $order->id, 'business_id' => $grill->id, 'product_name' => 'Cancelled Halo-halo', 'quantity' => 1, 'unit_price' => 90, 'subtotal' => 90, 'status' => 'cancelled']);
        $delivery = $this->delivery($order);

        $offer = $this->actingAs($this->rider('r1@example.com'))->getJson("/api/rider/deliveries/{$delivery->id}/offer")
            ->assertOk()->json('data');

        $this->assertSame($delivery->id, $offer['id']);
        $this->assertSame('TT-2026-00128', $offer['order_number']);
        $this->assertSame('Priority Delivery', $offer['delivery_type_label']);
        $this->assertEquals(60, $offer['delivery_fee']);
        $this->assertEquals(20, $offer['rider_tip']);
        $this->assertEquals(4.8, $offer['distance_km']);
        $this->assertSame(12, $offer['estimated_duration_minutes']);
        $this->assertTrue($offer['is_cod']);
        $this->assertFalse($offer['is_mine']);
        $this->assertFalse($offer['offered_to_me'], 'An open board offer is not a ping.');
        $this->assertSame('Batingan, Gloria', $offer['dropoff']['address']);
        $this->assertSame([['id' => $grill->id, 'name' => 'Eksklusibo Grill', 'address' => 'Pag-asa, Bansud', 'logo' => null, 'items_count' => 3]], $offer['pickups']);
        $this->assertSame(['Chicken BBQ', 'Pork Sisig'], array_column($offer['items'], 'product_name'), 'Cancelled lines are excluded.');
        $this->assertSame([2, 1], array_column($offer['items'], 'quantity'));
        $this->assertEquals([240, 180], array_column($offer['items'], 'subtotal'));
        $this->assertSame(3, $offer['items_count']);
        $this->assertEquals(420, $offer['items_total']);
    }

    public function test_multi_restaurant_order_lists_each_pickup_with_its_items(): void
    {
        $a = $this->business('Restaurant A');
        $b = $this->business('Restaurant B');
        $order = $this->order($a, [[$a, 'Adobo', 1, 150], [$b, 'Halo-halo', 2, 80]]);
        $delivery = $this->delivery($order);

        $offer = $this->actingAs($this->rider('r1@example.com'))->getJson("/api/rider/deliveries/{$delivery->id}/offer")->assertOk()->json('data');

        $this->assertSame(['Restaurant A', 'Restaurant B'], array_column($offer['pickups'], 'name'));
        $this->assertSame([1, 2], array_column($offer['pickups'], 'items_count'));
        $this->assertSame([$a->id, $b->id], array_column($offer['items'], 'business_id'));
        $this->assertSame('Standard Delivery', $offer['delivery_type_label']);
    }

    public function test_pinged_offer_can_be_declined_flag(): void
    {
        $grill = $this->business('Grill');
        $delivery = $this->delivery($this->order($grill, [[$grill, 'BBQ', 1, 100]]), ['dispatch_status' => 'dispatching']);
        $rider = $this->rider('r1@example.com');
        BookingDispatchLog::create(['delivery_id' => $delivery->id, 'rider_id' => $rider->id, 'distance_km' => 1.2, 'response' => 'pending', 'dispatched_at' => now()]);

        $this->actingAs($rider)->getJson("/api/rider/deliveries/{$delivery->id}/offer")
            ->assertOk()->assertJsonPath('data.offered_to_me', true);
    }

    public function test_offer_is_hidden_from_riders_who_cannot_see_it(): void
    {
        $grill = $this->business('Grill');
        $owner = $this->rider('owner@example.com');
        $other = $this->rider('other@example.com');
        $taken = $this->delivery($this->order($grill, [[$grill, 'BBQ', 1, 100]]), ['status' => 'assigned', 'rider_id' => $owner->id, 'dispatch_status' => null]);

        $this->actingAs($other)->getJson("/api/rider/deliveries/{$taken->id}/offer")->assertNotFound();
        $this->actingAs($owner)->getJson("/api/rider/deliveries/{$taken->id}/offer")
            ->assertOk()->assertJsonPath('data.is_mine', true);

        // Out of range (> 25 km) and never pinged: not on this rider's board.
        $far = $this->rider('far@example.com', 13.5, 121.0);
        $open = $this->delivery($this->order($grill, [[$grill, 'BBQ', 1, 100]]));
        $this->actingAs($far)->getJson("/api/rider/deliveries/{$open->id}/offer")->assertNotFound();
    }

    public function test_the_assigned_rider_gets_trip_status_extras_and_others_never_do(): void
    {
        $grill = $this->business('Grill');
        $owner = $this->rider('owner@example.com');
        $mine = $this->delivery($this->order($grill, [[$grill, 'BBQ', 1, 100]]), [
            'status' => 'assigned', 'rider_id' => $owner->id, 'dispatch_status' => null, 'assigned_at' => now(),
        ]);

        $data = $this->actingAs($owner)->getJson("/api/rider/deliveries/{$mine->id}/offer")->assertOk()->json('data');
        $this->assertSame('mine', $data['availability']);
        $this->assertNotNull($data['assigned_at']);
        $this->assertEquals(40, $data['rider_earnings']);
        $this->assertSame('09171234567', $data['customer_phone']);
        $this->assertArrayHasKey('order_status', $data);

        // An open offer another rider reviews carries no tourist contact or earnings.
        $open = $this->delivery($this->order($grill, [[$grill, 'BBQ', 1, 100]]));
        $other = $this->rider('other@example.com');
        $offer = $this->actingAs($other)->getJson("/api/rider/deliveries/{$open->id}/offer")->assertOk()->json('data');
        $this->assertArrayNotHasKey('customer_phone', $offer);
        $this->assertArrayNotHasKey('rider_earnings', $offer);
    }

    public function test_offer_won_by_another_rider_shows_as_already_accepted(): void
    {
        $grill = $this->business('Grill');
        $order = $this->order($grill, [[$grill, 'BBQ', 2, 100]], ['order_number' => 'TT-TAKEN-1', 'rider_tip' => 20]);
        $delivery = $this->delivery($order, ['dispatch_status' => 'dispatching']);
        $winner = $this->rider('winner@example.com');
        $loser = $this->rider('loser@example.com');
        BookingDispatchLog::create(['delivery_id' => $delivery->id, 'rider_id' => $winner->id, 'distance_km' => 1, 'response' => 'pending', 'dispatched_at' => now()]);
        BookingDispatchLog::create(['delivery_id' => $delivery->id, 'rider_id' => $loser->id, 'distance_km' => 1, 'response' => 'pending', 'dispatched_at' => now()]);

        // Both riders see it as available first.
        $this->actingAs($loser)->getJson("/api/rider/deliveries/{$delivery->id}/offer")->assertOk()->assertJsonPath('data.availability', 'available');

        // Winner accepts through the canonical endpoint.
        $this->actingAs($winner)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])->assertOk();
        $this->assertSame($winner->id, (int) $delivery->fresh()->rider_id);

        // The loser can no longer accept…
        $this->actingAs($loser)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])->assertStatus(409);
        $this->assertSame($winner->id, (int) $delivery->fresh()->rider_id, 'Ownership never moves to the second rider.');

        // …and sees the offer as already accepted, without the customer's drop-off.
        $offer = $this->actingAs($loser)->getJson("/api/rider/deliveries/{$delivery->id}/offer")->assertOk()->json('data');
        $this->assertSame('taken', $offer['availability']);
        $this->assertSame('Already accepted by another rider', $offer['status_label']);
        $this->assertSame('TT-TAKEN-1', $offer['order_number']);
        $this->assertNull($offer['delivery_address']);
        $this->assertArrayNotHasKey('items', $offer);
        $this->assertArrayNotHasKey('dropoff', $offer);

        // Decision D3 (dispatch Stage 3): the won offer leaves the loser's board
        // immediately; the offer page above carries the explanation.
        $ids = collect($this->actingAs($loser)->getJson('/api/rider/deliveries/pending')->assertOk()->json('data'))->pluck('id');
        $this->assertNotContains($delivery->id, $ids);

        // The winner still sees it as their own.
        $this->actingAs($winner)->getJson("/api/rider/deliveries/{$delivery->id}/offer")->assertOk()->assertJsonPath('data.availability', 'mine');
    }

    public function test_already_accepted_status_is_limited_to_recent_nearby_offers(): void
    {
        $grill = $this->business('Grill');
        $owner = $this->rider('owner@example.com');
        $old = $this->delivery($this->order($grill, [[$grill, 'BBQ', 1, 100]]), [
            'status' => 'assigned', 'rider_id' => $owner->id, 'dispatch_status' => null, 'assigned_at' => now()->subMinutes(30),
        ]);
        $recent = $this->delivery($this->order($grill, [[$grill, 'BBQ', 1, 100]]), [
            'status' => 'assigned', 'rider_id' => $owner->id, 'dispatch_status' => null, 'assigned_at' => now()->subMinute(),
        ]);

        $near = $this->rider('near@example.com');
        $this->actingAs($near)->getJson("/api/rider/deliveries/{$old->id}/offer")->assertNotFound();
        $this->actingAs($near)->getJson("/api/rider/deliveries/{$recent->id}/offer")->assertOk()->assertJsonPath('data.availability', 'taken');

        // Decision D3: taken offers are not listed on the board at all.
        $ids = collect($this->actingAs($near)->getJson('/api/rider/deliveries/pending')->json('data'))->pluck('id');
        $this->assertNotContains($recent->id, $ids);
        $this->assertNotContains($old->id, $ids);

        // A rider far away who was never pinged learns nothing.
        $far = $this->rider('far@example.com', 13.5, 121.0);
        $this->actingAs($far)->getJson("/api/rider/deliveries/{$recent->id}/offer")->assertNotFound();
    }

    // ---------- exclusive review hold ----------

    public function test_first_reviewer_holds_the_offer_and_others_can_neither_view_nor_accept_it(): void
    {
        $grill = $this->business('Grill');
        $delivery = $this->delivery($this->order($grill, [[$grill, 'BBQ', 2, 100]], ['order_number' => 'TT-HOLD-1']));
        $first = $this->rider('first@example.com');
        $second = $this->rider('second@example.com');

        $mine = $this->actingAs($first)->postJson("/api/rider/deliveries/{$delivery->id}/review")->assertOk()->json('data');
        $this->assertSame('available', $mine['availability']);
        $this->assertTrue($mine['reviewing_by_me']);
        $this->assertNotNull($mine['review_expires_at']);
        $this->assertSame(90, $mine['review_seconds']);
        $this->assertCount(1, $mine['items']);
        $this->assertSame($first->id, (int) $delivery->fresh()->review_rider_id);

        // Second rider: cannot open it…
        $other = $this->actingAs($second)->postJson("/api/rider/deliveries/{$delivery->id}/review")->assertOk()->json('data');
        $this->assertSame('reviewing', $other['availability']);
        $this->assertSame('Another rider is reviewing this offer', $other['status_label']);
        $this->assertNull($other['delivery_address']);
        $this->assertArrayNotHasKey('items', $other);
        $this->assertArrayNotHasKey('dropoff', $other);
        $this->assertSame($first->id, (int) $delivery->fresh()->review_rider_id, 'The hold never moves to the second rider.');
        $this->actingAs($second)->getJson("/api/rider/deliveries/{$delivery->id}/offer")->assertOk()->assertJsonPath('data.availability', 'reviewing');

        // …sees it as being reviewed on the list…
        $card = collect($this->actingAs($second)->getJson('/api/rider/deliveries/pending')->json('data'))->firstWhere('id', $delivery->id);
        $this->assertSame('reviewing', $card['availability']);
        $this->assertNull($card['delivery_address']);
        $firstCard = collect($this->actingAs($first)->getJson('/api/rider/deliveries/pending')->json('data'))->firstWhere('id', $delivery->id);
        $this->assertSame('available', $firstCard['availability']);
        $this->assertTrue($firstCard['reviewing_by_me']);

        // …and cannot accept it (server-enforced, not just hidden).
        $this->actingAs($second)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])
            ->assertStatus(409)->assertJsonFragment(['message' => 'Another rider is reviewing this offer. Try another delivery.']);
        $this->assertNull($delivery->fresh()->rider_id);

        // The reviewer accepts; the hold ends with the assignment.
        $this->actingAs($first)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])->assertOk();
        $fresh = $delivery->fresh();
        $this->assertSame($first->id, (int) $fresh->rider_id);
        $this->assertNull($fresh->review_rider_id);
        $this->assertNull($fresh->review_expires_at);
        $this->actingAs($second)->getJson("/api/rider/deliveries/{$delivery->id}/offer")->assertOk()->assertJsonPath('data.availability', 'taken');
    }

    public function test_a_pinged_rider_cannot_accept_while_another_rider_reviews(): void
    {
        $grill = $this->business('Grill');
        $delivery = $this->delivery($this->order($grill, [[$grill, 'BBQ', 1, 100]]), ['dispatch_status' => 'dispatching']);
        $reviewer = $this->rider('reviewer@example.com');
        $pinged = $this->rider('pinged@example.com');
        // One ping wave offered the delivery to both riders.
        BookingDispatchLog::create(['delivery_id' => $delivery->id, 'rider_id' => $reviewer->id, 'distance_km' => 1, 'response' => 'pending', 'dispatched_at' => now()]);
        $log = BookingDispatchLog::create(['delivery_id' => $delivery->id, 'rider_id' => $pinged->id, 'distance_km' => 1, 'response' => 'pending', 'dispatched_at' => now()]);

        $this->actingAs($reviewer)->postJson("/api/rider/deliveries/{$delivery->id}/review")->assertOk()->assertJsonPath('data.reviewing_by_me', true);

        $this->actingAs($pinged)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])
            ->assertStatus(409)->assertJsonPath('message', 'Another rider is reviewing this offer. Try another delivery.');
        $this->assertNull($delivery->fresh()->rider_id);
        $this->assertSame('pending', $log->fresh()->response, 'The ping stays live so it can be accepted once the hold ends.');

        // The reviewer moves on; the pinged rider can now accept.
        $this->actingAs($reviewer)->deleteJson("/api/rider/deliveries/{$delivery->id}/review")->assertOk();
        $this->actingAs($pinged)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])->assertOk();
        $this->assertSame($pinged->id, (int) $delivery->fresh()->rider_id);
    }

    public function test_releasing_or_expiry_frees_the_offer_for_the_next_rider(): void
    {
        $grill = $this->business('Grill');
        $delivery = $this->delivery($this->order($grill, [[$grill, 'BBQ', 1, 100]]));
        $first = $this->rider('first@example.com');
        $second = $this->rider('second@example.com');

        $this->actingAs($first)->postJson("/api/rider/deliveries/{$delivery->id}/review")->assertOk();
        // Only the holder can release.
        $this->actingAs($second)->deleteJson("/api/rider/deliveries/{$delivery->id}/review")->assertOk();
        $this->assertSame($first->id, (int) $delivery->fresh()->review_rider_id);

        $this->actingAs($first)->deleteJson("/api/rider/deliveries/{$delivery->id}/review")->assertOk();
        $this->assertNull($delivery->fresh()->review_rider_id);
        $this->actingAs($second)->postJson("/api/rider/deliveries/{$delivery->id}/review")->assertOk()->assertJsonPath('data.reviewing_by_me', true);

        // An abandoned hold lapses on its own.
        $this->travel(91)->seconds();
        $this->actingAs($first)->postJson("/api/rider/deliveries/{$delivery->id}/review")->assertOk()->assertJsonPath('data.reviewing_by_me', true);
        $this->assertSame($first->id, (int) $delivery->fresh()->review_rider_id);
    }

    public function test_a_rider_holds_one_offer_at_a_time_and_cannot_extend_by_reopening(): void
    {
        $grill = $this->business('Grill');
        $d1 = $this->delivery($this->order($grill, [[$grill, 'BBQ', 1, 100]]));
        $d2 = $this->delivery($this->order($grill, [[$grill, 'Sisig', 1, 100]]));
        $rider = $this->rider('r1@example.com');

        $firstExpiry = $this->actingAs($rider)->postJson("/api/rider/deliveries/{$d1->id}/review")->json('data.review_expires_at');
        $this->travel(30)->seconds();
        $this->assertSame($firstExpiry, $this->actingAs($rider)->postJson("/api/rider/deliveries/{$d1->id}/review")->json('data.review_expires_at'), 'Re-opening keeps the original expiry.');

        $this->actingAs($rider)->postJson("/api/rider/deliveries/{$d2->id}/review")->assertOk();
        $this->assertNull($d1->fresh()->review_rider_id, 'Opening another offer releases the first.');
        $this->assertSame($rider->id, (int) $d2->fresh()->review_rider_id);
    }

    public function test_heartbeat_keeps_the_review_hold_while_the_page_is_open_and_never_steals_one(): void
    {
        // Product decision 2026-11-07: the review page shows no timer. While it
        // is open it renews the hold; an abandoned page lapses on its own.
        $grill = $this->business('Grill');
        $delivery = $this->delivery($this->order($grill, [[$grill, 'BBQ', 1, 100]]));
        $reviewer = $this->rider('reviewer@example.com');
        $other = $this->rider('other@example.com');

        $this->actingAs($reviewer)->postJson("/api/rider/deliveries/{$delivery->id}/review")->assertOk();

        // Page still open after 60 s and again after 120 s (past the 90 s window).
        $this->travel(60)->seconds();
        $this->actingAs($reviewer)->patchJson("/api/rider/deliveries/{$delivery->id}/review")->assertOk()->assertJsonPath('data.held', true);
        $this->travel(60)->seconds();
        $this->actingAs($reviewer)->patchJson("/api/rider/deliveries/{$delivery->id}/review")->assertOk()->assertJsonPath('data.held', true);
        $this->assertSame($reviewer->id, (int) $delivery->fresh()->review_rider_id);

        // Another rider's heartbeat can never steal a live hold.
        $this->actingAs($other)->patchJson("/api/rider/deliveries/{$delivery->id}/review")
            ->assertOk()->assertJsonPath('data.held', false)->assertJsonPath('data.reason', 'reviewing');
        $this->actingAs($other)->postJson("/api/rider/deliveries/{$delivery->id}/review")->assertOk()->assertJsonPath('data.availability', 'reviewing');

        // The reviewer closes the app without releasing: the hold lapses.
        $this->travel(91)->seconds();
        $this->actingAs($other)->postJson("/api/rider/deliveries/{$delivery->id}/review")->assertOk()->assertJsonPath('data.reviewing_by_me', true);

        // The original reviewer's stale page now learns it lost the hold.
        $this->actingAs($reviewer)->patchJson("/api/rider/deliveries/{$delivery->id}/review")->assertOk()->assertJsonPath('data.held', false);
    }

    public function test_only_riders_may_view_offers(): void
    {
        $grill = $this->business('Grill');
        $delivery = $this->delivery($this->order($grill, [[$grill, 'BBQ', 1, 100]]));

        $this->getJson("/api/rider/deliveries/{$delivery->id}/offer")->assertUnauthorized();
        $tourist = User::create(['name' => 'T', 'email' => 't@example.com', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->actingAs($tourist)->getJson("/api/rider/deliveries/{$delivery->id}/offer")->assertForbidden();
    }

    public function test_viewing_an_offer_changes_no_dispatch_state(): void
    {
        $grill = $this->business('Grill');
        $delivery = $this->delivery($this->order($grill, [[$grill, 'BBQ', 1, 100]]));
        $before = $delivery->fresh()->only(['status', 'rider_id', 'dispatch_status', 'assigned_at']);

        $this->actingAs($this->rider('r1@example.com'))->getJson("/api/rider/deliveries/{$delivery->id}/offer")->assertOk();

        $this->assertSame($before, $delivery->fresh()->only(['status', 'rider_id', 'dispatch_status', 'assigned_at']));
        $this->assertSame(0, BookingDispatchLog::where('delivery_id', $delivery->id)->count());
    }
}
