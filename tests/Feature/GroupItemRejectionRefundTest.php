<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\GroupCheckout;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Payment;
use App\Models\Refund;
use App\Models\User;
use App\Services\GroupOrderService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Regression: the restaurant item-rejection/refund flow must refund ONLY the
 * rejected item's own restaurant line and leave the sibling items (same
 * restaurant) and the other restaurants' item groups on the canonical order
 * intact (one-order group-checkout architecture, AGENTS.md §4.1).
 *
 * https://github.com/anomalyco/opencode tracking: BusinessOwnerOrderController::processItemRefund
 * passed (Order, OrderItem, ...) to OrderRefundService::refundCancelledItem(OrderItem, int, ...)
 * which raised a TypeError for every grouped-order item rejection.
 */
class GroupItemRejectionRefundTest extends TestCase
{
    use RefreshDatabase;

    private User $ownerA;
    private User $ownerB;
    private User $customer;
    private Business $restaurantA;
    private Business $restaurantB;

    protected function setUp(): void
    {
        parent::setUp();

        $this->ownerA = $this->makeUser('owner-a-reject@example.com', 'Owner A', 'business_owner');
        $this->ownerB = $this->makeUser('owner-b-reject@example.com', 'Owner B', 'business_owner');
        $this->customer = $this->makeUser('tourist-reject@example.com', 'John Tourist', 'tourist');

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

        $this->restaurantA = Business::create([
            'owner_id' => $this->ownerA->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Restaurant A',
            'business_description' => 'A test restaurant',
            'status' => 'approved',
            'force_closed' => false,
            'business_hours' => $allDays,
            'latitude' => 12.51,
            'longitude' => 121.31,
        ]);

        $this->restaurantB = Business::create([
            'owner_id' => $this->ownerB->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Restaurant B',
            'business_description' => 'Another test restaurant',
            'status' => 'approved',
            'force_closed' => false,
            'business_hours' => $allDays,
            'latitude' => 12.52,
            'longitude' => 121.32,
        ]);
    }

    private function makeUser(string $email, string $name, string $role): User
    {
        return User::create([
            'name' => $name,
            'email' => $email,
            'password' => Hash::make('Password123!'),
            'role' => $role,
            'account_status' => 'approved',
        ]);
    }

    private function makeOffering(Business $business, string $name, float $price): Offering
    {
        return Offering::create([
            'business_id' => $business->id,
            'name' => $name,
            'description' => 'Test menu item',
            'price' => $price,
            'is_available' => true,
            'status' => 'available',
        ]);
    }

    private function authHeaders(User $user): array
    {
        $token = $user->createToken('test-token')->plainTextToken;

        return [
            'Authorization' => "Bearer {$token}",
            'Accept' => 'application/json',
        ];
    }

    private function makePaidGroup(): GroupCheckout
    {
        $burger = $this->makeOffering($this->restaurantA, 'Burger', 120.00);
        $fries = $this->makeOffering($this->restaurantA, 'Fries', 80.00);
        $pizza = $this->makeOffering($this->restaurantB, 'Pizza', 400.00);

        $group = app(GroupOrderService::class)->createGroup($this->customer, [
            'order_type' => 'delivery',
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'customer_phone' => '09171234567',
            'delivery_address' => '123 Test St',
            'payment_method' => 'gcash',
            'notes' => null,
            'restaurants' => [
                [
                    'business_id' => $this->restaurantA->id,
                    'items' => [
                        ['offering_id' => $burger->id, 'quantity' => 1, 'notes' => null],
                        ['offering_id' => $fries->id, 'quantity' => 1, 'notes' => null],
                    ],
                ],
                [
                    'business_id' => $this->restaurantB->id,
                    'items' => [
                        ['offering_id' => $pizza->id, 'quantity' => 1, 'notes' => null],
                    ],
                ],
            ],
        ]);

        // Grouped orders are paid as ONE group-level payment; the partial refund
        // ledger is capped against this payment.
        Payment::create([
            'payment_number' => 'PAY-'.Str::orderedUuid(),
            'payable_type' => GroupCheckout::class,
            'payable_id' => $group->id,
            'user_id' => $this->customer->id,
            'amount' => $group->grand_total,
            'method' => 'gcash',
            'status' => 'paid',
            'paid_at' => now(),
        ]);

        return $group;
    }

    public function test_reject_one_item_refunds_only_that_item_and_leaves_siblings_intact(): void
    {
        $group = $this->makePaidGroup();

        // ONE canonical order carries every restaurant's item group (§4.1).
        $order = $group->orders()->sole()->load('items');

        $burger = $order->items->firstWhere('product_name', 'Burger');
        $fries = $order->items->firstWhere('product_name', 'Fries');
        $pizza = $order->items->firstWhere('product_name', 'Pizza');

        $this->assertSame('pending', $burger->status);
        $this->assertSame(1, $burger->activeQuantity());

        // Restaurant A rejects ONLY the Burger.
        $this->postJson(
            "/api/business-owner/orders/{$order->id}/items/{$burger->id}/reject",
            ['reason' => 'Item unavailable'],
            $this->authHeaders($this->ownerA)
        )->assertOk();

        // The rejected item is fully cancelled by the restaurant owner.
        $burger->refresh();
        $this->assertSame('rejected', $burger->status);
        $this->assertSame(1, (int) $burger->cancelled_quantity, 'Burger quantity fully cancelled.');
        $this->assertSame(0, $burger->activeQuantity());
        $this->assertSame('Item unavailable', $burger->cancellation_reason);
        $this->assertSame($this->ownerA->id, (int) $burger->cancelled_by);

        // Sibling item in the SAME restaurant's item group remains intact and active.
        $fries->refresh();
        $this->assertSame('pending', $fries->status);
        $this->assertSame(0, (int) $fries->cancelled_quantity);
        $this->assertSame(1, $fries->activeQuantity());

        // The other restaurant's item is completely untouched.
        $pizza->refresh();
        $this->assertSame('pending', $pizza->status);
        $this->assertSame(0, (int) $pizza->cancelled_quantity);
        $this->assertSame(1, $pizza->activeQuantity());

        // Exactly ONE refund row, for the Burger only (unit price 120.00, no deduction).
        $this->assertSame(1, Refund::where('order_item_id', $burger->id)->count());
        $burgerRefund = Refund::where('order_item_id', $burger->id)->first();
        $this->assertSame(120.00, (float) $burgerRefund->amount);
        $this->assertSame(120.00, (float) $burgerRefund->original_amount);
        $this->assertSame(0.00, (float) $burgerRefund->refund_deduction);
        $this->assertSame($this->customer->id, (int) $burgerRefund->user_id);

        $this->assertSame(0, Refund::where('order_item_id', $fries->id)->count());
        $this->assertSame(0, Refund::where('order_item_id', $pizza->id)->count());
        $this->assertSame(1, Refund::count(), 'Only the rejected item produced a refund row.');

        // The canonical order is NOT cancelled (Fries remains active) — the order
        // stays in its payment-pending state, untouched by the single rejection.
        $this->assertNotSame('cancelled', $order->fresh()->status);
        $this->assertSame('pending_payment', $order->fresh()->status);

        // The group refund ledger tracks exactly the burger amount.
        $group->refresh();
        $this->assertSame(120.00, (float) $group->refunded_amount);
    }
}