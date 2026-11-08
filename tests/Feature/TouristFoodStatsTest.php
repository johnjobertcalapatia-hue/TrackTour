<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Review;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * GET /api/tourist/food — real per-dish "sold" counts and food star ratings
 * (shown on the dish cards; never invented).
 */
class TouristFoodStatsTest extends TestCase
{
    use RefreshDatabase;

    private Business $grill;

    private User $tourist;

    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $owner = User::create(['email' => 'owner@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->tourist = User::create(['email' => 'tourist@example.com', 'password' => Hash::make('Password123!'), 'role' => 'tourist', 'account_status' => 'approved']);
        $m = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $this->grill = Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => $m->id,
            'business_name' => 'Ekslusibo Grill',
            'status' => 'approved',
        ]);
    }

    private function dish(string $name): Offering
    {
        return Offering::create(['business_id' => $this->grill->id, 'name' => $name, 'price' => 199, 'is_available' => true, 'status' => 'available']);
    }

    private function sell(Offering $dish, int $qty, string $status, int $cancelled = 0): Order
    {
        $order = Order::create([
            'order_number' => 'TT-'.(++$this->seq), 'business_id' => $this->grill->id, 'user_id' => $this->tourist->id,
            'customer_name' => 'T', 'customer_email' => $this->tourist->email, 'order_type' => 'delivery',
            'payment_method' => 'cash', 'payment_status' => 'paid', 'status' => $status, 'subtotal' => 0, 'delivery_fee' => 0, 'total' => 0,
        ]);
        OrderItem::create(['order_id' => $order->id, 'business_id' => $this->grill->id, 'offering_id' => $dish->id, 'product_name' => $dish->name, 'quantity' => $qty, 'unit_price' => 199, 'subtotal' => 199 * $qty, 'status' => 'pending']);
        if ($cancelled) {
            OrderItem::where('order_id', $order->id)->update(['cancelled_quantity' => $cancelled]);
        }

        return $order;
    }

    private function review(Order $order, int $food, string $status = 'approved'): void
    {
        Review::create(['business_id' => $this->grill->id, 'user_id' => $this->tourist->id, 'order_id' => $order->id, 'rating' => $food, 'food_rating' => $food, 'status' => $status]);
    }

    public function test_sold_counts_and_food_ratings_come_from_real_orders_and_reviews(): void
    {
        $sisig = $this->dish('Sisig');
        $this->dish('Brand New Dish');

        $a = $this->sell($sisig, 3, 'delivered');
        $b = $this->sell($sisig, 2, 'completed', cancelled: 1);   // 1 unit cancelled
        $this->sell($sisig, 5, 'preparing');                       // not delivered yet: not "sold"
        $this->sell($sisig, 4, 'cancelled');
        $this->review($a, 5);
        $this->review($b, 4);
        $this->review($this->sell($sisig, 1, 'delivered'), 1, 'pending'); // unapproved review: ignored (but 1 more sold)

        $byName = collect($this->getJson('/api/tourist/food')->assertOk()->json('data.data'))->keyBy('name');

        $this->assertSame(5, $byName['Sisig']['sold_count']);          // 3 + (2 - 1) + 1
        $this->assertEquals(4.5, $byName['Sisig']['food_rating']);
        $this->assertSame(2, $byName['Sisig']['food_rating_count']);

        $this->assertSame(0, $byName['Brand New Dish']['sold_count']);
        $this->assertNull($byName['Brand New Dish']['food_rating'], 'no rating is invented');
        $this->assertSame(0, $byName['Brand New Dish']['food_rating_count']);
    }
}
