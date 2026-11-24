<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Expense;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Review;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Reports & Analytics overview: per-restaurant sales from its own items
 * (group checkouts), Manila days, earnings after expenses, the change against
 * the previous period, top items and orders by status.
 */
class OwnerReportOverviewTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Business $grill;

    private Business $cafe;

    protected function setUp(): void
    {
        parent::setUp();
        // Monday 23 Nov 2026, noon in Manila.
        Carbon::setTestNow(Carbon::parse('2026-11-23 12:00', 'Asia/Manila'));
        $town = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $this->owner = $this->user('owner@example.com');
        $this->grill = $this->business($this->owner, 'Ekslusibo Grill', $town);
        $this->cafe = $this->business($this->user('cafe@example.com'), 'Kape Bansud', $town);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function user(string $email): User
    {
        return User::create(['email' => $email, 'name' => Str::before($email, '@'), 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
    }

    private function business(User $owner, string $name, Municipality $town): Business
    {
        return Business::create(['owner_id' => $owner->id, 'business_category_id' => BusinessCategory::firstOrCreate(['name' => 'Restaurant'])->id, 'municipality_id' => $town->id, 'business_name' => $name, 'status' => 'approved', 'latitude' => 12.86, 'longitude' => 121.45]);
    }

    /** @param array<int, array{0: Business, 1: string, 2: float, 3?: int, 4?: string}> $items */
    private function order(string $status, ?string $completedAtManila, array $items, ?string $createdAtManila = null): Order
    {
        $order = Order::create([
            'order_number' => 'TT-'.random_int(10000, 99999), 'business_id' => $items[0][0]->id, 'user_id' => $this->owner->id,
            'customer_name' => 'Maria', 'customer_email' => 'maria@example.com', 'order_type' => 'delivery',
            'payment_method' => 'gcash', 'payment_status' => 'paid', 'status' => $status, 'subtotal' => 0, 'delivery_fee' => 49, 'total' => 0,
            'completed_at' => $completedAtManila ? Carbon::parse($completedAtManila, 'Asia/Manila')->utc() : null,
        ]);
        $order->forceFill(['created_at' => Carbon::parse($createdAtManila ?? $completedAtManila ?? '2026-11-23 09:00', 'Asia/Manila')->utc()])->save();
        foreach ($items as $item) {
            [$business, $name, $price] = $item;
            $qty = $item[3] ?? 1;
            $offering = Offering::firstOrCreate(['business_id' => $business->id, 'name' => $name], ['price' => $price, 'is_available' => true, 'status' => 'available']);
            OrderItem::create(['order_id' => $order->id, 'business_id' => $business->id, 'offering_id' => $offering->id, 'product_name' => $name, 'quantity' => $qty, 'unit_price' => $price, 'subtotal' => $price * $qty, 'status' => $item[4] ?? 'completed']);
        }

        return $order;
    }

    private function overview(string $query = 'from=2026-11-17&to=2026-11-23', ?User $as = null)
    {
        return $this->actingAs($as ?? $this->owner, 'sanctum')->getJson("/api/business-owner/reports/overview?{$query}");
    }

    public function test_sales_count_only_this_restaurants_items_on_manila_days(): void
    {
        // Group checkout (canonical order is the grill's): the latte is the cafe's.
        $this->order('completed', '2026-11-23 01:30', [[$this->grill, 'Sisig', 220], [$this->cafe, 'Latte', 120]]);
        // 11:30 PM on the 16th in Manila is the previous period, although it is the 16th in UTC too.
        $this->order('completed', '2026-11-16 23:30', [[$this->grill, 'Sisig', 220]]);
        // A cancelled dish in a completed order is not a sale.
        $this->order('completed', '2026-11-20 12:00', [[$this->grill, 'Lechon', 300, 2], [$this->grill, 'Halo-halo', 90, 1, 'cancelled']]);
        Expense::create(['business_id' => $this->grill->id, 'category' => 'ingredients', 'amount' => 100, 'expense_date' => '2026-11-21', 'vendor_name' => 'Market']);

        $res = $this->overview()->assertOk();
        $res->assertJsonPath('data.kpis.orders.value', 2)
            ->assertJsonPath('data.kpis.revenue.value', 820)          // 220 + 600, no latte, no delivery fee, no halo-halo
            ->assertJsonPath('data.kpis.earnings.value', 720)         // minus the ₱100 expense
            ->assertJsonPath('data.kpis.earnings.expenses', 100)
            ->assertJsonPath('data.kpis.revenue.previous', 220)
            ->assertJsonPath('data.kpis.orders.previous', 1)
            ->assertJsonPath('data.range.previous_from', '2026-11-10')
            ->assertJsonPath('data.range.previous_to', '2026-11-16');
        $this->assertEqualsWithDelta(272.7, $res->json('data.kpis.revenue.change'), 0.1);

        $series = collect($res->json('data.series'))->keyBy('date');
        $this->assertCount(7, $series);
        $this->assertSame(220, (int) $series['2026-11-23']['revenue'], '01:30 Manila on the 23rd counts on the 23rd');
        $this->assertSame(220, (int) $series['2026-11-23']['previous_revenue'], 'day 7 is compared with day 7 of the period before (the 16th)');

        $this->assertSame('Lechon', $res->json('data.top_items.0.name'));
        $this->assertSame(2, $res->json('data.top_items.0.quantity'));
        $this->assertNotContains('Latte', array_column($res->json('data.top_items'), 'name'));
        $this->assertSame([['label' => 'Week 1', 'from' => '2026-11-17', 'to' => '2026-11-23', 'revenue' => 820, 'previous_revenue' => 220]], $res->json('data.breakdown'));
    }

    public function test_orders_by_status_groups_and_rating(): void
    {
        $this->order('completed', '2026-11-22 10:00', [[$this->grill, 'Sisig', 220]]);
        $this->order('preparing', null, [[$this->grill, 'Sisig', 220]], '2026-11-22 11:00');
        $this->order('waiting_restaurant', null, [[$this->grill, 'Sisig', 220]], '2026-11-22 11:00');
        $this->order('cancelled_by_tourist', null, [[$this->grill, 'Sisig', 220]], '2026-11-21 11:00');
        // The cafe's own order is not the grill owner's.
        $this->order('completed', '2026-11-22 10:00', [[$this->cafe, 'Latte', 120]]);
        Review::create(['business_id' => $this->grill->id, 'rating' => 5, 'status' => 'pending']);
        Review::create(['business_id' => $this->grill->id, 'rating' => 4, 'status' => 'approved']);
        Review::create(['business_id' => $this->grill->id, 'rating' => 1, 'status' => 'rejected']);

        $res = $this->overview()->assertOk();
        $this->assertSame(4, $res->json('data.orders_by_status.total'));
        $this->assertSame(['completed' => 1, 'in_progress' => 1, 'pending' => 1, 'cancelled' => 1], collect($res->json('data.orders_by_status.groups'))->pluck('count', 'key')->all());
        $this->assertSame(['value' => 4.5, 'count' => 2, 'new_in_range' => 2], $res->json('data.kpis.rating'));
        $this->assertNull($res->json('data.kpis.orders.change'), 'no previous orders: no percentage');
    }

    public function test_filters_validation_and_other_owners_data(): void
    {
        $this->order('completed', '2026-11-22 10:00', [[$this->cafe, 'Latte', 120]]);

        // Another owner's business id never widens access.
        $this->overview("from=2026-11-17&to=2026-11-23&business_id={$this->cafe->id}")->assertOk()->assertJsonPath('data.kpis.revenue.value', 0);
        $this->overview('from=2026-11-23&to=2026-11-17')->assertStatus(422);
        $this->overview('from=2025-01-01&to=2026-11-23')->assertStatus(422);
        $this->overview('from=2026-11-17')->assertStatus(422);

        // Long ranges: weekly points on the chart, 30-day revenue buckets.
        $res = $this->overview('from=2026-01-01&to=2026-11-23')->assertOk();
        $this->assertLessThanOrEqual(48, count($res->json('data.series')));
        $this->assertLessThanOrEqual(12, count($res->json('data.breakdown')));
    }
}
