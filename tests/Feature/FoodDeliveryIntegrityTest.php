<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\GroupCheckout;
use App\Models\MenuAvailabilityEvent;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\OfferingVariation;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\User;
use App\Services\MenuAvailabilityService;
use Illuminate\Database\Events\TransactionBeginning;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use LogicException;
use Tests\TestCase;

/**
 * Secure transaction architecture, Stage 3 — food delivery:
 *   manual availability (no stock quantities) with an append-only,
 *   per-business SHA-256 history; checkout revalidation inside the order
 *   transaction; accepted orders never rewritten by later menu changes.
 */
class FoodDeliveryIntegrityTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private User $tourist;

    private Business $grill;

    private Business $cafe;

    private Offering $inasal;

    private Offering $pancit;

    private Offering $halo;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(); // delivery-fee routing falls back to the straight-line estimate

        $this->owner = User::create(['name' => 'Owner', 'email' => 'owner@example.com', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->tourist = User::create(['name' => 'Jayvie De Torres', 'email' => 'tourist@example.com', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $this->grill = $this->business('Ekslusibo Grill', 12.51, 121.31);
        $this->cafe = $this->business('Bansud Cafe', 12.52, 121.32);
        $this->inasal = $this->offering($this->grill, 'Chicken Inasal', 150);
        $this->pancit = $this->offering($this->grill, 'Pancit', 120);
        $this->halo = $this->offering($this->cafe, 'Halo-halo', 90);
    }

    private function business(string $name, float $lat, float $lng): Business
    {
        $allDays = array_fill_keys(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], [['open' => '00:00', 'close' => '23:59']]);

        return Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => BusinessCategory::firstOrCreate(['name' => 'Restaurant'])->id,
            'municipality_id' => Municipality::firstOrCreate(['name' => 'Bansud'], ['district' => '1st', 'province' => 'Oriental Mindoro', 'latitude' => 12.5, 'longitude' => 121.3])->id,
            'business_name' => $name,
            'status' => 'approved',
            'force_closed' => false,
            'business_hours' => $allDays,
            'latitude' => $lat,
            'longitude' => $lng,
        ]);
    }

    private function offering(Business $business, string $name, float $price): Offering
    {
        return app(MenuAvailabilityService::class)->create(fn () => Offering::create([
            'business_id' => $business->id, 'name' => $name, 'price' => $price, 'is_available' => true, 'status' => 'available',
        ]), 'test.create');
    }

    private function flatOrder(array $items, array $overrides = [])
    {
        return $this->actingAs($this->tourist, 'sanctum')->postJson('/api/tourist/food/order', array_merge([
            'business_id' => $this->grill->id,
            'items' => $items,
            'order_type' => 'delivery',
            'delivery_speed' => 'standard',
            'delivery_address' => '123 Test St',
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'customer_phone' => '09171234567',
            'payment_method' => 'gcash',
        ], $overrides));
    }

    private function groupOrder()
    {
        return $this->actingAs($this->tourist, 'sanctum')->postJson('/api/tourist/food/group-order', [
            'restaurants' => [
                ['business_id' => $this->grill->id, 'items' => [['offering_id' => $this->inasal->id, 'quantity' => 2, 'notes' => null]]],
                ['business_id' => $this->cafe->id, 'items' => [['offering_id' => $this->halo->id, 'quantity' => 1, 'notes' => null]]],
            ],
            'order_type' => 'delivery',
            'delivery_address' => '123 Test St',
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'delivery_speed' => 'standard',
            'rider_tip' => 0,
            'customer_phone' => '09171234567',
            'payment_method' => 'gcash',
        ]);
    }

    /** Simulates a toggle that commits after the friendly pre-check but before the order transaction locks the row. */
    private function flipWhenCheckoutTransactionStarts(Offering $offering, array $change): void
    {
        $done = false;
        Event::listen(TransactionBeginning::class, function () use (&$done, $offering, $change) {
            if ($done) {
                return;
            }
            $done = true;
            DB::table('offerings')->where('id', $offering->id)->update($change);
        });
    }

    private function events(Offering $offering)
    {
        return MenuAvailabilityEvent::where('offering_id', $offering->id)->orderBy('sequence')->get();
    }

    // ---------------- availability history ----------------

    public function test_every_availability_change_through_the_api_is_recorded_once_with_actor_and_source(): void
    {
        $this->actingAs($this->owner, 'sanctum')->putJson("/api/business-owner/menu/{$this->inasal->id}", ['is_available' => false])->assertOk();
        $this->actingAs($this->owner, 'sanctum')->putJson("/api/business-owner/menu/{$this->inasal->id}", ['name' => 'Chicken Inasal Paa'])->assertOk(); // no availability change
        $this->actingAs($this->owner, 'sanctum')->putJson("/api/business-owner/menu/{$this->inasal->id}", ['is_available' => true])->assertOk();

        $events = $this->events($this->inasal);
        $this->assertSame([null, true, false], $events->pluck('previous_available')->all());
        $this->assertSame([true, false, true], $events->pluck('new_available')->all());
        $this->assertSame(['test.create', 'owner_menu_manage.edit', 'owner_menu_manage.edit'], $events->pluck('source')->all());
        $this->assertSame($this->owner->id, $events[1]->actor_id);
        $this->assertSame('business_owner', $events[1]->actor_role);
        $this->assertSame([], app(MenuAvailabilityService::class)->verifyChain($this->grill->id));
    }

    public function test_the_service_and_the_observer_never_record_the_same_change_twice(): void
    {
        $service = app(MenuAvailabilityService::class);
        $service->update($this->inasal, ['is_available' => false, 'status' => 'unavailable'], 'owner_offerings.toggle');
        $this->assertCount(1, $this->events($this->inasal)->where('source', 'owner_offerings.toggle'));
        $this->assertCount(0, MenuAvailabilityEvent::where('source', 'unrouted')->get());

        // A write that bypasses the service is still caught, exactly once, as "unrouted".
        $this->pancit->update(['is_available' => false]);
        $unrouted = MenuAvailabilityEvent::where('offering_id', $this->pancit->id)->where('source', 'unrouted')->get();
        $this->assertCount(1, $unrouted);
        $this->assertTrue($unrouted[0]->previous_available);
        $this->assertFalse($unrouted[0]->new_available);
    }

    public function test_offering_endpoints_archive_and_bulk_changes_are_recorded(): void
    {
        $this->actingAs($this->owner, 'sanctum')->putJson("/api/business-owner/offerings/{$this->pancit->id}", [
            'business_id' => $this->grill->id, 'name' => 'Pancit', 'price' => 120, 'status' => 'unavailable',
        ]);
        $this->actingAs($this->owner, 'sanctum')->deleteJson("/api/business-owner/offerings/{$this->inasal->id}");
        $bulk = app(MenuAvailabilityService::class)->bulk(Offering::whereIn('id', [$this->halo->id])->get(), ['status' => 'unavailable', 'is_available' => false], 'owner_offerings.bulk');

        $this->assertSame(1, $bulk);
        $this->assertTrue($this->events($this->inasal)->contains('source', 'owner_offerings.archive'));
        $this->assertTrue($this->events($this->halo)->contains('source', 'owner_offerings.bulk'));
        $this->assertFalse(Offering::find($this->halo->id)->is_available);
    }

    public function test_variation_availability_is_recorded_too(): void
    {
        $service = app(MenuAvailabilityService::class);
        $variation = $service->createVariation(fn () => OfferingVariation::create(['offering_id' => $this->inasal->id, 'name' => 'Large', 'price' => 180, 'is_available' => true]), 'test.variation');
        $service->updateVariation($variation, ['is_available' => false], 'owner_menu.variation');

        $events = MenuAvailabilityEvent::where('offering_variation_id', $variation->id)->orderBy('sequence')->get();
        $this->assertCount(2, $events);
        $this->assertSame('Chicken Inasal — Large', $events[1]->item_name);
        $this->assertFalse($events[1]->new_available);
    }

    public function test_each_business_has_its_own_gapless_chain(): void
    {
        $service = app(MenuAvailabilityService::class);
        foreach ([false, true, false] as $value) {
            $service->update($this->inasal, ['is_available' => $value], 'test');
            $service->update($this->halo, ['is_available' => $value], 'test');
        }

        foreach ([$this->grill, $this->cafe] as $business) {
            $sequences = MenuAvailabilityEvent::where('business_id', $business->id)->orderBy('sequence')->pluck('sequence')->all();
            $this->assertSame(range(1, count($sequences)), $sequences);
            $this->assertSame([], $service->verifyChain($business->id));
        }
        $head = DB::table('menu_availability_chains')->where('business_id', $this->grill->id)->first();
        $this->assertSame(MenuAvailabilityEvent::where('business_id', $this->grill->id)->max('sequence'), (int) $head->last_sequence);
    }

    public function test_history_is_append_only_and_tampering_is_detected(): void
    {
        $event = $this->events($this->inasal)->first();
        try {
            $event->update(['new_available' => false]);
            $this->fail('Model update should be refused.');
        } catch (LogicException) {
        }
        try {
            DB::table('menu_availability_events')->where('id', $event->id)->update(['new_available' => false]);
            $this->fail('Database update should be refused.');
        } catch (QueryException) {
        }

        // Someone with direct database privileges drops the trigger and edits a row.
        DB::unprepared('DROP TRIGGER IF EXISTS menu_availability_events_no_update');
        DB::table('menu_availability_events')->where('id', $event->id)->update(['actor_role' => 'forged']);
        $this->assertNotSame([], app(MenuAvailabilityService::class)->verifyChain($this->grill->id));
    }

    public function test_a_sequence_cannot_be_claimed_twice(): void
    {
        $first = $this->events($this->inasal)->first();
        $this->expectException(QueryException::class);
        DB::table('menu_availability_events')->insert([
            'business_id' => $first->business_id, 'sequence' => $first->sequence, 'offering_id' => $first->offering_id, 'item_name' => 'x',
            'new_available' => 1, 'actor_role' => 'system', 'source' => 'forged', 'recorded_at_ms' => 1,
            'previous_hash' => str_repeat('0', 64), 'current_hash' => str_repeat('c', 64),
        ]);
    }

    // ---------------- no stock quantities ----------------

    public function test_stock_is_neither_accepted_nor_returned(): void
    {
        DB::table('offerings')->where('id', $this->inasal->id)->update(['stock' => 7]); // legacy value kept in the deprecated column

        $this->actingAs($this->owner, 'sanctum')->putJson("/api/business-owner/menu/{$this->inasal->id}", ['stock' => 99, 'unit' => 'pc'])->assertOk();
        $this->assertSame(7, (int) DB::table('offerings')->where('id', $this->inasal->id)->value('stock'));
        $this->assertSame('pc', Offering::find($this->inasal->id)->unit);

        $created = $this->actingAs($this->owner, 'sanctum')->postJson('/api/business-owner/offerings', [
            'business_id' => $this->grill->id, 'name' => 'Sisig', 'price' => 180, 'status' => 'available', 'stock' => 50,
        ])->assertCreated()->json('data');
        $this->assertArrayNotHasKey('stock', $created);
        $this->assertNotSame(50, (int) DB::table('offerings')->where('name', 'Sisig')->value('stock'));
        $this->assertNotContains('stock', (new Offering)->getFillable());
    }

    // ---------------- checkout revalidation ----------------

    public function test_a_stale_cart_or_direct_request_cannot_order_an_unavailable_item(): void
    {
        app(MenuAvailabilityService::class)->update($this->inasal, ['is_available' => false, 'status' => 'unavailable'], 'test');

        $this->flatOrder([['offering_id' => $this->inasal->id, 'quantity' => 1]])->assertStatus(422);
        $this->groupOrder()->assertStatus(422);

        $this->assertSame(0, Order::count());
        $this->assertSame(0, OrderItem::count());
        $this->assertSame(0, GroupCheckout::count());
    }

    public function test_an_item_switched_off_during_single_restaurant_checkout_leaves_no_partial_order(): void
    {
        $this->flipWhenCheckoutTransactionStarts($this->pancit, ['is_available' => false, 'status' => 'unavailable']);

        $this->flatOrder([['offering_id' => $this->inasal->id, 'quantity' => 1], ['offering_id' => $this->pancit->id, 'quantity' => 1]])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Pancit is no longer available. Please remove it from your cart.');

        $this->assertSame(0, Order::count());
        $this->assertSame(0, OrderItem::count());
    }

    public function test_an_item_switched_off_during_group_checkout_rolls_back_the_whole_group(): void
    {
        $this->flipWhenCheckoutTransactionStarts($this->halo, ['is_available' => false, 'status' => 'unavailable']);

        $this->groupOrder()->assertStatus(422)->assertJsonPath('message', 'Halo-halo is no longer available. Please remove it from your cart.');

        $this->assertSame(0, GroupCheckout::count());
        $this->assertSame(0, Order::count());
        $this->assertSame(0, OrderItem::count());
    }

    public function test_a_price_change_during_checkout_is_refused(): void
    {
        $this->flipWhenCheckoutTransactionStarts($this->inasal, ['price' => 175]);

        $this->flatOrder([['offering_id' => $this->inasal->id, 'quantity' => 1]])
            ->assertStatus(422)
            ->assertJsonPath('message', 'The price of Chicken Inasal changed. Please review your cart before placing the order.');
        $this->assertSame(0, Order::count());
    }

    public function test_group_checkout_still_creates_one_canonical_order_with_items_per_restaurant(): void
    {
        $this->groupOrder()->assertCreated();

        $this->assertSame(1, GroupCheckout::count());
        $this->assertSame(1, Order::count());
        $this->assertEqualsCanonicalizing([$this->grill->id, $this->cafe->id], OrderItem::pluck('business_id')->all());
    }

    // ---------------- accepted orders stay historically accurate ----------------

    public function test_menu_changes_never_cancel_or_rewrite_an_accepted_order(): void
    {
        $orderId = $this->flatOrder([['offering_id' => $this->inasal->id, 'quantity' => 2]], ['payment_method' => 'cash'])->assertCreated()->json('data.order.id');
        $order = Order::findOrFail($orderId);
        $order->update(['status' => 'accepted']);
        $item = OrderItem::where('order_id', $orderId)->sole();

        app(MenuAvailabilityService::class)->update($this->inasal, ['is_available' => false, 'status' => 'unavailable', 'name' => 'Inasal (sold out)', 'price' => 999], 'owner_menu.edit');

        $this->assertSame('accepted', $order->fresh()->status);
        $fresh = $item->fresh();
        $this->assertSame('Chicken Inasal', $fresh->product_name);
        $this->assertEquals(150, $fresh->unit_price);
        $this->assertEquals(300, $fresh->subtotal);
        $this->assertSame(2, (int) $fresh->quantity);
        $this->assertSame(0, (int) $fresh->cancelled_quantity);
        $this->assertEquals(300, (float) $order->fresh()->subtotal);
    }

    // Stage 5 rule (2026-11-11): the rider earns the full delivery fee (was a flat ₱40).
    public function test_a_new_food_delivery_pays_the_rider_the_full_delivery_fee(): void
    {
        $orderId = $this->flatOrder([['offering_id' => $this->inasal->id, 'quantity' => 1]], ['payment_method' => 'cash'])->assertCreated()->json('data.order.id');
        $order = Order::findOrFail($orderId);
        $delivery = \App\Models\Delivery::where('order_id', $orderId)->sole();

        $this->assertGreaterThan(0, (float) $order->delivery_fee);
        $this->assertEquals((float) $order->delivery_fee, (float) $delivery->rider_commission);
    }
}
