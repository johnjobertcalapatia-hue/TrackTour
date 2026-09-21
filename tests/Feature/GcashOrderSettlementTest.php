<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\OrderSettlement;
use App\Models\Payment;
use App\Models\RestaurantWalletTransaction;
use App\Models\User;
use App\Services\OrderSettlementService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class GcashOrderSettlementTest extends TestCase
{
    use RefreshDatabase;

    public function test_completed_provider_confirmed_gcash_credits_only_food_subtotal_once(): void
    {
        $order = $this->makeOrder(500, 50, 20, 10, 'completed');
        $this->confirmPayment($order);

        $settlement = app(OrderSettlementService::class)->recordGcashSettlement($order);
        $wallet = $order->business->fresh()->restaurantWallet;

        $this->assertSame(OrderSettlement::SOURCE_GCASH, $settlement->source);
        $this->assertEquals(580, (float) $settlement->settlement_base);
        $this->assertEquals(500, (float) $settlement->restaurant_amount);
        $this->assertEquals(10, (float) $settlement->platform_amount);
        $this->assertEquals(500, (float) $wallet->available_balance);
        $this->assertEquals(500, (float) $wallet->total_earned);
        $this->assertSame(1, RestaurantWalletTransaction::where('order_settlement_id', $settlement->id)->count());

        $same = app(OrderSettlementService::class)->recordGcashSettlement($order);
        $this->assertSame($settlement->id, $same->id);
        $this->assertSame(1, RestaurantWalletTransaction::count());
    }

    public function test_unpaid_or_incomplete_gcash_order_cannot_create_an_earning(): void
    {
        $unpaid = $this->makeOrder(500, 50, 20, 10, 'completed');
        $this->assertNull(app(OrderSettlementService::class)->recordGcashSettlement($unpaid));

        $incomplete = $this->makeOrder(300, 40, 0, 6, 'ready');
        $this->confirmPayment($incomplete);
        $this->expectException(\InvalidArgumentException::class);
        app(OrderSettlementService::class)->recordGcashSettlement($incomplete);
    }

    private function makeOrder(float $subtotal, float $deliveryFee, float $tip, float $systemFee, string $status): Order
    {
        $owner = User::factory()->create();
        $category = BusinessCategory::firstOrCreate(['name' => 'Restaurant']);
        $municipality = Municipality::firstOrCreate(
            ['name' => 'Bansud'],
            ['district' => '1st', 'province' => 'Oriental Mindoro', 'latitude' => 12.5, 'longitude' => 121.3]
        );
        $business = Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'GCash '.uniqid(),
            'status' => 'approved',
        ]);

        return Order::create([
            'order_number' => 'TT-GC-'.uniqid(),
            'business_id' => $business->id,
            'user_id' => $owner->id,
            'customer_name' => 'Test Tourist',
            'order_type' => 'delivery',
            'payment_method' => 'gcash',
            'payment_status' => $status === 'completed' ? 'paid' : 'pending',
            'status' => $status,
            'subtotal' => $subtotal,
            'delivery_fee' => $deliveryFee,
            'rider_tip' => $tip,
            'system_fee' => $systemFee,
            'total' => $subtotal + $deliveryFee + $tip + $systemFee,
        ]);
    }

    private function confirmPayment(Order $order): void
    {
        Payment::create([
            'payment_number' => 'PAY-GC-'.uniqid(),
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $order->user_id,
            'amount' => $order->total,
            'currency' => 'PHP',
            'method' => 'gcash',
            'provider' => 'paymongo',
            'provider_payment_id' => 'pi-'.uniqid(),
            'status' => 'paid',
            'paid_at' => now(),
        ]);
    }
}
