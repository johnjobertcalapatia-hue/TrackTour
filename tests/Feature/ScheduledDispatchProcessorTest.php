<?php

namespace Tests\Feature;

use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderCredit;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\NearestRiderService;
use App\Services\ScheduledDispatchProcessor;
use App\Services\SmartDispatchService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * P2 scheduled dispatch processor: due scheduled deliveries are handed to the
 * EXISTING dispatch pipeline (canonical offer via NearestRiderService), with an
 * atomic per-delivery claim so overlapping scheduler runs never double-offer,
 * and a retry policy when no rider is available.
 *
 * NearestRiderService is partially mocked (nearest-rider SQL is SQLite-unsafe);
 * the mock reproduces the canonical dispatchToNearest behavior (eligibility +
 * offer creation) so the processor is tested against the real contract.
 */
class ScheduledDispatchProcessorTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private ScheduledDispatchProcessor $processor;

    protected function setUp(): void
    {
        parent::setUp();

        config(['delivery.scheduler.max_retries' => 3]);
        config(['delivery.scheduler.retry_after_minutes' => 5]);
        config(['delivery.scheduler.claim_timeout_minutes' => 5]);

        $this->owner = User::create([
            'email' => 'owner-sched@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->app->instance(NearestRiderService::class, new class(app(\App\Services\FirebaseService::class)) extends NearestRiderService {
            public function __construct($firebase)
            {
                parent::__construct($firebase);
            }

            public function findNearestAvailableRiders(float $pickupLat, float $pickupLng, string $serviceType = 'food', int $limit = 5, ?int $municipalityId = null): Collection
            {
                return User::where('role', User::ROLE_RIDER)
                    ->where('account_status', User::ACCOUNT_STATUS_APPROVED)
                    ->whereHas('riderDetail', fn ($q) => $q
                        ->whereIn('rider_status', [User::RIDER_STATUS_ONLINE, User::RIDER_STATUS_AVAILABLE])
                        ->where('current_service', $serviceType))
                    ->with(['locations' => fn ($q) => $q->latest('recorded_at')->limit(1)])
                    ->get()
                    ->each(fn ($u) => $u->setAttribute('distance_km', 1.5))
                    ->sortBy('id')
                    ->values();
            }

            public function dispatchToNearest(Delivery $delivery, string $serviceType = 'food', ?int $municipalityId = null): ?User
            {
                $order = $delivery->order;
                $isCod = strtolower((string) ($order?->payment_method ?? '')) === 'cash';
                $requiredCredit = (float) ($order?->rider_financed_amount ?? $order?->subtotal ?? 0);

                $riders = User::where('role', User::ROLE_RIDER)
                    ->where('account_status', User::ACCOUNT_STATUS_APPROVED)
                    ->whereHas('riderDetail', fn ($q) => $q
                        ->where('rider_status', User::RIDER_STATUS_AVAILABLE)
                        ->where('current_service', $serviceType))
                    ->with(['locations' => fn ($q) => $q->latest('recorded_at')->limit(1)])
                    ->get()
                    ->filter(function (User $rider) use ($isCod, $requiredCredit) {
                        $location = $rider->locations->first();
                        if (! $location?->latitude || ! $location?->longitude) {
                            return false;
                        }
                        if ($isCod && ! $this->mockCodCreditEligible($rider, $requiredCredit)) {
                            return false;
                        }
                        return true;
                    })
                    ->sortBy('id');

                foreach ($riders as $rider) {
                    $alreadyOffered = BookingDispatchLog::where('delivery_id', $delivery->id)
                        ->where('rider_id', $rider->id)
                        ->exists();
                    if ($alreadyOffered) {
                        continue;
                    }

                    BookingDispatchLog::create([
                        'delivery_id' => $delivery->id,
                        'rider_id' => $rider->id,
                        'distance_km' => 1.5,
                        'response' => 'pending',
                        'dispatched_at' => now(),
                    ]);

                    $delivery->update([
                        'dispatch_status' => 'notified',
                        'dispatch_expires_at' => now()->addSeconds(self::DISPATCH_TIMEOUT_SECONDS),
                    ]);

                    return $rider;
                }

                $delivery->update(['dispatch_status' => 'no_rider_available']);

                return null;
            }

            private function mockCodCreditEligible(User $rider, float $requiredCredit): bool
            {
                $detail = $rider->riderDetail;
                if (! $detail) {
                    return false;
                }

                $usable = app(\App\Services\RiderCreditService::class)->getUsableCredits($rider->id);
                $activeLimit = (int) ($detail->active_order_limit ?: config('delivery.cod_active_order_limit', 2));
                $activeOrders = Delivery::where('rider_id', $rider->id)
                    ->whereIn('status', NearestRiderService::COD_ACTIVE_STATUSES)
                    ->count();

                return $usable >= $requiredCredit && $activeOrders < $activeLimit;
            }
        });

        $this->processor = app(ScheduledDispatchProcessor::class);
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

    private function makeRider(string $email, float $totalCredits = 10000, float $minReserve = 200): User
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

        RiderLocation::create([
            'rider_id' => $rider->id,
            'latitude' => 12.51,
            'longitude' => 121.31,
            'recorded_at' => now(),
        ]);

        RiderCredit::create([
            'rider_id' => $rider->id,
            'total_credits' => $totalCredits,
            'reserved_credits' => 0,
            'minimum_reserve' => $minReserve,
        ]);

        return $rider;
    }

    private function makeOrder(Business $business, array $overrides = []): Order
    {
        $paymentMethod = $overrides['payment_method'] ?? 'gcash';
        $subtotal = (float) ($overrides['subtotal'] ?? 300);

        return Order::create([
            'order_number' => 'ORD-' . Str::upper(Str::random(8)),
            'business_id' => $business->id,
            'customer_name' => 'Customer',
            'customer_email' => 'cust@example.com',
            'customer_phone' => '09171234567',
            'order_type' => 'delivery',
            'payment_method' => $paymentMethod,
            'payment_status' => $paymentMethod === 'cash' ? 'pending' : 'paid',
            'status' => $overrides['status'] ?? 'preparing',
            'subtotal' => $subtotal,
            'delivery_fee' => 40,
            'rider_tip' => 0,
            'system_fee' => $overrides['system_fee'] ?? 0,
            'rider_financed_amount' => (float) ($overrides['rider_financed_amount'] ?? $subtotal),
            'total' => $subtotal + 40,
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'delivery_address' => '123 Test St',
            'predicted_ready_at' => now()->addMinutes(15),
            'predicted_preparation_seconds' => 900,
            'acceptance_started_at' => now()->subMinutes(30),
            'accepted_at' => now()->subMinutes(20),
        ]);
    }

    private function makeScheduledDelivery(Order $order, ?Carbon $scheduledAt = null, bool $due = true): Delivery
    {
        app(SmartDispatchService::class)->scheduleDispatch($order->fresh());

        $delivery = $order->fresh()->delivery;
        $this->assertNotNull($delivery, 'scheduleDispatch created the delivery.');

        $delivery->update([
            'scheduled_at' => $scheduledAt ?? ($due ? now()->subMinute() : now()->addHour()),
            'dispatch_status' => 'scheduled',
        ]);

        return $delivery;
    }

    // ---------- tests ----------

    public function test_due_delivery_is_dispatched_and_offer_created(): void
    {
        $business = $this->makeBusiness('Sched A');
        $rider = $this->makeRider('riderA-sched@example.com');
        $order = $this->makeOrder($business);
        $delivery = $this->makeScheduledDelivery($order, now()->subMinute());

        $this->artisan('schedule:dispatch')
            ->expectsOutputToContain('Processed 1 due scheduled delivery(ies).')
            ->assertExitCode(0);

        $delivery->refresh();
        $this->assertSame('notified', $delivery->dispatch_status);
        $this->assertEquals(1, $delivery->dispatch_attempts);
        $this->assertNotNull($delivery->dispatch_expires_at);

        $log = BookingDispatchLog::where('delivery_id', $delivery->id)
            ->where('response', 'pending')->first();
        $this->assertNotNull($log, 'A rider offer (BookingDispatchLog) was created.');
        $this->assertSame($rider->id, $log->rider_id);
    }

    public function test_future_delivery_remains_scheduled(): void
    {
        $business = $this->makeBusiness('Sched B');
        $this->makeRider('riderB-sched@example.com');
        $order = $this->makeOrder($business);
        $delivery = $this->makeScheduledDelivery($order, now()->addHour(), false);

        $this->assertSame(0, $this->processor->process());

        $delivery->refresh();
        $this->assertSame('scheduled', $delivery->dispatch_status);
        $this->assertEquals(0, $delivery->dispatch_attempts);
        $this->assertSame(0, BookingDispatchLog::where('delivery_id', $delivery->id)->count());
    }

    public function test_processor_does_not_dispatch_the_same_delivery_twice(): void
    {
        $business = $this->makeBusiness('Sched C');
        $rider = $this->makeRider('riderC-sched@example.com');
        $order = $this->makeOrder($business);
        $delivery = $this->makeScheduledDelivery($order, now()->subMinute());

        $this->assertSame(1, $this->processor->process());
        $this->assertSame(0, $this->processor->process());

        $delivery->refresh();
        $this->assertSame('notified', $delivery->dispatch_status);
        $this->assertEquals(1, $delivery->dispatch_attempts);
        $this->assertSame(1, BookingDispatchLog::where('delivery_id', $delivery->id)->count());
        $this->assertSame($rider->id, BookingDispatchLog::where('delivery_id', $delivery->id)->first()->rider_id);
    }

    public function test_no_eligible_rider_retries_then_marks_failed(): void
    {
        $business = $this->makeBusiness('Sched D');
        $order = $this->makeOrder($business); // No riders exist.
        $delivery = $this->makeScheduledDelivery($order, now()->subMinute());

        // Attempt 1: no rider -> retry scheduled.
        $this->assertSame(1, $this->processor->process());
        $delivery->refresh();
        $this->assertSame('scheduled', $delivery->dispatch_status);
        $this->assertEquals(1, $delivery->dispatch_attempts);
        $this->assertNotNull($delivery->dispatch_retry_at);
        $this->assertTrue($delivery->dispatch_retry_at->isFuture());
        $this->assertSame(0, BookingDispatchLog::where('delivery_id', $delivery->id)->count());

        // Retry gate: a run before retry_at is skipped.
        $this->assertSame(0, $this->processor->process());
        $delivery->refresh();
        $this->assertEquals(1, $delivery->dispatch_attempts);

        // Attempts 2..4 happen once retry_at is reached.
        foreach ([2, 3, 4] as $expectedAttempts) {
            DB::table('deliveries')->where('id', $delivery->id)
                ->update(['dispatch_retry_at' => now()->subMinute()]);

            $this->assertSame(1, $this->processor->process());
            $delivery->refresh();
            $this->assertEquals($expectedAttempts, $delivery->dispatch_attempts);
        }

        $this->assertSame('dispatch_failed', $delivery->dispatch_status);
        $this->assertNotNull($delivery->dispatch_failed_at);
        $this->assertSame(0, BookingDispatchLog::where('delivery_id', $delivery->id)->count());
    }

    public function test_cod_rider_with_insufficient_credit_is_excluded(): void
    {
        $business = $this->makeBusiness('Sched E');
        $poorRider = $this->makeRider('poor-sched@example.com', 100, 500); // usable 0.
        $richRider = $this->makeRider('rich-sched@example.com', 10000, 200); // usable 9800.
        $order = $this->makeOrder($business, ['payment_method' => 'cash', 'rider_financed_amount' => 300.00]);
        $delivery = $this->makeScheduledDelivery($order, now()->subMinute());

        $this->assertSame(1, $this->processor->process());

        $delivery->refresh();
        $this->assertSame('notified', $delivery->dispatch_status);

        $logs = BookingDispatchLog::where('delivery_id', $delivery->id)->get();
        $this->assertCount(1, $logs, 'Only the credit-worthy rider receives the offer.');
        $this->assertSame($richRider->id, $logs->first()->rider_id);
        $this->assertSame(0, $logs->where('rider_id', $poorRider->id)->count());
    }

    public function test_multiple_due_deliveries_are_processed_independently(): void
    {
        $business = $this->makeBusiness('Sched F');
        $this->makeRider('riderF-sched@example.com');

        $deliveries = [];
        foreach (['O1', 'O2', 'O3'] as $tag) {
            $order = $this->makeOrder($business, ['order_number' => 'ORD-F' . $tag]);
            $deliveries[] = $this->makeScheduledDelivery($order, now()->subMinute());
        }

        $this->assertSame(3, $this->processor->process());

        foreach ($deliveries as $delivery) {
            $delivery->refresh();
            $this->assertSame('notified', $delivery->dispatch_status);
            $this->assertEquals(1, $delivery->dispatch_attempts);
            $this->assertSame(1, BookingDispatchLog::where('delivery_id', $delivery->id)->count());
        }
    }

    public function test_cancelled_restaurant_delivery_does_not_block_the_other(): void
    {
        $businessA = $this->makeBusiness('Sched G-A');
        $businessB = $this->makeBusiness('Sched G-B');
        $this->makeRider('riderG-sched@example.com');

        $cancelledOrder = $this->makeOrder($businessA, ['status' => 'cancelled']);
        $deliveryA = $this->makeScheduledDelivery($cancelledOrder, now()->subMinute());

        $readyOrder = $this->makeOrder($businessB);
        $deliveryB = $this->makeScheduledDelivery($readyOrder, now()->subMinute());

        $this->assertSame(1, $this->processor->process(), 'Only the eligible delivery is processed.');

        $deliveryA->refresh();
        $this->assertSame('scheduled', $deliveryA->dispatch_status, 'Cancelled sub-order untouched.');
        $this->assertEquals(0, $deliveryA->dispatch_attempts);
        $this->assertSame(0, BookingDispatchLog::where('delivery_id', $deliveryA->id)->count());

        $deliveryB->refresh();
        $this->assertSame('notified', $deliveryB->dispatch_status, 'Other sub-order dispatched independently.');
        $this->assertSame(1, BookingDispatchLog::where('delivery_id', $deliveryB->id)->count());
    }

    public function test_stale_dispatching_claim_is_recovered(): void
    {
        $business = $this->makeBusiness('Sched H');
        $rider = $this->makeRider('riderH-sched@example.com');
        $order = $this->makeOrder($business);
        $delivery = $this->makeScheduledDelivery($order, now()->subMinute());

        // Simulate a crashed worker holding the claim for 10 minutes without ever dispatching.
        DB::table('deliveries')->where('id', $delivery->id)->update([
            'dispatch_status' => 'dispatching',
            'updated_at' => now()->subMinutes(10),
        ]);

        $this->assertSame(1, $this->processor->process());

        $delivery->refresh();
        $this->assertSame('notified', $delivery->dispatch_status);
        $this->assertEquals(1, $delivery->dispatch_attempts);
        $this->assertSame($rider->id, BookingDispatchLog::where('delivery_id', $delivery->id)->first()->rider_id);
    }
}