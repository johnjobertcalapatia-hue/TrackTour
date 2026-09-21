<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\FoodPreparationRecord;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\PreparationPredictionLog;
use App\Models\User;
use App\Services\PreparationPredictionService;
use App\Services\SmartDispatchService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class PreparationPredictionTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private Business $business;
    private Municipality $municipality;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $category = BusinessCategory::create(['name' => 'Restaurant']);

        $this->municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
        ]);

        $this->business = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $this->municipality->id,
            'business_name' => 'Test Restaurant',
            'business_description' => 'A test restaurant',
            'status' => 'approved',
        ]);
    }

    private function makeOffering(bool $eligible = true): Offering
    {
        return Offering::create([
            'business_id' => $this->business->id,
            'name' => 'Adobo',
            'description' => 'Classic Filipino dish',
            'price' => 150.00,
            'status' => 'available',
            'is_available' => true,
            'type' => 'menu',
            'prediction_eligible' => $eligible,
            'preparation_record_count' => $eligible ? Offering::MINIMUM_RECORDS_FOR_PREDICTION : 0,
        ]);
    }

    private function makeOrder(Offering $offering, array $orderOverrides = [], ?array $itemOverrides = null): Order
    {
        $order = Order::create(array_merge([
            'order_number' => 'ORD-' . uniqid(),
            'business_id' => $this->business->id,
            'customer_name' => 'Customer 1',
            'customer_email' => 'customer@example.com',
            'order_type' => 'delivery',
            'payment_method' => 'cash',
            'payment_status' => 'paid',
            'status' => 'accepted',
            'subtotal' => 150.00,
            'delivery_fee' => 30.00,
            'total' => 180.00,
        ], $orderOverrides));

        OrderItem::create(array_merge([
            'order_id' => $order->id,
            'offering_id' => $offering->id,
            'product_name' => $offering->name,
            'quantity' => 1,
            'unit_price' => $offering->price,
            'subtotal' => $offering->price,
        ], $itemOverrides ?? []));

        return $order->load('items');
    }

    private function seedPreparationRecords(Offering $offering, int $count, int $seconds): void
    {
        $historyOrder = Order::create([
            'order_number' => 'ORD-HIST' . uniqid(),
            'business_id' => $this->business->id,
            'customer_name' => 'History',
            'customer_email' => 'history@example.com',
            'order_type' => 'delivery',
            'status' => 'completed',
            'subtotal' => 100.00,
            'total' => 100.00,
        ]);

        $start = now()->subMinutes(30);
        for ($i = 0; $i < $count; $i++) {
            FoodPreparationRecord::create([
                'restaurant_id' => $this->business->id,
                'menu_item_id' => $offering->id,
                'restaurant_order_id' => $historyOrder->id,
                'preparation_started_at' => $start->copy()->addMinutes($i * 5),
                'ready_at' => $start->copy()->addMinutes($i * 5)->addSeconds($seconds),
                'actual_preparation_seconds' => $seconds,
                'quantity' => 1,
                'day_of_week' => $start->dayOfWeek,
                'hour_of_day' => $start->hour,
                'kitchen_load_at_start' => 'low',
                'is_valid_for_training' => true,
            ]);
        }
    }

    public function test_predict_for_menu_item_uses_fallback_when_no_records(): void
    {
        $offering = $this->makeOffering(false);
        $service = app(PreparationPredictionService::class);

        [$seconds, $source] = $service->predictForMenuItem($this->business->id, $offering->id);

        $this->assertSame(900, $seconds);
        $this->assertSame('restaurant_default', $source);
    }

    public function test_predict_for_menu_item_uses_historical_average(): void
    {
        $offering = $this->makeOffering(false);
        $this->seedPreparationRecords($offering, 10, 600);
        $service = app(PreparationPredictionService::class);

        [$seconds, $source] = $service->predictForMenuItem($this->business->id, $offering->id);

        $this->assertEqualsWithDelta(600, $seconds, 0.5);
        $this->assertSame('historical_avg', $source);
    }

    public function test_predict_for_menu_item_uses_weighted_average_with_recent_bias(): void
    {
        $offering = $this->makeOffering(false);
        $this->seedPreparationRecords($offering, 8, 300);
        $this->seedPreparationRecords($offering, 15, 900);
        $service = app(PreparationPredictionService::class);

        [$seconds, $source] = $service->predictForMenuItem($this->business->id, $offering->id);

        $this->assertSame('weighted_avg', $source);
        $this->assertGreaterThan(600, $seconds);
    }

    public function test_complete_order_ready_time_takes_max_of_items(): void
    {
        $this->business->getOrCreateRestaurantSetting()->update([
            'auto_preparation_prediction_enabled' => true,
        ]);
        $fast = $this->makeOffering(false);
        $slow = $this->makeOffering(false);
        $this->seedPreparationRecords($fast, 10, 300);
        $this->seedPreparationRecords($slow, 10, 1200);

        $order = $this->makeOrder($fast);
        OrderItem::create([
            'order_id' => $order->id,
            'offering_id' => $slow->id,
            'product_name' => $slow->name,
            'quantity' => 1,
            'unit_price' => $slow->price,
            'subtotal' => $slow->price,
        ]);
        $order->load('items');

        $service = app(PreparationPredictionService::class);
        $result = $service->predictCompleteOrderReadyTime($order);

        $this->assertEquals(1200, $result['seconds']);
    }

    public function test_predict_and_log_updates_order_and_creates_log(): void
    {
        $this->business->getOrCreateRestaurantSetting()->update([
            'auto_preparation_prediction_enabled' => true,
        ]);
        $offering = $this->makeOffering();
        $this->seedPreparationRecords($offering, 10, 540);
        $order = $this->makeOrder($offering);

        $service = app(PreparationPredictionService::class);
        $seconds = $service->predictAndLog($order);

        $order->refresh();
        $this->assertSame(540, $seconds);
        $this->assertSame(540, $order->predicted_preparation_seconds);
        $this->assertNotNull($order->predicted_ready_at);
        $this->assertSame('historical_avg', $order->prediction_source);

        $this->assertDatabaseHas('preparation_prediction_logs', [
            'restaurant_id' => $this->business->id,
            'restaurant_order_id' => $order->id,
            'menu_item_id' => $offering->id,
            'prediction_source' => 'historical_avg',
            'predicted_seconds' => 540,
        ]);
    }

    public function test_record_actual_preparation_creates_record_and_refreshes_stats(): void
    {
        $offering = $this->makeOffering(false);
        $this->seedPreparationRecords($offering, 5, 300);
        $order = $this->makeOrder($offering, [
            'preparation_started_at' => now()->subMinutes(10),
            'food_ready_at' => now(),
            'predicted_preparation_seconds' => 540,
        ]);

        $service = app(PreparationPredictionService::class);
        $service->recordActualPreparation($order);

        $order->refresh();
        $this->assertSame(600, $order->actual_preparation_seconds);
        $this->assertSame(60, $order->prediction_error_seconds);

        $this->assertDatabaseHas('food_preparation_records', [
            'restaurant_id' => $this->business->id,
            'restaurant_order_id' => $order->id,
            'menu_item_id' => $offering->id,
            'actual_preparation_seconds' => 600,
            'is_valid_for_training' => true,
        ]);

        $offering->refresh();
        $this->assertTrue($offering->prediction_eligible);
    }

    public function test_estimate_rider_eta_returns_default_when_no_coordinates(): void
    {
        $offering = $this->makeOffering();
        $order = $this->makeOrder($offering);
        $service = app(SmartDispatchService::class);

        $eta = $service->estimateRiderEta($order);

        $this->assertSame(480, $eta);
    }

    public function test_calculate_dispatch_time_uses_ready_time_eta_and_buffer(): void
    {
        $this->business->update([
            'latitude' => 12.0,
            'longitude' => 121.0,
        ]);

        $offering = $this->makeOffering();
        $order = $this->makeOrder($offering, [
            'predicted_ready_at' => now()->addSeconds(3000),
            'rider_eta_seconds' => 480,
            'pickup_buffer_seconds' => 120,
        ]);

        $service = app(SmartDispatchService::class);
        $dispatchTime = $service->calculateDispatchTime($order);

        $this->assertNotNull($dispatchTime);
        $this->assertEquals(now()->addSeconds(2400)->timestamp, $dispatchTime->timestamp, '', 5);
    }

    public function test_schedule_dispatch_creates_scheduled_delivery_for_future(): void
    {
        $this->business->update([
            'latitude' => 12.0,
            'longitude' => 121.0,
        ]);

        $offering = $this->makeOffering();
        $order = $this->makeOrder($offering, [
            'predicted_ready_at' => now()->addSeconds(3600),
        ]);

        $service = app(SmartDispatchService::class);
        $service->scheduleDispatch($order);

        $order->refresh();
        $this->assertNotNull($order->dispatch_scheduled_at);
        $this->assertSame(480, $order->rider_eta_seconds);
        $this->assertSame(120, $order->pickup_buffer_seconds);

        $delivery = Delivery::where('order_id', $order->id)->first();
        $this->assertNotNull($delivery);
        $this->assertSame('scheduled', $delivery->dispatch_status);
    }

    public function test_schedule_dispatch_ignores_non_delivery_orders(): void
    {
        $offering = $this->makeOffering();
        $order = $this->makeOrder($offering, ['order_type' => 'pickup']);

        app(SmartDispatchService::class)->scheduleDispatch($order);

        $this->assertDatabaseCount('deliveries', 0);
    }
}
