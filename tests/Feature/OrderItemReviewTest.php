<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderItemReview;
use App\Models\Review;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * POST /api/tourist/food/order/{order}/items/{item}/review — per-dish review
 * (stars, feedback, photos) from My Orders → To Review.
 */
class OrderItemReviewTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    private User $rider;

    private Business $grill;

    private Offering $sisig;

    private Offering $bbq;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $this->tourist = User::create(['name' => 'Jayvie', 'email' => 'tourist@example.com', 'password' => Hash::make('Password123!'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->rider = User::create(['name' => 'Rico', 'email' => 'rider@example.com', 'password' => Hash::make('Password123!'), 'role' => 'rider', 'account_status' => 'approved']);
        $owner = User::create(['email' => 'owner@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $m = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $this->grill = Business::create(['owner_id' => $owner->id, 'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id, 'municipality_id' => $m->id, 'business_name' => 'Ekslusibo Grill', 'status' => 'approved', 'latitude' => 12.86, 'longitude' => 121.45]);
        $this->sisig = Offering::create(['business_id' => $this->grill->id, 'name' => 'Sisig', 'price' => 210, 'image' => 'menu-items/sisig.jpg', 'is_available' => true, 'status' => 'available']);
        $this->bbq = Offering::create(['business_id' => $this->grill->id, 'name' => 'Chicken BBQ', 'price' => 120, 'is_available' => true, 'status' => 'available']);
    }

    /** @return array{0: Order, 1: OrderItem, 2: OrderItem} */
    private function deliveredOrder(string $status = 'delivered'): array
    {
        $order = Order::create([
            'order_number' => 'TT-500', 'business_id' => $this->grill->id, 'user_id' => $this->tourist->id,
            'customer_name' => 'Jayvie De Torres', 'customer_email' => $this->tourist->email, 'customer_phone' => '09171234567',
            'order_type' => 'delivery', 'payment_method' => 'gcash', 'payment_status' => 'paid', 'status' => $status,
            'subtotal' => 518, 'delivery_fee' => 80, 'total' => 598, 'delivery_address' => 'Poblacion, Bansud',
        ]);
        $a = OrderItem::create(['order_id' => $order->id, 'business_id' => $this->grill->id, 'offering_id' => $this->sisig->id, 'product_name' => 'Sisig', 'quantity' => 2, 'unit_price' => 199, 'subtotal' => 398, 'status' => 'ready']);
        $b = OrderItem::create(['order_id' => $order->id, 'business_id' => $this->grill->id, 'offering_id' => $this->bbq->id, 'product_name' => 'Chicken BBQ', 'quantity' => 1, 'unit_price' => 120, 'subtotal' => 120, 'status' => 'ready']);
        Delivery::create(['order_id' => $order->id, 'rider_id' => $this->rider->id, 'status' => 'delivered', 'delivered_at' => now()->subHour()]);

        return [$order, $a, $b];
    }

    private function review(Order $order, OrderItem $item, array $data, ?User $as = null)
    {
        return $this->actingAs($as ?? $this->tourist, 'sanctum')
            ->post("/api/tourist/food/order/{$order->id}/items/{$item->id}/review", $data, ['Accept' => 'application/json']);
    }

    private function toReview()
    {
        return $this->actingAs($this->tourist, 'sanctum')->getJson('/api/tourist/orders?tab=all')->assertOk()->json('data.sections.0');
    }

    public function test_reviews_a_dish_with_stars_feedback_photos_and_rider_stars(): void
    {
        [$order, $sisig] = $this->deliveredOrder();

        $res = $this->review($order, $sisig, [
            'rating' => 5, 'review' => 'Crispy and hot!', 'delivery_rating' => 4,
            'images' => [UploadedFile::fake()->image('plate.jpg'), UploadedFile::fake()->image('close.png')],
        ])->assertOk();

        $this->assertCount(2, $res->json('data.images'));
        foreach ($res->json('data.images') as $path) {
            Storage::disk('public')->assertExists($path);
        }
        $saved = OrderItemReview::firstOrFail();
        $this->assertSame($this->sisig->id, $saved->offering_id);
        $this->assertSame('Crispy and hot!', $saved->review);
        // The order's business review and rider rating stay in step.
        $this->assertSame(5, $order->fresh()->rating);
        $this->assertSame(4, $order->fresh()->delivery_rating);
        $this->assertSame(5, Review::where('order_id', $order->id)->value('food_rating'));
    }

    public function test_the_order_stays_in_to_review_until_every_dish_is_reviewed(): void
    {
        [$order, $sisig, $bbq] = $this->deliveredOrder();

        $section = $this->toReview();
        $this->assertSame('to_review', $section['tab']);
        $this->assertSame([false, false], array_column($section['items'], 'reviewed'));
        // Delivery details for To Review.
        $this->assertSame('TT-500', $section['reference']);
        $this->assertSame('Jayvie De Torres', $section['customer_name']);
        $this->assertSame('09171234567', $section['customer_phone']);
        $this->assertSame('Poblacion, Bansud', $section['delivery_address']);
        $this->assertNotNull($section['delivered_at']);
        $this->assertEquals(598, $section['total']);
        // Buy again / Add to cart data: today's menu price and the restaurant location.
        $first = collect($section['items'])->firstWhere('name', 'Sisig');
        $this->assertTrue($first['can_order']);
        $this->assertEquals(210, $first['current_price']);
        $this->assertSame($this->sisig->id, $first['offering_id']);
        $this->assertEquals(12.86, $first['business_latitude']);

        $this->review($order, $sisig, ['rating' => 4])->assertOk();
        $section = $this->toReview();
        $this->assertSame('to_review', $section['tab'], 'one dish still to review');
        $this->assertSame(4, collect($section['items'])->firstWhere('name', 'Sisig')['my_rating']);

        $this->review($order, $bbq, ['rating' => 2])->assertOk();
        $this->assertSame('completed', $this->toReview()['tab']);
        $this->assertSame(3, $order->fresh()->rating, 'average of the dish ratings');
    }

    public function test_reviewing_again_updates_the_same_review_and_replaces_photos(): void
    {
        [$order, $sisig] = $this->deliveredOrder();
        $first = $this->review($order, $sisig, ['rating' => 3, 'images' => [UploadedFile::fake()->image('old.jpg')]])->json('data.images.0');
        $this->review($order, $sisig, ['rating' => 5, 'images' => [UploadedFile::fake()->image('new.jpg')]])->assertOk();

        $this->assertSame(1, OrderItemReview::count());
        $this->assertSame(5, OrderItemReview::first()->rating);
        Storage::disk('public')->assertMissing($first);
    }

    public function test_rules_only_after_delivery_own_orders_and_valid_input(): void
    {
        [$order, $sisig] = $this->deliveredOrder('preparing');
        Delivery::where('order_id', $order->id)->update(['status' => 'in_transit']);
        $this->review($order, $sisig, ['rating' => 5])->assertUnprocessable();

        $order->update(['status' => 'delivered']);
        $this->review($order, $sisig, ['rating' => 9])->assertUnprocessable();
        $this->review($order, $sisig, ['rating' => 5, 'images' => array_fill(0, 6, UploadedFile::fake()->image('x.jpg'))])->assertUnprocessable();
        $this->review($order, $sisig, ['rating' => 5, 'images' => [UploadedFile::fake()->create('menu.pdf', 10, 'application/pdf')]])->assertUnprocessable();

        $other = User::create(['email' => 'other@example.com', 'password' => Hash::make('Password123!'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->review($order, $sisig, ['rating' => 5], $other)->assertForbidden();

        $otherOrder = Order::create(['order_number' => 'TT-9', 'user_id' => $this->tourist->id, 'customer_name' => 'J', 'customer_email' => $this->tourist->email, 'order_type' => 'delivery', 'payment_method' => 'cash', 'payment_status' => 'paid', 'status' => 'delivered', 'subtotal' => 0, 'delivery_fee' => 0, 'total' => 0]);
        $this->review($otherOrder, $sisig, ['rating' => 5])->assertNotFound();
        $this->assertSame(0, OrderItemReview::count());
    }

    public function test_dish_reviews_drive_that_dishs_food_rating_once_approved(): void
    {
        [$order, $sisig, $bbq] = $this->deliveredOrder();
        $this->review($order, $sisig, ['rating' => 5])->assertOk();
        $this->review($order, $bbq, ['rating' => 3])->assertOk();

        $byName = fn () => collect($this->getJson('/api/tourist/food')->json('data.data'))->keyBy('name');
        $this->assertNull($byName()['Sisig']['food_rating'], 'pending moderation');

        Review::where('order_id', $order->id)->update(['status' => 'approved']);
        $this->assertEquals(5, $byName()['Sisig']['food_rating']);
        $this->assertEquals(3, $byName()['Chicken BBQ']['food_rating']);
        $this->assertSame(1, $byName()['Sisig']['food_rating_count']);
    }
}
