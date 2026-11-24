<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Business owner Reports filters: Business, Business Type, Period and
 * Date From / Date To (which override the period) — on screen and in exports.
 */
class BusinessOwnerReportFiltersTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Business $grill;

    private Business $resort;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse('2026-11-23 04:00:00', 'UTC')); // 12:00 noon in Manila

        $town = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $this->owner = User::create(['email' => 'owner@example.com', 'name' => 'Owner', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->grill = $this->business('Ekslusibo Grill', 'Restaurant', $town);
        $this->resort = $this->business('Aplaya Resort', 'Resort', $town);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function business(string $name, string $category, Municipality $town): Business
    {
        return Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => BusinessCategory::firstOrCreate(['name' => $category])->id,
            'municipality_id' => $town->id,
            'business_name' => $name,
            'status' => 'approved',
            'latitude' => 12.86,
            'longitude' => 121.45,
        ]);
    }

    /** A completed order placed and completed at the given Manila time. */
    private function order(Business $business, string $manila, float $total, string $status = 'completed'): Order
    {
        $at = Carbon::parse($manila, 'Asia/Manila')->utc();
        $order = Order::create([
            'order_number' => 'TT-'.Str::random(6), 'business_id' => $business->id, 'user_id' => $this->owner->id,
            'customer_name' => 'Tourist', 'customer_email' => 't@example.com', 'order_type' => 'delivery',
            'payment_method' => 'gcash', 'payment_status' => 'paid', 'status' => $status,
            'subtotal' => $total, 'delivery_fee' => 0, 'total' => $total,
            'completed_at' => $status === 'completed' ? $at : null,
        ]);
        $order->forceFill(['created_at' => $at, 'updated_at' => $at])->saveQuietly();

        return $order;
    }

    private function getReport(string $url)
    {
        return $this->actingAs($this->owner, 'sanctum')->getJson($url);
    }

    public function test_sales_follow_the_period_without_dates_and_the_dates_when_given(): void
    {
        $this->order($this->grill, '2026-11-02 10:00', 100);
        $this->order($this->grill, '2026-11-20 10:00', 200);
        $this->order($this->grill, '2026-10-15 10:00', 400); // last month

        // Period only (as before): this month.
        $this->getReport('/api/business-owner/reports/sales?period=monthly')->assertOk()
            ->assertJsonPath('data.summary.total_orders', 2)
            ->assertJsonPath('data.custom_range', false);

        // Dates override the period, even when they reach into last month.
        $this->getReport('/api/business-owner/reports/sales?period=monthly&from=2026-10-01&to=2026-11-05')->assertOk()
            ->assertJsonPath('data.summary.total_orders', 2)
            ->assertJsonPath('data.custom_range', true);
        $this->assertEquals(500, $this->getReport('/api/business-owner/reports/sales?from=2026-10-01&to=2026-11-05')->json('data.summary.total_revenue'));

        // Only one end: open on the other side.
        $this->getReport('/api/business-owner/reports/sales?from=2026-11-10')->assertJsonPath('data.summary.total_orders', 1);
        $this->getReport('/api/business-owner/reports/sales?to=2026-10-31')->assertJsonPath('data.summary.total_orders', 1);
    }

    public function test_a_date_means_a_whole_manila_day(): void
    {
        // 23:30 Manila on Nov 20 is still Nov 20 (15:30 UTC); 00:30 Manila on Nov 21 is not.
        $this->order($this->grill, '2026-11-20 23:30', 100);
        $this->order($this->grill, '2026-11-21 00:30', 200);

        $this->getReport('/api/business-owner/reports/sales?from=2026-11-20&to=2026-11-20')->assertOk()
            ->assertJsonPath('data.summary.total_orders', 1);
        $this->assertEquals(100, $this->getReport('/api/business-owner/reports/sales?from=2026-11-20&to=2026-11-20')->json('data.summary.total_revenue'));
    }

    public function test_order_and_booking_reports_filter_by_when_they_were_placed(): void
    {
        $this->order($this->grill, '2026-11-02 10:00', 100, 'cancelled');
        $this->order($this->grill, '2026-11-20 10:00', 200);
        Booking::create(['booking_number' => 'BK-1', 'business_id' => $this->resort->id, 'user_id' => $this->owner->id, 'customer_name' => 'Guest', 'customer_email' => 'g@example.com', 'booking_type' => 'room', 'status' => 'confirmed', 'check_in_date' => '2026-12-01', 'check_out_date' => '2026-12-02', 'guests' => 2, 'total_amount' => 1500])
            ->forceFill(['created_at' => Carbon::parse('2026-11-03 09:00', 'Asia/Manila')->utc()])->saveQuietly();

        $this->getReport('/api/business-owner/reports/orders')->assertOk()->assertJsonPath('data.total_orders', 2);
        $this->getReport('/api/business-owner/reports/orders?from=2026-11-15')->assertOk()->assertJsonPath('data.total_orders', 1);
        $this->getReport('/api/business-owner/reports/bookings?from=2026-11-01&to=2026-11-05')->assertOk()->assertJsonPath('data.total_bookings', 1);
        $this->getReport('/api/business-owner/reports/bookings?from=2026-11-10')->assertOk()->assertJsonPath('data.total_bookings', 0);
    }

    public function test_date_from_after_date_to_is_refused_with_a_clear_message(): void
    {
        $this->getReport('/api/business-owner/reports/sales?from=2026-11-20&to=2026-11-01')
            ->assertStatus(422)->assertJsonPath('errors.from.0', 'Date From cannot be after Date To.');
        $this->getReport('/api/business-owner/reports/orders?from=not-a-date')->assertStatus(422);
    }

    public function test_business_and_business_type_filters_still_work(): void
    {
        $this->order($this->grill, '2026-11-20 10:00', 200);
        $resortOrder = $this->order($this->resort, '2026-11-20 11:00', 300);

        $this->getReport('/api/business-owner/reports/sales')->assertJsonPath('data.summary.total_orders', 2);
        $this->getReport("/api/business-owner/reports/sales?business_id={$this->grill->id}")->assertJsonPath('data.summary.total_orders', 1);
        $this->getReport('/api/business-owner/reports/sales?business_type=Resort')->assertJsonPath('data.summary.total_orders', 1);
        $this->assertEquals($resortOrder->total, $this->getReport('/api/business-owner/reports/sales?business_type=Resort')->json('data.summary.total_revenue'));

        // The business list the filter dropdowns use: every business with its category.
        $list = collect($this->getReport('/api/business-owner/businesses')->assertOk()->json('data'));
        $this->assertEqualsCanonicalizing(['Restaurant', 'Resort'], $list->pluck('category')->all());
    }

    public function test_exports_use_the_same_dates_as_the_screen(): void
    {
        $this->order($this->grill, '2026-11-02 10:00', 100);
        $this->order($this->grill, '2026-11-20 10:00', 200);

        $csv = $this->actingAs($this->owner, 'sanctum')->get('/api/business-owner/exports/csv?type=sales&from=2026-11-15&to=2026-11-23');
        $csv->assertOk();
        $body = $csv->getContent();
        $this->assertStringContainsString('200', $body);
        $this->assertStringNotContainsString(',100', $body);
        $this->assertStringContainsString('2026-11-15_to_2026-11-23', (string) $csv->headers->get('Content-Disposition'));

        $orders = $this->actingAs($this->owner, 'sanctum')->get('/api/business-owner/exports/csv?type=orders&from=2026-11-15')->getContent();
        $this->assertMatchesRegularExpression('/completed,1,/', $orders);
    }
}
