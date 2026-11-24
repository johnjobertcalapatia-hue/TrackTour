<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Expense;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Promotion;
use App\Models\RestaurantHandover;
use App\Models\Staff;
use App\Models\StaffActivityLog;
use App\Models\StaffRole;
use App\Models\StaffRolePermission;
use App\Models\TransactionEvent;
use App\Models\User;
use App\Support\StaffPermissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Staff Management §5 (docs/staff-management-plan.md): the three restaurant
 * roles — Order & Pickup, Finance, Menu & Promotions — several roles per
 * employee, restaurant-scoped data, and the "Handed to rider" record.
 */
class RestaurantStaffRolesTest extends TestCase
{
    use RefreshDatabase;

    private Municipality $town;

    private User $owner;

    private Business $grill;

    private Business $cafe;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake();
        Mail::fake();

        $this->town = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        foreach (['Restaurant', 'Café', 'Food Hub', 'Resort'] as $name) {
            BusinessCategory::create(['name' => $name]);
        }
        StaffRole::create(['name' => 'Reservation Staff']);
        DB::table('business_category_staff_role')->insert([
            'business_category_id' => BusinessCategory::where('name', 'Resort')->value('id'),
            'staff_role_id' => StaffRole::where('name', 'Reservation Staff')->value('id'),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        // Exactly what migration 2026_11_25_000006 does on a real database.
        (require base_path('database/migrations/2026_11_25_000006_add_restaurant_staff_roles.php'))->up();

        $this->owner = $this->user('owner@example.com', 'business_owner');
        $this->grill = $this->business($this->owner, 'Ekslusibo Grill', 'Restaurant');
        $this->cafe = $this->business($this->user('cafe@example.com', 'business_owner'), 'Kape Bansud', 'Café');
    }

    // ------------------------------------------------------------ fixtures

    private function user(string $email, string $role): User
    {
        return User::create(['email' => $email, 'name' => Str::before($email, '@'), 'password' => Hash::make('Password123!'), 'role' => $role, 'account_status' => 'approved']);
    }

    private function business(User $owner, string $name, string $category): Business
    {
        return Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => BusinessCategory::where('name', $category)->value('id'),
            'municipality_id' => $this->town->id,
            'business_name' => $name,
            'status' => 'approved',
            'latitude' => 12.86,
            'longitude' => 121.45,
        ]);
    }

    private function role(string $name): int
    {
        return (int) StaffRole::where('name', $name)->value('id');
    }

    /** @param list<string> $roles */
    private function staff(Business $business, array $roles): Staff
    {
        $staff = Staff::create([
            'business_id' => $business->id,
            'user_id' => $this->user(Str::random(8).'@staff.test', 'staff')->id,
            'staff_role_id' => $this->role($roles[0]),
            'status' => 'active',
        ]);
        $staff->roles()->sync(array_map(fn ($r) => $this->role($r), $roles));

        return $staff;
    }

    private function as(Staff $staff)
    {
        return $this->actingAs($staff->user, 'sanctum');
    }

    private function deliveryOrder(Business $business, bool $withRider = true): Order
    {
        $order = Order::create([
            'order_number' => 'TT-'.random_int(10000, 99999), 'business_id' => $business->id, 'user_id' => $this->owner->id,
            'customer_name' => 'Tourist', 'customer_email' => 'tourist@example.com', 'order_type' => 'delivery',
            'payment_method' => 'gcash', 'payment_status' => 'paid', 'status' => 'preparing',
            'subtotal' => 200, 'delivery_fee' => 50, 'total' => 250,
        ]);
        $rider = $this->user(Str::random(6).'@rider.test', 'rider');
        Delivery::create(['order_id' => $order->id, 'rider_id' => $withRider ? $rider->id : null, 'status' => $withRider ? 'assigned' : 'waiting']);

        return $order;
    }

    private function item(Order $order, Business $business, string $status = 'ready'): OrderItem
    {
        $offering = Offering::create(['business_id' => $business->id, 'name' => 'Dish '.Str::random(4), 'price' => 100, 'is_available' => true, 'status' => 'available']);

        return OrderItem::create(['order_id' => $order->id, 'business_id' => $business->id, 'offering_id' => $offering->id, 'product_name' => $offering->name, 'quantity' => 1, 'unit_price' => 100, 'subtotal' => 100, 'status' => $status]);
    }

    // ------------------------------------------------ roles per business type

    public function test_restaurants_cafes_and_food_hubs_offer_exactly_the_three_roles_and_resorts_keep_theirs(): void
    {
        foreach (['Restaurant', 'Café', 'Food Hub'] as $category) {
            $this->assertEqualsCanonicalizing(
                StaffPermissions::RESTAURANT_ROLES,
                BusinessCategory::where('name', $category)->first()->staffRoles()->pluck('name')->all()
            );
        }
        $this->assertSame(['Reservation Staff'], BusinessCategory::where('name', 'Resort')->first()->staffRoles()->pluck('name')->all());

        $offered = collect($this->actingAs($this->owner, 'sanctum')->getJson("/api/business-owner/staff/roles?business_id={$this->grill->id}")->assertOk()->json('data'))->pluck('name');
        $this->assertEqualsCanonicalizing(StaffPermissions::RESTAURANT_ROLES, $offered->all());
    }

    // ------------------------------------------------------------ multi-role

    public function test_the_owner_gives_one_employee_several_roles_without_a_second_account(): void
    {
        $staffId = $this->actingAs($this->owner, 'sanctum')->postJson('/api/business-owner/staff', [
            'business_id' => $this->grill->id, 'first_name' => 'Maria', 'last_name' => 'Santos', 'email' => 'maria@staff.test',
            'staff_role_ids' => [$this->role(StaffPermissions::ORDER_PICKUP_ROLE), $this->role(StaffPermissions::MENU_PROMOTIONS_ROLE)],
        ])->assertCreated()->assertJsonPath('data.staff.roles', [StaffPermissions::ORDER_PICKUP_ROLE, StaffPermissions::MENU_PROMOTIONS_ROLE])->json('data.staff.id');

        $staff = Staff::findOrFail($staffId);
        $this->assertSame(1, User::where('email', 'maria@staff.test')->count());
        $staff->update(['status' => 'active']);
        foreach ([StaffPermissions::ORDERS_UPDATE, StaffPermissions::HANDOVER_CONFIRM, StaffPermissions::MENU_MANAGE, StaffPermissions::PROMOTIONS_MANAGE] as $permission) {
            $this->assertContains($permission, $staff->grantedPermissions());
        }
        $this->assertNotContains(StaffPermissions::FINANCE_VIEW, $staff->grantedPermissions());

        $this->as($staff)->getJson('/api/staff/orders')->assertOk();
        $this->as($staff)->getJson('/api/staff/menu')->assertOk();
        $this->as($staff)->getJson('/api/staff/expenses')->assertForbidden();
    }

    public function test_changing_roles_is_recorded_and_a_role_of_another_business_type_is_refused(): void
    {
        $staff = $this->staff($this->grill, [StaffPermissions::ORDER_PICKUP_ROLE]);
        $owner = $this->actingAs($this->owner, 'sanctum');
        $base = ['first_name' => 'Ana', 'last_name' => 'Cruz', 'email' => $staff->user->email];

        $owner->putJson("/api/business-owner/staff/{$staff->id}", $base + ['staff_role_ids' => [$this->role('Reservation Staff')]])
            ->assertStatus(422)->assertJsonPath('message', 'That role is not available for this type of business.');

        $owner->putJson("/api/business-owner/staff/{$staff->id}", $base + ['staff_role_ids' => [$this->role(StaffPermissions::ORDER_PICKUP_ROLE), $this->role(StaffPermissions::FINANCE_ROLE)]])->assertOk();
        $log = StaffActivityLog::where('staff_id', $staff->id)->where('action', 'staff.role_changed')->sole();
        $this->assertSame([StaffPermissions::ORDER_PICKUP_ROLE, StaffPermissions::FINANCE_ROLE], $log->properties['to']);
        $this->assertContains(StaffPermissions::FINANCE_VIEW, $log->properties['permissions_after']);
        $this->assertNotContains(StaffPermissions::FINANCE_VIEW, $log->properties['permissions_before']);
    }

    // ------------------------------------------------- menu & promotions staff

    public function test_menu_staff_manage_the_menu_and_availability_but_not_orders_or_money(): void
    {
        $menu = $this->staff($this->grill, [StaffPermissions::MENU_PROMOTIONS_ROLE]);

        $id = $this->as($menu)->postJson('/api/staff/menu', ['business_id' => $this->grill->id, 'name' => 'Sizzling Sisig', 'price' => 210, 'is_available' => true])
            ->assertCreated()->json('data.id');
        $this->assertSame($this->grill->id, Offering::findOrFail($id)->business_id);

        $this->as($menu)->putJson("/api/staff/menu/{$id}", ['is_available' => false])->assertOk();
        $this->assertFalse((bool) Offering::findOrFail($id)->is_available);
        $this->assertTrue(collect($this->as($menu)->getJson('/api/staff/menu')->assertOk()->json('data.data') ?? $this->as($menu)->getJson('/api/staff/menu')->json('data'))->isNotEmpty());

        // Another restaurant's dish and business are out of reach.
        $cafeDish = Offering::create(['business_id' => $this->cafe->id, 'name' => 'Latte', 'price' => 120, 'is_available' => true, 'status' => 'available']);
        $this->as($menu)->putJson("/api/staff/menu/{$cafeDish->id}", ['is_available' => false])->assertNotFound();
        $this->as($menu)->postJson('/api/staff/menu', ['business_id' => $this->cafe->id, 'name' => 'Sneaky', 'price' => 1])->assertForbidden();
        $this->assertTrue((bool) $cafeDish->fresh()->is_available);

        $this->as($menu)->getJson('/api/staff/orders')->assertForbidden();
        $this->as($menu)->getJson('/api/staff/sales/summary')->assertForbidden();
        $this->as($menu)->getJson('/api/staff/expenses')->assertForbidden();
    }

    public function test_menu_staff_create_edit_and_remove_promotions_for_their_restaurant_only(): void
    {
        $menu = $this->staff($this->grill, [StaffPermissions::MENU_PROMOTIONS_ROLE]);

        // The owner page's field names (previously refused by the API).
        $id = $this->as($menu)->postJson('/api/staff/promotions', [
            'business_id' => $this->grill->id, 'title' => 'Merienda Treat', 'discount_type' => 'fixed', 'discount_value' => 50,
            'start_date' => '2026-12-01', 'end_date' => '2026-12-31',
        ])->assertCreated()->assertJsonPath('data.discount_type', 'fixed')->json('data.id');
        $promotion = Promotion::findOrFail($id);
        $this->assertSame(['fixed', 50.0], [$promotion->type, (float) $promotion->value]);

        $this->as($menu)->getJson("/api/staff/promotions/{$id}")->assertOk()->assertJsonPath('data.title', 'Merienda Treat')->assertJsonPath('data.start_date', '2026-12-01');
        $this->as($menu)->putJson("/api/staff/promotions/{$id}", ['title' => 'Merienda Treat', 'discount_type' => 'percentage', 'discount_value' => 15, 'start_date' => '2026-12-01', 'end_date' => '2026-12-31'])->assertOk();
        $this->assertSame('percentage', $promotion->fresh()->type);
        $this->as($menu)->putJson("/api/staff/promotions/{$id}", ['discount_type' => 'percentage', 'discount_value' => 150, 'start_date' => '2026-12-01', 'end_date' => '2026-12-31'])->assertStatus(422);

        $cafePromo = Promotion::create(['business_id' => $this->cafe->id, 'name' => 'Cafe deal', 'type' => 'percentage', 'value' => 10, 'start_date' => now(), 'end_date' => now()->addWeek(), 'is_active' => true]);
        $this->as($menu)->deleteJson("/api/staff/promotions/{$cafePromo->id}")->assertForbidden();
        $this->as($menu)->postJson('/api/staff/promotions', ['business_id' => $this->cafe->id, 'title' => 'X', 'discount_value' => 5, 'start_date' => '2026-12-01', 'end_date' => '2026-12-02'])->assertForbidden();

        $this->as($menu)->deleteJson("/api/staff/promotions/{$id}")->assertSuccessful();
        $this->assertSoftDeleted('promotions', ['id' => $id]);
    }

    public function test_the_owner_promotion_form_now_saves_with_its_own_field_names(): void
    {
        $this->actingAs($this->owner, 'sanctum')->postJson('/api/business-owner/promotions', [
            'business_id' => $this->grill->id, 'title' => 'Owner deal', 'discount_type' => 'percentage', 'discount_value' => 20,
            'start_date' => '2026-12-01', 'end_date' => '2026-12-10',
        ])->assertCreated();
        // The original API names still work too.
        $this->actingAs($this->owner, 'sanctum')->postJson('/api/business-owner/promotions', [
            'business_id' => $this->grill->id, 'title' => 'Old shape', 'discount_percentage' => 10, 'valid_from' => '2026-12-01', 'valid_until' => '2026-12-10',
        ])->assertCreated();
        $this->assertSame(2, Promotion::where('business_id', $this->grill->id)->count());
    }

    // ------------------------------------------------------- finance staff

    public function test_finance_staff_see_their_restaurants_finances_and_create_and_edit_expenses_only(): void
    {
        $finance = $this->staff($this->grill, [StaffPermissions::FINANCE_ROLE]);
        $mine = Expense::create(['business_id' => $this->grill->id, 'vendor_name' => 'Palengke', 'category' => 'ingredients', 'amount' => 500, 'expense_date' => '2026-11-20']);
        $theirs = Expense::create(['business_id' => $this->cafe->id, 'vendor_name' => 'Cafe supplier', 'category' => 'supplies', 'amount' => 900, 'expense_date' => '2026-11-20']);

        foreach (['/api/staff/sales', '/api/staff/sales/summary', '/api/staff/sales/payments', '/api/staff/reports/sales', '/api/staff/reports/orders', '/api/staff/reports/cod-settlements', '/api/staff/expenses/summary'] as $url) {
            $this->as($finance)->getJson($url)->assertOk();
        }
        $listed = collect($this->as($finance)->getJson('/api/staff/expenses')->assertOk()->json('data.data'))->pluck('id');
        $this->assertSame([$mine->id], $listed->all(), 'only their restaurant');

        $this->as($finance)->postJson('/api/staff/expenses', ['business_id' => $this->grill->id, 'vendor_name' => 'LPG', 'category' => 'utilities', 'amount' => 1200, 'expense_date' => '2026-11-22'])->assertCreated();
        $this->as($finance)->postJson('/api/staff/expenses', ['business_id' => $this->cafe->id, 'vendor_name' => 'X', 'category' => 'other', 'amount' => 1, 'expense_date' => '2026-11-22'])->assertStatus(422);
        $this->as($finance)->putJson("/api/staff/expenses/{$mine->id}", ['business_id' => $this->grill->id, 'vendor_name' => 'Palengke', 'category' => 'ingredients', 'amount' => 550, 'expense_date' => '2026-11-20'])->assertOk();
        $this->assertEquals(550, $mine->fresh()->amount);
        $this->as($finance)->putJson("/api/staff/expenses/{$theirs->id}", ['business_id' => $this->grill->id, 'vendor_name' => 'X', 'category' => 'other', 'amount' => 1, 'expense_date' => '2026-11-20'])->assertForbidden();
        $this->as($finance)->getJson("/api/staff/expenses/{$theirs->id}")->assertForbidden();

        // Deleting an expense stays owner-only: there is no staff route.
        $this->as($finance)->deleteJson("/api/staff/expenses/{$mine->id}")->assertStatus(405);
        $this->assertDatabaseHas('expenses', ['id' => $mine->id, 'deleted_at' => null]);

        $this->as($finance)->getJson('/api/staff/orders')->assertForbidden();
        $this->as($finance)->getJson('/api/staff/menu')->assertForbidden();
        $this->as($finance)->getJson('/api/staff/promotions')->assertForbidden();
    }

    // ------------------------------------------------------ handed to rider

    public function test_order_staff_confirm_the_handover_once_items_are_ready_and_a_rider_has_accepted(): void
    {
        $orderStaff = $this->staff($this->grill, [StaffPermissions::ORDER_PICKUP_ROLE]);

        $noRider = $this->deliveryOrder($this->grill, false);
        $this->item($noRider, $this->grill);
        $this->as($orderStaff)->postJson("/api/staff/orders/{$noRider->id}/handover")->assertStatus(422)->assertJsonPath('message', 'No rider has accepted this order yet.');

        $order = $this->deliveryOrder($this->grill);
        $item = $this->item($order, $this->grill, 'preparing');
        $this->as($orderStaff)->postJson("/api/staff/orders/{$order->id}/handover")->assertStatus(422)->assertJsonPath('message', 'Mark all your items ready before handing them to the rider.');

        $item->update(['status' => 'ready']);
        $stopsBefore = DB::table('delivery_pickup_stops')->get()->toArray();
        $deliveryStatus = $order->delivery->fresh()->status;

        $this->as($orderStaff)->postJson("/api/staff/orders/{$order->id}/handover")->assertOk()->assertJsonPath('data.already_confirmed', false);
        $handover = RestaurantHandover::sole();
        $this->assertSame([$order->delivery->id, $this->grill->id, $order->delivery->rider_id, $orderStaff->user_id],
            [$handover->delivery_id, $handover->business_id, $handover->rider_id, $handover->confirmed_by]);
        $this->assertNotNull($handover->confirmed_at);
        $this->assertTrue(TransactionEvent::where('event_type', 'restaurant_handover_confirmed')->exists());
        $this->assertTrue(StaffActivityLog::where('action', 'staff.handover_confirmed')->where('staff_id', $orderStaff->id)->exists());

        // The rider's pickup flow is untouched: no stop or delivery status changed.
        $this->assertEquals($stopsBefore, DB::table('delivery_pickup_stops')->get()->toArray());
        $this->assertEquals($deliveryStatus, $order->delivery->fresh()->status);

        // Idempotent.
        $this->as($orderStaff)->postJson("/api/staff/orders/{$order->id}/handover")->assertOk()->assertJsonPath('data.already_confirmed', true);
        $this->assertSame(1, RestaurantHandover::count());

        // The staff order list shows it.
        $listed = collect($this->as($orderStaff)->getJson('/api/staff/orders')->json('data'))->firstWhere('id', $order->id);
        $this->assertNotNull($listed['my_handover']);
    }

    public function test_the_rider_sees_the_restaurants_handover_on_the_pickup_stop(): void
    {
        $order = $this->deliveryOrder($this->grill);
        $this->item($order, $this->grill);
        $orderStaff = $this->staff($this->grill, [StaffPermissions::ORDER_PICKUP_ROLE]);
        $orderStaff->user->profile()->create(['first_name' => 'Juan', 'last_name' => 'Dela Cruz']);
        app(\App\Services\PickupSequenceService::class)->ensureStops($order->delivery->fresh());

        $this->as($orderStaff)->postJson("/api/staff/orders/{$order->id}/handover")->assertOk();

        $rider = User::findOrFail($order->delivery->rider_id);
        $stop = collect($this->actingAs($rider, 'sanctum')->getJson("/api/rider/deliveries/{$order->delivery->id}/pickup-stops")->assertOk()->json('data.stops'))
            ->firstWhere('business_id', $this->grill->id);
        $this->assertNotNull($stop['restaurant_handover']['confirmed_at']);
        $this->assertSame('Juan', $stop['restaurant_handover']['confirmed_by'], 'first name only, never an email');
    }

    public function test_in_a_group_checkout_each_restaurant_confirms_only_its_own_handover(): void
    {
        $order = $this->deliveryOrder($this->grill);
        $this->item($order, $this->grill, 'ready');
        $this->item($order, $this->cafe, 'preparing');
        $grillStaff = $this->staff($this->grill, [StaffPermissions::ORDER_PICKUP_ROLE]);
        $cafeStaff = $this->staff($this->cafe, [StaffPermissions::ORDER_PICKUP_ROLE]);

        $this->as($cafeStaff)->postJson("/api/staff/orders/{$order->id}/handover")->assertStatus(422);
        $this->as($grillStaff)->postJson("/api/staff/orders/{$order->id}/handover")->assertOk();
        $this->assertSame([$this->grill->id], RestaurantHandover::pluck('business_id')->all());

        // A staff member can never confirm for another restaurant, even by naming it.
        $this->as($grillStaff)->postJson("/api/staff/orders/{$order->id}/handover", ['business_id' => $this->cafe->id])->assertForbidden();
        $this->as($this->staff($this->cafe, [StaffPermissions::FINANCE_ROLE]))->postJson("/api/staff/orders/{$order->id}/handover")->assertForbidden();
    }

    public function test_the_owner_can_confirm_a_handover_too(): void
    {
        $order = $this->deliveryOrder($this->grill);
        $this->item($order, $this->grill);
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/business-owner/orders/{$order->id}/handover")->assertOk();
        $this->assertSame($this->owner->id, RestaurantHandover::sole()->confirmed_by);
    }

    // ---------------------------------------------------- fixed restrictions

    public function test_fixed_restrictions_hold_even_with_every_role_and_a_forged_grant(): void
    {
        $all = $this->staff($this->grill, StaffPermissions::RESTAURANT_ROLES);
        // A grant that is not in the catalogue never counts.
        StaffRolePermission::create(['staff_role_id' => $this->role(StaffPermissions::FINANCE_ROLE), 'permission' => 'expenses.delete']);
        StaffRolePermission::create(['staff_role_id' => $this->role(StaffPermissions::FINANCE_ROLE), 'permission' => 'staff.manage']);
        $this->assertNotContains('expenses.delete', $all->grantedPermissions());
        $this->assertNotContains('staff.manage', $all->grantedPermissions());

        $expense = Expense::create(['business_id' => $this->grill->id, 'vendor_name' => 'V', 'category' => 'other', 'amount' => 1, 'expense_date' => '2026-11-20']);
        $this->as($all)->deleteJson("/api/staff/expenses/{$expense->id}")->assertStatus(405);
        // Owner-only areas (staff management, payouts, settings) are behind the owner role.
        $this->as($all)->getJson('/api/business-owner/staff')->assertForbidden();
        $this->as($all)->deleteJson("/api/business-owner/expenses/{$expense->id}")->assertForbidden();
        $this->as($all)->getJson('/api/business-owner/businesses')->assertForbidden();
        // Their own business list is just their restaurant.
        $this->assertSame([$this->grill->id], collect($this->as($all)->getJson('/api/staff/businesses')->assertOk()->json('data'))->pluck('id')->all());
    }
}
