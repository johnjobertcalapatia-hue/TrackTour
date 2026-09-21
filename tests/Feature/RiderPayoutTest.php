<?php

namespace Tests\Feature;

use App\Exceptions\PayoutConflictException;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderEarning;
use App\Models\RiderPayout;
use App\Models\User;
use App\Services\RiderPayoutService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * P8 — Rider Payouts.
 *
 * Rider-initiated payouts against the earnings ledger. The UNIQUE pivot
 * (rider_earning_id) is the idempotency barrier: an earning locked into a
 * pending/approved/paid payout can never be drawn again — the same peso is
 * never paid out twice. Rejected and cancelled payouts release their earnings.
 *
 * COD-sourced and prepaid-sourced earnings are equally drawable; the rider's
 * credit wallet (rider_credits) is a SEPARATE financing ledger and is never
 * touched by a payout.
 */
class RiderPayoutTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $rider;
    private User $admin;
    private Business $business;
    private RiderPayoutService $service;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::factory()->create([
            'role' => User::ROLE_BUSINESS_OWNER,
            'account_status' => 'approved',
        ]);

        $this->rider = User::factory()->create([
            'role' => User::ROLE_RIDER,
            'account_status' => 'approved',
        ]);

        $this->admin = User::factory()->create([
            'role' => User::ROLE_TOURISM_OFFICE,
        ]);

        $this->service = app(RiderPayoutService::class);

        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
            'latitude' => 12.5,
            'longitude' => 121.3,
        ]);

        $allDays = array_fill_keys(
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
            [['open' => '00:00', 'close' => '23:59']]
        );

        $this->business = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Payout Test Eatery',
            'status' => 'approved',
            'force_closed' => false,
            'business_hours' => $allDays,
            'latitude' => 12.51,
            'longitude' => 121.31,
        ]);
    }

    private function makeOrder(): Order
    {
        return Order::create([
            'order_number' => 'ORD-' . Str::upper(Str::random(8)),
            'business_id' => $this->business->id,
            'customer_name' => 'Customer',
            'customer_email' => 'cust@example.com',
            'customer_phone' => '09171234567',
            'order_type' => 'delivery',
            'payment_method' => 'gcash',
            'payment_status' => 'paid',
            'status' => 'completed',
            'subtotal' => 300,
            'delivery_fee' => 40,
            'rider_tip' => 0,
            'system_fee' => 0,
            'rider_financed_amount' => 300,
            'total' => 340,
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'delivery_address' => '123 Test St',
        ]);
    }

    private function makeEarning(float $amount, float $tip = 0.0): RiderEarning
    {
        $order = $this->makeOrder();

        return RiderEarning::create([
            'rider_id' => $this->rider->id,
            'order_id' => $order->id,
            'delivery_fee' => $amount,
            'rider_tip' => $tip,
            'total_earning' => round($amount + $tip, 2),
            'status' => 'earned',
            'earned_at' => now(),
        ]);
    }

    public function test_available_earnings_are_earned_and_unlocked(): void
    {
        $this->makeEarning(80.0);
        // NOT earned → excluded
        $order = $this->makeOrder();
        RiderEarning::create([
            'rider_id' => $this->rider->id,
            'order_id' => $order->id,
            'delivery_fee' => 200.0,
            'rider_tip' => 0,
            'total_earning' => 200.0,
            'status' => 'pending',
        ]);

        $available = $this->service->getAvailableEarnings($this->rider->id);

        $this->assertCount(1, $available['earnings']);
        $this->assertEquals(80.0, $available['total']);
        $this->assertTrue($available['payable']);
    }

    public function test_rider_requests_payout_locks_earnings(): void
    {
        $this->makeEarning(50.0);
        $this->makeEarning(30.0); // COD-sourced earning payable like prepaid

        $payout = $this->service->requestPayout($this->rider);

        $this->assertSame(RiderPayout::STATUS_PENDING, $payout->status);
        $this->assertEquals(80.0, $payout->amount);
        $this->assertCount(2, $payout->earnings);

        // After the request both earnings are locked → nothing available.
        $available = $this->service->getAvailableEarnings($this->rider->id);
        $this->assertCount(0, $available['earnings']);
    }

    public function test_earnings_cannot_be_double_drawn_after_payout(): void
    {
        $this->makeEarning(100.0);
        $this->service->requestPayout($this->rider);

        $available = $this->service->getAvailableEarnings($this->rider->id);
        $this->assertCount(0, $available['earnings'], 'Locked earnings must never reappear as available.');

        // A second rider payout would have nothing to include.
        $this->assertFalse($available['payable']);
    }

    public function test_admin_approve_then_mark_paid_locks_earnings_forever(): void
    {
        $this->makeEarning(120.0);
        $payout = $this->service->requestPayout($this->rider);

        $approved = $this->service->approve($payout, $this->admin);
        $this->assertSame(RiderPayout::STATUS_APPROVED, $approved->status);

        $paid = $this->service->markPaid($approved, $this->admin);
        $this->assertSame(RiderPayout::STATUS_PAID, $paid->status);

        // Paid earnings stay locked forever.
        $this->assertCount(0, $this->service->getAvailableEarnings($this->rider->id)['earnings']);
    }

    public function test_reject_releases_earnings_back_to_available(): void
    {
        $this->makeEarning(90.0);
        $payout = $this->service->requestPayout($this->rider);

        $rejected = $this->service->reject($payout, $this->admin);
        $this->assertSame(RiderPayout::STATUS_REJECTED, $rejected->status);

        // Earnings released → available again.
        $available = $this->service->getAvailableEarnings($this->rider->id);
        $this->assertCount(1, $available['earnings']);
        $this->assertEquals(90.0, $available['total']);
    }

    public function test_cancel_releases_earnings(): void
    {
        $this->makeEarning(45.0);
        $payout = $this->service->requestPayout($this->rider);

        $cancelled = $this->service->cancel($payout);
        $this->assertSame(RiderPayout::STATUS_CANCELLED, $cancelled->status);

        $this->assertCount(1, $this->service->getAvailableEarnings($this->rider->id)['earnings']);
    }

    public function test_request_with_no_available_earnings_throws(): void
    {
        $this->expectException(PayoutConflictException::class);

        $this->service->requestPayout($this->rider);
    }
}