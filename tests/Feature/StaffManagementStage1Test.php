<?php

namespace Tests\Feature;

use App\Mail\ResetPasswordMail;
use App\Mail\StaffInvitationMail;
use App\Models\ActivityLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Staff;
use App\Models\StaffActivityLog;
use App\Models\StaffInvitation;
use App\Models\StaffRole;
use App\Models\User;
use App\Support\StaffPermissions;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Staff Management Stage 1 (docs/staff-management-plan.md): the four security
 * gaps, existing-staff compatibility, multi-restaurant authorisation,
 * invitation-based activation and the staff activity records.
 */
class StaffManagementStage1Test extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Business $grill;

    private Business $cafe;

    private Municipality $town;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake();
        Mail::fake();

        $this->town = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $this->owner = $this->user('owner@example.com', 'business_owner');
        $this->grill = $this->business($this->owner, 'Ekslusibo Grill');
        $cafeOwner = $this->user('cafe-owner@example.com', 'business_owner');
        $this->cafe = $this->business($cafeOwner, 'Kape Bansud');

        // The role templates as seeded, then mapped exactly as the migration does.
        foreach (['Restaurant Manager', 'Order & Payment Staff', 'Kitchen / Preparation Staff', 'Inventory Staff', 'Digital Promotion Staff'] as $name) {
            StaffRole::create(['name' => $name]);
        }
        StaffPermissions::seedRolesWithoutGrants();
    }

    // ------------------------------------------------------------ fixtures

    private function user(string $email, string $role, string $password = 'Password123!'): User
    {
        return User::create(['email' => $email, 'name' => Str::before($email, '@'), 'password' => Hash::make($password), 'role' => $role, 'account_status' => 'approved']);
    }

    private function business(User $owner, string $name): Business
    {
        return Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => BusinessCategory::firstOrCreate(['name' => 'Restaurant'])->id,
            'municipality_id' => $this->town->id,
            'business_name' => $name,
            'status' => 'approved',
            'latitude' => 12.86,
            'longitude' => 121.45,
        ]);
    }

    private function staff(Business $business, string $role, string $status = 'active', ?string $email = null): Staff
    {
        $user = $this->user($email ?? Str::random(8).'@staff.test', 'staff');

        return Staff::create([
            'business_id' => $business->id,
            'user_id' => $user->id,
            'staff_role_id' => StaffRole::where('name', $role)->value('id'),
            'status' => $status,
        ]);
    }

    private function order(Business $business, array $attributes = [], bool $riderAccepted = true): Order
    {
        $order = Order::create(array_merge([
            'order_number' => 'TT-'.random_int(10000, 99999),
            'business_id' => $business->id,
            'user_id' => $this->owner->id,
            'customer_name' => 'Tourist',
            'customer_email' => 'tourist@example.com',
            'order_type' => 'delivery',
            'payment_method' => 'gcash',
            'payment_status' => 'paid',
            'status' => 'accepted',
            'subtotal' => 200,
            'delivery_fee' => 50,
            'total' => 250,
        ], $attributes));
        $rider = $this->user(Str::random(6).'@rider.test', 'rider');
        Delivery::create(['order_id' => $order->id, 'rider_id' => $riderAccepted ? $rider->id : null, 'status' => $riderAccepted ? 'assigned' : 'waiting']);

        return $order;
    }

    private function item(Order $order, Business $business, string $name = 'Sisig'): OrderItem
    {
        $offering = Offering::create(['business_id' => $business->id, 'name' => $name, 'price' => 100, 'is_available' => true, 'status' => 'available']);

        return OrderItem::create(['order_id' => $order->id, 'business_id' => $business->id, 'offering_id' => $offering->id, 'product_name' => $name, 'quantity' => 1, 'unit_price' => 100, 'subtotal' => 100, 'status' => 'accepted']);
    }

    private function asStaff(Staff $staff)
    {
        return $this->actingAs($staff->user, 'sanctum');
    }

    private function login(string $email, string $password = 'Password123!')
    {
        return $this->postJson('/api/login', ['email' => $email, 'password' => $password]);
    }

    // --------------------------------------------- gap 1: status is enforced

    public function test_a_suspended_inactive_or_pending_staff_member_is_refused_by_every_staff_route(): void
    {
        foreach (['suspended', 'inactive', 'pending'] as $status) {
            $staff = $this->staff($this->grill, 'Restaurant Manager', $status);
            $this->asStaff($staff)->getJson('/api/staff/dashboard')->assertForbidden()->assertJsonPath('code', 'staff_inactive');
            $this->asStaff($staff)->getJson('/api/staff/orders')->assertForbidden();
        }
    }

    public function test_suspending_revokes_every_token_immediately_and_reactivating_restores_sign_in(): void
    {
        $staff = $this->staff($this->grill, 'Restaurant Manager', 'active', 'maria@staff.test');
        $token = $this->login('maria@staff.test')->assertOk()->json('data.token');
        $this->withToken($token)->getJson('/api/staff/dashboard')->assertOk();

        $this->actingAs($this->owner, 'sanctum')
            ->patchJson("/api/business-owner/staff/{$staff->id}/status", ['status' => 'suspended', 'reason' => 'Investigation'])
            ->assertOk();

        $this->assertSame(0, $staff->user->tokens()->count(), 'every session ends at once');
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/staff/dashboard')->assertUnauthorized();
        $this->login('maria@staff.test')->assertForbidden()->assertJsonPath('message', 'This staff account is suspended. Please contact the business owner.');
        $this->assertSame(0, $staff->user->tokens()->count(), 'no token issued to a suspended account');

        $this->app['auth']->forgetGuards();
        $this->actingAs($this->owner, 'sanctum')->patchJson("/api/business-owner/staff/{$staff->id}/status", ['status' => 'active'])->assertOk();
        $this->login('maria@staff.test')->assertOk();
    }

    public function test_removing_staff_signs_them_out_and_keeps_their_record(): void
    {
        $staff = $this->staff($this->grill, 'Kitchen / Preparation Staff', 'active', 'juan@staff.test');
        $staff->user->createToken('api-token');

        $this->actingAs($this->owner, 'sanctum')->deleteJson("/api/business-owner/staff/{$staff->id}")->assertSuccessful();

        $this->assertSame(0, $staff->user->tokens()->count());
        $this->assertSoftDeleted('staff', ['id' => $staff->id, 'status' => 'archived']);
        $this->app['auth']->forgetGuards();
        $this->login('juan@staff.test')->assertForbidden();
    }

    public function test_another_owner_cannot_manage_my_staff(): void
    {
        $staff = $this->staff($this->grill, 'Kitchen / Preparation Staff');
        $this->actingAs($this->cafe->owner, 'sanctum')->patchJson("/api/business-owner/staff/{$staff->id}/status", ['status' => 'suspended'])->assertForbidden();
        $this->actingAs($this->cafe->owner, 'sanctum')->deleteJson("/api/business-owner/staff/{$staff->id}")->assertForbidden();
        $this->assertSame('active', $staff->fresh()->status);
    }

    // ------------------------------------------- gap 2: permissions enforced

    public function test_each_staff_route_requires_its_permission(): void
    {
        $promotion = $this->staff($this->grill, 'Digital Promotion Staff');
        $this->asStaff($promotion)->getJson('/api/staff/orders')->assertForbidden()->assertJsonPath('permission', 'orders.view');
        $this->asStaff($promotion)->getJson('/api/staff/bookings')->assertForbidden();
        $this->asStaff($promotion)->getJson('/api/staff/menu')->assertForbidden();
        $this->asStaff($promotion)->getJson('/api/staff/dashboard')->assertOk()->assertJsonPath('data.recent_orders', []);

        // Menu: view without manage (menu.manage is off by default).
        $inventory = $this->staff($this->grill, 'Inventory Staff');
        $this->asStaff($inventory)->getJson('/api/staff/menu')->assertOk();
        $this->asStaff($inventory)->postJson('/api/staff/menu', ['name' => 'Halo-halo', 'price' => 90])->assertForbidden()->assertJsonPath('permission', 'menu.manage');
        $kitchen = $this->staff($this->grill, 'Kitchen / Preparation Staff');
        $this->asStaff($kitchen)->getJson('/api/staff/orders')->assertOk();
        $this->asStaff($kitchen)->deleteJson('/api/staff/menu/1')->assertForbidden();
    }

    public function test_only_staff_with_the_cash_permission_can_confirm_the_riders_payment(): void
    {
        $order = $this->order($this->grill, ['payment_method' => 'cash']);
        $this->item($order, $this->grill);

        $kitchen = $this->staff($this->grill, 'Kitchen / Preparation Staff');
        $this->asStaff($kitchen)->postJson("/api/staff/orders/{$order->id}/cod-payment-received")
            ->assertForbidden()->assertJsonPath('permission', 'payments.confirm_rider_cash');
    }

    public function test_cancelling_needs_the_reject_permission(): void
    {
        $order = $this->order($this->grill, [], false);
        $this->item($order, $this->grill);
        $kitchen = $this->staff($this->grill, 'Kitchen / Preparation Staff');

        $this->asStaff($kitchen)->patchJson("/api/staff/orders/{$order->id}/status", ['status' => 'cancelled'])
            ->assertForbidden()->assertJsonPath('permission', 'orders.reject');
        $this->assertSame('accepted', $order->fresh()->status);
    }

    // ------------------------------------ gap 3: the canonical order rules

    public function test_staff_cannot_cancel_an_order_a_rider_has_accepted(): void
    {
        $order = $this->order($this->grill);
        $this->item($order, $this->grill);
        $manager = $this->staff($this->grill, 'Restaurant Manager');

        $this->asStaff($manager)->patchJson("/api/staff/orders/{$order->id}/status", ['status' => 'cancelled'])
            ->assertStatus(422)->assertJsonPath('message', 'A rider has accepted this order, so it must be prepared and cannot be cancelled. The Tourism Office has been notified.');

        $this->assertSame('accepted', $order->fresh()->status);
        $this->assertTrue(ActivityLog::where('action', 'escalation.restaurant_rejection_blocked')->exists(), 'escalated like an owner attempt');
    }

    public function test_staff_cannot_prepare_before_a_rider_accepts_or_touch_an_unpaid_order(): void
    {
        $manager = $this->staff($this->grill, 'Restaurant Manager');

        $noRider = $this->order($this->grill, [], false);
        $this->item($noRider, $this->grill);
        $this->asStaff($manager)->patchJson("/api/staff/orders/{$noRider->id}/status", ['status' => 'preparing'])
            ->assertStatus(422)->assertJsonPath('message', 'This delivery order cannot be prepared until a rider has accepted the delivery.');

        $unpaid = $this->order($this->grill, ['status' => 'pending_payment', 'payment_status' => 'pending']);
        $this->item($unpaid, $this->grill);
        $this->asStaff($manager)->patchJson("/api/staff/orders/{$unpaid->id}/status", ['status' => 'preparing'])->assertStatus(422);
        $this->assertSame('pending_payment', $unpaid->fresh()->status);
    }

    public function test_staff_can_prepare_their_own_single_restaurant_order(): void
    {
        $order = $this->order($this->grill);
        $this->item($order, $this->grill);

        $this->asStaff($this->staff($this->grill, 'Kitchen / Preparation Staff'))
            ->patchJson("/api/staff/orders/{$order->id}/status", ['status' => 'preparing'])->assertOk();
        $this->assertSame('preparing', $order->fresh()->status);
    }

    public function test_in_a_group_checkout_staff_only_reach_their_own_restaurants_items(): void
    {
        // One canonical order (AGENTS.md 4.1): the grill is the first restaurant, the cafe the second.
        $order = $this->order($this->grill);
        $grillItem = $this->item($order, $this->grill, 'Sisig');
        $cafeItem = $this->item($order, $this->cafe, 'Iced Coffee');
        $cafeStaff = $this->staff($this->cafe, 'Kitchen / Preparation Staff');
        $grillStaff = $this->staff($this->grill, 'Restaurant Manager');

        // The second restaurant's staff see the order, with only their own items.
        $listed = collect($this->asStaff($cafeStaff)->getJson('/api/staff/orders')->assertOk()->json('data'));
        $this->assertSame([$order->id], $listed->pluck('id')->all());
        $this->assertSame(['Iced Coffee'], collect($listed[0]['items'])->pluck('product_name')->all());
        $this->assertTrue($listed[0]['shared_with_other_restaurants']);
        // The order page (the owner's, 2026-11-24): the same one restaurant's items only.
        $shown = $this->asStaff($cafeStaff)->getJson("/api/staff/orders/{$order->id}")->assertOk()->json('data');
        $this->assertSame(['Iced Coffee'], collect($shown['items'])->pluck('product_name')->all());

        // Their own item: allowed. The other restaurant's item: refused.
        $this->asStaff($cafeStaff)->patchJson("/api/staff/orders/{$order->id}/items/{$cafeItem->id}/status", ['status' => 'preparing'])->assertOk();
        $this->assertSame('preparing', $cafeItem->fresh()->status);
        $this->asStaff($cafeStaff)->patchJson("/api/staff/orders/{$order->id}/items/{$grillItem->id}/status", ['status' => 'preparing'])
            ->assertForbidden()->assertJsonPath('code', 'staff_order_scope');
        $this->assertSame('accepted', $grillItem->fresh()->status);

        // Whole-order actions would touch the other restaurant: refused for both sides.
        $this->asStaff($cafeStaff)->patchJson("/api/staff/orders/{$order->id}/status", ['status' => 'preparing'])->assertForbidden();
        $this->asStaff($grillStaff)->patchJson("/api/staff/orders/{$order->id}/status", ['status' => 'preparing'])->assertForbidden();
        $this->asStaff($grillStaff)->postJson("/api/staff/orders/{$order->id}/mark-ready")->assertForbidden();
        $this->assertSame('accepted', $grillItem->fresh()->status, 'the other restaurant was never touched');

        // The first restaurant's staff no longer control the cafe's items.
        $this->asStaff($grillStaff)->patchJson("/api/staff/orders/{$order->id}/items/{$cafeItem->id}/status", ['status' => 'ready'])->assertForbidden();
    }

    public function test_staff_of_an_unrelated_restaurant_cannot_reach_the_order(): void
    {
        $order = $this->order($this->grill);
        $item = $this->item($order, $this->grill);
        $cafeManager = $this->staff($this->cafe, 'Restaurant Manager');

        $this->asStaff($cafeManager)->patchJson("/api/staff/orders/{$order->id}/items/{$item->id}/status", ['status' => 'preparing'])->assertForbidden();
        $this->asStaff($cafeManager)->postJson("/api/staff/orders/{$order->id}/cod-payment-received")->assertForbidden();
        $this->assertSame([], $this->asStaff($cafeManager)->getJson('/api/staff/orders')->json('data'));
        $this->asStaff($cafeManager)->getJson("/api/staff/orders/{$order->id}")->assertForbidden();
        // A business_id filter never widens the scope to another restaurant.
        $this->assertSame([], $this->asStaff($cafeManager)->getJson("/api/staff/orders?business_id={$this->grill->id}")->json('data'));
    }

    // ------------------------------------ gap 4: no owner-set passwords

    public function test_the_owner_invites_staff_without_any_password_and_the_token_is_stored_hashed(): void
    {
        $roleId = StaffRole::where('name', 'Order & Payment Staff')->value('id');
        $response = $this->actingAs($this->owner, 'sanctum')->postJson('/api/business-owner/staff', [
            'business_id' => $this->grill->id,
            'first_name' => 'Maria',
            'last_name' => 'Santos',
            'email' => 'maria@staff.test',
            'staff_role_id' => $roleId,
            'password' => 'OwnerChosen123!',
            'password_confirmation' => 'OwnerChosen123!',
        ])->assertCreated();

        $this->assertStringNotContainsStringIgnoringCase('password', json_encode($response->json('data')));
        $this->assertNull($response->json('data.activation_url'), 'the link is only shown when the email fails');
        $staff = Staff::where('business_id', $this->grill->id)->firstOrFail();
        $this->assertSame('pending', $staff->status);
        $this->assertFalse(Hash::check('OwnerChosen123!', $staff->user->password), 'an owner-supplied password is ignored');

        $plainToken = null;
        Mail::assertSent(StaffInvitationMail::class, function (StaffInvitationMail $mail) use (&$plainToken) {
            $plainToken = Str::afterLast($mail->activationUrl, '/');
            $html = $mail->render();

            return $mail->hasTo('maria@staff.test')
                && str_contains($html, $mail->activationUrl)
                && ! str_contains($html, 'OwnerChosen123!');
        });
        $invitation = StaffInvitation::sole();
        $this->assertSame(hash('sha256', $plainToken), $invitation->token_hash);
        $this->assertDatabaseMissing('staff_invitations', ['token_hash' => $plainToken]);
        $this->assertEqualsWithDelta(now()->addHours(72)->timestamp, $invitation->expires_at->timestamp, 5);

        // Pending staff cannot sign in until they activate.
        $this->app['auth']->forgetGuards();
        $this->login('maria@staff.test', 'OwnerChosen123!')->assertStatus(422);
    }

    public function test_activation_sets_the_staff_members_own_password_once(): void
    {
        $staff = $this->staff($this->grill, 'Kitchen / Preparation Staff', 'pending', 'ana@staff.test');
        [, $token] = StaffInvitation::issue($staff, $this->owner);

        $this->getJson("/api/staff-invitations/{$token}")->assertOk()->assertJsonPath('data.state', 'pending')->assertJsonPath('data.business', 'Ekslusibo Grill');
        $this->postJson("/api/staff-invitations/{$token}/accept", ['password' => 'MyOwnPass123!', 'password_confirmation' => 'MyOwnPass123!'])
            ->assertOk()->assertJsonMissingPath('data.token');

        $this->assertSame('active', $staff->fresh()->status);
        $this->assertTrue(Hash::check('MyOwnPass123!', $staff->user->fresh()->password));
        $this->login('ana@staff.test', 'MyOwnPass123!')->assertOk();

        // Single use.
        $this->postJson("/api/staff-invitations/{$token}/accept", ['password' => 'Another123!x', 'password_confirmation' => 'Another123!x'])
            ->assertStatus(422)->assertJsonPath('message', 'This invitation has already been used. Sign in with your email and password.');
    }

    public function test_an_expired_or_replaced_invitation_cannot_be_used(): void
    {
        $staff = $this->staff($this->grill, 'Kitchen / Preparation Staff', 'pending');
        [$old, $oldToken] = StaffInvitation::issue($staff, $this->owner);
        $old->forceFill(['expires_at' => now()->subMinute()])->save();
        $this->postJson("/api/staff-invitations/{$oldToken}/accept", ['password' => 'MyOwnPass123!', 'password_confirmation' => 'MyOwnPass123!'])
            ->assertStatus(422)->assertJsonPath('message', 'This invitation has expired. Ask the business owner for a new one.');

        [, $second] = StaffInvitation::issue($staff, $this->owner);
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/business-owner/staff/{$staff->id}/resend-invitation")->assertOk()->assertJsonPath('data.activation_url', null);
        $this->postJson("/api/staff-invitations/{$second}/accept", ['password' => 'MyOwnPass123!', 'password_confirmation' => 'MyOwnPass123!'])
            ->assertStatus(422)->assertJsonPath('message', 'This invitation was cancelled. Ask the business owner for a new one.');
        $this->assertSame('pending', $staff->fresh()->status);
    }

    public function test_when_the_email_fails_the_owner_gets_the_link_but_never_a_password(): void
    {
        Mail::shouldReceive('to')->andThrow(new \RuntimeException('SMTP down'));
        $response = $this->actingAs($this->owner, 'sanctum')->postJson('/api/business-owner/staff', [
            'business_id' => $this->grill->id, 'first_name' => 'Pedro', 'last_name' => 'Garcia',
            'email' => 'pedro@staff.test', 'staff_role_id' => StaffRole::where('name', 'Inventory Staff')->value('id'),
        ])->assertCreated()->assertJsonPath('data.mail_sent', false);

        $this->assertStringContainsString('/staff/activate/', $response->json('data.activation_url'));
        $this->assertTrue(StaffActivityLog::where('action', 'staff.invited')->whereJsonContains('properties->mail_sent', false)->exists());
        $this->assertStringNotContainsString(Str::afterLast($response->json('data.activation_url'), '/'), json_encode(StaffActivityLog::all()), 'the link is never logged');
    }

    public function test_the_plain_text_password_reset_is_gone_and_a_reset_link_is_emailed_instead(): void
    {
        $staff = $this->staff($this->grill, 'Restaurant Manager');
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/business-owner/staff/{$staff->id}/reset-password")->assertNotFound();

        $response = $this->actingAs($this->owner, 'sanctum')->postJson("/api/business-owner/staff/{$staff->id}/send-password-reset")->assertOk();
        $this->assertSame(['mail_sent' => true], $response->json('data'));
        Mail::assertSent(ResetPasswordMail::class, fn ($mail) => $mail->hasTo($staff->user->email));
        $this->assertSame(1, DB::table('password_resets')->where('email', $staff->user->email)->count());
    }

    public function test_staff_details_never_include_a_password(): void
    {
        $staff = $this->staff($this->grill, 'Restaurant Manager');
        $body = $this->actingAs($this->owner, 'sanctum')->getJson("/api/business-owner/staff/{$staff->id}")->assertOk()->json('data');
        $this->assertStringNotContainsStringIgnoringCase('password', json_encode($body));
        $this->assertNotEmpty($body['granted_permissions']);
    }

    // ------------------------------------------ existing staff compatibility

    public function test_existing_staff_keep_their_login_and_get_their_roles_permissions(): void
    {
        // An account created by the old flow (owner-set password, active).
        $existing = $this->staff($this->grill, 'Order & Payment Staff', 'active', 'old@staff.test');
        $this->login('old@staff.test')->assertOk();

        $this->assertEqualsCanonicalizing(
            [StaffPermissions::ORDERS_VIEW, StaffPermissions::ORDERS_UPDATE, StaffPermissions::ORDERS_REJECT, StaffPermissions::PAYMENTS_CONFIRM_RIDER_CASH, StaffPermissions::MENU_VIEW],
            $existing->grantedPermissions()
        );
        $this->asStaff($existing)->getJson('/api/staff/me')->assertOk()->assertJsonPath('data.business.id', $this->grill->id);
        $this->asStaff($existing)->getJson('/api/staff/orders')->assertOk();
    }

    public function test_legacy_module_permissions_are_converted(): void
    {
        $cashier = StaffRole::create(['name' => 'Cashier']);
        DB::table('role_permissions')->insert([
            ['staff_role_id' => $cashier->id, 'module_code' => 'food_ordering', 'can_view' => 1, 'can_create' => 0, 'can_update' => 1, 'can_delete' => 0, 'can_export' => 0, 'can_approve' => 0, 'created_at' => now(), 'updated_at' => now()],
            ['staff_role_id' => $cashier->id, 'module_code' => 'menu_management', 'can_view' => 1, 'can_create' => 0, 'can_update' => 0, 'can_delete' => 0, 'can_export' => 0, 'can_approve' => 0, 'created_at' => now(), 'updated_at' => now()],
        ]);
        StaffPermissions::seedRolesWithoutGrants();

        $this->assertEqualsCanonicalizing([StaffPermissions::ORDERS_VIEW, StaffPermissions::ORDERS_UPDATE, StaffPermissions::MENU_VIEW], $cashier->grantedPermissions());
        $this->assertSame(0, StaffPermissions::seedRolesWithoutGrants(), 'idempotent: a second run seeds nothing');
        $this->assertSame(3, $cashier->grants()->count());
    }

    public function test_a_staff_account_belongs_to_exactly_one_business(): void
    {
        $staff = $this->staff($this->grill, 'Kitchen / Preparation Staff');
        $this->expectException(QueryException::class);
        Staff::create(['business_id' => $this->cafe->id, 'user_id' => $staff->user_id, 'staff_role_id' => $staff->staff_role_id, 'status' => 'active']);
    }

    // ----------------------------------------------------- activity records

    public function test_account_and_permission_events_are_recorded(): void
    {
        $owner = $this->actingAs($this->owner, 'sanctum');
        $staffId = $owner->postJson('/api/business-owner/staff', [
            'business_id' => $this->grill->id, 'first_name' => 'Angela', 'last_name' => 'Reyes',
            'email' => 'angela@staff.test', 'staff_role_id' => StaffRole::where('name', 'Kitchen / Preparation Staff')->value('id'),
        ])->assertCreated()->json('data.staff.id');
        $staff = Staff::findOrFail($staffId);
        [, $token] = StaffInvitation::issue($staff, $this->owner);
        app(\App\Services\StaffAccountService::class)->accept($token, 'MyOwnPass123!');

        $owner->putJson("/api/business-owner/staff/{$staffId}", [
            'first_name' => 'Angela', 'last_name' => 'Reyes', 'email' => 'angela@staff.test',
            'staff_role_id' => StaffRole::where('name', 'Order & Payment Staff')->value('id'),
        ])->assertOk();
        $owner->patchJson("/api/business-owner/staff/{$staffId}/status", ['status' => 'suspended'])->assertOk();
        $owner->deleteJson("/api/business-owner/staff/{$staffId}")->assertSuccessful();

        $actions = StaffActivityLog::where('staff_id', $staffId)->orderBy('id')->pluck('action')->all();
        foreach (['staff.created', 'staff.invited', 'staff.activated', 'staff.role_changed', 'staff.suspended', 'staff.removed'] as $expected) {
            $this->assertContains($expected, $actions);
        }
        $roleChange = StaffActivityLog::where('action', 'staff.role_changed')->sole();
        $this->assertContains(StaffPermissions::PAYMENTS_CONFIRM_RIDER_CASH, $roleChange->properties['permissions_after']);
        $this->assertSame('owner', $roleChange->actor_type);

        $overview = $owner->getJson('/api/business-owner/staff/overview')->assertOk()->json('data');
        $this->assertNotEmpty($overview['recent_activity']);
        $this->assertStringNotContainsStringIgnoringCase('password', json_encode(StaffActivityLog::all()->toArray()));
    }

    public function test_activity_records_cannot_be_changed(): void
    {
        $staff = $this->staff($this->grill, 'Kitchen / Preparation Staff');
        $log = StaffActivityLog::record($staff, 'staff.created', 'Created.', [], $this->owner);
        $this->expectException(\LogicException::class);
        $log->update(['description' => 'Edited']);
    }
}
