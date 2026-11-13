<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\DeliveryPickupStop;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\User;
use App\Services\PickupSequenceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * TT-04544 (2026-11-12): the restaurant pressed "Ready for Pickup" on the
 * order page (PATCH /business-owner/orders/{id}/status → ready). The order
 * became 'ready' but its items stayed 'preparing', and the rider's pickup gate
 * — which reads the items — kept answering "The restaurant is still preparing
 * your order", so Confirm Pick Up never unlocked after the rider arrived.
 * A READY order now carries its own restaurant's active items to 'ready'.
 */
class OrderReadyCarriesItemsTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $rider;
    private Business $business;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::create(['name' => 'Owner', 'email' => 'owner@ready.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->rider = User::create(['name' => 'Rider', 'email' => 'rider@ready.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved']);
        $this->business = $this->restaurant('Ekslusibo Grill', $this->owner);
    }

    private function restaurant(string $name, User $owner): Business
    {
        return Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => BusinessCategory::firstOrCreate(['name' => 'Restaurant'])->id,
            'municipality_id' => Municipality::firstOrCreate(['name' => 'Bansud'], ['district' => '2nd', 'province' => 'Oriental Mindoro'])->id,
            'business_name' => $name,
            'status' => 'approved',
            'latitude' => 12.8667,
            'longitude' => 121.45,
        ]);
    }

    /** A GCash delivery order a rider accepted and reached (like TT-04544), items still preparing. */
    private function arrivedOrder(): array
    {
        $tourist = User::create(['email' => Str::random(6).'@tourist.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $order = Order::create([
            'order_number' => 'TT-'.Str::upper(Str::random(5)), 'business_id' => $this->business->id, 'user_id' => $tourist->id,
            'customer_name' => 'Tourist', 'customer_email' => $tourist->email, 'customer_phone' => '09123456789',
            'order_type' => 'delivery', 'payment_method' => 'gcash', 'payment_status' => 'paid', 'status' => 'preparing',
            'subtotal' => 300, 'delivery_fee' => 40, 'discount' => 0, 'total' => 340,
        ]);
        // Items as checkout saved them for TT-04544: no business_id of their own.
        $a = OrderItem::create(['order_id' => $order->id, 'business_id' => null, 'product_name' => 'Binange ng Mamay', 'quantity' => 2, 'unit_price' => 100, 'subtotal' => 200, 'status' => 'preparing']);
        $b = OrderItem::create(['order_id' => $order->id, 'business_id' => null, 'product_name' => 'Grilled Liempo', 'quantity' => 1, 'unit_price' => 100, 'subtotal' => 100, 'status' => 'preparing']);
        $delivery = Delivery::create([
            'order_id' => $order->id, 'rider_id' => $this->rider->id, 'status' => 'arrived_pickup', 'assigned_at' => now(),
            'pickup_address' => 'Pag-asa, Bansud', 'delivery_address' => 'Kawit, Gloria', 'rider_commission' => 40,
        ]);
        $stop = DeliveryPickupStop::create([
            'delivery_id' => $delivery->id, 'order_id' => $order->id, 'business_id' => $this->business->id, 'sequence' => 1,
            'pickup_latitude' => 12.8667, 'pickup_longitude' => 121.45, 'pickup_address' => 'Pag-asa, Bansud',
            'status' => 'pending', 'arrived_at' => now(),
        ]);

        return [$order, $a, $b, $delivery, $stop];
    }

    public function test_ready_from_the_order_page_unlocks_the_riders_pickup(): void
    {
        [$order, $a, $b, $delivery] = $this->arrivedOrder();
        $pickup = app(PickupSequenceService::class);
        $this->assertFalse($pickup->businessReady($delivery, $this->business->id), 'before: still preparing');

        $this->actingAs($this->owner, 'sanctum')
            ->patchJson("/api/business-owner/orders/{$order->id}/status", ['status' => 'ready'])
            ->assertOk();

        $this->assertSame('ready', $order->fresh()->status);
        $this->assertSame('ready', $a->fresh()->status);
        $this->assertSame('ready', $b->fresh()->status);
        $this->assertNotNull($a->fresh()->ready_at);
        $this->assertTrue($pickup->businessReady($delivery->fresh(), $this->business->id), 'the rider is no longer told the food is being prepared');
    }

    public function test_any_path_that_saves_the_order_ready_carries_the_items(): void
    {
        // e.g. the staff API / web status endpoints, which only update the order.
        [$order, $a, $b] = $this->arrivedOrder();

        $order->update(['status' => 'ready']);

        $this->assertSame(['ready', 'ready'], [$a->fresh()->status, $b->fresh()->status]);
    }

    public function test_cancelled_and_rejected_items_are_left_alone(): void
    {
        [$order, $a, $b] = $this->arrivedOrder();
        $b->update(['status' => 'rejected']);
        $c = OrderItem::create(['order_id' => $order->id, 'product_name' => 'Halo-halo', 'quantity' => 1, 'unit_price' => 50, 'subtotal' => 50, 'status' => 'cancelled']);

        $order->update(['status' => 'ready']);

        $this->assertSame('ready', $a->fresh()->status);
        $this->assertSame('rejected', $b->fresh()->status);
        $this->assertSame('cancelled', $c->fresh()->status);
    }

    public function test_another_restaurants_items_are_never_declared_ready(): void
    {
        [$order, $a] = $this->arrivedOrder();
        $other = $this->restaurant('Other Kitchen', User::create(['email' => 'other@ready.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']));
        $theirs = OrderItem::create(['order_id' => $order->id, 'business_id' => $other->id, 'product_name' => 'Pancit', 'quantity' => 1, 'unit_price' => 80, 'subtotal' => 80, 'status' => 'preparing']);

        $order->update(['status' => 'ready']);

        $this->assertSame('ready', $a->fresh()->status);
        $this->assertSame('preparing', $theirs->fresh()->status);
    }

    /** The broken state as it exists in old data (written past the model hook). */
    private function legacyStuckOrder(): array
    {
        [$order, $a, $b] = $this->arrivedOrder();
        \Illuminate\Support\Facades\DB::table('orders')->where('id', $order->id)->update(['status' => 'ready']);

        return [$order, $a, $b];
    }

    public function test_the_repair_command_reports_without_writing_by_default(): void
    {
        [$order, $a] = $this->legacyStuckOrder();

        $this->artisan('orders:repair-ready-items')
            ->expectsOutputToContain($order->order_number)
            ->expectsOutputToContain('Report only')
            ->assertSuccessful();

        $this->assertSame('preparing', $a->fresh()->status);
    }

    public function test_the_repair_command_applies_only_with_apply_and_only_to_the_orders_own_items(): void
    {
        [$order, $a, $b] = $this->legacyStuckOrder();
        $other = $this->restaurant('Other Kitchen', User::create(['email' => 'other2@ready.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']));
        $theirs = OrderItem::create(['order_id' => $order->id, 'business_id' => $other->id, 'product_name' => 'Pancit', 'quantity' => 1, 'unit_price' => 80, 'subtotal' => 80, 'status' => 'preparing']);
        [$untouched, $untouchedItem] = $this->legacyStuckOrder();

        $this->artisan('orders:repair-ready-items', ['--apply' => true, '--order' => $order->order_number])
            ->expectsOutputToContain('Repaired 1 of 1')
            ->assertSuccessful();

        $this->assertSame(['ready', 'ready'], [$a->fresh()->status, $b->fresh()->status]);
        $this->assertSame('preparing', $theirs->fresh()->status, 'another restaurant\'s food is never declared ready');
        $this->assertSame('preparing', $untouchedItem->fresh()->status, '--order limits the repair');

        // A second run finds nothing left for that order.
        $this->artisan('orders:repair-ready-items', ['--order' => $order->order_number])
            ->expectsOutputToContain('Nothing to repair')
            ->assertSuccessful();
    }

    public function test_an_order_that_was_already_ready_is_not_touched_again(): void
    {
        [$order, $a] = $this->arrivedOrder();
        $order->update(['status' => 'ready']);
        $readyAt = $a->fresh()->ready_at;
        $this->travel(5)->minutes();

        $order->update(['notes' => 'unrelated change']);

        $this->assertEquals($readyAt, $a->fresh()->ready_at);
    }
}
