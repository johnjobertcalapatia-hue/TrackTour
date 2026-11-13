<?php

namespace Tests\Feature;

use App\Http\Controllers\BusinessOwnerOrderController;
use App\Models\ActivityLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Refund;
use App\Models\TransactionEvent;
use App\Models\User;
use App\Services\Integrity\TransactionIntegrityService;
use App\Services\OrderRefundService;
use App\Services\PaymentRefundProcessor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Product-owner rule (2026-11-11), Stage 5: once a rider has accepted, the
 * order must be fulfilled — no restaurant rejection / cancellation, no
 * 60-minute auto-cancel, no refund; each refused attempt is escalated to the
 * Tourism Office. Plus the refund "requested" state and idempotency key.
 */
class AcceptedOrderRuleTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private User $tourist;

    private User $rider;

    private Business $business;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.paymongo.secret_key' => 'sk_test_rule', 'services.paymongo.webhook_secret' => '']);
        Http::fake(['api.paymongo.com/*' => Http::response(['data' => ['id' => 'ref_test_1', 'attributes' => ['status' => 'pending']]], 200)]);

        $this->owner = User::create(['name' => 'Owner', 'email' => 'owner@rule.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->tourist = User::create(['name' => 'Jayvie', 'email' => 'tourist@rule.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->rider = User::create(['name' => 'Aldrin', 'email' => 'rider@rule.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved']);
        $this->business = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => Municipality::create(['name' => 'Bansud', 'district' => '2nd', 'province' => 'Oriental Mindoro'])->id,
            'business_name' => 'Ekslusibo Grill',
            'status' => 'approved',
        ]);
    }

    /** A paid online delivery order; $accepted gives its delivery a rider. */
    private function order(bool $accepted, string $status = 'preparing', ?string $assignedAt = null): Order
    {
        $order = Order::create([
            'order_number' => 'TT-'.Str::upper(Str::random(6)),
            'business_id' => $this->business->id,
            'user_id' => $this->tourist->id,
            'customer_name' => 'Jayvie',
            'customer_email' => 'tourist@rule.test',
            'order_type' => 'delivery',
            'payment_method' => 'gcash',
            'payment_status' => 'paid',
            'status' => $status,
            'subtotal' => 300, 'delivery_fee' => 60, 'total' => 360,
        ]);
        OrderItem::create(['order_id' => $order->id, 'business_id' => $this->business->id, 'product_name' => 'Chicken Inasal', 'quantity' => 2, 'unit_price' => 150, 'subtotal' => 300, 'status' => 'preparing']);
        Payment::create([
            'payment_number' => 'PAY-'.Str::upper(Str::random(8)), 'payable_type' => Order::class, 'payable_id' => $order->id, 'user_id' => $this->tourist->id,
            'amount' => 360, 'currency' => 'PHP', 'method' => 'gcash', 'provider' => 'paymongo', 'provider_payment_id' => 'pay_'.Str::random(10), 'status' => 'paid', 'paid_at' => now(),
        ]);
        Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $accepted ? $this->rider->id : null,
            'status' => $accepted ? 'picked_up' : 'waiting',
            'assigned_at' => $accepted ? ($assignedAt ?? now()) : null,
            'pickup_address' => 'P', 'delivery_address' => 'D', 'rider_commission' => 60,
        ]);

        return $order->fresh();
    }

    private function escalations(Order $order, string $action): int
    {
        return ActivityLog::where('action', "escalation.{$action}")->where('model_type', Order::class)->where('model_id', $order->id)->count();
    }

    private function refundCalls(): int
    {
        return collect(Http::recorded())->filter(fn ($r) => str_contains($r[0]->url(), '/refunds'))->count();
    }

    // ---------------- restaurant rejection ----------------

    public function test_a_restaurant_cannot_cancel_an_accepted_order_and_the_attempt_is_escalated(): void
    {
        $order = $this->order(true);

        $this->actingAs($this->owner, 'sanctum')->patchJson("/api/business-owner/orders/{$order->id}/status", ['status' => 'cancelled'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'A rider has accepted this order, so it must be prepared and cannot be cancelled. The Tourism Office has been notified.');

        $this->assertSame('preparing', $order->fresh()->status);
        $this->assertSame(1, $this->escalations($order, 'restaurant_rejection_blocked'));
        $this->assertSame(0, $this->refundCalls());
        $result = app(TransactionIntegrityService::class)->verifyOrder($order);
        $flag = collect($result['checks'])->firstWhere('key', 'escalations');
        $this->assertFalse($flag['ok']);
        $this->assertSame('flag', $flag['severity']);
    }

    public function test_reject_order_and_reject_dish_are_refused_after_acceptance(): void
    {
        $order = $this->order(true, 'waiting_restaurant');
        $item = $order->items()->first();
        $this->actingAs($this->owner);
        $controller = app(BusinessOwnerOrderController::class);
        $request = Request::create('/', 'POST', ['reason' => 'Out of chicken']);
        $request->setUserResolver(fn () => $this->owner);

        $this->assertSame(422, $controller->rejectOrder($request, $order)->getStatusCode());
        $this->assertSame(422, $controller->rejectItem($request, $order, $item)->getStatusCode());

        $this->assertSame('waiting_restaurant', $order->fresh()->status);
        $this->assertSame('preparing', $item->fresh()->status);
        $this->assertSame(2, $this->escalations($order, 'restaurant_rejection_blocked'));
        $this->assertSame(0, $this->refundCalls());
    }

    // ---------------- late accepted orders ----------------

    public function test_a_late_accepted_order_is_flagged_once_and_never_cancelled_or_refunded(): void
    {
        $order = $this->order(true, 'preparing', now()->subHours(2)->toDateTimeString());

        $this->artisan('orders:auto-cancel-undelivered')->expectsOutputToContain('Flagged late accepted order')->assertSuccessful();
        $this->artisan('orders:auto-cancel-undelivered')->assertSuccessful();

        $this->assertSame('preparing', $order->fresh()->status);
        $this->assertSame('picked_up', Delivery::where('order_id', $order->id)->sole()->status->value);
        $this->assertSame(1, $this->escalations($order, 'late_after_acceptance'));
        $this->assertSame(0, $this->refundCalls());
        $this->assertSame('paid', Payment::where('payable_id', $order->id)->value('status'));
    }

    // ---------------- refunds ----------------

    public function test_no_refund_path_works_after_acceptance(): void
    {
        $order = $this->order(true);
        $payment = Payment::where('payable_id', $order->id)->sole();

        app(OrderRefundService::class)->refundPaidOrder($order, 'Tourist asked');
        $direct = app(PaymentRefundProcessor::class)->initiateRefund($payment, 360, 'Direct', $order);
        $this->assertSame('blocked_after_acceptance', $direct['status']);
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/payments/{$payment->payment_number}/refund", ['reason' => 'Changed my mind'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'A rider has accepted this order, so it can no longer be refunded.');

        $this->assertSame(0, $this->refundCalls());
        $this->assertSame('paid', $payment->fresh()->status);
        $this->assertSame(0, Refund::count());
        $this->assertGreaterThanOrEqual(3, $this->escalations($order, 'refund_blocked_after_acceptance'));
    }

    public function test_before_acceptance_a_refund_is_requested_first_then_sent_with_an_idempotency_key(): void
    {
        $order = $this->order(false, 'waiting_restaurant');

        app(OrderRefundService::class)->refundPaidOrder($order, 'No rider found');

        $refund = Refund::sole();
        $this->assertSame('pending', $refund->status);
        $this->assertSame('ref_test_1', $refund->provider_refund_id);
        $this->assertNotEmpty($refund->idempotency_key);
        $this->assertNotEmpty($refund->metadata['requested_at']);
        Http::assertSent(fn ($r) => str_contains($r->url(), '/refunds') && $r->header('Idempotency-Key') === [$refund->idempotency_key]);
        $this->assertSame('pending_refund', Payment::where('payable_id', $order->id)->value('status'));
    }

    public function test_an_unconfirmed_requested_refund_blocks_a_second_refund_and_is_escalated(): void
    {
        $order = $this->order(false, 'waiting_restaurant');
        $payment = Payment::where('payable_id', $order->id)->sole();
        // A crash after PayMongo accepted the refund but before we recorded the answer.
        $stuck = Refund::create([
            'payment_id' => $payment->id, 'order_id' => $order->id, 'payable_type' => Order::class, 'payable_id' => $order->id,
            'user_id' => $this->tourist->id, 'amount' => 360, 'original_amount' => 360, 'refund_deduction' => 0, 'currency' => 'PHP',
            'reason' => 'No rider found', 'metadata' => ['requested_at' => now()->subHour()->toIso8601String()], 'status' => 'requested',
            'idempotency_key' => (string) Str::uuid(),
        ]);
        Refund::whereKey($stuck->id)->update(['created_at' => now()->subHour()]);

        $again = app(PaymentRefundProcessor::class)->initiateRefund($payment, 360, 'Retry', $order);
        $this->assertSame('in_flight', $again['status']);
        $this->assertSame(0, $this->refundCalls(), 'Never refunded twice.');

        $this->artisan('payments:reconcile-refunds')->assertSuccessful();
        $this->artisan('payments:reconcile-refunds')->assertSuccessful();
        $this->assertSame(1, ActivityLog::where('action', 'escalation.refund_requested_unconfirmed')->count());
    }

    public function test_the_escalation_is_part_of_the_orders_tamper_evident_history(): void
    {
        $order = $this->order(true);
        app(OrderRefundService::class)->refundPaidOrder($order, 'Tourist asked');

        $event = TransactionEvent::whereHas('blueprint', fn ($q) => $q->where('order_id', $order->id))->where('event_type', 'escalation')->sole();
        $this->assertSame('refund_blocked_after_acceptance', $event->payload['action']);
    }
}
