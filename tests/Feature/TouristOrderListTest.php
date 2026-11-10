<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\GroupCheckout;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * GET /api/tourist/orders?tab= — My Orders tabs, item by item.
 */
class TouristOrderListTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    private User $rider;

    private Business $grill;

    private Business $cafe;

    private Offering $sisig;

    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tourist = User::create(['name' => 'Jayvie', 'email' => 'tourist@example.com', 'password' => Hash::make('Password123!'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->rider = User::create(['name' => 'Rico Rider', 'email' => 'rider@example.com', 'password' => Hash::make('Password123!'), 'role' => 'rider', 'account_status' => 'approved']);
        $owner = User::create(['email' => 'owner@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $m = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $cat = BusinessCategory::create(['name' => 'Restaurant']);
        $this->grill = Business::create(['owner_id' => $owner->id, 'business_category_id' => $cat->id, 'municipality_id' => $m->id, 'business_name' => 'Ekslusibo Grill', 'status' => 'approved']);
        $this->cafe = Business::create(['owner_id' => $owner->id, 'business_category_id' => $cat->id, 'municipality_id' => $m->id, 'business_name' => 'Bansud Cafe', 'status' => 'approved']);
        $this->sisig = Offering::create(['business_id' => $this->grill->id, 'name' => 'Sisig', 'price' => 199, 'image' => 'menu-items/sisig.jpg', 'is_available' => true, 'status' => 'available']);
    }

    private function order(array $over = [], ?User $for = null): Order
    {
        $for ??= $this->tourist;
        $order = Order::create(array_merge([
            'order_number' => 'TT-'.(++$this->seq),
            'business_id' => $this->grill->id,
            'user_id' => $for->id,
            'customer_name' => 'Jayvie',
            'customer_email' => $for->email,
            'order_type' => 'delivery',
            'payment_method' => 'cash',
            'payment_status' => 'pending',
            'status' => 'waiting_restaurant',
            'subtotal' => 398,
            'delivery_fee' => 80,
            'total' => 478,
        ], $over));
        OrderItem::create(['order_id' => $order->id, 'business_id' => $this->grill->id, 'offering_id' => $this->sisig->id, 'product_name' => 'Sisig', 'quantity' => 2, 'unit_price' => 199, 'subtotal' => 398, 'status' => 'pending']);

        return $order;
    }

    private function fetch(string $tab = 'all')
    {
        return $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/orders?tab={$tab}")->assertOk();
    }

    public function test_sorts_orders_into_tabs_by_status(): void
    {
        $this->order(['status' => 'pending_payment', 'payment_method' => 'gcash']);           // to pay
        $this->order(['payment_method' => 'gcash', 'payment_status' => 'pending']);           // to pay (unpaid GCash)
        $this->order(['status' => 'preparing']);                                              // preparing + to pay (COD, cash due)
        $transit = $this->order(['status' => 'ready', 'payment_method' => 'gcash', 'payment_status' => 'paid']);
        Delivery::create(['order_id' => $transit->id, 'rider_id' => $this->rider->id, 'status' => 'in_transit']);
        $arrived = $this->order(['status' => 'ready']);                                       // to receive + to pay (COD)
        Delivery::create(['order_id' => $arrived->id, 'rider_id' => $this->rider->id, 'status' => 'arrived_destination']);
        $this->order(['status' => 'delivered']);                                              // to review (COD settled on delivery)
        $this->order(['status' => 'completed', 'rating' => 5]);                               // reviewed → all only
        $this->order(['status' => 'cancelled']);                                              // cancelled → all only

        $res = $this->fetch();
        $this->assertSame(
            ['all' => 8, 'to_pay' => 4, 'preparing' => 1, 'in_transit' => 1, 'to_receive' => 1, 'to_review' => 1],
            $res->json('data.counts'),
        );
        $this->assertCount(8, $res->json('data.sections'), '"All" shows every type of order');

        $this->assertSame(['in_transit'], array_column($this->fetch('in_transit')->json('data.sections'), 'tab'));
        $transitSection = $this->fetch('in_transit')->json('data.sections.0');
        $this->assertSame('Rico Rider', $transitSection['rider']['name']);
        $this->assertSame('On the way', $transitSection['status_label']);
        $this->assertSame('Rider has arrived', $this->fetch('to_receive')->json('data.sections.0.status_label'));
    }

    public function test_cod_orders_show_in_to_pay_and_in_their_progress_tab_until_delivered(): void
    {
        $cod = $this->order(['status' => 'preparing', 'payment_method' => 'cash', 'payment_status' => 'pending']);

        $toPay = $this->fetch('to_pay')->json('data.sections');
        $this->assertSame([$cod->order_number], array_column($toPay, 'reference'));
        $this->assertTrue($toPay[0]['cod_due']);
        $this->assertSame(['preparing', 'to_pay'], $toPay[0]['tabs']);
        $this->assertSame([$cod->order_number], array_column($this->fetch('preparing')->json('data.sections'), 'reference'));

        // Delivered: the cash was paid to the rider, so it leaves To Pay.
        $cod->update(['status' => 'delivered']);
        $this->assertSame([], $this->fetch('to_pay')->json('data.sections'));
        $this->assertFalse($this->fetch('to_review')->json('data.sections.0.cod_due'));

        // A paid COD order is not "to pay" either.
        $this->order(['status' => 'preparing', 'payment_method' => 'cod', 'payment_status' => 'paid']);
        $this->assertSame(0, $this->fetch()->json('data.counts.to_pay'));
    }

    public function test_items_are_listed_individually_with_image_quantity_and_price(): void
    {
        $this->order();

        $item = $this->fetch('preparing')->json('data.sections.0.items.0');
        $this->assertSame('Sisig', $item['name']);
        $this->assertSame('menu-items/sisig.jpg', $item['image']);
        $this->assertSame('Ekslusibo Grill', $item['restaurant']);
        $this->assertSame(2, $item['quantity']);
        $this->assertEquals(398, $item['line_total']);
    }

    public function test_a_group_checkout_is_one_section_with_one_order_number_and_one_delivery_fee(): void
    {
        $group = GroupCheckout::create([
            'reference_number' => 'GRP-1001', 'user_id' => $this->tourist->id, 'customer_name' => 'Jayvie', 'customer_email' => $this->tourist->email,
            'order_type' => 'delivery', 'subtotal' => 548, 'delivery_total' => 95, 'grand_total' => 643,
            'payment_method' => 'gcash', 'payment_status' => 'paid', 'status' => 'pending',
        ]);
        $a = $this->order(['group_order_id' => $group->id, 'payment_method' => 'gcash', 'payment_status' => 'paid', 'delivery_fee' => 95]);
        $b = $this->order(['group_order_id' => $group->id, 'business_id' => $this->cafe->id, 'payment_method' => 'gcash', 'payment_status' => 'paid', 'delivery_fee' => 0]);
        OrderItem::where('order_id', $b->id)->update(['business_id' => $this->cafe->id, 'product_name' => 'Iced Coffee', 'quantity' => 1, 'unit_price' => 150, 'subtotal' => 150]);

        $sections = $this->fetch()->json('data.sections');
        $this->assertCount(1, $sections, 'both restaurants\' dishes share one section');
        $section = $sections[0];
        $this->assertSame('GRP-1001', $section['reference']);
        $this->assertSame($a->id, $section['primary_order_id']);
        $this->assertEqualsCanonicalizing(['Sisig', 'Iced Coffee'], array_column($section['items'], 'name'));
        $this->assertEqualsCanonicalizing(['Ekslusibo Grill', 'Bansud Cafe'], array_column($section['items'], 'restaurant'));
        $this->assertEquals(95, $section['delivery_fee'], 'one delivery fee for the whole checkout');
        $this->assertEquals(643, $section['total']);
        // "Complete payment" pays the group checkout as a whole.
        $this->assertSame($group->id, $section['group_order_id']);
    }

    public function test_reviewing_moves_the_order_out_of_to_review(): void
    {
        $order = $this->order(['status' => 'delivered']);
        Delivery::create(['order_id' => $order->id, 'rider_id' => $this->rider->id, 'status' => 'delivered']);
        $this->assertSame(1, $this->fetch()->json('data.counts.to_review'));

        $this->actingAs($this->tourist, 'sanctum')
            ->postJson("/api/tourist/food/order/{$order->id}/rate", ['rating' => 5, 'food_rating' => 5, 'delivery_rating' => 4, 'review' => 'Great sisig!'])
            ->assertOk();

        $res = $this->fetch();
        $this->assertSame(0, $res->json('data.counts.to_review'));
        $this->assertSame('completed', $res->json('data.sections.0.tab'));
        $this->assertSame(4, $order->fresh()->delivery_rating, 'the rider\'s stars are stored');
    }

    public function test_only_the_tourists_own_orders_and_validates_tab(): void
    {
        $this->getJson('/api/tourist/orders')->assertUnauthorized();

        $other = User::create(['email' => 'other@example.com', 'password' => Hash::make('Password123!'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->order([], $other);
        $this->order();

        $this->assertCount(1, $this->fetch()->json('data.sections'));
        $this->actingAs($this->tourist, 'sanctum')->getJson('/api/tourist/orders?tab=nope')->assertUnprocessable();
    }
}
