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
use App\Services\OrderSizeClassifier;
use App\Services\SmartDispatchService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * P5.2 (rescoped): Basic Order Size & Dispatch Eligibility.
 *
 * This is a lightweight, quantity-based normal/large tag. It is flag-only:
 * large orders are surfaced for operational review but are still dispatched
 * normally. The one-active-delivery rule remains the only hard dispatch
 * constraint (covered separately by OneActiveDeliveryTest).
 */
class OrderSizeDispatchEligibilityTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner-size@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);
    }

    // ---------- helpers ----------

    private function makeBusiness(string $name): Business
    {
        $category = BusinessCategory::firstOrCreate(['name' => 'Restaurant']);
        $municipality = Municipality::firstOrCreate(
            ['name' => 'Bansud'],
            ['district' => '1st', 'province' => 'Oriental Mindoro', 'latitude' => 12.5, 'longitude' => 121.3]
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

    /**
     * @param  array<int, array{quantity:int, status?:string, cancelled_quantity?:int}>  $lines
     */
    private function addItems(Order $order, array $lines): void
    {
        foreach ($lines as $line) {
            $order->items()->create([
                'offering_id' => null,
                'product_name' => 'Item',
                'quantity' => $line['quantity'],
                'unit_price' => 100,
                'subtotal' => 100 * $line['quantity'],
                'status' => $line['status'] ?? 'pending',
                'cancelled_quantity' => $line['cancelled_quantity'] ?? 0,
            ]);
        }
    }

    private function makeRider(string $email = 'rider-size@example.com'): User
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

        return $rider;
    }

    // ---------- classification ----------

    public function test_normal_order_is_classified_normal(): void
    {
        $order = $this->makeOrder($this->makeBusiness('Size Normal'));
        $this->addItems($order, [
            ['quantity' => 2],
            ['quantity' => 1],
        ]);

        $classifier = app(OrderSizeClassifier::class);

        $this->assertSame(OrderSizeClassifier::NORMAL, $classifier->classify($order));
        $this->assertFalse($classifier->isLarge($order));
        $this->assertSame('normal', $order->fresh()->size_class);
    }

    public function test_order_reaching_quantity_threshold_is_large(): void
    {
        $order = $this->makeOrder($this->makeBusiness('Size Qty'));
        $this->addItems($order, [['quantity' => 12]]);

        $classifier = app(OrderSizeClassifier::class);

        $this->assertSame(OrderSizeClassifier::LARGE, $classifier->classify($order));
        $this->assertTrue($classifier->isLarge($order));
        $this->assertSame('large', $order->fresh()->size_class, 'The tag is persisted on the order.');
    }

    public function test_order_reaching_line_item_threshold_is_large(): void
    {
        $order = $this->makeOrder($this->makeBusiness('Size Lines'));
        $this->addItems($order, array_fill(0, 6, ['quantity' => 1]));

        $classifier = app(OrderSizeClassifier::class);

        $this->assertSame(OrderSizeClassifier::LARGE, $classifier->classify($order));
        $this->assertSame('large', $order->fresh()->size_class);
    }

    public function test_rejected_items_and_cancelled_quantity_are_excluded(): void
    {
        $cancelled = $this->makeOrder($this->makeBusiness('Size Cancelled'));
        $this->addItems($cancelled, [['quantity' => 12, 'cancelled_quantity' => 12]]);

        $rejected = $this->makeOrder($this->makeBusiness('Size Rejected'));
        $this->addItems($rejected, [
            ['quantity' => 12, 'status' => 'rejected'],
            ['quantity' => 1],
        ]);

        $classifier = app(OrderSizeClassifier::class);

        $this->assertSame(OrderSizeClassifier::NORMAL, $classifier->classify($cancelled));
        $this->assertSame(OrderSizeClassifier::NORMAL, $classifier->classify($rejected));
        $this->assertSame('normal', $cancelled->fresh()->size_class);
        $this->assertSame('normal', $rejected->fresh()->size_class);
    }

    public function test_thresholds_are_configurable(): void
    {
        $order = $this->makeOrder($this->makeBusiness('Size Config'));
        $this->addItems($order, [['quantity' => 5]]);

        $classifier = app(OrderSizeClassifier::class);

        config(['delivery.order_size.large_item_quantity' => 5]);
        $this->assertSame(OrderSizeClassifier::LARGE, $classifier->classify($order));

        config(['delivery.order_size.large_item_quantity' => 50]);
        $this->assertSame(OrderSizeClassifier::NORMAL, $classifier->classify($order));
    }

    public function test_size_class_reverts_to_normal_when_order_shrinks(): void
    {
        $order = $this->makeOrder($this->makeBusiness('Size Shrink'));
        $this->addItems($order, [['quantity' => 12]]);

        $this->assertSame('large', $order->fresh()->size_class);

        $item = $order->items()->first();
        $item->update(['cancelled_quantity' => 12]);

        $this->assertSame('normal', $order->fresh()->size_class);
    }

    public function test_orders_are_classified_independently(): void
    {
        $small = $this->makeOrder($this->makeBusiness('Size Independent A'));
        $this->addItems($small, [['quantity' => 2]]);

        $big = $this->makeOrder($this->makeBusiness('Size Independent B'));
        $this->addItems($big, [['quantity' => 20]]);

        $this->assertSame('normal', $small->fresh()->size_class);
        $this->assertSame('large', $big->fresh()->size_class);
    }

    // ---------- dispatch eligibility (flag-only) ----------

    public function test_large_order_is_flagged_but_still_dispatchable(): void
    {
        $business = $this->makeBusiness('Size Dispatch');
        $order = $this->makeOrder($business);
        $this->addItems($order, [['quantity' => 15]]);

        $eligibility = app(OrderSizeClassifier::class)->dispatchEligibility($order);

        $this->assertSame(OrderSizeClassifier::LARGE, $eligibility['size_class']);
        $this->assertTrue($eligibility['requires_review']);
        $this->assertTrue($eligibility['dispatchable'], 'Flag-only: large orders remain dispatchable.');
    }

    public function test_large_order_still_flows_through_real_dispatch(): void
    {
        Http::fake();

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
        });

        $business = $this->makeBusiness('Size Real Dispatch');
        $rider = $this->makeRider();
        $order = $this->makeOrder($business);
        $this->addItems($order, [['quantity' => 15]]);

        app(SmartDispatchService::class)->scheduleDispatch($order->fresh());
        $delivery = $order->fresh()->delivery;
        $this->assertNotNull($delivery);

        $delivery->update([
            'pickup_latitude' => $business->latitude,
            'pickup_longitude' => $business->longitude,
        ]);

        $assigned = app(NearestRiderService::class)->dispatchToNearest($delivery->fresh(), 'food');

        $this->assertNotNull($assigned, 'A large order is still offered to a rider.');
        $this->assertSame($rider->id, $assigned->id);
        $this->assertTrue(BookingDispatchLog::where('delivery_id', $delivery->id)
            ->where('rider_id', $rider->id)
            ->where('response', 'pending')->exists());
        $this->assertSame('notified', $delivery->fresh()->dispatch_status);
        $this->assertSame('large', $order->fresh()->size_class);
    }
}
