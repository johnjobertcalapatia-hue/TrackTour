<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Staff;
use App\Models\StaffActivityLog;
use App\Models\StaffRole;
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
 * Staff Management §6 (docs/staff-management-plan.md): the owner's Roles &
 * Permissions page — built-in roles are read-only, custom roles belong to one
 * business and manage only the modules the owner chooses.
 */
class StaffCustomRolesTest extends TestCase
{
    use RefreshDatabase;

    private Municipality $town;

    private User $owner;

    private Business $grill;

    private Business $resort;

    private Business $otherGrill;

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
        (require base_path('database/migrations/2026_11_25_000006_add_restaurant_staff_roles.php'))->up();

        $this->owner = $this->user('owner@example.com', 'business_owner');
        $this->grill = $this->business($this->owner, 'Ekslusibo Grill', 'Restaurant');
        $this->resort = $this->business($this->owner, 'Tambunan Resort', 'Resort');
        $this->otherGrill = $this->business($this->user('other@example.com', 'business_owner'), 'Other Grill', 'Restaurant');
    }

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

    private function owner()
    {
        return $this->actingAs($this->owner, 'sanctum');
    }

    private function createRole(Business $business, string $name, array $permissions): int
    {
        return $this->owner()->postJson('/api/business-owner/roles', [
            'business_id' => $business->id, 'name' => $name, 'permissions' => $permissions,
        ])->assertCreated()->json('data.id');
    }

    private function staff(Business $business, array $roleIds): Staff
    {
        $staff = Staff::create([
            'business_id' => $business->id,
            'user_id' => $this->user(Str::random(8).'@staff.test', 'staff')->id,
            'staff_role_id' => $roleIds[0],
            'status' => 'active',
        ]);
        $staff->roles()->sync($roleIds);

        return $staff;
    }

    public function test_the_page_lists_the_three_built_in_roles_and_the_modules_for_the_business_type(): void
    {
        $data = $this->owner()->getJson("/api/business-owner/roles?business_id={$this->grill->id}")->assertOk()->json('data');

        $this->assertEqualsCanonicalizing(StaffPermissions::RESTAURANT_ROLES, array_column($data['built_in'], 'name'));
        $this->assertSame([], $data['custom']);
        $modules = array_column($data['modules'], 'key');
        $this->assertContains('menu', $modules);
        $this->assertNotContains('bookings', $modules);
        $this->assertNotEmpty($data['owner_only']);

        $resortModules = array_column($this->owner()->getJson("/api/business-owner/roles?business_id={$this->resort->id}")->json('data.modules'), 'key');
        $this->assertContains('bookings', $resortModules);
        $this->assertNotContains('menu', $resortModules);
    }

    public function test_the_owner_adds_a_custom_role_with_the_modules_it_manages(): void
    {
        $response = $this->owner()->postJson('/api/business-owner/roles', [
            'business_id' => $this->grill->id, 'name' => '  Cashier ', 'description' => 'Front counter',
            'permissions' => [StaffPermissions::ORDERS_UPDATE, StaffPermissions::PAYMENTS_CONFIRM_RIDER_CASH],
        ])->assertCreated();

        $response->assertJsonPath('data.name', 'Cashier')->assertJsonPath('data.is_custom', true);
        // Managing orders needs seeing them: the view is granted with it.
        $this->assertSame([StaffPermissions::ORDERS_VIEW, StaffPermissions::ORDERS_UPDATE, StaffPermissions::PAYMENTS_CONFIRM_RIDER_CASH], $response->json('data.permissions'));
        $this->assertSame(['orders', 'rider_cash'], $response->json('data.modules'));

        $role = StaffRole::where('name', 'Cashier')->sole();
        $this->assertSame($this->grill->id, $role->business_id);

        // Another business may use the same name; this one may not twice, nor reuse a built-in name.
        $this->actingAs($this->otherGrill->owner, 'sanctum')->postJson('/api/business-owner/roles', [
            'business_id' => $this->otherGrill->id, 'name' => 'Cashier', 'permissions' => [StaffPermissions::ORDERS_VIEW],
        ])->assertCreated();
        $this->owner()->postJson('/api/business-owner/roles', ['business_id' => $this->grill->id, 'name' => 'cashier', 'permissions' => [StaffPermissions::ORDERS_VIEW]])
            ->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->owner()->postJson('/api/business-owner/roles', ['business_id' => $this->grill->id, 'name' => StaffPermissions::FINANCE_ROLE, 'permissions' => [StaffPermissions::FINANCE_VIEW]])
            ->assertUnprocessable()->assertJsonValidationErrors('name');
    }

    public function test_only_permissions_for_the_business_type_and_never_owner_only_ones_are_accepted(): void
    {
        $base = ['business_id' => $this->resort->id, 'name' => 'Desk'];
        $this->owner()->postJson('/api/business-owner/roles', $base + ['permissions' => [StaffPermissions::MENU_MANAGE]])
            ->assertUnprocessable()->assertJsonValidationErrors('permissions.0');
        $this->owner()->postJson('/api/business-owner/roles', $base + ['permissions' => ['staff.manage']])
            ->assertUnprocessable()->assertJsonValidationErrors('permissions.0');
        $this->owner()->postJson('/api/business-owner/roles', $base + ['permissions' => []])
            ->assertUnprocessable()->assertJsonValidationErrors('permissions');
        $this->owner()->postJson('/api/business-owner/roles', $base + ['permissions' => [StaffPermissions::BOOKINGS_UPDATE]])
            ->assertCreated()->assertJsonPath('data.permissions', [StaffPermissions::BOOKINGS_VIEW, StaffPermissions::BOOKINGS_UPDATE]);
    }

    public function test_built_in_roles_are_read_only_and_other_owners_roles_are_out_of_reach(): void
    {
        $builtIn = StaffRole::where('name', StaffPermissions::FINANCE_ROLE)->value('id');
        $this->owner()->putJson("/api/business-owner/roles/{$builtIn}", ['name' => 'Finance', 'permissions' => [StaffPermissions::FINANCE_VIEW]])->assertForbidden();
        $this->owner()->deleteJson("/api/business-owner/roles/{$builtIn}")->assertForbidden();

        $theirs = StaffRole::create(['business_id' => $this->otherGrill->id, 'name' => 'Their Role']);
        $this->owner()->putJson("/api/business-owner/roles/{$theirs->id}", ['name' => 'Mine', 'permissions' => [StaffPermissions::FINANCE_VIEW]])->assertNotFound();
        $this->owner()->deleteJson("/api/business-owner/roles/{$theirs->id}")->assertNotFound();
        $this->owner()->getJson("/api/business-owner/roles?business_id={$this->otherGrill->id}")->assertNotFound();
        $this->owner()->postJson('/api/business-owner/roles', ['business_id' => $this->otherGrill->id, 'name' => 'X', 'permissions' => [StaffPermissions::FINANCE_VIEW]])->assertNotFound();

        // The roles list for a business the owner does not own offers nothing (it used to offer every role).
        $this->assertSame([], $this->owner()->getJson("/api/business-owner/staff/roles?business_id={$this->otherGrill->id}")->assertOk()->json('data'));
    }

    public function test_staff_cannot_reach_the_roles_page(): void
    {
        $staff = $this->staff($this->grill, [StaffRole::where('name', StaffPermissions::ORDER_PICKUP_ROLE)->value('id')]);
        $this->actingAs($staff->user, 'sanctum')->getJson('/api/business-owner/roles')->assertForbidden();
        $this->actingAs($staff->user, 'sanctum')->postJson('/api/business-owner/roles', ['business_id' => $this->grill->id, 'name' => 'Boss', 'permissions' => [StaffPermissions::FINANCE_VIEW]])->assertForbidden();
    }

    public function test_staff_can_be_given_their_own_business_custom_role_only(): void
    {
        $cashier = $this->createRole($this->grill, 'Cashier', [StaffPermissions::ORDERS_VIEW]);
        $theirs = StaffRole::create(['business_id' => $this->otherGrill->id, 'name' => 'Theirs']);

        $offered = collect($this->owner()->getJson("/api/business-owner/staff/roles?business_id={$this->grill->id}")->json('data'));
        $this->assertContains($cashier, $offered->pluck('id')->all());
        $this->assertNotContains($theirs->id, $offered->pluck('id')->all());

        $base = ['business_id' => $this->grill->id, 'first_name' => 'Ana', 'last_name' => 'Cruz'];
        $this->owner()->postJson('/api/business-owner/staff', $base + ['email' => 'ana@staff.test', 'staff_role_ids' => [$cashier]])->assertCreated();
        $this->owner()->postJson('/api/business-owner/staff', $base + ['email' => 'ben@staff.test', 'staff_role_ids' => [$theirs->id]])->assertUnprocessable();
        // A custom role of the owner's other business is refused too.
        $resortRole = $this->createRole($this->resort, 'Desk', [StaffPermissions::BOOKINGS_VIEW]);
        $this->owner()->postJson('/api/business-owner/staff', $base + ['email' => 'cy@staff.test', 'staff_role_ids' => [$resortRole]])->assertUnprocessable();
    }

    public function test_changing_a_role_changes_access_at_once_and_is_logged_for_each_holder(): void
    {
        $roleId = $this->createRole($this->grill, 'Kitchen', [StaffPermissions::ORDERS_VIEW]);
        $staff = $this->staff($this->grill, [$roleId]);

        $this->actingAs($staff->user, 'sanctum')->getJson('/api/staff/menu')->assertForbidden();

        $this->owner()->putJson("/api/business-owner/roles/{$roleId}", [
            'name' => 'Kitchen', 'permissions' => [StaffPermissions::ORDERS_VIEW, StaffPermissions::MENU_VIEW],
        ])->assertOk()->assertJsonPath('data.staff_count', 1);

        $this->actingAs($staff->user, 'sanctum')->getJson('/api/staff/menu')->assertOk();

        $log = StaffActivityLog::where('staff_id', $staff->id)->where('action', 'staff.role_permissions_changed')->sole();
        $this->assertSame([StaffPermissions::ORDERS_VIEW], $log->properties['permissions_before']);
        $this->assertContains(StaffPermissions::MENU_VIEW, $log->properties['permissions_after']);
    }

    public function test_a_role_can_only_be_deleted_when_nobody_holds_it(): void
    {
        $roleId = $this->createRole($this->grill, 'Runner', [StaffPermissions::HANDOVER_CONFIRM]);
        $staff = $this->staff($this->grill, [$roleId]);

        $this->owner()->deleteJson("/api/business-owner/roles/{$roleId}")->assertUnprocessable();
        $this->assertSame(1, $this->owner()->getJson("/api/business-owner/roles?business_id={$this->grill->id}")->json('data.custom.0.staff_count'));

        $staff->roles()->sync([StaffRole::where('name', StaffPermissions::ORDER_PICKUP_ROLE)->value('id')]);
        $staff->forceFill(['staff_role_id' => StaffRole::where('name', StaffPermissions::ORDER_PICKUP_ROLE)->value('id')])->save();

        $this->owner()->deleteJson("/api/business-owner/roles/{$roleId}")->assertOk();
        $this->assertNull(StaffRole::find($roleId));
    }
}
