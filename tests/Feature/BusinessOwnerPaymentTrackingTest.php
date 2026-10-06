<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\GroupCheckout;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\OrderSettlement;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class BusinessOwnerPaymentTrackingTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $otherOwner;
    private User $tourist;
    private Business $business;
    private Business $otherBusiness;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->otherOwner = User::create([
            'email' => 'owner2@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->tourist = User::create([
            'email' => 'tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
        ]);

        $this->business = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Test Restaurant',
            'business_description' => 'A test restaurant',
            'status' => 'approved',
        ]);

        $this->otherBusiness = Business::create([
            'owner_id' => $this->otherOwner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Other Restaurant',
            'business_description' => 'Another restaurant',
            'status' => 'approved',
        ]);
    }

    private function makeOrder(
        string $number,
        string $method,
        float $total,
        string $status = 'completed',
        string $paymentStatus = 'paid',
        ?Business $business = null
    ): Order {
        $business ??= $this->business;

        return Order::create([
            'order_number' => $number,
            'business_id' => $business->id,
            'customer_name' => "Customer {$number}",
            'customer_email' => 'customer@example.com',
            'order_type' => 'delivery',
            'payment_method' => $method,
            'payment_status' => $paymentStatus,
            'status' => $status,
            'subtotal' => $total,
            'total' => $total,
        ]);
    }

    private function makeSettlement(Order $order, string $method, float $base, float $restaurant, float $platform): OrderSettlement
    {
        return OrderSettlement::create([
            'settlement_number' => 'STL-' . $order->order_number,
            'order_id' => $order->id,
            'business_id' => $order->business_id,
            'source' => $method === 'cash' ? 'cod' : 'gcash',
            'payment_method' => $method,
            'settlement_base' => $base,
            'restaurant_amount' => $restaurant,
            'platform_amount' => $platform,
            'status' => 'settled',
            'settled_at' => now(),
        ]);
    }

    private function paymentsUrl(Business $business, array $params = []): string
    {
        $query = http_build_query($params);

        return '/api/business-owner/businesses/' . $business->id . '/payments' . ($query ? "?{$query}" : '');
    }

    public function test_business_owner_can_view_payment_records_with_summary(): void
    {
        $this->makeOrder('ORD-CASH001', 'cash', 1000.00);
        $this->makeOrder('ORD-GCASH001', 'gcash', 500.00);

        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson($this->paymentsUrl($this->business));

        $response->assertOk()
            ->assertJson([
                'success' => true,
                'meta' => [
                    'summary' => [
                        'orders_count' => 2,
                        'total_received' => 1500.00,
                        'cash_count' => 1,
                        'cash_total' => 1000.00,
                        'online_count' => 1,
                        'online_total' => 500.00,
                        'paid_count' => 2,
                    ],
                ],
            ])
            ->assertJsonCount(2, 'data.payments');

        $rows = collect($response->json('data.payments'));

        $cashRow = $rows->firstWhere('order_number', 'ORD-CASH001');
        $this->assertSame('Cash', $cashRow['payment_label']);
        $this->assertSame('cash', $cashRow['payment_method']);

        $onlineRow = $rows->firstWhere('order_number', 'ORD-GCASH001');
        $this->assertSame('Online', $onlineRow['payment_label']);
        $this->assertSame(500, $onlineRow['total']);
    }

    public function test_payment_filter_isolates_cash_and_online_records(): void
    {
        $this->makeOrder('ORD-CASH002', 'cash', 1000.00);
        $this->makeOrder('ORD-GCASH002', 'gcash', 500.00);
        $this->makeOrder('ORD-CARD002', 'card', 750.00);

        $cash = $this->actingAs($this->owner, 'sanctum')
            ->getJson($this->paymentsUrl($this->business, ['payment_method' => 'cash']));

        $cash->assertOk()
            ->assertJsonCount(1, 'data.payments')
            ->assertJsonPath('data.payments.0.order_number', 'ORD-CASH002');

        $online = $this->actingAs($this->owner, 'sanctum')
            ->getJson($this->paymentsUrl($this->business, ['payment_method' => 'online']));

        $online->assertOk()
            ->assertJsonCount(2, 'data.payments');

        $numbers = collect($online->json('data.payments'))->pluck('order_number');
        $this->assertTrue($numbers->contains('ORD-GCASH002'));
        $this->assertTrue($numbers->contains('ORD-CARD002'));
    }

    public function test_payment_record_includes_settlement_amount_for_the_business(): void
    {
        $order = $this->makeOrder('ORD-STL001', 'cash', 1000.00);
        $this->makeSettlement($order, 'cash', 1000.00, 800.00, 200.00);

        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson($this->paymentsUrl($this->business));

        $response->assertOk()
            ->assertJsonPath('data.payments.0.settlement_amount', 800)
            ->assertJsonPath('data.payments.0.settlement_status', 'settled')
            ->assertJsonPath('data.payments.0.settlement_number', 'STL-ORD-STL001')
            ->assertJsonPath('meta.summary.settled_amount', 800);
    }

    public function test_group_checkout_payments_are_scoped_to_the_owning_business(): void
    {
        $group = GroupCheckout::create([
            'reference_number' => 'GRP-TRACK001',
            'user_id' => $this->tourist->id,
            'customer_name' => 'Group Customer',
            'customer_email' => 'group@example.com',
            'order_type' => 'delivery',
            'payment_method' => 'cash',
            'payment_status' => 'paid',
            'status' => 'completed',
        ]);

        $orderA = $this->makeOrder('ORD-GRP-A', 'cash', 600.00, 'completed', 'paid', $this->business);
        $orderB = $this->makeOrder('ORD-GRP-B', 'cash', 400.00, 'completed', 'paid', $this->otherBusiness);

        $orderA->update(['group_order_id' => $group->id]);
        $orderB->update(['group_order_id' => $group->id]);

        $this->makeSettlement($orderA, 'cash', 600.00, 480.00, 120.00);
        $this->makeSettlement($orderB, 'cash', 400.00, 320.00, 80.00);

        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson($this->paymentsUrl($this->business));

        $response->assertOk()
            ->assertJsonCount(1, 'data.payments')
            ->assertJsonPath('data.payments.0.order_number', 'ORD-GRP-A')
            ->assertJsonPath('data.payments.0.group_reference', 'GRP-TRACK001')
            ->assertJsonPath('data.payments.0.settlement_amount', 480);

        $other = $this->actingAs($this->otherOwner, 'sanctum')
            ->getJson($this->paymentsUrl($this->otherBusiness));

        $other->assertOk()
            ->assertJsonCount(1, 'data.payments')
            ->assertJsonPath('data.payments.0.order_number', 'ORD-GRP-B')
            ->assertJsonPath('meta.summary.total_received', 400);
    }

    public function test_non_owner_cannot_access_payment_tracking(): void
    {
        $this->makeOrder('ORD-RBAC01', 'cash', 1000.00);

        $this->actingAs($this->otherOwner, 'sanctum')
            ->getJson($this->paymentsUrl($this->business))
            ->assertForbidden();

        $this->actingAs($this->tourist, 'sanctum')
            ->getJson($this->paymentsUrl($this->business))
            ->assertForbidden();
    }

    public function test_payment_tracking_returns_empty_state_without_orders(): void
    {
        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson($this->paymentsUrl($this->business));

        $response->assertOk()
            ->assertJsonCount(0, 'data.payments')
            ->assertJson([
                'meta' => [
                    'summary' => [
                        'orders_count' => 0,
                        'total_received' => 0.00,
                        'cash_total' => 0.00,
                        'online_total' => 0.00,
                        'settled_amount' => 0.00,
                    ],
                ],
            ]);
    }

    public function test_payment_records_are_excluded_for_other_businesses_orders(): void
    {
        $this->makeOrder('ORD-MINE', 'cash', 1000.00, 'completed', 'paid', $this->business);
        $this->makeOrder('ORD-THEIRS', 'gcash', 500.00, 'completed', 'paid', $this->otherBusiness);

        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson($this->paymentsUrl($this->business));

        $response->assertOk()
            ->assertJsonCount(1, 'data.payments')
            ->assertJsonPath('data.payments.0.order_number', 'ORD-MINE')
            ->assertJsonPath('meta.summary.total_received', 1000);
    }

    public function test_unauthenticated_cannot_access_payment_tracking(): void
    {
        $this->getJson($this->paymentsUrl($this->business))
            ->assertUnauthorized();
    }

    public function test_owner_can_view_full_transaction_detail(): void
    {
        $order = $this->makeOrder('ORD-DETAIL1', 'cash', 654.65, 'waiting_restaurant', 'pending');
        $order->items()->create([
            'business_id' => $this->business->id,
            'product_name' => 'Adobo',
            'quantity' => 2,
            'unit_price' => 150.00,
            'subtotal' => 300.00,
            'status' => 'accepted',
        ]);

        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson($this->paymentsUrl($this->business) . '/' . $order->id);

        $response->assertOk()
            ->assertJsonPath('data.order_number', 'ORD-DETAIL1')
            ->assertJsonPath('data.payment_label', 'Cash')
            ->assertJsonPath('data.payment_status', 'pending')
            ->assertJsonPath('data.order_status', 'waiting_restaurant')
            ->assertJsonCount(1, 'data.items')
            ->assertJsonPath('data.items.0.product_name', 'Adobo')
            ->assertJsonPath('data.totals.total', 654.65)
            ->assertJsonPath('data.settlement', null);
    }

    public function test_transaction_detail_includes_settlement_for_the_business(): void
    {
        $order = $this->makeOrder('ORD-DETAIL2', 'cash', 1000.00, 'completed', 'paid');
        $this->makeSettlement($order, 'cash', 1000.00, 800.00, 200.00);

        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson($this->paymentsUrl($this->business) . '/' . $order->id);

        $response->assertOk()
            ->assertJsonPath('data.settlement.settlement_number', 'STL-ORD-DETAIL2')
            ->assertJsonPath('data.settlement.restaurant_amount', 800)
            ->assertJsonPath('data.settlement.platform_amount', 200)
            ->assertJsonPath('data.settlement.status', 'settled');
    }

    public function test_transaction_detail_only_exposes_own_business_items_in_group(): void
    {
        $group = GroupCheckout::create([
            'reference_number' => 'GRP-DETAIL',
            'user_id' => $this->tourist->id,
            'customer_name' => 'Group Customer',
            'customer_email' => 'group@example.com',
            'order_type' => 'delivery',
            'payment_method' => 'gcash',
            'payment_status' => 'paid',
            'status' => 'completed',
        ]);

        $orderA = $this->makeOrder('ORD-DET-A', 'gcash', 600.00, 'completed', 'paid', $this->business);
        $orderB = $this->makeOrder('ORD-DET-B', 'gcash', 400.00, 'completed', 'paid', $this->otherBusiness);
        $orderA->update(['group_order_id' => $group->id]);
        $orderB->update(['group_order_id' => $group->id]);

        $orderA->items()->create(['business_id' => $this->business->id, 'product_name' => 'A Item', 'quantity' => 1, 'unit_price' => 600.00, 'subtotal' => 600.00, 'status' => 'ready']);
        $orderA->items()->create(['business_id' => $this->otherBusiness->id, 'product_name' => 'B Item', 'quantity' => 1, 'unit_price' => 400.00, 'subtotal' => 400.00, 'status' => 'ready']);

        $this->makeSettlement($orderA, 'gcash', 600.00, 480.00, 120.00);

        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson($this->paymentsUrl($this->business) . '/' . $orderA->id);

        $response->assertOk()
            ->assertJsonPath('data.group_reference', 'GRP-DETAIL')
            ->assertJsonCount(1, 'data.items')
            ->assertJsonPath('data.items.0.product_name', 'A Item')
            ->assertJsonPath('data.settlement.restaurant_amount', 480);
    }

    public function test_transaction_detail_is_forbidden_for_non_owner_and_not_found_for_unowned_order(): void
    {
        $order = $this->makeOrder('ORD-DET-R1', 'cash', 500.00, 'completed', 'paid');

        $this->actingAs($this->otherOwner, 'sanctum')
            ->getJson($this->paymentsUrl($this->business) . '/' . $order->id)
            ->assertForbidden();

        $theirs = $this->makeOrder('ORD-DET-T1', 'gcash', 300.00, 'completed', 'paid', $this->otherBusiness);

        $this->actingAs($this->owner, 'sanctum')
            ->getJson($this->paymentsUrl($this->business) . '/' . $theirs->id)
            ->assertNotFound();
    }

    public function test_transaction_detail_includes_delivery_status_from_enum_cast(): void
    {
        $order = $this->makeOrder('ORD-DET-ENUM', 'cash', 800.00, 'completed', 'paid');
        Delivery::create([
            'order_id' => $order->id,
            'status' => 'delivered',
            'dispatch_status' => 'assigned',
            'delivery_fee' => 50.00,
            'delivery_address' => '123 Test St, Bansud',
            'delivery_latitude' => 12.60,
            'delivery_longitude' => 121.40,
        ]);

        $response = $this->actingAs($this->owner, 'sanctum')
            ->getJson($this->paymentsUrl($this->business) . '/' . $order->id);

        $response->assertOk()
            ->assertJsonPath('data.delivery.status', 'delivered')
            ->assertJsonPath('data.delivery.dispatch_status', 'assigned');
    }
}