<?php

namespace Tests\Feature;

use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\NearestRiderService;
use App\Services\WebsocketNotifierService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Mockery;
use Tests\TestCase;

/**
 * Simultaneous-offer dispatch & atomic acceptance.
 *
 * A dispatch wave pings EVERY eligible rider (one pending booking_dispatch_log
 * per rider), the rider may choose which offer to accept, and acceptance is the
 * only atomic assignment (UNIQUE (delivery_id, rider_id) backstop). Covered:
 *
 *   A  two riders offered the same delivery → first wins, loser 409 + log cancelled
 *   B  one rider offered two deliveries → chooses one; the other is withdrawn + re-offered
 *   C  three riders, each offered → one chosen; the two losers are cancelled + notified
 *   D  stale offer (never offered / already won) → accept is a 409 conflict
 *   E  offline / non-matching riders get NO offer in the wave
 *   F  HTTP /rider/dispatch/offers lists only live offers and clears after accept
 *   G  double-click accept → first wins, second conflicts (409)
 *   H  accept after expiry → 409 timeout, log 'timeout', fresh wave re-offered
 *
 * NearestRiderService is mocked ONLY at the candidate-finder seam so the REAL
 * simultaneous-offer dispatch loop and the REAL atomic accept transaction run.
 */
class DeliveryOfferConcurrencyTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private NearestRiderService $service;
    private Mockery\MockInterface $websocket;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner-offers@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        config(['firebase.dispatch_enabled' => false]);

        // Real dispatch + real accept, but the SQLite-unsafe candidate finders
        // are replaced with a controllable candidate collection so the
        // multi-ping wave and the accept transaction run unmocked.
        $this->app->instance(NearestRiderService::class, new class(app(\App\Services\FirebaseService::class)) extends NearestRiderService {
            public Collection $candidates;

            public function __construct($firebase)
            {
                parent::__construct($firebase);
                $this->candidates = collect();
            }

            public function findNearestAvailableRiders(float $pickupLat, float $pickupLng, string $serviceType = 'food', int $limit = 5, ?int $municipalityId = null): Collection
            {
                return $this->candidates
                    ->filter(fn (User $rider) => $rider->account_status === User::ACCOUNT_STATUS_APPROVED
                        && in_array($rider->riderDetail?->rider_status, [User::RIDER_STATUS_ONLINE, User::RIDER_STATUS_AVAILABLE], true)
                        && $rider->riderDetail?->current_service === $serviceType)
                    ->sortBy('distance_km')
                    ->take($limit)
                    ->values();
            }

            public function findNearestEligibleCodRiders(Delivery $delivery, float $pickupLat, float $pickupLng, string $serviceType, int $limit, ?int $municipalityId): Collection
            {
                return $this->candidates
                    ->filter(fn (User $rider) => $rider->account_status === User::ACCOUNT_STATUS_APPROVED
                        && $rider->riderDetail?->rider_status === User::RIDER_STATUS_AVAILABLE
                        && $rider->riderDetail?->current_service === $serviceType)
                    ->sortBy('distance_km')
                    ->take($limit)
                    ->values();
            }
        });

        $this->service = app(NearestRiderService::class);

        $this->websocket = $this->mock(WebsocketNotifierService::class, function ($mock) {
            $mock->shouldReceive('notifyDispatch')->andReturn(true);
            $mock->shouldReceive('notifyTripAssigned')->andReturn(true);
            $mock->shouldReceive('getOnlineRidersFromBridge')->andReturn([]);
            $mock->shouldReceive('notifyStatusEvent')->andReturn(true);
        });
    }

    // ---------- helpers ----------

    private function makeBusiness(string $name): Business
    {
        $category = BusinessCategory::firstOrCreate(['name' => 'Restaurant']);
        $municipality = Municipality::firstOrCreate(
            ['name' => 'Bansud'],
            [
                'district' => '1st',
                'province' => 'Oriental Mindoro',
                'latitude' => 12.5,
                'longitude' => 121.3,
            ]
        );

        return Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => $name,
            'status' => 'approved',
            'force_closed' => false,
            'latitude' => 12.51,
            'longitude' => 121.31,
        ]);
    }

    private function makeRider(string $email, array $overrides = []): User
    {
        $rider = User::create(array_merge([
            'email' => $email,
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
            'rider_status' => 'available',
            'current_service' => 'food',
        ], $overrides));

        RiderDetail::create([
            'user_id' => $rider->id,
            'rider_status' => $overrides['rider_status'] ?? 'available',
            'current_service' => $overrides['current_service'] ?? 'food',
        ]);

        RiderLocation::create([
            'rider_id' => $rider->id,
            'latitude' => 12.51,
            'longitude' => 121.31,
            'recorded_at' => now(),
        ]);

        return $rider;
    }

    private function makeOrder(Business $business): Order
    {
        return Order::create([
            'order_number' => 'ORD-'.Str::upper(Str::random(8)),
            'business_id' => $business->id,
            'customer_name' => 'Customer',
            'customer_email' => 'cust@example.com',
            'customer_phone' => '09171234567',
            'order_type' => 'delivery',
            'payment_method' => 'gcash',
            'payment_status' => 'paid',
            'status' => 'preparing',
            'subtotal' => 300,
            'delivery_fee' => 40,
            'rider_tip' => 0,
            'system_fee' => 0,
            'rider_financed_amount' => 300,
            'total' => 340,
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'delivery_address' => '123 Test St',
            'predicted_ready_at' => now()->addMinutes(15),
            'predicted_preparation_seconds' => 900,
            'acceptance_started_at' => now()->subMinutes(30),
            'accepted_at' => now()->subMinutes(20),
        ]);
    }

    private function makeManualDelivery(Order $order, array $overrides = []): Delivery
    {
        return Delivery::create(array_merge([
            'order_id' => $order->id,
            'delivery_fee' => 40,
            'distance_km' => 1.5,
            'status' => 'waiting',
            'dispatch_status' => 'notified',
            'dispatch_expires_at' => now()->addSeconds(NearestRiderService::DISPATCH_TIMEOUT_SECONDS),
            'pickup_address' => 'Restaurant St',
            'pickup_latitude' => 12.51,
            'pickup_longitude' => 121.31,
            'delivery_address' => $order->delivery_address,
            'delivery_latitude' => $order->delivery_latitude,
            'delivery_longitude' => $order->delivery_longitude,
            'rider_commission' => 20,
        ], $overrides));
    }

    private function makePendingOffer(Delivery $delivery, User $rider, array $overrides = []): BookingDispatchLog
    {
        return BookingDispatchLog::create(array_merge([
            'delivery_id' => $delivery->id,
            'rider_id' => $rider->id,
            'distance_km' => 1.5,
            'response' => 'pending',
            'dispatched_at' => now(),
        ], $overrides));
    }

    private function setCandidates(array $riders): void
    {
        $candidates = collect($riders);
        $candidates->each(function (User $rider, int $i) {
            $rider->setAttribute('distance_km', 1.0 + $i);
        });

        $this->service->candidates = $candidates->values();
    }

    private function authHeaders(User $user): array
    {
        $token = $user->createToken('test-token')->plainTextToken;

        return [
            'Authorization' => "Bearer {$token}",
            'Accept' => 'application/json',
        ];
    }

    private function pendingLogs(Delivery $delivery, ?User $rider = null)
    {
        $query = BookingDispatchLog::where('delivery_id', $delivery->id);
        if ($rider) {
            $query->where('rider_id', $rider->id);
        }

        return $query;
    }

    // ---------- tests ----------

    public function test_dispatch_offers_to_every_eligible_rider_in_a_single_wave(): void
    {
        $business = $this->makeBusiness('Wave Test');
        $riderA = $this->makeRider('wave-a@example.com');
        $riderB = $this->makeRider('wave-b@example.com');
        $riderC = $this->makeRider('wave-c@example.com');
        $this->setCandidates([$riderA, $riderB, $riderC]);

        $delivery = $this->makeManualDelivery($this->makeOrder($business));

        $nearest = $this->service->dispatchToNearest($delivery, 'food');

        $this->assertSame($riderA->id, $nearest->id, 'Nearest candidate is returned as the wave representative.');
        $this->assertSame(3, $this->pendingLogs($delivery)->where('response', 'pending')->count());
        $this->assertSame('notified', $delivery->fresh()->dispatch_status);
        $this->assertNotNull($delivery->fresh()->dispatch_expires_at);
    }

    public function test_first_accepted_offer_wins_and_loser_gets_conflict_and_cancelled(): void
    {
        $business = $this->makeBusiness('A Two Riders');
        $riderA = $this->makeRider('two-a@example.com');
        $riderB = $this->makeRider('two-b@example.com');
        $delivery = $this->makeManualDelivery($this->makeOrder($business));

        $this->makePendingOffer($delivery, $riderA);
        $this->makePendingOffer($delivery, $riderB);

        $resultA = $this->service->handleRiderResponse($delivery->id, $riderA->id, 'accepted');
        $resultB = $this->service->handleRiderResponse($delivery->id, $riderB->id, 'accepted');

        $this->assertTrue($resultA['success'], 'First accepting rider wins.');
        $this->assertSame($riderA->id, $delivery->fresh()->rider_id, 'Delivery stays bound to the winner.');
        $this->assertSame('accepted', $this->pendingLogs($delivery, $riderA)->first()->response);

        $this->assertFalse($resultB['success']);
        $this->assertTrue($resultB['conflict'], 'Loser accept is a conflict, not a plain rejection.');
        $this->assertSame($riderA->id, $delivery->fresh()->rider_id);
        $this->assertSame('cancelled', $this->pendingLogs($delivery, $riderB)->first()->response);

        // The losing rider's socket was told the offer is gone.
        $this->websocket->shouldHaveReceived('notifyStatusEvent', ['delivery_offer_cancelled', ["rider:{$riderB->id}"], Mockery::any()]);
    }

    public function test_rider_chooses_one_offer_and_the_other_is_withdrawn_and_reoffered(): void
    {
        $business = $this->makeBusiness('B Choose One');
        $riderX = $this->makeRider('choose-x@example.com');
        $riderY = $this->makeRider('choose-y@example.com');
        $this->setCandidates([$riderX, $riderY]);

        $deliveryA = $this->makeManualDelivery($this->makeOrder($business));
        $deliveryB = $this->makeManualDelivery($this->makeOrder($business));

        $this->makePendingOffer($deliveryA, $riderX);
        $this->makePendingOffer($deliveryB, $riderX);

        // The rider picks delivery A.
        $result = $this->service->handleRiderResponse($deliveryA->id, $riderX->id, 'accepted');

        $this->assertTrue($result['success']);
        $this->assertSame($riderX->id, $deliveryA->fresh()->rider_id);

        // The un-chosen offer on B is withdrawn and delivery B re-offered to Y.
        $this->assertSame('cancelled', $this->pendingLogs($deliveryB, $riderX)->first()->response);
        $this->assertNull($deliveryB->fresh()->rider_id);
        $this->assertTrue($this->pendingLogs($deliveryB, $riderY)->where('response', 'pending')->exists());

        // X may not stack a second active delivery: X's offer on B was already
        // withdrawn the instant A was accepted, so this accept conflicts.
        $second = $this->service->handleRiderResponse($deliveryB->id, $riderX->id, 'accepted');
        $this->assertFalse($second['success']);
        $this->assertTrue($second['conflict']);

        // After the winner also got the loser's 'accepted_another_delivery' hint.
        $this->websocket->shouldHaveReceived('notifyStatusEvent', ['delivery_offer_cancelled', ["rider:{$riderX->id}"], Mockery::any()]);
    }

    public function test_three_riders_each_offered_and_losers_cancelled_and_notified(): void
    {
        $business = $this->makeBusiness('C Three Riders');
        $riderA = $this->makeRider('three-a@example.com');
        $riderB = $this->makeRider('three-b@example.com');
        $riderC = $this->makeRider('three-c@example.com');
        $this->setCandidates([$riderA, $riderB, $riderC]);

        $delivery = $this->makeManualDelivery($this->makeOrder($business));

        // Real wave: everyone gets their own offer.
        $this->service->dispatchToNearest($delivery, 'food');
        $this->assertSame(3, $this->pendingLogs($delivery)->where('response', 'pending')->count());

        // Rider C (whoever is chosen) accepts.
        $result = $this->service->handleRiderResponse($delivery->id, $riderC->id, 'accepted');
        $this->assertTrue($result['success']);
        $this->assertSame($riderC->id, $delivery->fresh()->rider_id);

        $this->assertSame('accepted', $this->pendingLogs($delivery, $riderC)->first()->response);
        $this->assertSame('cancelled', $this->pendingLogs($delivery, $riderA)->first()->response);
        $this->assertSame('cancelled', $this->pendingLogs($delivery, $riderB)->first()->response);

        $this->websocket->shouldHaveReceived('notifyStatusEvent', ['delivery_offer_cancelled', ["rider:{$riderA->id}"], Mockery::any()]);
        $this->websocket->shouldHaveReceived('notifyStatusEvent', ['delivery_offer_cancelled', ["rider:{$riderB->id}"], Mockery::any()]);
    }

    public function test_stale_offer_accept_after_claim_returns_conflict(): void
    {
        $business = $this->makeBusiness('D Stale');
        $riderA = $this->makeRider('stale-a@example.com');
        $riderB = $this->makeRider('stale-b@example.com');
        $delivery = $this->makeManualDelivery($this->makeOrder($business));

        // B was never offered: cannot claim.
        $noLog = $this->service->handleRiderResponse($delivery->id, $riderB->id, 'accepted');
        $this->assertFalse($noLog['success']);
        $this->assertTrue($noLog['conflict']);

        // A wins…
        $this->makePendingOffer($delivery, $riderA);
        $this->service->handleRiderResponse($delivery->id, $riderA->id, 'accepted');

        // …but a SECOND accept from A is always rejected (no pending offer remains).
        $second = $this->service->handleRiderResponse($delivery->id, $riderA->id, 'accepted');
        $this->assertFalse($second['success']);
        $this->assertTrue($second['conflict']);

        $this->assertSame($riderA->id, $delivery->fresh()->rider_id);
    }

    public function test_offline_and_non_matching_riders_are_not_offered(): void
    {
        $business = $this->makeBusiness('E Offline');
        $onlineA = $this->makeRider('offline-a@example.com');
        $offlineB = $this->makeRider('offline-b@example.com', ['rider_status' => 'offline']);
        $transportC = $this->makeRider('offline-c@example.com', ['current_service' => 'transport']);

        // Candidate set includes all three; the finder applies eligibility.
        $this->setCandidates([$onlineA, $offlineB, $transportC]);

        $delivery = $this->makeManualDelivery($this->makeOrder($business));
        $this->service->dispatchToNearest($delivery, 'food');

        $this->assertTrue($this->pendingLogs($delivery, $onlineA)->exists());
        $this->assertFalse($this->pendingLogs($delivery, $offlineB)->exists());
        $this->assertFalse($this->pendingLogs($delivery, $transportC)->exists());
    }

    public function test_http_offers_endpoint_lists_only_live_offers_and_clears_after_accept(): void
    {
        $business = $this->makeBusiness('F Endpoint');
        $riderA = $this->makeRider('endpoint-a@example.com');
        $riderB = $this->makeRider('endpoint-b@example.com');
        $delivery = $this->makeManualDelivery($this->makeOrder($business));

        $this->makePendingOffer($delivery, $riderA);
        $this->makePendingOffer($delivery, $riderB);

        // F1: recovery — the riding app can read its live offers via HTTP.
        $before = $this->getJson('/api/rider/dispatch/offers', $this->authHeaders($riderA));
        $before->assertOk()->assertJsonPath('success', true)->assertJsonCount(1, 'data.offers');
        $before->assertJsonPath('data.offers.0.delivery_id', $delivery->id);

        // F2: accept over HTTP succeeds and both riders' offer lists clear.
        $accept = $this->patchJson(
            '/api/rider/dispatch/accept',
            ['delivery_id' => $delivery->id],
            $this->authHeaders($riderA)
        );
        $accept->assertOk()->assertJsonPath('success', true);
        $this->assertSame($riderA->id, $delivery->fresh()->rider_id);

        $this->getJson('/api/rider/dispatch/offers', $this->authHeaders($riderA))
            ->assertOk()->assertJsonCount(0, 'data.offers');
        $this->getJson('/api/rider/dispatch/offers', $this->authHeaders($riderB))
            ->assertOk()->assertJsonCount(0, 'data.offers');
    }

    public function test_double_click_accept_first_wins_second_conflicts(): void
    {
        $business = $this->makeBusiness('G Double Click');
        $riderA = $this->makeRider('double-a@example.com');
        $delivery = $this->makeManualDelivery($this->makeOrder($business));

        $this->makePendingOffer($delivery, $riderA);

        $first = $this->patchJson(
            '/api/rider/dispatch/accept',
            ['delivery_id' => $delivery->id],
            $this->authHeaders($riderA)
        );
        $first->assertOk()->assertJsonPath('success', true);

        $second = $this->patchJson(
            '/api/rider/dispatch/accept',
            ['delivery_id' => $delivery->id],
            $this->authHeaders($riderA)
        );
        $second->assertStatus(409)->assertJsonPath('success', false);

        $this->assertSame($riderA->id, $delivery->fresh()->rider_id);
        $this->assertSame(1, $this->pendingLogs($delivery, $riderA)->where('response', 'accepted')->count());
    }

    public function test_accept_after_offer_expiry_times_out_and_reoffers(): void
    {
        $business = $this->makeBusiness('H Expiry');
        $riderA = $this->makeRider('expiry-a@example.com');
        $riderB = $this->makeRider('expiry-b@example.com');
        $this->setCandidates([$riderA, $riderB]);

        $delivery = $this->makeManualDelivery($this->makeOrder($business), [
            'dispatch_expires_at' => now()->subMinutes(1),
        ]);
        $this->makePendingOffer($delivery, $riderA, ['dispatched_at' => now()->subMinutes(5)]);

        // A's offer is already expired → accept is a 409 timeout.
        $result = $this->service->handleRiderResponse($delivery->id, $riderA->id, 'accepted');
        $this->assertFalse($result['success']);
        $this->assertTrue($result['timeout']);
        $this->assertTrue($result['conflict']);
        $this->assertSame('timeout', $this->pendingLogs($delivery, $riderA)->first()->response);

        // The delivery was re-offered to a fresh rider once the wave was empty.
        $this->assertNull($delivery->fresh()->rider_id);
        $this->assertSame('notified', $delivery->fresh()->dispatch_status);
        $this->assertTrue($this->pendingLogs($delivery, $riderB)->where('response', 'pending')->exists());
        $this->assertTrue($result['next_dispatched']);
    }
}