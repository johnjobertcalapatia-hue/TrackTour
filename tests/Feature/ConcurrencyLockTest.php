<?php

namespace Tests\Feature;

use App\Exceptions\PayoutConflictException;
use App\Http\Controllers\Rider\RiderDeliveryController;
use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderDetail;
use App\Models\RiderEarning;
use App\Models\RiderLocation;
use App\Models\RiderPayout;
use App\Models\User;
use App\Services\NearestRiderService;
use App\Services\RiderPayoutService;
use App\Services\SmartDispatchService;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * P9 — dispatch & concurrency locks.
 *
 * Every gap here used to be a read-then-write with no row lock and no schema
 * backstop. Each test now asserts the authoritative DB transition wins:
 *   1. two riders accepting the SAME prepaid delivery -> claimed exactly once
 *   2. one order can never have two delivery rows (UNIQUE + locked re-check)
 *   3. manual dispatchNow cannot double-offer against a pending wave
 *   4. a delivered/cancelled delivery cannot race into a second terminal state
 *   5. COD cash settlement is idempotent (single payment + single earning)
 *   6. a rider can only ever have ONE live payout request (clean 409)
 *   7. cancelDelivery is idempotent and honours terminal states
 */
class ConcurrencyLockTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $tourist;
    private NearestRiderService $dispatchService;
    private SmartDispatchService $smartDispatch;
    private RiderPayoutService $payoutService;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner-p9@example.com',
            'password' => \Illuminate\Support\Facades\Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->tourist = User::create([
            'email' => 'tourist-p9@example.com',
            'password' => \Illuminate\Support\Facades\Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->dispatchService = app(NearestRiderService::class);
        $this->smartDispatch = app(SmartDispatchService::class);
        $this->payoutService = app(RiderPayoutService::class);
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

    private function makeRider(string $email): User
    {
        $rider = User::create([
            'email' => $email,
            'password' => \Illuminate\Support\Facades\Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
        ]);

        RiderDetail::create([
            'user_id' => $rider->id,
            'rider_status' => 'available',
            'current_service' => 'food',
        ]);

        RiderLocation::create([
            'rider_id' => $rider->id,
            'latitude' => 12.51,
            'longitude' => 121.31,
            'recorded_at' => now(),
        ]);


        return $rider;
    }

    private function makeOrder(Business $business, string $paymentMethod = 'gcash', array $overrides = []): Order
    {
        return Order::create(array_merge([
            'order_number' => 'ORD-' . Str::upper(Str::random(8)),
            'business_id' => $business->id,
            'user_id' => $this->tourist->id,
            'customer_name' => 'Customer',
            'customer_email' => 'cust-p9@example.com',
            'customer_phone' => '09171234567',
            'order_type' => 'delivery',
            'payment_method' => $paymentMethod,
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
        ], $overrides));
    }

    private function makePendingOffer(Delivery $delivery, User $rider): BookingDispatchLog
    {
        return BookingDispatchLog::create([
            'delivery_id' => $delivery->id,
            'rider_id' => $rider->id,
            'distance_km' => 1.5,
            'response' => 'pending',
            'dispatched_at' => now(),
        ]);
    }

    private function makeEarning(User $rider, float $amount, float $tip = 0.0): RiderEarning
    {
        $order = $this->makeOrder($this->makeBusiness('Payout Eatery ' . Str::random(4)));

        return RiderEarning::create([
            'rider_id' => $rider->id,
            'order_id' => $order->id,
            'delivery_fee' => $amount,
            'rider_tip' => $tip,
            'total_earning' => round($amount + $tip, 2),
            'status' => 'earned',
            'earned_at' => now(),
        ]);
    }

    // ---------- seam 1: double-accept ----------

    public function test_two_riders_accepting_the_same_prepaid_delivery_claim_it_once(): void
    {
        $business = $this->makeBusiness('Double Accept Eatery');
        $riderX = $this->makeRider('riderx-p9@example.com');
        $riderY = $this->makeRider('ridery-p9@example.com');

        $order = $this->makeOrder($business, 'gcash');
        $this->smartDispatch->scheduleDispatch($order->fresh());
        $delivery = $order->fresh()->delivery;

        $delivery->update([
            'dispatch_status' => 'notified',
            'dispatch_expires_at' => now()->addSeconds(120),
        ]);

        $this->makePendingOffer($delivery->fresh(), $riderX);
        $this->makePendingOffer($delivery->fresh(), $riderY);

        $first = $this->dispatchService->handleRiderResponse($delivery->id, $riderX->id, 'accepted');
        $second = $this->dispatchService->handleRiderResponse($delivery->id, $riderY->id, 'accepted');

        $this->assertTrue($first['success'], 'Winner accept succeeds.');
        $this->assertSame($riderX->id, $delivery->fresh()->rider_id, 'Winner is assigned.');

        $this->assertFalse($second['success'], 'Loser accept fails.');
        // P11.8: the winner's claim immediately withdraws every other rider's
        // offer on the delivery, so a SEQUENTIALLY-timed loser accept surfaces
        // as an offer-gone conflict instead of 'already_assigned' (the
        // already_assigned branch still fires when two accepts genuinely
        // overlap on the delivery row lock). Both paths leave the delivery
        // bound to the winner exactly once.
        $this->assertTrue($second['conflict'] ?? false);
        $this->assertSame($riderX->id, $delivery->fresh()->rider_id, 'Loser never overwrites the winner.');

        $this->assertSame(1, Delivery::where('id', $delivery->id)->whereNotNull('rider_id')->count());
    }

    // ---------- seam 2: one delivery per order ----------

    public function test_schedule_dispatch_never_creates_two_deliveries_for_an_order(): void
    {
        $business = $this->makeBusiness('One Delivery Eatery');
        $order = $this->makeOrder($business);

        $this->smartDispatch->scheduleDispatch($order->fresh());
        $this->smartDispatch->scheduleDispatch($order->fresh());
        $this->smartDispatch->scheduleDispatch($order->fresh());

        $this->assertSame(1, Delivery::where('order_id', $order->id)->count());

        // The schema backstop rejects a hand-rolled second delivery outright.
        $this->expectException(UniqueConstraintViolationException::class);
        Delivery::create(['order_id' => $order->id, 'status' => 'waiting']);
    }

    // ---------- seam 3: manual dispatch can't double-offer ----------

    public function test_dispatch_now_never_creates_a_second_offer_wave(): void
    {
        $business = $this->makeBusiness('Dispatch Guard Eatery');
        $rider = $this->makeRider('riderz-p9@example.com');

        $order = $this->makeOrder($business);
        $this->smartDispatch->scheduleDispatch($order->fresh());
        $delivery = $order->fresh()->delivery;

        $spy = new class extends NearestRiderService {
            public int $calls = 0;
            public ?User $rider = null;

            public function __construct()
            {
            }

            public function dispatchToNearest(Delivery $delivery, string $serviceType = 'food', ?int $municipalityId = null): ?User
            {
                $this->calls++;

                // Mirror the real pipeline: once an offer is created the delivery
                // enters 'notified', so a second dispatchNow must be a no-op.
                $delivery->update([
                    'dispatch_status' => 'notified',
                    'dispatch_expires_at' => now()->addSeconds(NearestRiderService::DISPATCH_TIMEOUT_SECONDS),
                ]);

                return $this->rider;
            }
        };
        $spy->rider = $rider;
        $this->app->instance(NearestRiderService::class, $spy);
        $smart = app(SmartDispatchService::class);

        // Pending offer wave already out -> manual dispatch is a no-op.
        $delivery->update(['dispatch_status' => 'notified']);
        $smart->dispatchNow($order->fresh(), $delivery->fresh());
        $this->assertSame(0, $spy->calls, 'No second wave while an offer is pending.');

        // Back to scheduled (scheduler retried, no rider yet) -> manual dispatch may
        // claim it, exactly once.
        $delivery->update(['dispatch_status' => 'scheduled']);
        $smart->dispatchNow($order->fresh(), $delivery->fresh());
        $smart->dispatchNow($order->fresh(), $delivery->fresh());
        $this->assertSame(1, $spy->calls, 'Exactly one claim attempt after the wave was cleared.');
    }

    // ---------- seam 4: terminal-state racings ----------

    public function test_rider_cannot_mark_delivered_after_the_delivery_was_cancelled(): void
    {
        $business = $this->makeBusiness('Terminal Guard Eatery');
        $riderX = $this->makeRider('ridertg-p9@example.com');

        $order = $this->makeOrder($business, 'gcash');
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $riderX->id,
            'status' => 'arrived_destination',
            'pickup_address' => $business->business_name,
            'delivery_address' => $order->delivery_address,
        ]);

        // Auto-cancel / restaurant-cancel wins first.
        $this->dispatchService->cancelDelivery($delivery->fresh());

        $request = Request::create("/api/rider/deliveries/{$delivery->id}/status", 'PATCH', ['status' => 'delivered']);
        $request->setUserResolver(fn () => $riderX);

        $response = app(RiderDeliveryController::class)->updateStatus($request, $delivery->fresh());

        $this->assertSame(409, $response->getStatusCode());
        $this->assertSame('cancelled', $delivery->fresh()->status->value ?? $delivery->fresh()->status);
        $this->assertSame(0, RiderEarning::where('rider_id', $riderX->id)->where('order_id', $order->id)->count(),
            'A cancelled delivery must never record a rider earning.');
    }

    public function test_cancel_delivery_is_idempotent_and_honours_terminal_states(): void
    {
        $business = $this->makeBusiness('Cancel Eatery');
        $riderX = $this->makeRider('ridercan-p9@example.com');

        $order = $this->makeOrder($business);
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $riderX->id,
            'status' => 'arrived_destination',
            'pickup_address' => $business->business_name,
            'delivery_address' => $order->delivery_address,
        ]);

        $this->dispatchService->cancelDelivery($delivery->fresh());
        $this->assertSame('cancelled', $delivery->fresh()->status->value ?? $delivery->fresh()->status);

        // Cancelling an already-cancelled / completed delivery is a no-op.
        $this->dispatchService->cancelDelivery($delivery->fresh());
        $this->assertSame('cancelled', $delivery->fresh()->status->value ?? $delivery->fresh()->status);

        $this->dispatchService->completeDelivery($delivery->fresh()->load('order'));
        $this->assertSame('cancelled', $delivery->fresh()->status->value ?? $delivery->fresh()->status,
            'completeDelivery does not resurrect a cancelled delivery.');
    }

    // ---------- seam 5: COD settlement idempotency ----------

    public function test_cod_delivery_can_be_settled_only_once(): void
    {
        $business = $this->makeBusiness('COD Settle Eatery');
        $riderX = $this->makeRider('ridercod-p9@example.com');

        $order = $this->makeOrder($business, 'cash');
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $riderX->id,
            'status' => 'delivered',
            'cash_due' => $order->total,
            'pickup_address' => $business->business_name,
            'delivery_address' => $order->delivery_address,
        ]);

        $first = $this->dispatchService->settleCodDelivery($delivery->fresh()->load('order'), (float) $order->total);
        $this->assertTrue($first['success']);
        $this->assertSame('completed', $delivery->fresh()->status->value ?? $delivery->fresh()->status);

        $second = null;
        try {
            $this->dispatchService->settleCodDelivery($delivery->fresh()->load('order'), (float) $order->total);
        } catch (\InvalidArgumentException $e) {
            $second = $e;
        }

        $this->assertNotNull($second, 'A second settlement must be rejected.');
        $this->assertSame(1, Payment::where('payable_type', Order::class)->where('payable_id', $order->id)->count(),
            'Exactly one cash payment is recorded.');
        $this->assertSame(1, RiderEarning::where('rider_id', $riderX->id)->where('order_id', $order->id)->count(),
            'Exactly one earning is recorded.');
    }

    // ---------- seam 6: one live payout per rider ----------

    public function test_second_payout_request_is_rejected_while_one_is_live(): void
    {
        $rider = $this->makeRider('riderpay-p9@example.com');
        $this->makeEarning($rider, 60.0);
        $this->makeEarning($rider, 20.0);

        $payout = $this->payoutService->requestPayout($rider);
        $this->assertSame(RiderPayout::STATUS_PENDING, $payout->status);
        $this->assertEquals(80.0, $payout->amount);

        $rejected = null;
        try {
            $this->payoutService->requestPayout($rider);
        } catch (PayoutConflictException $e) {
            $rejected = $e;
        }

        $this->assertNotNull($rejected, 'A second live payout request must be a clean 409.');
        $this->assertStringContainsStringIgnoringCase('already have a payout', $rejected->getMessage());
        $this->assertSame(1, RiderPayout::where('rider_id', $rider->id)->whereIn('status', RiderPayout::LIVE_STATUSES)->count());

        // After the payout is cancelled the slot frees and earnings are released.
        $this->payoutService->cancel($payout->fresh());
        $second = $this->payoutService->requestPayout($rider);
        $this->assertSame(RiderPayout::STATUS_PENDING, $second->status);
        $this->assertEquals(80.0, $second->amount);
    }
}