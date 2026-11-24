<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Business owner Orders page filters: status chips (groups of real statuses),
 * search, business (incl. group checkouts), server-side paging and counts.
 */
class BusinessOwnerOrderFiltersTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Business $grill;

    private Business $cafe;

    protected function setUp(): void
    {
        parent::setUp();
        $town = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $this->owner = $this->user('owner@example.com');
        $this->grill = $this->business($this->owner, 'Ekslusibo Grill', $town);
        $this->cafe = $this->business($this->owner, 'Kape Bansud', $town);
    }

    private function user(string $email): User
    {
        return User::create(['email' => $email, 'name' => Str::before($email, '@'), 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
    }

    private function business(User $owner, string $name, Municipality $town): Business
    {
        return Business::create(['owner_id' => $owner->id, 'business_category_id' => BusinessCategory::firstOrCreate(['name' => 'Restaurant'])->id, 'municipality_id' => $town->id, 'business_name' => $name, 'status' => 'approved', 'latitude' => 12.86, 'longitude' => 121.45]);
    }

    private function order(Business $business, string $status, string $customer = 'Tourist', ?string $number = null): Order
    {
        return Order::create([
            'order_number' => $number ?? 'TT-'.random_int(10000, 99999), 'business_id' => $business->id, 'user_id' => $this->owner->id,
            'customer_name' => $customer, 'customer_email' => 't@example.com', 'order_type' => 'delivery',
            'payment_method' => 'gcash', 'payment_status' => 'paid', 'status' => $status, 'subtotal' => 100, 'delivery_fee' => 0, 'total' => 100,
        ]);
    }

    private function list(string $query = '')
    {
        return $this->actingAs($this->owner, 'sanctum')->getJson('/api/business-owner/orders'.($query ? "?{$query}" : ''))->assertOk();
    }

    public function test_each_chip_matches_every_status_it_stands_for(): void
    {
        $this->order($this->grill, 'waiting_restaurant');
        $this->order($this->grill, 'pending_payment');
        $this->order($this->grill, 'in_transit');
        $this->order($this->grill, 'arrived_destination');
        $this->order($this->grill, 'cancelled');
        $this->order($this->grill, 'cancelled_by_tourist');
        $this->order($this->grill, 'rejected');
        $this->order($this->grill, 'completed');

        $this->assertSame(2, $this->list('status=pending')->json('meta.total'));
        // "On the way" was "Out for delivery" — no order ever has status out_for_delivery.
        $this->assertSame(2, $this->list('status=on_the_way')->json('meta.total'));
        $this->assertSame(3, $this->list('status=cancelled')->json('meta.total'));
        $this->assertSame(1, $this->list('status=completed')->json('meta.total'));
        // An exact status still works.
        $this->assertSame(1, $this->list('status=rejected')->json('meta.total'));
    }

    public function test_counts_for_every_chip_come_with_the_list(): void
    {
        $this->order($this->grill, 'waiting_restaurant');
        $this->order($this->grill, 'preparing');
        $this->order($this->grill, 'preparing');
        $this->order($this->grill, 'cancelled_by_tourist');

        $counts = $this->list('status=preparing')->json('meta.status_counts');
        $this->assertSame(4, $counts['all'], 'counts ignore the selected chip');
        $this->assertSame(1, $counts['pending']);
        $this->assertSame(2, $counts['preparing']);
        $this->assertSame(1, $counts['cancelled']);
        $this->assertSame(0, $counts['on_the_way']);
    }

    public function test_search_by_order_number_or_customer(): void
    {
        $this->order($this->grill, 'completed', 'Maria Santos', 'TT-10024');
        $this->order($this->grill, 'completed', 'Juan Dela Cruz', 'TT-20031');

        $this->assertSame(['TT-10024'], collect($this->list('search=10024')->json('data'))->pluck('order_number')->all());
        $this->assertSame(['TT-20031'], collect($this->list('search=juan')->json('data'))->pluck('order_number')->all());
        $this->assertSame(0, $this->list('search='.urlencode('%'))->json('meta.total'), 'a % is searched literally');
    }

    public function test_the_business_filter_includes_group_checkouts_where_it_is_not_the_first_restaurant(): void
    {
        $this->order($this->grill, 'completed');
        // Group checkout: canonical order belongs to the grill; the cafe has an item in it.
        $group = $this->order($this->grill, 'preparing');
        $latte = Offering::create(['business_id' => $this->cafe->id, 'name' => 'Latte', 'price' => 120, 'is_available' => true, 'status' => 'available']);
        OrderItem::create(['order_id' => $group->id, 'business_id' => $this->cafe->id, 'offering_id' => $latte->id, 'product_name' => 'Latte', 'quantity' => 1, 'unit_price' => 120, 'subtotal' => 120, 'status' => 'preparing']);

        $this->assertSame([$group->id], collect($this->list("business_id={$this->cafe->id}")->json('data'))->pluck('id')->all());
        $this->assertSame(2, $this->list("business_id={$this->grill->id}")->json('meta.total'));

        // Another owner's business id never widens access.
        $other = $this->business($this->user('other@example.com'), 'Other', Municipality::first());
        $this->order($other, 'completed');
        $this->assertSame(0, $this->list("business_id={$other->id}")->json('meta.total'));
    }

    public function test_paging_reaches_every_order(): void
    {
        foreach (range(1, 25) as $i) {
            $this->order($this->grill, 'completed', "Customer {$i}");
        }

        $first = $this->list('perPage=10&page=1');
        $this->assertSame([1, 3, 25], [$first->json('meta.current_page'), $first->json('meta.last_page'), $first->json('meta.total')]);
        $this->assertCount(5, $this->list('perPage=10&page=3')->json('data'), 'the oldest orders are reachable too');
        $this->actingAs($this->owner, 'sanctum')->getJson('/api/business-owner/orders?perPage=500')->assertStatus(422);
    }
}
