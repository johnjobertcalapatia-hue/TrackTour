<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\CodSettlement;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AdminPosSalesApiTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $tourist;
    private User $rider;
    private Business $businessA;
    private Business $businessB;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::create([
            'email' => 'pos-admin@bansud.gov.ph',
            'password' => Hash::make('Password123!'),
            'role' => User::ROLE_BANSUD_TOURISM_OFFICE,
            'account_status' => User::ACCOUNT_STATUS_APPROVED,
        ]);

        $this->tourist = User::create([
            'email' => 'pos-tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => User::ROLE_TOURIST,
            'account_status' => User::ACCOUNT_STATUS_APPROVED,
        ]);

        $this->rider = User::create([
            'email' => 'pos-rider@example.com',
            'password' => Hash::make('Password123!'),
            'role' => User::ROLE_RIDER,
            'account_status' => User::ACCOUNT_STATUS_APPROVED,
        ]);

        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
        ]);

        $this->businessA = Business::create([
            'owner_id' => $this->tourist->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'POS Restaurant A',
            'status' => 'approved',
        ]);

        $this->businessB = Business::create([
            'owner_id' => $this->tourist->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'POS Restaurant B',
            'status' => 'approved',
        ]);
    }

    public function test_admin_can_fetch_pos_sales_overview(): void
    {
        $this->makeOrder('TT-POS001', 'cash', 1000.00);
        $this->makeOrder('TT-POS002', 'gcash', 500.00);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/pos/sales');

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonStructure([
                'data' => [
                    'period',
                    'summary',
                    'by_payment_method',
                    'by_order_status',
                ],
            ]);
    }

    public function test_non_admin_cannot_access_pos_sales_endpoints(): void
    {
        $tourist = User::create([
            'email' => 'pos-intruder@example.com',
            'password' => Hash::make('Password123!'),
            'role' => User::ROLE_TOURIST,
            'account_status' => User::ACCOUNT_STATUS_APPROVED,
        ]);

        foreach (['/api/admin/pos/sales', '/api/admin/pos/sales/transactions', '/api/admin/pos/sales/summary'] as $url) {
            $this->actingAs($tourist, 'sanctum')
                ->getJson($url)
                ->assertStatus(403);
        }
    }

    public function test_sales_aggregates_only_paid_orders_and_excludes_cancelled(): void
    {
        $this->makeOrder('TT-POS003', 'cash', 1000.00);
        $this->makeOrder('TT-POS004', 'gcash', 500.00);

        // Awaiting payment — must count toward pending, never toward sales.
        $this->makeOrder('TT-POS005', 'gcash', 300.00, 'waiting_restaurant', 'pending');

        // Paid but later cancelled/refunded — never a sale.
        $this->makeOrder('TT-POS006', 'cash', 400.00, 'cancelled', 'paid');

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/pos/sales');

        $response->assertOk()
            ->assertJsonPath('data.summary.transactions', 2);

        $this->assertSame(1500.0, (float) $response->json('data.summary.gross_sales'));
        $this->assertSame(750.0, (float) $response->json('data.summary.average_order_value'));
        $this->assertSame(300.0, (float) $response->json('data.summary.pending_amount'));

        $byMethod = $response->json('data.by_payment_method');
        $cod = collect($byMethod)->firstWhere('payment_method', 'cod');
        $gcash = collect($byMethod)->firstWhere('payment_method', 'gcash');

        $this->assertSame(1000.0, (float) $cod['revenue']);
        $this->assertSame(1, $cod['transactions']);
        $this->assertSame(500.0, (float) $gcash['revenue']);
        $this->assertSame(1, $gcash['transactions']);

        $this->assertSame(2, $response->json('data.by_order_status.completed'));
    }

    public function test_pos_sales_summary_kpis(): void
    {
        $this->makeOrder('TT-POS007', 'cash', 1000.00);
        $this->makeOrder('TT-POS008', 'gcash', 500.00);
        $this->makeOrder('TT-POS009', 'gcash', 250.00, 'waiting_restaurant', 'pending');

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/pos/sales/summary');

        $response->assertOk()
            ->assertJsonPath('data.today.transactions', 2)
            ->assertJsonPath('data.today.cod_transactions', 1)
            ->assertJsonPath('data.today.online_transactions', 1)
            ->assertJsonPath('data.all_time.transactions', 2);

        $this->assertSame(1500.0, (float) $response->json('data.today.revenue'));
        $this->assertSame(1000.0, (float) $response->json('data.today.cod_revenue'));
        $this->assertSame(500.0, (float) $response->json('data.today.online_revenue'));
        $this->assertSame(1500.0, (float) $response->json('data.this_month.revenue'));
        $this->assertSame(1500.0, (float) $response->json('data.all_time.revenue'));
        $this->assertSame(250.0, (float) $response->json('data.pending_amount'));
    }

    public function test_transactions_ledger_filter_isolates_method_and_search(): void
    {
        $this->makeOrder('TT-CASH001', 'cash', 1000.00, 'completed', 'paid', null, $this->businessA, 'Alice Tourist');
        $this->makeOrder('TT-GCASH001', 'gcash', 500.00, 'completed', 'paid', null, $this->businessA, 'Bob Tourist');

        $cod = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/pos/sales/transactions?payment_method=cod');

        $cod->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.order_number', 'TT-CASH001')
            ->assertJsonPath('data.0.payment_method', 'cod');

        $search = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/pos/sales/transactions?search=Alice');

        $search->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.customer_name', 'Alice Tourist');
    }

    public function test_by_business_totals_split_restaurants(): void
    {
        $this->makeOrder('TT-BIZ001', 'cash', 1000.00, 'completed', 'paid', null, $this->businessA);
        $this->makeOrder('TT-BIZ002', 'gcash', 500.00, 'completed', 'paid', null, $this->businessA);
        $this->makeOrder('TT-BIZ003', 'cash', 2000.00, 'completed', 'paid', null, $this->businessB);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/pos/sales/by-business');

        $response->assertOk()
            ->assertJsonPath('data.total_transactions', 3);

        $this->assertSame(3500.0, (float) $response->json('data.total_revenue'));

        $businesses = collect($response->json('data.businesses'));
        $this->assertCount(2, $businesses);

        $a = $businesses->firstWhere('business_name', 'POS Restaurant A');
        $b = $businesses->firstWhere('business_name', 'POS Restaurant B');

        $this->assertSame(1500.0, (float) $a['revenue']);
        $this->assertSame(2, $a['transactions']);
        $this->assertSame(1000.0, (float) $a['cod_revenue']);
        $this->assertSame(500.0, (float) $a['online_revenue']);

        $this->assertSame(2000.0, (float) $b['revenue']);
        $this->assertSame(1, $b['transactions']);
        $this->assertSame(2000.0, (float) $b['cod_revenue']);
        $this->assertSame(0.0, (float) $b['online_revenue']);
    }

    public function test_cod_settlement_platform_revenue_reflects_settled_cod(): void
    {
        $order = $this->makeOrder('TT-STL001', 'cash', 1000.00);

        $delivery = Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $this->rider->id,
            'delivery_fee' => 50,
            'status' => 'completed',
        ]);

        CodSettlement::create([
            'settlement_number' => 'COD-STL-POS-001',
            'order_id' => $order->id,
            'delivery_id' => $delivery->id,
            'business_id' => $this->businessA->id,
            'rider_id' => $this->rider->id,
            'settlement_base' => 100.00,
            'restaurant_share' => 80.00,
            'platform_fee' => 20.00,
            'status' => CodSettlement::STATUS_SETTLED,
            'settled_at' => Carbon::now(),
        ]);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/pos/sales');

        $response->assertOk()
            ->assertJsonPath('data.summary.cod_settlements.transactions', 1);

        $this->assertSame(100.0, (float) $response->json('data.summary.cod_settlements.settlement_base'));
        $this->assertSame(20.0, (float) $response->json('data.summary.cod_settlements.platform_revenue'));
    }

    public function test_trend_buckets_daily_sales(): void
    {
        $twoDaysAgo = Carbon::now()->subDays(2)->startOfDay()->addHours(10);
        $this->makeOrder('TT-TREND001', 'cash', 200.00, 'completed', 'paid', $twoDaysAgo);
        $this->makeOrder('TT-TREND002', 'gcash', 300.00);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/pos/sales/trend');

        $response->assertOk();

        $days = collect($response->json('data.days'));
        $past = $days->firstWhere('date', $twoDaysAgo->format('Y-m-d'));
        $today = $days->firstWhere('date', Carbon::now()->format('Y-m-d'));

        $this->assertNotNull($past);
        $this->assertSame(200.0, (float) $past['sales']);
        $this->assertSame(1, $past['transactions']);

        $this->assertNotNull($today);
        $this->assertSame(300.0, (float) $today['sales']);
        $this->assertSame(1, $today['transactions']);
    }

    public function test_pos_sales_endpoints_are_read_only(): void
    {
        $order = $this->makeOrder('TT-RO001', 'cash', 1000.00);

        Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $this->rider->id,
            'delivery_fee' => 50,
            'status' => 'completed',
        ]);

        CodSettlement::create([
            'settlement_number' => 'COD-STL-RO-001',
            'order_id' => $order->id,
            'delivery_id' => $order->delivery->id,
            'business_id' => $this->businessA->id,
            'rider_id' => $this->rider->id,
            'settlement_base' => 100.00,
            'restaurant_share' => 80.00,
            'platform_fee' => 20.00,
            'status' => CodSettlement::STATUS_SETTLED,
            'settled_at' => Carbon::now(),
        ]);

        $before = [
            'order_total' => (float) $order->fresh()->total,
            'order_paid_amount' => (float) $order->fresh()->paid_amount,
            'payment_count' => Payment::where('payable_id', $order->id)->count(),
            'settlement_platform_fee' => (float) CodSettlement::where('order_id', $order->id)->value('platform_fee'),
        ];

        $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/pos/sales')->assertOk();
        $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/pos/sales/transactions')->assertOk();
        $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/pos/sales/by-business')->assertOk();

        $this->assertSame($before['order_total'], (float) $order->fresh()->total);
        $this->assertSame($before['order_paid_amount'], (float) $order->fresh()->paid_amount);
        $this->assertSame($before['payment_count'], Payment::where('payable_id', $order->id)->count());
        $this->assertSame(
            $before['settlement_platform_fee'],
            (float) CodSettlement::where('order_id', $order->id)->value('platform_fee')
        );
    }

    private function makeOrder(
        string $number,
        string $method,
        float $total,
        string $status = 'completed',
        string $paymentStatus = 'paid',
        ?Carbon $paidAt = null,
        ?Business $business = null,
        string $customer = 'Test Tourist',
    ): Order {
        $business ??= $this->businessA;

        $order = Order::create([
            'order_number' => $number,
            'business_id' => $business->id,
            'user_id' => $this->tourist->id,
            'customer_name' => $customer,
            'order_type' => 'delivery',
            'payment_method' => $method,
            'payment_status' => $paymentStatus,
            'status' => $status,
            'subtotal' => $total,
            'delivery_fee' => 0,
            'rider_tip' => 0,
            'system_fee' => 0,
            'total' => $total,
        ]);

        if ($paymentStatus === 'paid') {
            Payment::create([
                'payment_number' => 'PAY-'.strtoupper($number).'-'.uniqid(),
                'payable_type' => Order::class,
                'payable_id' => $order->id,
                'user_id' => $this->tourist->id,
                'amount' => $total,
                'currency' => 'PHP',
                'method' => $method,
                'provider' => $method === 'cash' ? 'rider' : 'paymongo',
                'provider_payment_id' => 'pi-'.uniqid(),
                'status' => 'paid',
                'paid_at' => $paidAt ?? Carbon::now(),
            ]);
        }

        return $order;
    }
}