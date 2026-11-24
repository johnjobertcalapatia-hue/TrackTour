<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Promotion;
use App\Models\Staff;
use App\Models\StaffRole;
use App\Models\User;
use App\Services\CheckoutAvailabilityGuard;
use App\Support\StaffPermissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use Tests\TestCase;

/**
 * Promotions Part A: dish sales. The server alone works out the sale price;
 * the business pays for it (system fee on the lower food total); order items
 * keep the price they were sold at; sales never overlap or make a dish free.
 */
class DishSalesTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private User $tourist;

    private Business $grill;

    private Business $cafe;

    private Offering $sisig;

    private Offering $halo;

    private Offering $latte;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake();
        Mail::fake();
        // Monday 23 Nov 2026, 10:00 in Manila.
        Carbon::setTestNow(Carbon::parse('2026-11-23 10:00', 'Asia/Manila'));

        $town = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        BusinessCategory::create(['name' => 'Restaurant']);
        $this->owner = $this->user('owner@example.com', 'business_owner');
        $this->tourist = $this->user('tourist@example.com', 'tourist');
        $this->grill = $this->business($this->owner, 'Ekslusibo Grill', $town);
        $this->cafe = $this->business($this->user('cafe@example.com', 'business_owner'), 'Kape Bansud', $town);
        $this->sisig = $this->dish($this->grill, 'Sisig', 200);
        $this->halo = $this->dish($this->grill, 'Halo-halo', 90);
        $this->latte = $this->dish($this->cafe, 'Latte', 120);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function user(string $email, string $role): User
    {
        return User::create(['email' => $email, 'name' => Str::before($email, '@'), 'password' => Hash::make('Password123!'), 'role' => $role, 'account_status' => 'approved']);
    }

    private function business(User $owner, string $name, Municipality $town): Business
    {
        $allDays = array_fill_keys(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], [['open' => '00:00', 'close' => '23:59']]);

        return Business::create([
            'owner_id' => $owner->id, 'business_category_id' => BusinessCategory::where('name', 'Restaurant')->value('id'),
            'municipality_id' => $town->id, 'business_name' => $name, 'status' => 'approved',
            'latitude' => 12.86, 'longitude' => 121.45, 'force_closed' => false, 'business_hours' => $allDays,
        ]);
    }

    private function dish(Business $business, string $name, float $price): Offering
    {
        return Offering::create(['business_id' => $business->id, 'name' => $name, 'price' => $price, 'is_available' => true, 'status' => 'available']);
    }

    private function createSale(array $overrides = [], ?User $as = null)
    {
        return $this->actingAs($as ?? $this->owner, 'sanctum')->postJson('/api/business-owner/dish-sales', array_merge([
            'business_id' => $this->grill->id,
            'title' => 'Weekend Sale',
            'discount_type' => 'percentage',
            'discount_value' => 25,
            'starts_at' => '2026-11-23',
            'ends_at' => '2026-11-29',
            'offering_ids' => [$this->sisig->id],
        ], $overrides));
    }

    private function orderSingle(array $items)
    {
        return $this->actingAs($this->tourist, 'sanctum')->postJson('/api/tourist/food/order', [
            'items' => $items, 'order_type' => 'pickup', 'customer_phone' => '09171234567', 'payment_method' => 'cash',
        ]);
    }

    public function test_sale_price_is_shown_charged_and_kept_on_the_order(): void
    {
        $saleId = $this->createSale()->assertCreated()
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.label', '25% off')
            ->assertJsonPath('data.dishes.0.sale_price', 150)
            ->json('data.id');

        // Manila days, ending 23:59:59 on the 29th. Starting "today" starts now
        // (10:00 Manila), not at midnight: earlier orders were not on sale.
        $sale = Promotion::findOrFail($saleId);
        $this->assertSame('2026-11-23 02:00:00', $sale->start_date->utc()->format('Y-m-d H:i:s'));
        $this->assertSame('2026-11-29 15:59:59', $sale->end_date->utc()->format('Y-m-d H:i:s'));

        // Tourists see the price they will pay.
        $this->getJson("/api/tourist/food/{$this->sisig->id}")->assertOk()
            ->assertJsonPath('data.price', 150)
            ->assertJsonPath('data.original_price', 200)
            ->assertJsonPath('data.sale.label', '25% off');
        $menu = collect($this->getJson("/api/tourist/explore/{$this->grill->id}")->assertOk()->json('data.menu_items'))->keyBy('id');
        $this->assertEquals(150, $menu[$this->sisig->id]['price']);
        $this->assertNull($menu[$this->halo->id]['sale'], 'a dish outside the sale keeps its price');

        // The cart's price refresh.
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/tourist/food/availability', ['business_ids' => [$this->grill->id], 'offering_ids' => [$this->sisig->id, $this->halo->id]])
            ->assertOk()->assertJsonPath("data.prices.{$this->sisig->id}.price", 150)->assertJsonPath("data.prices.{$this->halo->id}.price", 90);

        // Checkout charges the sale price; the business pays for it.
        $this->orderSingle([
            ['offering_id' => $this->sisig->id, 'quantity' => 2, 'expected_unit_price' => 150],
            ['offering_id' => $this->halo->id, 'quantity' => 1],
        ])->assertCreated();
        $order = Order::sole();
        $this->assertEquals(390, (float) $order->subtotal, '2 × ₱150 + ₱90');
        $this->assertEquals(Order::calculateSystemFee(390), (float) $order->system_fee, 'system fee on the discounted food total');
        $this->assertEquals(0, (float) $order->discount, 'a dish sale is never also an order discount');

        $line = OrderItem::where('offering_id', $this->sisig->id)->sole();
        $this->assertEquals(150, (float) $line->unit_price);
        $this->assertEquals(200, (float) $line->original_unit_price);
        $this->assertEquals(300, (float) $line->subtotal);
        $this->assertSame($saleId, $line->promotion_id);
        $this->assertSame('25% off · Weekend Sale', $line->sale_label);
        $plain = OrderItem::where('offering_id', $this->halo->id)->sole();
        $this->assertNull($plain->original_unit_price);
        $this->assertNull($plain->promotion_id);

        // Archiving the sale: the menu goes back to ₱200; the order keeps what was charged.
        $this->actingAs($this->owner, 'sanctum')->deleteJson("/api/business-owner/dish-sales/{$saleId}")->assertSuccessful();
        $this->getJson("/api/tourist/food/{$this->sisig->id}")->assertJsonPath('data.price', 200)->assertJsonPath('data.sale', null);
        $line->refresh();
        $this->assertEquals(150, (float) $line->unit_price);
        $this->assertEquals(200, (float) $line->original_unit_price);
        $this->assertSame('25% off · Weekend Sale', $line->sale_label);
    }

    public function test_group_checkout_uses_each_restaurants_sale_price(): void
    {
        $this->createSale(['discount_type' => 'fixed', 'discount_value' => 50])->assertCreated();

        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/tourist/food/group-order', [
            'restaurants' => [
                ['business_id' => $this->grill->id, 'items' => [['offering_id' => $this->sisig->id, 'quantity' => 1, 'expected_unit_price' => 150]]],
                ['business_id' => $this->cafe->id, 'items' => [['offering_id' => $this->latte->id, 'quantity' => 1]]],
            ],
            'order_type' => 'pickup', 'customer_phone' => '09171234567', 'payment_method' => 'cash',
        ])->assertCreated();

        $this->assertEquals(270, (float) Order::sole()->subtotal, '₱150 sisig + ₱120 latte');
        $this->assertEquals(150, (float) OrderItem::where('offering_id', $this->sisig->id)->value('unit_price'));
        $this->assertEquals(120, (float) OrderItem::where('offering_id', $this->latte->id)->value('unit_price'));
    }

    public function test_a_price_the_cart_did_not_show_is_refused(): void
    {
        $this->createSale()->assertCreated();

        // The cart still shows the old menu price: no order, and the message names the new price.
        $this->orderSingle([['offering_id' => $this->sisig->id, 'quantity' => 1, 'expected_unit_price' => 200]])
            ->assertStatus(422)->assertJsonFragment(['message' => 'The price of Sisig changed to ₱150.00. Please review your cart before placing the order.']);
        $this->assertSame(0, Order::count());

        // A client-sent price is never charged, even a lower one.
        $this->orderSingle([['offering_id' => $this->sisig->id, 'quantity' => 1, 'expected_unit_price' => 1]])->assertStatus(422);
        $this->assertSame(0, Order::count());
    }

    public function test_the_locked_recheck_refuses_a_sale_that_started_or_ended_mid_checkout(): void
    {
        $guard = app(CheckoutAvailabilityGuard::class);
        $line = ['offering_id' => $this->sisig->id, 'business_id' => $this->grill->id, 'unit_price' => 200, 'promotion_id' => null];
        $guard->assertOrderable([$line]); // no sale: fine

        $saleId = $this->createSale()->assertCreated()->json('data.id');
        try {
            $guard->assertOrderable([$line]); // priced before the sale began
            $this->fail('A line priced before the sale started must be refused.');
        } catch (InvalidArgumentException $e) {
            $this->assertStringContainsString('price of Sisig changed', $e->getMessage());
        }
        $guard->assertOrderable([['unit_price' => 150, 'promotion_id' => $saleId] + $line]);

        // Ended early by the owner: the sale price is refused from then on.
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/business-owner/dish-sales/{$saleId}/end")->assertOk()->assertJsonPath('data.status', 'stopped');
        $this->expectException(InvalidArgumentException::class);
        $guard->assertOrderable([['unit_price' => 150, 'promotion_id' => $saleId] + $line]);
    }

    public function test_sale_validation_on_the_server(): void
    {
        // A percentage of 100 (free) and a ₱ amount that reaches the menu price are refused.
        $this->createSale(['discount_value' => 100])->assertStatus(422)->assertJsonValidationErrors('discount_value');
        $this->createSale(['discount_type' => 'fixed', 'discount_value' => 90, 'offering_ids' => [$this->halo->id]])
            ->assertStatus(422)->assertJsonValidationErrors('discount_value');
        // Another business's dish, an end before the start, an end in the past, no dishes.
        $this->createSale(['offering_ids' => [$this->latte->id]])->assertStatus(422)->assertJsonValidationErrors('offering_ids');
        $this->createSale(['starts_at' => '2026-11-29', 'ends_at' => '2026-11-25'])->assertStatus(422)->assertJsonValidationErrors('ends_at');
        $this->createSale(['starts_at' => '2026-11-01', 'ends_at' => '2026-11-20'])->assertStatus(422)->assertJsonValidationErrors('ends_at');
        $this->createSale(['offering_ids' => []])->assertStatus(422)->assertJsonValidationErrors('offering_ids');
        // Another owner's business.
        $this->createSale(['business_id' => $this->cafe->id, 'offering_ids' => [$this->latte->id]])->assertForbidden();
        $this->assertSame(0, Promotion::count());

        // A back-dated start becomes "now": orders already placed were not on sale.
        $id = $this->createSale(['starts_at' => '2026-11-01'])->assertCreated()->json('data.id');
        $this->assertTrue(Promotion::find($id)->start_date->gte(now()->subMinute()));
    }

    public function test_a_dish_is_in_one_sale_at_a_time(): void
    {
        $first = $this->createSale()->assertCreated()->json('data.id');
        $this->createSale(['title' => 'Payday', 'starts_at' => '2026-11-28', 'ends_at' => '2026-12-02', 'offering_ids' => [$this->halo->id, $this->sisig->id]])
            ->assertStatus(422)->assertJsonValidationErrors('offering_ids')
            ->assertJsonFragment(['offering_ids' => ['A dish can be in only one sale at a time: Sisig (in "Weekend Sale").']]);
        // After the first ends, or for another dish, it is fine.
        $this->createSale(['title' => 'December', 'starts_at' => '2026-11-30', 'ends_at' => '2026-12-05'])->assertCreated();
        $this->createSale(['title' => 'Halo', 'offering_ids' => [$this->halo->id]])->assertCreated();

        // Editing a sale does not clash with itself; moving it onto another sale does.
        $this->actingAs($this->owner, 'sanctum')->putJson("/api/business-owner/dish-sales/{$first}", [
            'business_id' => $this->grill->id, 'title' => 'Weekend Sale', 'discount_type' => 'percentage', 'discount_value' => 30,
            'starts_at' => '2026-11-23', 'ends_at' => '2026-11-29', 'offering_ids' => [$this->sisig->id],
        ])->assertOk()->assertJsonPath('data.dishes.0.sale_price', 140);
        $this->actingAs($this->owner, 'sanctum')->putJson("/api/business-owner/dish-sales/{$first}", [
            'business_id' => $this->grill->id, 'title' => 'Weekend Sale', 'discount_type' => 'percentage', 'discount_value' => 30,
            'starts_at' => '2026-11-23', 'ends_at' => '2026-11-29', 'offering_ids' => [$this->sisig->id, $this->halo->id],
        ])->assertStatus(422)->assertJsonValidationErrors('offering_ids');
    }

    public function test_menu_price_cannot_make_a_sale_free_and_old_endpoints_cannot_touch_sales(): void
    {
        $id = $this->createSale(['discount_type' => 'fixed', 'discount_value' => 150])->assertCreated()->json('data.id');

        try {
            $this->sisig->update(['price' => 140]);
            $this->fail('A menu price at or below a running sale discount must be refused.');
        } catch (ValidationException $e) {
            $this->assertStringContainsString('Weekend Sale', $e->errors()['price'][0]);
        }
        $this->assertEquals(200, (float) $this->sisig->fresh()->price);
        $this->sisig->fresh()->update(['price' => 220]); // a higher price is fine

        // The label endpoints neither list nor change dish sales; archived sales are not restored.
        $this->actingAs($this->owner, 'sanctum')->getJson('/api/business-owner/promotions')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($this->owner, 'sanctum')->putJson("/api/business-owner/promotions/{$id}", ['title' => 'x', 'discount_type' => 'percentage', 'discount_value' => 99, 'valid_from' => '2026-11-23', 'valid_until' => '2026-11-24'])->assertStatus(422);
        $this->actingAs($this->owner, 'sanctum')->deleteJson("/api/business-owner/promotions/{$id}")->assertStatus(422);
        $this->actingAs($this->owner, 'sanctum')->deleteJson("/api/business-owner/dish-sales/{$id}")->assertSuccessful();
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/business-owner/archive/promotion/{$id}/restore")->assertStatus(422);
        $this->assertSoftDeleted('promotions', ['id' => $id]);

        // Label promotions keep working as before.
        $this->actingAs($this->owner, 'sanctum')->postJson('/api/business-owner/promotions', [
            'business_id' => $this->grill->id, 'title' => 'Fiesta', 'discount_type' => 'percentage', 'discount_value' => 10,
            'start_date' => '2026-11-23', 'end_date' => '2026-11-30',
        ])->assertCreated();
        $this->assertSame('label', Promotion::where('name', 'Fiesta')->value('kind'));
        $this->getJson("/api/tourist/food/{$this->sisig->id}")->assertJsonPath('data.price', 220)->assertJsonPath('data.sale', null);
    }

    public function test_only_the_owner_and_menu_and_promotions_staff_manage_sales(): void
    {
        (require base_path('database/migrations/2026_11_25_000006_add_restaurant_staff_roles.php'))->up();
        $staff = function (string $role) {
            $user = $this->user(Str::random(8).'@staff.test', 'staff');
            $member = Staff::create(['business_id' => $this->grill->id, 'user_id' => $user->id, 'staff_role_id' => StaffRole::where('name', $role)->value('id'), 'status' => 'active']);
            $member->roles()->sync([StaffRole::where('name', $role)->value('id')]);

            return $user;
        };

        $menuStaff = $staff(StaffPermissions::MENU_PROMOTIONS_ROLE);
        $this->actingAs($menuStaff, 'sanctum')->postJson('/api/staff/dish-sales', [
            'business_id' => $this->grill->id, 'title' => 'Staff Sale', 'discount_type' => 'percentage', 'discount_value' => 10,
            'starts_at' => '2026-11-23', 'ends_at' => '2026-11-24', 'offering_ids' => [$this->halo->id],
        ])->assertCreated();
        $this->actingAs($menuStaff, 'sanctum')->getJson('/api/staff/dish-sales')->assertOk()->assertJsonCount(1, 'data');

        $pickup = $staff(StaffPermissions::ORDER_PICKUP_ROLE);
        $this->actingAs($pickup, 'sanctum')->getJson('/api/staff/dish-sales')->assertForbidden();

        // Another owner sees none and cannot change one.
        $other = User::where('email', 'cafe@example.com')->first();
        $id = Promotion::itemSales()->value('id');
        $this->actingAs($other, 'sanctum')->getJson('/api/business-owner/dish-sales')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($other, 'sanctum')->postJson("/api/business-owner/dish-sales/{$id}/end")->assertNotFound();
        $this->actingAs($this->tourist, 'sanctum')->getJson('/api/business-owner/dish-sales')->assertForbidden();
    }
}
