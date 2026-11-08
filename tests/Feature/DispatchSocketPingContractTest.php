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
use App\Services\SmartDispatchService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The Laravel → socket half of the order→rider ping contract. The socket
 * engine can only ping a rider when dispatchToNearest() POSTs /dispatch to the
 * bridge naming that rider. A wrong, missing or unauthenticated POST means the
 * rider never hears order_received_ping — only the slower HTTP offers poll
 * would recover it.
 *
 * Exercised against the REAL SmartDispatchService → NearestRiderService
 * checkout pipeline on both candidate sources (MySQL rider_locations and the
 * live socket radar). Http::fake records every bridge request and answers the
 * radar /status probe so the tests stay offline and SQLite-safe.
 */
class DispatchSocketPingContractTest extends TestCase
{
    use RefreshDatabase;

    private const BRIDGE_DISPATCH_URL = 'http://127.0.0.1:3002/dispatch';

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'delivery.scheduler.max_retries' => 3,
            'delivery.scheduler.retry_after_minutes' => 5,
        ]);
    }

    // ---------- helpers ----------

    /** Record every bridge request; answer /status with the given radar list. */
    private function bypassLiveBridge(array $radarEntries): void
    {
        Http::fake([
            '*' => Http::response(['success' => true, 'onlineRiders' => $radarEntries], 200),
        ]);
    }

    /** Every captured POST to the dispatch bridge, in order. */
    private function dispatchBridgePosts(): \Illuminate\Support\Collection
    {
        return collect(Http::recorded())
            ->filter(fn ($pair) => $pair[0]->url() === self::BRIDGE_DISPATCH_URL)
            ->map(fn ($pair) => $pair[0]);
    }

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
            'owner_id' => $this->makeOwner()->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => $name,
            'status' => 'approved',
            'force_closed' => false,
            'latitude' => 12.51,
            'longitude' => 121.31,
        ]);
    }

    private function makeOwner(): User
    {
        return User::firstOrCreate(
            ['email' => 'owner-ping@example.com'],
            [
                'password' => Hash::make('Password123!'),
                'role' => 'business_owner',
                'account_status' => 'approved',
            ]
        );
    }

    /** A cash (COD) order with no predicted ready time → immediate dispatch. */
    private function makeCashOrder(Business $business): Order
    {
        return Order::create([
            'order_number' => 'ORD-' . Str::upper(Str::random(8)),
            'business_id' => $business->id,
            'customer_name' => 'Customer',
            'customer_email' => 'cust-ping@example.com',
            'customer_phone' => '09171234567',
            'order_type' => 'delivery',
            'payment_method' => 'cash',
            'payment_status' => 'pending',
            'status' => 'waiting_restaurant',
            'subtotal' => 300,
            'delivery_fee' => 40,
            'rider_tip' => 0,
            'system_fee' => 0,
            'rider_financed_amount' => 300,
            'total' => 340,
            'delivery_latitude' => 12.52,
            'delivery_longitude' => 121.32,
            'delivery_address' => '123 Test St',
        ]);
    }

    /** Approved + 'available' + food rider; opt-in rider_locations row. */
    private function makeRider(string $email, ?Business $locationAt = null): User
    {
        $rider = User::create([
            'email' => $email,
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
            'rider_status' => 'available',
            'current_service' => 'food',
        ]);

        RiderDetail::create([
            'user_id' => $rider->id,
            'rider_status' => 'available',
            'current_service' => 'food',
        ]);

        if ($locationAt !== null) {
            RiderLocation::create([
                'rider_id' => $rider->id,
                'latitude' => $locationAt->latitude,
                'longitude' => $locationAt->longitude,
                'recorded_at' => now(),
            ]);
        }

        return $rider;
    }

    private function nowMs(): int
    {
        return (int) floor(microtime(true) * 1000);
    }

    private function radarEntry(User $rider): array
    {
        return [
            'riderId' => $rider->id,
            'status' => 'available',
            'vehicleType' => 'food',
            'lat' => 12.51,
            'lng' => 121.31,
            'updatedAt' => $this->nowMs(),
        ];
    }

    private function dispatchCheckout(Business $business): Delivery
    {
        $order = $this->makeCashOrder($business);

        app(SmartDispatchService::class)->scheduleDispatch($order->fresh());

        $delivery = $order->fresh()->delivery;
        $this->assertNotNull($delivery, 'scheduleDispatch created the delivery.');

        return $delivery;
    }

    private function assertOfferAndPing(Delivery $delivery, User $rider): void
    {
        $delivery->refresh();
        $this->assertSame('notified', $delivery->dispatch_status);
        $this->assertNotNull($delivery->dispatch_expires_at);

        $this->assertTrue(
            BookingDispatchLog::where('delivery_id', $delivery->id)
                ->where('rider_id', $rider->id)
                ->where('response', 'pending')
                ->exists(),
            'The rider received a pending dispatch offer (the ping the UI listens for).'
        );

        Http::assertSent(fn (HttpRequest $req) =>
            $req->url() === self::BRIDGE_DISPATCH_URL
            && $req['deliveryId'] === $delivery->id
            && $req['riderId'] === $rider->id
            && $req['restaurantLat'] !== null
            && $req['restaurantLng'] !== null
            && filled($req['restaurantName']),
            'dispatchToNearest must POST the bridge /dispatch naming the offered rider.'
        );
    }

    // ---------- tests ----------

    public function test_mysql_candidate_dispatch_posts_bridge_ping_naming_the_rider(): void
    {
        $business = $this->makeBusiness('Ping Mysql');
        $rider = $this->makeRider('ping-mysql@example.com', $business); // fresh MySQL location
        $this->bypassLiveBridge([]);

        $delivery = $this->dispatchCheckout($business);

        $this->assertOfferAndPing($delivery, $rider);
        $this->assertSame(1, $this->dispatchBridgePosts()->count(), 'Exactly one rider was pinged.');
    }

    public function test_radar_fallback_dispatch_posts_bridge_ping_naming_the_rider(): void
    {
        $business = $this->makeBusiness('Ping Radar');
        $rider = $this->makeRider('ping-radar@example.com'); // no MySQL location → radar fallback
        $this->bypassLiveBridge([$this->radarEntry($rider)]);

        $delivery = $this->dispatchCheckout($business);

        $this->assertOfferAndPing($delivery, $rider);
        $this->assertSame(1, $this->dispatchBridgePosts()->count(), 'Exactly one rider was pinged.');
    }

    public function test_radar_fallback_pings_only_the_targeted_candidate_then_the_next_on_reject(): void
    {
        // Reconciled 2026-11-07 (AGENTS.md §12; docs/dispatch-escalation-plan.md, approved): food deliveries
        // are offered to ONE rider at a time. With two radar candidates only the
        // first gets an offer + bridge ping; a reject advances to the second.
        $business = $this->makeBusiness('Ping Radar Multi');
        $riderA = $this->makeRider('ping-radar-a@example.com');
        $riderB = $this->makeRider('ping-radar-b@example.com');
        $this->bypassLiveBridge([$this->radarEntry($riderA), $this->radarEntry($riderB)]);

        $delivery = $this->dispatchCheckout($business);

        $this->assertSame('notified', $delivery->fresh()->dispatch_status);
        $pending = BookingDispatchLog::where('delivery_id', $delivery->id)->where('response', 'pending')->get();
        $this->assertCount(1, $pending, 'Exactly one targeted offer at a time.');
        $this->assertSame(1, $this->dispatchBridgePosts()->count(), 'Exactly one bridge ping.');

        $first = (int) $pending->first()->rider_id;
        $second = $first === $riderA->id ? $riderB->id : $riderA->id;
        app(\App\Services\NearestRiderService::class)->handleRiderResponse($delivery->id, $first, 'declined');

        $this->assertSame($second, (int) BookingDispatchLog::where('delivery_id', $delivery->id)->where('response', 'pending')->value('rider_id'));
        Http::assertSent(fn (HttpRequest $req) =>
            $req->url() === self::BRIDGE_DISPATCH_URL
            && $req['deliveryId'] === $delivery->id
            && $req['riderId'] === $second
        );
    }

    public function test_no_candidate_moves_the_delivery_to_the_manual_board_without_a_rider_ping(): void
    {
        // Reconciled 2026-11-07 (AGENTS.md §12; docs/dispatch-escalation-plan.md, approved): with no MySQL or
        // radar candidate a food delivery is published on the manual board
        // (every eligible rider can see and accept it) instead of a blind
        // ping + retry. Never a dead end.
        $business = $this->makeBusiness('Ping Nobody');
        $this->bypassLiveBridge([]); // no MySQL riders, no radar riders

        $delivery = $this->dispatchCheckout($business);

        $delivery->refresh();
        $this->assertSame('waiting_for_rider', $delivery->dispatch_status);
        $this->assertSame('manual', $delivery->dispatch_phase);
        $this->assertNull($delivery->dispatch_retry_at);
        $this->assertSame(0, BookingDispatchLog::where('delivery_id', $delivery->id)->count());
        $this->assertSame(0, $this->dispatchBridgePosts()->count(), 'No targeted rider exists, so no rider ping is sent.');
    }
}