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
use App\Services\SmartDispatchService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * P4 core dispatch rule: a rider may be offered many deliveries but can hold
 * only ONE active delivery at a time. Accepting an offer must:
 *   - assign that delivery to the rider,
 *   - withdraw the rider's other outstanding offers (response = cancelled),
 *   - re-offer those deliveries to the next available rider,
 *   - reject any attempt to accept a second delivery while one is active.
 *
 * NearestRiderService is partially mocked because the nearest-rider SQL is
 * SQLite-unsafe; the mock reproduces canonical offer creation so the real
 * handleRiderResponse logic (the rule under test) runs unmocked.
 */
class OneActiveDeliveryTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private NearestRiderService $service;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner-one-active@example.com',
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

        $this->service = app(NearestRiderService::class);
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
            'total_credits' => 10000,
            'reserved_credits' => 0,
            'minimum_reserve' => 200,
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

    private function makeDelivery(Order $order, array $overrides = []): Delivery
    {
        app(SmartDispatchService::class)->scheduleDispatch($order->fresh());

        $delivery = $order->fresh()->delivery;
        $this->assertNotNull($delivery, 'scheduleDispatch created the delivery.');

        $delivery->update(array_merge([
            'status' => 'waiting',
            'scheduled_at' => null,
            'dispatch_status' => 'notified',
            'dispatch_expires_at' => now()->addSeconds(120),
        ], $overrides));

        return $delivery->fresh();
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

    // ---------- tests ----------

    public function test_accepting_one_offer_assigns_it_and_withdraws_rider_other_offers(): void
    {
        $business = $this->makeBusiness('One Active A');
        $riderX = $this->makeRider('riderx-a@example.com');
        $riderY = $this->makeRider('ridery-a@example.com');

        $deliveryA = $this->makeDelivery($this->makeOrder($business));
        $deliveryB = $this->makeDelivery($this->makeOrder($business));

        $this->makePendingOffer($deliveryA, $riderX);
        $this->makePendingOffer($deliveryB, $riderX);

        $result = $this->service->handleRiderResponse($deliveryA->id, $riderX->id, 'accepted');

        $this->assertTrue($result['success'], 'First accept succeeds.');
        $this->assertSame(\App\Enums\TripStatus::ASSIGNED, $deliveryA->fresh()->status);
        $this->assertSame($riderX->id, $deliveryA->fresh()->rider_id);
        $this->assertSame('busy', $riderX->fresh()->riderDetail->rider_status);

        // The rider's other outstanding offer is withdrawn.
        $logB = BookingDispatchLog::where('delivery_id', $deliveryB->id)
            ->where('rider_id', $riderX->id)->first();
        $this->assertSame('cancelled', $logB->response);

        // ...and that delivery is re-offered to the next available rider.
        $this->assertNull($deliveryB->fresh()->rider_id);
        $this->assertTrue(BookingDispatchLog::where('delivery_id', $deliveryB->id)
            ->where('rider_id', $riderY->id)
            ->where('response', 'pending')->exists());
    }

    public function test_rider_with_an_active_delivery_cannot_accept_another(): void
    {
        $business = $this->makeBusiness('One Active B');
        $riderX = $this->makeRider('riderx-b@example.com');
        $riderY = $this->makeRider('ridery-b@example.com');

        $this->makeDelivery($this->makeOrder($business), [
            'status' => 'assigned',
            'rider_id' => $riderX->id,
            'assigned_at' => now(),
            'dispatch_status' => null,
            'dispatch_expires_at' => null,
        ]);

        $deliveryB = $this->makeDelivery($this->makeOrder($business));
        $this->makePendingOffer($deliveryB, $riderX);

        $result = $this->service->handleRiderResponse($deliveryB->id, $riderX->id, 'accepted');

        $this->assertFalse($result['success']);
        $this->assertTrue($result['already_active']);
        $this->assertStringContainsString('already have an active delivery', $result['message']);

        $this->assertNull($deliveryB->fresh()->rider_id);
        $this->assertSame('declined', BookingDispatchLog::where('delivery_id', $deliveryB->id)
            ->where('rider_id', $riderX->id)->first()->response);

        // Still exactly one active delivery for the rider.
        $this->assertSame(1, Delivery::where('rider_id', $riderX->id)
            ->whereIn('status', NearestRiderService::COD_ACTIVE_STATUSES)->count());

        // The rejected delivery is re-offered to the other rider.
        $this->assertTrue(BookingDispatchLog::where('delivery_id', $deliveryB->id)
            ->where('rider_id', $riderY->id)
            ->where('response', 'pending')->exists());
    }

    public function test_simultaneous_accepts_leave_only_one_active_delivery(): void
    {
        $business = $this->makeBusiness('One Active C');
        $riderX = $this->makeRider('riderx-c@example.com');

        $deliveryA = $this->makeDelivery($this->makeOrder($business));
        $deliveryB = $this->makeDelivery($this->makeOrder($business));

        $this->makePendingOffer($deliveryA, $riderX);
        $this->makePendingOffer($deliveryB, $riderX);

        // Fire both accepts in the same tick, before either is completed.
        $resultA = $this->service->handleRiderResponse($deliveryA->id, $riderX->id, 'accepted');
        $resultB = $this->service->handleRiderResponse($deliveryB->id, $riderX->id, 'accepted');

        $this->assertTrue($resultA['success']);
        $this->assertFalse($resultB['success']);

        $this->assertSame(1, Delivery::where('rider_id', $riderX->id)->count());
        $this->assertSame(1, Delivery::where('rider_id', $riderX->id)
            ->whereIn('status', NearestRiderService::COD_ACTIVE_STATUSES)->count());
    }
}
