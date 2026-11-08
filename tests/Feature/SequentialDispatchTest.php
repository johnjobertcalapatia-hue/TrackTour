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
use App\Services\PickupSequencePlanner;
use App\Services\SequentialDispatchService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Sequential targeted dispatch (docs/dispatch-escalation-plan.md, Stage 2).
 *
 *  - farthest restaurant from the tourist is the first pickup; the rider
 *    search is centred on it
 *  - ONE nearest eligible rider at a time, 30 s server deadline
 *  - reject advances immediately, timeout advances via the worker
 *  - never the same rider twice, eligibility re-checked before every offer
 *  - 4 unsuccessful offers (or nobody eligible) → manual board
 *  - an accept stops the escalation
 *  - tourist cancel vs accept: exactly one wins (audit defect §2)
 *
 * COD orders keep candidate selection in PHP (SQLite-safe); Http::fake keeps
 * the socket bridge (radar) empty and deterministic.
 */
class SequentialDispatchTest extends TestCase
{
    use RefreshDatabase;

    private Municipality $muni;

    /** Optional OSRM stub: fn (string $url) => ?Response; null = router not stubbed (500). */
    private $osrm = null;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(function ($request) {
            if (str_contains($request->url(), 'router.project-osrm.org')) {
                return $this->osrm ? ($this->osrm)($request->url()) : Http::response('', 500);
            }

            return Http::response(['success' => true, 'onlineRiders' => []], 200);
        });
        $this->muni = Municipality::firstOrCreate(['name' => 'Bansud'], ['district' => '1st', 'province' => 'Oriental Mindoro', 'latitude' => 12.86, 'longitude' => 121.45]);
    }

    // ---------- fixtures ----------

    private function business(string $name, float $lat, float $lng): Business
    {
        $category = BusinessCategory::firstOrCreate(['name' => 'Restaurant']);
        $owner = User::firstOrCreate(['email' => 'seq-owner@example.com'], ['password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);

        return Business::create([
            'owner_id' => $owner->id, 'business_category_id' => $category->id, 'municipality_id' => $this->muni->id,
            'business_name' => $name, 'status' => 'approved', 'force_closed' => false,
            'address' => "{$name}, Bansud", 'latitude' => $lat, 'longitude' => $lng,
        ]);
    }

    /** Eligible COD rider at the given position (fresh GPS). */
    private function rider(string $name, float $lat, float $lng): User
    {
        $rider = User::create([
            'name' => $name, 'email' => strtolower(str_replace(' ', '', $name)).'@example.com', 'password' => Hash::make('x'),
            'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'available', 'current_service' => 'food',
        ]);
        RiderDetail::updateOrCreate(['user_id' => $rider->id], ['rider_status' => 'available', 'current_service' => 'food']);
        RiderLocation::create(['rider_id' => $rider->id, 'latitude' => $lat, 'longitude' => $lng, 'recorded_at' => now()]);

        return $rider;
    }

    /** Tourist COD order with items from the given restaurants, plus its waiting delivery. */
    private function orderWithDelivery(array $businesses, float $dropLat = 12.86, float $dropLng = 121.45, ?User $tourist = null): Delivery
    {
        $tourist ??= User::create(['name' => 'Tourist', 'email' => uniqid('t').'@example.com', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $order = Order::create([
            'order_number' => uniqid('TT-SEQ-'), 'user_id' => $tourist->id, 'business_id' => $businesses[0]->id,
            'customer_name' => 'Tourist', 'customer_email' => $tourist->email, 'customer_phone' => '09171234567',
            'order_type' => 'delivery', 'delivery_speed' => 'standard', 'payment_method' => 'cash', 'payment_status' => 'pending',
            'status' => 'waiting_restaurant', 'subtotal' => 100 * count($businesses), 'delivery_fee' => 60, 'rider_tip' => 0, 'system_fee' => 0,
            'rider_financed_amount' => 100 * count($businesses), 'total' => 100 * count($businesses) + 60,
            'delivery_latitude' => $dropLat, 'delivery_longitude' => $dropLng, 'delivery_address' => 'Tourist stay',
        ]);
        foreach ($businesses as $b) {
            OrderItem::create(['order_id' => $order->id, 'business_id' => $b->id, 'product_name' => "Dish {$b->id}", 'quantity' => 1, 'unit_price' => 100, 'subtotal' => 100]);
        }

        return Delivery::create([
            'order_id' => $order->id, 'status' => 'waiting', 'dispatch_status' => 'waiting_for_rider', 'rider_commission' => 40, 'delivery_fee' => 60,
            'pickup_address' => $businesses[0]->address, 'pickup_latitude' => $businesses[0]->latitude, 'pickup_longitude' => $businesses[0]->longitude,
            'delivery_address' => 'Tourist stay', 'delivery_latitude' => $dropLat, 'delivery_longitude' => $dropLng,
        ]);
    }

    private function dispatch(Delivery $delivery): ?User
    {
        return app(NearestRiderService::class)->dispatchToNearest($delivery->fresh(), 'food', $this->muni->id);
    }

    private function pending(Delivery $delivery): \Illuminate\Support\Collection
    {
        return BookingDispatchLog::where('delivery_id', $delivery->id)->where('response', 'pending')->get();
    }

    private function decline(User $rider, Delivery $delivery): void
    {
        $this->actingAs($rider)->patchJson('/api/rider/dispatch/decline', ['delivery_id' => $delivery->id])->assertOk();
    }

    /** Four riders at increasing distance from the restaurant (≈0.1, 0.2, 0.3, 0.4 km) plus a fifth. */
    private function fiveRiders(): array
    {
        return [
            $this->rider('Rider One', 12.8651, 121.452),
            $this->rider('Rider Two', 12.8660, 121.452),
            $this->rider('Rider Three', 12.8670, 121.452),
            $this->rider('Rider Four', 12.8680, 121.452),
            $this->rider('Rider Five', 12.8690, 121.452),
        ];
    }

    // ---------- targeted offers ----------

    public function test_offers_only_the_nearest_rider_first_with_a_30_second_server_deadline(): void
    {
        $grill = $this->business('Grill', 12.865, 121.452);
        [$one] = $this->fiveRiders();
        $delivery = $this->orderWithDelivery([$grill]);

        $this->assertSame($one->id, $this->dispatch($delivery)?->id);

        $offers = $this->pending($delivery);
        $this->assertCount(1, $offers, 'Only ONE targeted rider at a time.');
        $offer = $offers->first();
        $this->assertSame($one->id, (int) $offer->rider_id);
        $this->assertSame('targeted', $offer->phase);
        $this->assertSame(1, (int) $offer->attempt_no);
        $this->assertEqualsWithDelta(30, now()->diffInSeconds($offer->expires_at), 1);

        $fresh = $delivery->fresh();
        $this->assertSame('notified', $fresh->dispatch_status);
        $this->assertSame('targeted', $fresh->dispatch_phase);
        $this->assertSame(1, $fresh->targeted_attempts);
        $this->assertSame($offer->id, (int) $fresh->current_offer_id);

        // The rider's poll shows the server-controlled countdown.
        $poll = $this->actingAs($one)->getJson('/api/rider/dispatch/pending-request')->assertOk()->json('data');
        $this->assertNotNull($poll);
        $this->assertLessThanOrEqual(30, (int) ($poll['expires_in'] ?? $poll['request']['expires_in'] ?? 30));
    }

    public function test_rider_one_accepts_immediately_and_escalation_stops(): void
    {
        $grill = $this->business('Grill', 12.865, 121.452);
        [$one, $two] = $this->fiveRiders();
        $delivery = $this->orderWithDelivery([$grill]);
        $this->dispatch($delivery);

        $this->actingAs($one)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])->assertOk();

        $fresh = $delivery->fresh();
        $this->assertSame($one->id, (int) $fresh->rider_id);
        $this->assertNull($fresh->current_offer_id);

        // Nothing further is offered, even after the deadline passes.
        $this->travel(2)->minutes();
        $this->artisan('dispatch:process-offer-timeouts')->assertSuccessful();
        $this->assertSame(1, BookingDispatchLog::where('delivery_id', $delivery->id)->count());
        $this->assertSame(0, BookingDispatchLog::where('rider_id', $two->id)->count());
    }

    public function test_rider_one_rejects_and_rider_two_receives_the_offer_immediately_and_accepts(): void
    {
        $grill = $this->business('Grill', 12.865, 121.452);
        [$one, $two] = $this->fiveRiders();
        $delivery = $this->orderWithDelivery([$grill]);
        $this->dispatch($delivery);

        $this->decline($one, $delivery);

        $offers = $this->pending($delivery);
        $this->assertCount(1, $offers);
        $this->assertSame($two->id, (int) $offers->first()->rider_id, 'A reject advances to the next nearest rider at once.');
        $this->assertSame(2, (int) $offers->first()->attempt_no);
        $this->assertSame('declined', BookingDispatchLog::where('rider_id', $one->id)->value('response'));

        $this->actingAs($two)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])->assertOk();
        $this->assertSame($two->id, (int) $delivery->fresh()->rider_id);
    }

    public function test_four_rejections_move_the_delivery_to_the_manual_board_without_a_fifth_offer(): void
    {
        $grill = $this->business('Grill', 12.865, 121.452);
        $riders = $this->fiveRiders();
        $delivery = $this->orderWithDelivery([$grill]);
        $this->dispatch($delivery);

        foreach (array_slice($riders, 0, 4) as $i => $rider) {
            $current = $this->pending($delivery);
            $this->assertCount(1, $current, 'Attempt '.($i + 1).' has exactly one live offer.');
            $this->assertSame($rider->id, (int) $current->first()->rider_id, 'Riders are offered nearest first.');
            $this->decline($rider, $delivery);
        }

        $fresh = $delivery->fresh();
        $this->assertSame('manual', $fresh->dispatch_phase);
        $this->assertSame('waiting_for_rider', $fresh->dispatch_status);
        $this->assertSame(4, $fresh->targeted_attempts);
        $this->assertNull($fresh->current_offer_id);
        $this->assertCount(0, $this->pending($delivery));
        $this->assertSame(0, BookingDispatchLog::where('rider_id', $riders[4]->id)->count(), 'No fifth targeted offer.');

        // Re-triggering dispatch on the board phase sends nothing new.
        $this->assertNull($this->dispatch($delivery));
        $this->assertSame(4, BookingDispatchLog::where('delivery_id', $delivery->id)->count());
    }

    public function test_four_timeouts_are_advanced_by_the_server_worker_then_the_manual_board(): void
    {
        $grill = $this->business('Grill', 12.865, 121.452);
        $riders = $this->fiveRiders();
        $delivery = $this->orderWithDelivery([$grill]);
        $this->dispatch($delivery);

        foreach (array_slice($riders, 0, 4) as $i => $rider) {
            $this->assertSame($rider->id, (int) $this->pending($delivery)->first()?->rider_id);
            // Not yet expired: the worker leaves the live offer alone.
            $this->travel(15)->seconds();
            $this->artisan('dispatch:process-offer-timeouts');
            $this->assertSame($rider->id, (int) $this->pending($delivery)->first()?->rider_id, 'Offer stays live until 30 s.');
            // Expired: the worker times it out and advances.
            $this->travel(16)->seconds();
            $this->artisan('dispatch:process-offer-timeouts');
            $this->assertSame('timeout', BookingDispatchLog::where('delivery_id', $delivery->id)->where('rider_id', $rider->id)->value('response'));
        }

        $fresh = $delivery->fresh();
        $this->assertSame('manual', $fresh->dispatch_phase);
        $this->assertSame(4, $fresh->targeted_attempts);
        $this->assertSame(0, BookingDispatchLog::where('rider_id', $riders[4]->id)->count());
    }

    public function test_a_rider_is_never_offered_the_same_order_twice(): void
    {
        $grill = $this->business('Grill', 12.865, 121.452);
        $one = $this->rider('Rider One', 12.8651, 121.452);
        $two = $this->rider('Rider Two', 12.8660, 121.452);
        $delivery = $this->orderWithDelivery([$grill]);
        $this->dispatch($delivery);

        // Rider 1 times out, rider 2 rejects: rider 1 is NOT offered again.
        $this->travel(31)->seconds();
        $this->artisan('dispatch:process-offer-timeouts');
        $this->assertSame($two->id, (int) $this->pending($delivery)->first()?->rider_id);
        $this->decline($two, $delivery);

        $this->assertCount(0, $this->pending($delivery));
        $this->assertSame(1, BookingDispatchLog::where('delivery_id', $delivery->id)->where('rider_id', $one->id)->count());
        $this->assertSame('manual', $delivery->fresh()->dispatch_phase, 'No eligible targeted rider remains.');
    }

    public function test_no_eligible_rider_goes_straight_to_the_manual_board(): void
    {
        $grill = $this->business('Grill', 12.865, 121.452);
        $delivery = $this->orderWithDelivery([$grill]);

        $this->assertNull($this->dispatch($delivery));

        $fresh = $delivery->fresh();
        $this->assertSame('manual', $fresh->dispatch_phase);
        $this->assertSame('waiting_for_rider', $fresh->dispatch_status);
        $this->assertSame(0, $fresh->targeted_attempts);
        $this->assertNull($fresh->dispatch_retry_at, 'Not parked in the legacy retry loop.');
    }

    public function test_a_rider_who_goes_offline_or_loses_eligibility_is_skipped(): void
    {
        $grill = $this->business('Grill', 12.865, 121.452);
        [$one, $two, $three] = $this->fiveRiders();
        $delivery = $this->orderWithDelivery([$grill]);
        $this->dispatch($delivery);
        $this->assertSame($one->id, (int) $this->pending($delivery)->first()?->rider_id);

        // Rider 2 loses eligibility (account suspended) while rider 1 holds the offer…
        User::where('id', $two->id)->update(['account_status' => 'suspended']);

        // …and rider 1 goes offline during the offer: their accept is refused.
        RiderDetail::where('user_id', $one->id)->update(['rider_status' => 'offline']);
        $this->actingAs($one)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])->assertStatus(422);
        $this->assertNull($delivery->fresh()->rider_id);

        // Whether the refusal or the 30 s timeout ends rider 1's turn, the next
        // offer skips the suspended rider.
        if ((int) $this->pending($delivery)->first()?->rider_id === $one->id) {
            $this->travel(31)->seconds();
            $this->artisan('dispatch:process-offer-timeouts');
        }

        $this->assertSame($three->id, (int) $this->pending($delivery)->first()?->rider_id, 'Eligibility is re-checked before every offer.');
        $this->assertSame(0, BookingDispatchLog::where('rider_id', $two->id)->count());
    }

    public function test_there_is_never_more_than_one_live_targeted_offer(): void
    {
        $grill = $this->business('Grill', 12.865, 121.452);
        $this->fiveRiders();
        $delivery = $this->orderWithDelivery([$grill]);

        $this->dispatch($delivery);
        // Overlapping triggers (scheduler, dispatch-on-ready, a second worker).
        $this->dispatch($delivery);
        app(SequentialDispatchService::class)->offerNext($delivery->fresh(), 'food', $this->muni->id);
        $this->artisan('dispatch:process-offer-timeouts');

        $this->assertCount(1, $this->pending($delivery));
        $this->assertSame(1, $delivery->fresh()->targeted_attempts);
    }

    // ---------- pickup sequence ----------

    public function test_farthest_restaurant_from_the_tourist_is_the_first_pickup_and_centres_the_rider_search(): void
    {
        // Tourist at 12.860. A is 2 km away, B 4.5 km, C 7 km (roughly, north).
        $a = $this->business('Restaurant A', 12.878, 121.45);
        $b = $this->business('Restaurant B', 12.900, 121.45);
        $c = $this->business('Restaurant C', 12.923, 121.45);
        $nearC = $this->rider('Near C', 12.9232, 121.45);
        $this->rider('Near A', 12.8782, 121.45);
        $delivery = $this->orderWithDelivery([$a, $b, $c], 12.86, 121.45);

        $sequence = app(PickupSequencePlanner::class)->plan($delivery->fresh(), allowRoad: false);
        $this->assertSame([$c->id, $b->id, $a->id], $sequence);

        $fresh = $delivery->fresh();
        $this->assertSame([$c->id, $b->id, $a->id], $fresh->pickup_sequence);
        $this->assertEqualsWithDelta(12.923, (float) $fresh->pickup_latitude, 0.0001, 'The delivery starts at the farthest restaurant.');

        // The rider nearest to Restaurant C is targeted, not the one nearest the tourist.
        $this->assertSame($nearC->id, $this->dispatch($delivery)?->id);

        // The route the rider drives follows the same order.
        $stops = app(\App\Services\PurchasingCashService::class)->routeStops($delivery->fresh());
        $this->assertSame([$c->id, $b->id, $a->id], $stops->pluck('business_id')->all());
        $this->assertSame([1, 2, 3], $stops->pluck('sequence')->all());
    }

    public function test_pickup_sequence_prefers_road_distance_when_available(): void
    {
        config(['delivery.dispatch_road_distance' => true]);
        // Straight line says B (12.900) is farther than A (12.880), but the
        // road from A loops around: 9 km vs B's 5 km.
        $a = $this->business('Restaurant A', 12.880, 121.45);
        $b = $this->business('Restaurant B', 12.900, 121.45);
        $this->osrm = function (string $url) {
            $km = str_contains($url, '121.45,12.88;') ? 9.0 : 5.0;

            return Http::response(['code' => 'Ok', 'routes' => [['distance' => $km * 1000, 'duration' => 600]]], 200);
        };
        $delivery = $this->orderWithDelivery([$a, $b], 12.86, 121.45);

        $this->assertSame([$a->id, $b->id], app(PickupSequencePlanner::class)->plan($delivery->fresh(), allowRoad: true));

        // Router down → straight-line fallback (B farther), never an error.
        $this->osrm = null;
        $this->assertSame([$b->id, $a->id], app(PickupSequencePlanner::class)->plan($delivery->fresh(), allowRoad: true));
    }

    // ---------- audit defect §2: cancellation vs acceptance ----------

    public function test_tourist_cancel_withdraws_the_targeted_offer_so_it_cannot_be_accepted(): void
    {
        $grill = $this->business('Grill', 12.865, 121.452);
        [$one] = $this->fiveRiders();
        $tourist = User::create(['name' => 'T', 'email' => 'tourist-cancel@example.com', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $delivery = $this->orderWithDelivery([$grill], tourist: $tourist);
        $this->dispatch($delivery);

        $this->actingAs($tourist)->postJson("/api/tourist/food/order/{$delivery->order_id}/cancel")->assertOk();

        $this->assertSame('cancelled', $delivery->fresh()->status->value ?? $delivery->fresh()->status);
        $this->assertSame('cancelled', BookingDispatchLog::where('rider_id', $one->id)->value('response'));

        $this->actingAs($one)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])->assertStatus(409);
        $this->assertNull($delivery->fresh()->rider_id, 'A cancelled order is never assigned.');

        // The worker never re-offers a cancelled order.
        $this->travel(2)->minutes();
        $this->artisan('dispatch:process-offer-timeouts');
        $this->assertSame(1, BookingDispatchLog::where('delivery_id', $delivery->id)->count());
    }

    public function test_accept_guard_refuses_an_order_cancelled_behind_a_live_offer(): void
    {
        // Even if a cancellation path forgot to withdraw the offer, the accept
        // re-checks the order under the delivery lock.
        $grill = $this->business('Grill', 12.865, 121.452);
        [$one] = $this->fiveRiders();
        $delivery = $this->orderWithDelivery([$grill]);
        $this->dispatch($delivery);
        Order::where('id', $delivery->order_id)->update(['status' => 'cancelled_by_tourist']);

        $this->actingAs($one)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])
            ->assertStatus(409)->assertJsonPath('message', 'This order is no longer available.');
        $this->assertNull($delivery->fresh()->rider_id);
    }

    public function test_once_a_rider_accepted_the_tourist_cannot_cancel_before_assignment(): void
    {
        $grill = $this->business('Grill', 12.865, 121.452);
        [$one] = $this->fiveRiders();
        $tourist = User::create(['name' => 'T', 'email' => 'tourist-late@example.com', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $delivery = $this->orderWithDelivery([$grill], tourist: $tourist);
        $this->dispatch($delivery);
        $this->actingAs($one)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])->assertOk();

        $this->actingAs($tourist)->postJson("/api/tourist/food/order/{$delivery->order_id}/cancel")->assertStatus(422);
        $this->assertNotContains(Order::find($delivery->order_id)->status, ['cancelled', 'cancelled_by_tourist']);
        $this->assertSame($one->id, (int) $delivery->fresh()->rider_id);
    }

    // ---------- manual board (Stage 3) ----------

    /** @return array<int, array<string, mixed>> this rider's Available Deliveries rows */
    private function board(User $rider): array
    {
        return $this->actingAs($rider)->getJson('/api/rider/deliveries/pending')->assertOk()->json('data');
    }

    private function toManualBoard(Delivery $delivery, array $riders): void
    {
        foreach ($riders as $rider) {
            $this->decline($rider, $delivery);
        }
        $this->assertSame('manual', $delivery->fresh()->dispatch_phase);
    }

    public function test_during_targeted_offers_only_the_targeted_rider_sees_or_can_accept_it(): void
    {
        $grill = $this->business('Grill', 12.865, 121.452);
        [$one, $two, $three] = $this->fiveRiders();
        $delivery = $this->orderWithDelivery([$grill]);
        $this->dispatch($delivery);

        $this->assertContains($delivery->id, array_column($this->board($one), 'id'), 'The targeted rider sees their offer.');
        $this->assertNotContains($delivery->id, array_column($this->board($two), 'id'), 'Not on the board while targeted.');
        $this->assertNotContains($delivery->id, array_column($this->board($three), 'id'));
        $this->actingAs($two)->getJson("/api/rider/deliveries/{$delivery->id}/offer")->assertNotFound();

        // Server-side, not just hidden: a direct claim is refused.
        $response = $this->actingAs($two)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id]);
        $this->assertFalse((bool) $response->json('success'));
        $this->assertNull($delivery->fresh()->rider_id);

        // The targeted rider still accepts normally.
        $this->actingAs($one)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])->assertOk();
        $this->assertSame($one->id, (int) $delivery->fresh()->rider_id);
        // The others never get an "Already accepted" card for it.
        $this->assertNotContains($delivery->id, array_column($this->board($two), 'id'));
    }

    public function test_after_four_failed_offers_every_eligible_rider_sees_it_including_those_who_declined(): void
    {
        $grill = $this->business('Grill', 12.865, 121.452);
        $riders = $this->fiveRiders();
        $delivery = $this->orderWithDelivery([$grill]);
        $this->dispatch($delivery);
        $this->toManualBoard($delivery, array_slice($riders, 0, 4));

        foreach ($riders as $rider) {
            $this->assertContains($delivery->id, array_column($this->board($rider), 'id'), $rider->name.' sees the manual board offer (D2).');
        }

        // A rider who declined a targeted offer may still claim it on the board.
        $this->actingAs($riders[1])->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])->assertOk();
        $this->assertSame($riders[1]->id, (int) $delivery->fresh()->rider_id);
    }

    public function test_the_board_is_sorted_per_rider_by_distance_to_the_first_pickup_with_the_card_facts(): void
    {
        $north = $this->business('North Grill', 12.900, 121.452);
        $south = $this->business('South Grill', 12.830, 121.452);
        $northRider = $this->rider('North Rider', 12.899, 121.452);
        $southRider = $this->rider('South Rider', 12.831, 121.452);

        // The oldest is the south order: sorting must not follow creation time.
        $southJob = $this->orderWithDelivery([$south]);
        $northJob = $this->orderWithDelivery([$north]);
        $twoStop = $this->orderWithDelivery([$north, $south]);
        foreach ([$southJob, $northJob, $twoStop] as $d) {
            $d->update(['dispatch_phase' => SequentialDispatchService::PHASE_MANUAL]);
        }
        // The two-stop job's first pickup (pickup_*) is South Grill, a bit farther south.
        $twoStop->update(['pickup_latitude' => 12.825, 'pickup_longitude' => $south->longitude]);

        $northBoard = $this->board($northRider);
        $this->assertSame([$northJob->id, $southJob->id, $twoStop->id], array_column($northBoard, 'id'));
        $southBoard = $this->board($southRider);
        $this->assertSame([$southJob->id, $twoStop->id, $northJob->id], array_column($southBoard, 'id'));

        // Card facts: "0.1 km to first pickup · North Grill · 1 item · 1 pickup stop".
        $card = collect($northBoard)->firstWhere('id', $northJob->id);
        $this->assertEqualsWithDelta(0.1, $card['pickup_distance_km'], 0.05);
        $this->assertSame(['North Grill'], $card['pickup_names']);
        $this->assertSame(1, $card['items_count']);
        $this->assertSame(1, $card['pickup_stops']);
        $this->assertSame(2, collect($northBoard)->firstWhere('id', $twoStop->id)['pickup_stops']);
    }

    public function test_two_riders_accept_the_same_board_offer_one_wins_and_it_leaves_the_other_board(): void
    {
        $grill = $this->business('Grill', 12.865, 121.452);
        [$one, $two] = $this->fiveRiders();
        $delivery = $this->orderWithDelivery([$grill]);
        $delivery->update(['dispatch_phase' => SequentialDispatchService::PHASE_MANUAL]);

        $this->actingAs($one)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])->assertOk();
        $this->actingAs($two)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $delivery->id])->assertStatus(409);
        $this->assertSame($one->id, (int) $delivery->fresh()->rider_id);

        $this->assertNotContains($delivery->id, array_column($this->board($two), 'id'), 'Removed at once (D3).');
        $this->actingAs($two)->getJson("/api/rider/deliveries/{$delivery->id}/offer")
            ->assertOk()->assertJsonPath('data.availability', 'taken');

        // One active delivery: the winner can't take a second board offer.
        $other = $this->orderWithDelivery([$grill]);
        $other->update(['dispatch_phase' => SequentialDispatchService::PHASE_MANUAL]);
        $this->actingAs($one)->patchJson('/api/rider/dispatch/accept', ['delivery_id' => $other->id])->assertStatus(409);
        $this->assertNull($other->fresh()->rider_id);
    }

    public function test_cancelled_and_expired_offers_leave_the_board(): void
    {
        $grill = $this->business('Grill', 12.865, 121.452);
        [$one] = $this->fiveRiders();
        $tourist = User::create(['name' => 'Tourist', 'email' => 'board-tourist@example.com', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $cancelled = $this->orderWithDelivery([$grill], tourist: $tourist);
        $expiring = $this->orderWithDelivery([$grill]);
        foreach ([$cancelled, $expiring] as $d) {
            $d->update(['dispatch_phase' => SequentialDispatchService::PHASE_MANUAL]);
        }
        $this->assertCount(2, $this->board($one));

        $this->actingAs($tourist)->postJson("/api/tourist/food/order/{$cancelled->order_id}/cancel")->assertOk();
        $this->assertSame([$expiring->id], array_column($this->board($one), 'id'));

        // The 60-minute dispatch deadline ends the search.
        $this->travel(61)->minutes();
        RiderLocation::create(['rider_id' => $one->id, 'latitude' => 12.8651, 'longitude' => 121.452, 'recorded_at' => now()]);
        $this->artisan('dispatch:process-offer-timeouts')->assertSuccessful();
        $this->assertSame([], $this->board($one));
    }

    // ---------- offer popup card facts ----------

    public function test_the_offer_popup_gets_photo_items_cod_group_and_minutes(): void
    {
        $grill = $this->business('Grill', 12.865, 121.452);
        $cafe = $this->business('Cafe', 12.866, 121.453);
        $this->fiveRiders();
        $delivery = $this->orderWithDelivery([$grill, $cafe]);
        $delivery->update(['estimated_duration_minutes' => 8]);
        $dish = \App\Models\Offering::create(['business_id' => $grill->id, 'name' => 'BBQ', 'price' => 100, 'is_available' => true, 'status' => 'available', 'image' => 'offerings/bbq.jpg']);
        OrderItem::where('order_id', $delivery->order_id)->where('business_id', $grill->id)->update(['offering_id' => $dish->id, 'quantity' => 2]);
        $this->dispatch($delivery);

        // The first pickup is the Cafe (farther from the tourist): the nearest
        // rider to it gets the offer.
        $targeted = User::find($this->pending($delivery)->first()->rider_id);
        $offer = $this->actingAs($targeted)->getJson('/api/rider/dispatch/offers')->assertOk()->json('data.offers.0');

        $this->assertSame($delivery->id, $offer['delivery_id']);
        $this->assertSame('offerings/bbq.jpg', $offer['image']);
        $this->assertSame(3, $offer['items_count']);          // 2 BBQ + 1 cafe dish
        $this->assertTrue($offer['is_cod']);
        $this->assertTrue($offer['is_group']);
        $this->assertSame(8, $offer['dropoff_minutes']);
        // ≈0.1 km to the first pickup at 25 km/h → at least 1 minute.
        $this->assertSame(1, $offer['pickup_minutes']);
        // Existing fields are unchanged.
        $this->assertArrayHasKey('expires_in', $offer);
        $this->assertArrayHasKey('rider_payout', $offer);
    }
}
