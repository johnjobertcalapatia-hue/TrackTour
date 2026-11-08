<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * GET /api/tourist/travels — municipalities the tourist has been to.
 */
class TouristTravelsTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    private Municipality $bansud;

    private Municipality $gloria;

    private Municipality $roxas;

    private Business $resort;

    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tourist = User::create(['email' => 'tourist@example.com', 'password' => Hash::make('Password123!'), 'role' => 'tourist', 'account_status' => 'approved']);
        $owner = User::create(['email' => 'owner@example.com', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro', 'latitude' => 12.8667, 'longitude' => 121.4500]);
        $this->gloria = Municipality::create(['name' => 'Gloria', 'district' => '2', 'province' => 'Oriental Mindoro', 'latitude' => 12.9750, 'longitude' => 121.4667]);
        $this->roxas = Municipality::create(['name' => 'Roxas', 'district' => '2', 'province' => 'Oriental Mindoro', 'latitude' => 12.5833, 'longitude' => 121.5167]);
        $this->resort = Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Resort'])->id,
            'municipality_id' => $this->roxas->id,
            'business_name' => 'Roxas Beach Resort',
            'status' => 'approved',
        ]);
    }

    private function order(float $lat, float $lng, string $status = 'delivered', string $type = 'delivery', ?User $for = null): Order
    {
        $for ??= $this->tourist;

        return Order::create([
            'order_number' => 'TT-'.(++$this->seq), 'user_id' => $for->id, 'customer_name' => 'T', 'customer_email' => $for->email,
            'order_type' => $type, 'payment_method' => 'cash', 'payment_status' => 'paid', 'status' => $status,
            'subtotal' => 0, 'delivery_fee' => 0, 'total' => 0, 'delivery_latitude' => $lat, 'delivery_longitude' => $lng,
        ]);
    }

    private function booking(string $status, string $checkIn): Booking
    {
        return Booking::create([
            'booking_number' => 'BK-'.(++$this->seq), 'business_id' => $this->resort->id, 'user_id' => $this->tourist->id,
            'customer_name' => 'T', 'customer_email' => $this->tourist->email, 'booking_type' => 'stay', 'status' => $status,
            'check_in_date' => $checkIn, 'check_out_date' => $checkIn, 'guests' => 2, 'total_amount' => 1000,
        ]);
    }

    private function fetch()
    {
        return collect($this->actingAs($this->tourist, 'sanctum')->getJson('/api/tourist/travels')->assertOk()->json('data.municipalities'))->keyBy('name');
    }

    public function test_lists_municipalities_from_deliveries_stays_and_rides(): void
    {
        $this->order(12.86, 121.45);                                    // food delivered in Bansud
        $this->order(12.861, 121.451, 'completed');                     // again in Bansud
        $this->order(12.97, 121.47, 'completed', 'transport');          // ride dropped off in Gloria
        $this->booking('completed', now()->subDays(3)->toDateString()); // stayed in Roxas

        $visits = $this->fetch();

        $this->assertEqualsCanonicalizing(['Bansud', 'Gloria', 'Roxas'], $visits->keys()->all());
        $this->assertSame(2, $visits['Bansud']['food_orders']);
        $this->assertSame(1, $visits['Gloria']['trips']);
        $this->assertSame(1, $visits['Roxas']['stays']);
        $this->assertSame('Oriental Mindoro', $visits['Roxas']['province']);
        $this->assertNotNull($visits['Bansud']['last_visited_at']);
    }

    public function test_ignores_unfinished_orders_future_or_cancelled_stays_and_other_peoples_records(): void
    {
        $this->order(12.86, 121.45, 'preparing');                       // not delivered yet
        $this->order(14.6, 120.98);                                     // Manila: not a covered municipality
        $this->booking('confirmed', now()->addWeek()->toDateString());  // future stay
        $this->booking('cancelled', now()->subWeek()->toDateString());
        $other = User::create(['email' => 'other@example.com', 'password' => Hash::make('Password123!'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->order(12.97, 121.47, 'delivered', 'delivery', $other);

        $this->assertCount(0, $this->fetch());
    }

    public function test_requires_a_signed_in_tourist(): void
    {
        $this->getJson('/api/tourist/travels')->assertUnauthorized();
    }
}
