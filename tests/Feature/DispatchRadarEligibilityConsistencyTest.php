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
use App\Services\SmartDispatchService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * B1 + B2 (master spec §10, §12–§14, §62–§63): eligibility consistency and
 * GPS freshness for the socket-radar fallback.
 *
 * B1 — the radar fallback previously applied a blanket getBusyRiderIds()
 * exclusion to EVERY delivery, while the primary COD query applies only the
 * configured active-order limit (cod_active_order_limit = 2). A rider with one
 * unsettled delivered COD therefore passed the primary path but was silently
 * dropped by the radar: inconsistent rules for the same rider (the verified
 * field failure — delivery #8 found 0 eligible riders).
 *
 * B2 (Option C) — MySQL rider_locations stays the persistent source with its
 * 5-minute freshness gate; the live socket radar serves as the freshness
 * SOURCE when the rider reported inside the 120-second radar window
 * (socket-validation.js LIMITS.radarStaleMs). Business eligibility rules stay
 * authoritative: a live radar entry never bypasses approved / available /
 * food-service / pickup-distance / active-order-limit gates, and a stale
 * radar entry is not trusted at all.
 *
 * Every test runs the REAL SmartDispatchService → NearestRiderService
 * checkout pipeline. Http::fake supplies the bridge /status radar payload, so
 * candidate selection is deterministic and SQLite-safe (COD candidate
 * filtering is Eloquent + PHP haversine).
 */
class DispatchRadarEligibilityConsistencyTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'delivery.scheduler.max_retries' => 3,
            'delivery.scheduler.retry_after_minutes' => 5,
            'delivery.scheduler.claim_timeout_minutes' => 5,
        ]);
    }

    // ---------- helpers ----------

    /** Serve the socket bridge /status payload (also answers POST /dispatch). */
    private function fakeRadar(array $entries): void
    {
        Http::fake([
            '*' => Http::response(['success' => true, 'onlineRiders' => $entries], 200),
        ]);
    }

    /**
     * Non-COD only: findNearestFromMySql() runs raw ACOS/COS/RADIANS distance
     * SQL that SQLite cannot execute (every existing non-COD test stubs this
     * method for the same reason). Returning nobody forces the REAL radar
     * fallback — which is exactly what the non-COD cases verify here (the
     * blanket one-active-delivery exclusion is preserved on the radar path).
     * COD cases are untouched: they use findNearestEligibleCodRiders(), the
     * pure-Eloquent query that runs on SQLite.
     */
    private function stubEmptyPrimaryRiderSearch(): void
    {
        $this->app->instance(NearestRiderService::class, new class() extends NearestRiderService {
            public function findNearestAvailableRiders(float $pickupLat, float $pickupLng, string $serviceType = 'food', int $limit = 5, ?int $municipalityId = null): Collection
            {
                return collect();
            }
        });
    }

    private function nowMs(): int
    {
        return (int) floor(microtime(true) * 1000);
    }

    /** A live radar entry at the pickup point (0 km from the business). */
    private function radarEntry(User $rider, ?int $updatedAtMs = null): array
    {
        return [
            'riderId' => $rider->id,
            'status' => 'available',
            'vehicleType' => 'food',
            'lat' => 12.51,
            'lng' => 121.31,
            'updatedAt' => $updatedAtMs ?? $this->nowMs(),
        ];
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
            ['email' => 'owner-radar@example.com'],
            [
                'password' => Hash::make('Password123!'),
                'role' => 'business_owner',
                'account_status' => 'approved',
            ]
        );
    }

    private function makeOrder(Business $business, string $paymentMethod = 'cash'): Order
    {
        return Order::create([
            'order_number' => 'ORD-' . Str::upper(Str::random(8)),
            'business_id' => $business->id,
            'customer_name' => 'Customer',
            'customer_email' => 'cust-radar@example.com',
            'customer_phone' => '09171234567',
            'order_type' => 'delivery',
            'payment_method' => $paymentMethod,
            'payment_status' => 'pending',
            'status' => 'waiting_restaurant',
            'subtotal' => 300,
            'delivery_fee' => 40,
            'rider_tip' => 0,
            'system_fee' => 0,
            'rider_financed_amount' => $paymentMethod === 'cash' ? 300 : 0,
            'total' => 340,
            'delivery_latitude' => 12.52,
            'delivery_longitude' => 121.32,
            'delivery_address' => '123 Test St',
        ]);
    }

    /**
     * Approved + 'available' + food-service rider. Location rows are opt-in:
     * with none (or a stale one) the primary MySQL COD query finds nobody and
     * the radar fallback is the only candidate source — exactly the field case.
     */
    private function makeRider(string $email, ?Business $locationAt = null, bool $staleLocation = false): User
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
                'recorded_at' => $staleLocation ? now()->subMinutes(10) : now(),
            ]);
        }

        return $rider;
    }

    /**
     * An existing delivery that counts toward the COD active-order limit only
     * when it is an in-road status, or delivered + cash_due + unsettled
     * (NearestRiderService::activeBindingsQuery).
     */
    private function makeBinding(User $rider, string $status, ?float $cashDue = null, bool $settled = false): Delivery
    {
        $order = $this->makeOrder(Business::firstOrFail());

        return Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $rider->id,
            'status' => $status,
            'delivery_fee' => 40,
            'distance_km' => 1.0,
            'cash_due' => $cashDue,
            'cash_settled_at' => $settled ? now() : null,
        ]);
    }

    /** Run the canonical checkout dispatch and return the delivery. */
    private function dispatchCheckout(Business $business, string $paymentMethod = 'cash'): Delivery
    {
        $order = $this->makeOrder($business, $paymentMethod);

        app(SmartDispatchService::class)->scheduleDispatch($order->fresh());

        $delivery = $order->fresh()->delivery;
        $this->assertNotNull($delivery, 'scheduleDispatch created the delivery.');

        return $delivery;
    }

    private function assertNotified(Delivery $delivery, User $rider): void
    {
        $delivery->refresh();
        $this->assertSame('notified', $delivery->dispatch_status);
        $this->assertNotNull($delivery->dispatch_expires_at);
        $this->assertNull($delivery->dispatch_retry_at);

        $this->assertTrue(
            BookingDispatchLog::where('delivery_id', $delivery->id)
                ->where('rider_id', $rider->id)
                ->where('response', 'pending')
                ->exists(),
            'The rider received a pending dispatch offer.'
        );
    }

    private function assertParked(Delivery $delivery): void
    {
        $delivery->refresh();
        $this->assertSame('no_rider_available', $delivery->dispatch_status);
        $this->assertNotNull($delivery->dispatch_retry_at, 'No candidate still parks with a retry — never a dead end.');
        $this->assertTrue($delivery->dispatch_retry_at->isFuture());
        $this->assertSame(0, BookingDispatchLog::where('delivery_id', $delivery->id)->count());
    }

    // ---------- B2: GPS freshness architecture (Option C) ----------

    public function test_live_radar_entry_is_trusted_when_mysql_location_is_stale(): void
    {
        $business = $this->makeBusiness('Radar Fresh');
        // Location row is 10 minutes old → primary COD query excludes (stale),
        // but the socket radar reported seconds ago → radar is the freshness source.
        $rider = $this->makeRider('radar-stale-db@example.com', $business, staleLocation: true);
        $this->fakeRadar([$this->radarEntry($rider)]);

        $delivery = $this->dispatchCheckout($business);

        $this->assertNotified($delivery, $rider);
    }

    public function test_live_radar_entry_is_trusted_when_mysql_location_is_missing(): void
    {
        $business = $this->makeBusiness('Radar NoDb');
        $rider = $this->makeRider('radar-no-db@example.com'); // no rider_locations row at all
        $this->fakeRadar([$this->radarEntry($rider)]);

        $delivery = $this->dispatchCheckout($business);

        $this->assertNotified($delivery, $rider);
    }

    public function test_stale_radar_entry_is_not_trusted_as_freshness_source(): void
    {
        $business = $this->makeBusiness('Radar Stale');
        $rider = $this->makeRider('radar-stale-radar@example.com'); // no MySQL location either
        // Last radar report was 10 minutes ago (> 120 s window) → not live.
        $this->fakeRadar([$this->radarEntry($rider, $this->nowMs() - 10 * 60 * 1000)]);

        $delivery = $this->dispatchCheckout($business);

        $this->assertParked($delivery);
    }

    // ---------- B1: radar uses the same COD active-order policy as primary ----------

    public function test_cod_rider_below_active_order_limit_with_unsettled_delivery_gets_radar_offer(): void
    {
        $business = $this->makeBusiness('Radar B1 Below');
        $rider = $this->makeRider('radar-b1-below@example.com'); // primary finds nobody (no location)
        // One unsettled delivered COD = 1 active binding, limit = 2 → eligible.
        $this->makeBinding($rider, 'delivered', cashDue: 100.00, settled: false);
        $this->fakeRadar([$this->radarEntry($rider)]);

        $delivery = $this->dispatchCheckout($business);

        $this->assertNotified(
            $delivery,
            $rider,
        );
    }

    public function test_cod_rider_at_active_order_limit_is_excluded_on_radar(): void
    {
        $business = $this->makeBusiness('Radar B1 At');
        $rider = $this->makeRider('radar-b1-at@example.com');
        $this->makeBinding($rider, 'delivered', cashDue: 100.00, settled: false);
        $this->makeBinding($rider, 'delivered', cashDue: 100.00, settled: false); // 2 = limit
        $this->fakeRadar([$this->radarEntry($rider)]);

        $delivery = $this->dispatchCheckout($business);

        $this->assertParked($delivery);
    }

    public function test_cod_rider_above_active_order_limit_is_excluded_on_radar(): void
    {
        $business = $this->makeBusiness('Radar B1 Above');
        $rider = $this->makeRider('radar-b1-above@example.com');
        $this->makeBinding($rider, 'delivered', cashDue: 100.00, settled: false);
        $this->makeBinding($rider, 'delivered', cashDue: 100.00, settled: false);
        $this->makeBinding($rider, 'in_transit'); // 3 > limit = 2
        $this->fakeRadar([$this->radarEntry($rider)]);

        $delivery = $this->dispatchCheckout($business);

        $this->assertParked($delivery);
    }

    public function test_cod_rider_at_limit_is_excluded_by_the_primary_mysql_path_too(): void
    {
        $business = $this->makeBusiness('Radar Primary At');
        // Fresh MySQL location → the primary COD query sees this rider first.
        $rider = $this->makeRider('radar-primary-at@example.com', $business);
        $this->makeBinding($rider, 'delivered', cashDue: 100.00, settled: false);
        $this->makeBinding($rider, 'delivered', cashDue: 100.00, settled: false); // at limit
        $this->fakeRadar([$this->radarEntry($rider)]);

        $delivery = $this->dispatchCheckout($business);

        // Primary excludes on the limit → radar fallback runs → must ALSO
        // exclude on the same limit (consistent rules on both paths).
        $this->assertParked($delivery);
    }

    public function test_cod_rider_with_terminal_unrelated_delivery_stays_radar_eligible(): void
    {
        $business = $this->makeBusiness('Radar Terminal');
        $rider = $this->makeRider('radar-terminal@example.com');
        // A cancelled delivery is NOT an active binding: stale/terminal history
        // must not block an otherwise eligible rider.
        $this->makeBinding($rider, 'cancelled');
        $this->fakeRadar([$this->radarEntry($rider)]);

        $delivery = $this->dispatchCheckout($business);

        $this->assertNotified($delivery, $rider);
    }

    // ---------- Preservation: non-COD keeps the one-active-delivery rule ----------

    public function test_non_cod_rider_with_active_delivery_is_still_excluded_from_radar(): void
    {
        $business = $this->makeBusiness('Radar NonCod Busy');
        $rider = $this->makeRider('radar-noncod-busy@example.com');
        $this->makeBinding($rider, 'assigned'); // one-active-delivery violation for non-COD
        $this->fakeRadar([$this->radarEntry($rider)]);
        $this->stubEmptyPrimaryRiderSearch();

        $delivery = $this->dispatchCheckout($business, paymentMethod: 'gcash');

        $this->assertParked($delivery);
    }

    public function test_non_cod_rider_without_active_delivery_can_receive_radar_offer(): void
    {
        $business = $this->makeBusiness('Radar NonCod Free');
        $rider = $this->makeRider('radar-noncod-free@example.com');
        $this->fakeRadar([$this->radarEntry($rider)]);
        $this->stubEmptyPrimaryRiderSearch();

        $delivery = $this->dispatchCheckout($business, paymentMethod: 'gcash');

        $this->assertNotified($delivery, $rider);
    }
}
