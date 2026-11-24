<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Review;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * GET /api/tourist/reviews — My Reviews grouped by what was reviewed:
 * food (dishes), restaurants, riders, resorts and tourist attractions.
 */
class TouristReviewFeedTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    private User $rider;

    private User $owner;

    private Municipality $town;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $this->tourist = User::create(['name' => 'Jayvie', 'email' => 'tourist@example.com', 'password' => Hash::make('Password123!'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->rider = User::create(['name' => 'Rico Rider', 'email' => 'rider@example.com', 'password' => Hash::make('Password123!'), 'role' => 'rider', 'account_status' => 'approved']);
        $this->owner = User::create(['email' => 'owner@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->town = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
    }

    private function business(string $category, string $name): Business
    {
        return Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => BusinessCategory::firstOrCreate(['name' => $category])->id,
            'municipality_id' => $this->town->id,
            'business_name' => $name,
            'status' => 'approved',
            'latitude' => 12.86,
            'longitude' => 121.45,
        ]);
    }

    private function feed(?User $as = null): array
    {
        return $this->actingAs($as ?? $this->tourist, 'sanctum')->getJson('/api/tourist/reviews')->assertOk()->json('data');
    }

    public function test_every_kind_of_review_lands_in_its_own_group(): void
    {
        // Food order: a dish review, the restaurant review and the rider's delivery rating.
        $grill = $this->business('Restaurant', 'Ekslusibo Grill');
        $sisig = Offering::create(['business_id' => $grill->id, 'name' => 'Sisig', 'price' => 210, 'is_available' => true, 'status' => 'available']);
        $order = Order::create([
            'order_number' => 'TT-500', 'business_id' => $grill->id, 'user_id' => $this->tourist->id,
            'customer_name' => 'Jayvie', 'customer_email' => $this->tourist->email, 'customer_phone' => '09171234567',
            'order_type' => 'delivery', 'payment_method' => 'gcash', 'payment_status' => 'paid', 'status' => 'delivered',
            'subtotal' => 210, 'delivery_fee' => 80, 'total' => 290, 'delivery_address' => 'Poblacion, Bansud',
        ]);
        $item = OrderItem::create(['order_id' => $order->id, 'business_id' => $grill->id, 'offering_id' => $sisig->id, 'product_name' => 'Sisig', 'quantity' => 1, 'unit_price' => 210, 'subtotal' => 210, 'status' => 'ready']);
        Delivery::create(['order_id' => $order->id, 'rider_id' => $this->rider->id, 'status' => 'delivered', 'delivered_at' => now()->subHour()]);
        $this->actingAs($this->tourist, 'sanctum')
            ->postJson("/api/tourist/food/order/{$order->id}/items/{$item->id}/review", ['rating' => 5, 'review' => 'Crispy and hot', 'delivery_rating' => 4])
            ->assertOk();

        // A rated ride.
        $ride = Order::create([
            'order_number' => 'TT-600', 'business_id' => null, 'user_id' => $this->tourist->id,
            'customer_name' => 'Jayvie', 'customer_email' => $this->tourist->email, 'customer_phone' => '09171234567',
            'order_type' => 'transport', 'payment_method' => 'cash', 'payment_status' => 'paid', 'status' => 'completed',
            'subtotal' => 120, 'delivery_fee' => 0, 'total' => 120,
            'rating' => 5, 'review' => 'Smooth ride', 'rating_tags' => ['safe_driving', 'friendly'],
        ]);
        Delivery::create(['order_id' => $ride->id, 'rider_id' => $this->rider->id, 'status' => 'delivered', 'delivered_at' => now()->subHour()]);

        // A resort and an attraction review (no order).
        Review::create(['business_id' => $this->business('Resort', 'Aplaya Resort')->id, 'user_id' => $this->tourist->id, 'rating' => 4, 'review' => 'Clean rooms', 'cleanliness_rating' => 5, 'status' => 'approved']);
        Review::create(['business_id' => $this->business('Tourist Attraction', 'Tamaraw Falls')->id, 'user_id' => $this->tourist->id, 'rating' => 5, 'review' => 'Beautiful', 'status' => 'pending']);

        $data = $this->feed();
        $byCategory = collect($data['items'])->groupBy('category');

        $this->assertSame(['all' => 6, 'food' => 1, 'restaurant' => 1, 'rider' => 2, 'resort' => 1, 'attraction' => 1], $data['counts']);

        $dish = $byCategory['food'][0];
        $this->assertSame('Sisig', $dish['title']);
        $this->assertSame('Ekslusibo Grill', $dish['subtitle']);
        $this->assertSame('Crispy and hot', $dish['comment']);
        $this->assertSame('pending', $dish['status'], 'moderated with the restaurant review');
        $this->assertSame("/tourist/food/item/{$sisig->id}", $dish['link']);

        $restaurant = $byCategory['restaurant'][0];
        $this->assertSame('Ekslusibo Grill', $restaurant['title'], 'the restaurant name is sent, not a nested object');
        $this->assertSame('Order TT-500', $restaurant['subtitle']);

        $riders = $byCategory['rider']->keyBy('subtitle');
        $this->assertSame(4, $riders['Food delivery · TT-500']['rating']);
        $this->assertSame('Rico Rider', $riders['Food delivery · TT-500']['title']);
        $this->assertSame('Smooth ride', $riders['Ride · TT-600']['comment']);
        $this->assertSame(['safe_driving', 'friendly'], $riders['Ride · TT-600']['tags']);
        $this->assertSame("/tourist/transport/trips/{$ride->id}", $riders['Ride · TT-600']['link']);

        $this->assertSame('Aplaya Resort', $byCategory['resort'][0]['title']);
        $this->assertSame([['label' => 'Cleanliness', 'value' => '5/5']], $byCategory['resort'][0]['details']);
        $this->assertSame('Tamaraw Falls', $byCategory['attraction'][0]['title']);
        $this->assertSame('pending', $byCategory['attraction'][0]['status']);
    }

    public function test_a_food_order_review_counts_as_a_restaurant_even_for_a_hotel_and_restaurant(): void
    {
        $combo = $this->business('Hotel & Restaurant Combination', 'Bayside Hotel');
        $order = Order::create([
            'order_number' => 'TT-700', 'business_id' => $combo->id, 'user_id' => $this->tourist->id,
            'customer_name' => 'Jayvie', 'customer_email' => $this->tourist->email, 'order_type' => 'delivery',
            'payment_method' => 'cash', 'payment_status' => 'paid', 'status' => 'delivered', 'subtotal' => 0, 'delivery_fee' => 0, 'total' => 0,
        ]);
        Review::create(['business_id' => $combo->id, 'order_id' => $order->id, 'user_id' => $this->tourist->id, 'rating' => 4, 'status' => 'approved']);
        // The same business reviewed as a place to stay.
        Review::create(['business_id' => $combo->id, 'user_id' => $this->tourist->id, 'rating' => 3, 'status' => 'approved']);

        $counts = $this->feed()['counts'];
        $this->assertSame(1, $counts['restaurant']);
        $this->assertSame(1, $counts['resort']);
    }

    public function test_only_my_own_reviews_are_listed_and_a_riders_email_is_never_shown(): void
    {
        $other = User::create(['name' => 'Other', 'email' => 'other@example.com', 'password' => Hash::make('Password123!'), 'role' => 'tourist', 'account_status' => 'approved']);
        $resort = $this->business('Resort', 'Aplaya Resort');
        Review::create(['business_id' => $resort->id, 'user_id' => $other->id, 'rating' => 2, 'status' => 'approved']);

        $nameless = User::create(['name' => '', 'email' => 'nameless.rider@example.com', 'password' => Hash::make('Password123!'), 'role' => 'rider', 'account_status' => 'approved']);
        $ride = Order::create([
            'order_number' => 'TT-800', 'user_id' => $this->tourist->id, 'customer_name' => 'Jayvie', 'customer_email' => $this->tourist->email,
            'order_type' => 'transport', 'payment_method' => 'cash', 'payment_status' => 'paid', 'status' => 'completed',
            'subtotal' => 100, 'delivery_fee' => 0, 'total' => 100, 'rating' => 4,
        ]);
        Delivery::create(['order_id' => $ride->id, 'rider_id' => $nameless->id, 'status' => 'delivered', 'delivered_at' => now()]);

        $data = $this->feed();
        $this->assertSame(1, $data['counts']['all']);
        $this->assertSame('Your driver', $data['items'][0]['title']);
        $this->assertStringNotContainsString('@', json_encode($data['items']));
    }

    public function test_no_reviews_gives_empty_groups(): void
    {
        $this->assertSame(['all' => 0, 'food' => 0, 'restaurant' => 0, 'rider' => 0, 'resort' => 0, 'attraction' => 0], $this->feed()['counts']);
    }
}
