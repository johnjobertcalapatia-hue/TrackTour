<?php

namespace Tests\Feature;

use App\Models\TouristDestination;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Phase 2.1 — Define roles and permissions, Step 4: unauthorized actions.
 *
 * Pins docs/PHASE2-ROLES-PERMISSIONS.md:
 * - F-1 fix: office roles are not publicly registrable (422, no rows created)
 * - district-admin surface denied to every wrong role, including `staff`
 * - denied writes leave the target data unchanged
 * - positive controls keep the authorized paths working
 */
class Phase2RoleAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    private User $districtAdmin;
    private User $municipalityOfficer;
    private User $staffUser;
    private User $tourist;
    private User $businessOwner;
    private User $rider;

    protected function setUp(): void
    {
        parent::setUp();

        $this->districtAdmin = $this->makeUser('bansud_tourism_office');
        $this->municipalityOfficer = $this->makeUser('tourism_office');
        $this->staffUser = $this->makeUser('staff');
        $this->tourist = $this->makeUser('tourist');
        $this->businessOwner = $this->makeUser('business_owner');
        $this->rider = $this->makeUser('rider');
    }

    private function makeUser(string $role, string $status = 'approved'): User
    {
        return User::create([
            'name' => ucfirst(str_replace('_', ' ', $role)),
            'email' => Str::lower($role.'.'.Str::random(8)).'@example.com',
            'password' => 'Password123!',
            'role' => $role,
            'account_status' => $status,
        ]);
    }

    // ------------------------------------------------------------------
    // F-1: office roles must not be publicly registrable
    // ------------------------------------------------------------------

    public function test_public_registration_rejects_municipality_tourism_admin_role(): void
    {
        $before = User::count();

        $this->postJson('/api/register', [
            'email' => Str::lower('mta.'.Str::random(8)).'@example.com',
            'password' => 'Password123!',
            'password_confirmation' => 'Password123!',
            'role' => 'tourism_office',
            'first_name' => 'Escalated',
            'last_name' => 'Account',
            'date_of_birth' => '1990-01-01',
            'mobile_number' => '09171234567',
        ])->assertStatus(422);

        $this->assertSame($before, User::count());
        $this->assertDatabaseMissing('users', ['role' => 'tourism_office', 'email' => Str::lower('mta.'.Str::random(8)).'@example.com']);
    }

    public function test_public_registration_rejects_district_super_admin_role(): void
    {
        $email = Str::lower('dsa.'.Str::random(8)).'@example.com';
        $before = User::count();

        $this->postJson('/api/register', [
            'email' => $email,
            'password' => 'Password123!',
            'password_confirmation' => 'Password123!',
            'role' => 'bansud_tourism_office',
            'name' => 'Escalated Super Admin',
        ])->assertStatus(422);

        $this->assertSame($before, User::count());
        $this->assertDatabaseMissing('users', ['email' => $email]);
    }

    public function test_public_registration_still_allows_tourist(): void
    {
        $email = Str::lower('tourist.'.Str::random(8)).'@example.com';

        $this->postJson('/api/register', [
            'email' => $email,
            'password' => 'Password123!',
            'password_confirmation' => 'Password123!',
            'role' => 'tourist',
            'first_name' => 'Ordinary',
            'last_name' => 'Tourist',
            'date_of_birth' => '1995-06-15',
            'mobile_number' => '09170001111',
        ])->assertCreated();

        $this->assertDatabaseHas('users', ['email' => $email, 'role' => 'tourist']);
    }

    // ------------------------------------------------------------------
    // District-admin surface denied to every wrong role (incl. staff,
    // which AdminFoundationTest's non-admin loop omits)
    // ------------------------------------------------------------------

    public function test_staff_cannot_access_district_admin_surface(): void
    {
        $this->actingAs($this->staffUser, 'sanctum')
            ->getJson('/api/admin/dashboard')
            ->assertForbidden();

        $this->actingAs($this->staffUser, 'sanctum')
            ->getJson('/api/admin/users')
            ->assertForbidden();
    }

    public function test_all_non_admin_roles_are_denied_on_district_dashboard(): void
    {
        foreach ([$this->tourist, $this->businessOwner, $this->rider, $this->municipalityOfficer] as $user) {
            $this->actingAs($user, 'sanctum')
                ->getJson('/api/admin/dashboard')
                ->assertForbidden();
        }
    }

    // ------------------------------------------------------------------
    // Denied writes must leave the target data unchanged
    // ------------------------------------------------------------------

    public function test_municipality_tourism_admin_cannot_approve_accounts_and_data_is_unchanged(): void
    {
        $target = $this->makeUser('tourist', 'pending');

        $this->actingAs($this->municipalityOfficer, 'sanctum')
            ->postJson("/api/admin/users/{$target->id}/approve")
            ->assertForbidden();

        $this->assertSame('pending', $target->fresh()->account_status);
    }

    public function test_tourist_cannot_approve_riders_and_rider_status_is_unchanged(): void
    {
        $riderTarget = $this->makeUser('rider', 'pending');

        $this->actingAs($this->tourist, 'sanctum')
            ->postJson("/api/admin/riders/{$riderTarget->id}/approve")
            ->assertForbidden();

        $this->assertSame('pending', $riderTarget->fresh()->account_status);
    }

    public function test_business_owner_cannot_settle_payouts_and_status_is_unchanged(): void
    {
        $payoutId = $this->createPendingPayout();

        $this->actingAs($this->businessOwner, 'sanctum')
            ->postJson("/api/admin/payouts/{$payoutId}/approve")
            ->assertForbidden();

        $this->assertSame('pending', $this->payoutStatus($payoutId));
    }

    public function test_rider_cannot_settle_payouts_and_status_is_unchanged(): void
    {
        $payoutId = $this->createPendingPayout();

        $this->actingAs($this->rider, 'sanctum')
            ->postJson("/api/admin/payouts/{$payoutId}/reject", ['remarks' => 'nope'])
            ->assertForbidden();

        $this->assertSame('pending', $this->payoutStatus($payoutId));
    }

    private function createPendingPayout(): int
    {
        return (int) \DB::table('rider_payouts')->insertGetId([
            'rider_id' => $this->rider->id,
            'payout_number' => 'PO-'.Str::upper(Str::random(10)),
            'amount' => 150.00,
            'status' => 'pending',
        ]);
    }

    private function payoutStatus(int $payoutId): ?string
    {
        return \DB::table('rider_payouts')->where('id', $payoutId)->value('status');
    }

    public function test_non_office_roles_cannot_create_tourism_content_and_no_rows_created(): void
    {
        $before = TouristDestination::count();

        foreach ([$this->tourist, $this->businessOwner, $this->rider, $this->staffUser] as $user) {
            $this->actingAs($user, 'sanctum')
                ->postJson('/api/tourism-office/destinations', [
                    'name' => 'Unauthorized Spot',
                    'description' => 'should never persist',
                ])
                ->assertForbidden();
        }

        $this->assertSame($before, TouristDestination::count());
    }

    public function test_tourist_cannot_change_business_owner_status_and_status_is_unchanged(): void
    {
        $owner = $this->makeUser('business_owner', 'pending');

        $this->actingAs($this->tourist, 'sanctum')
            ->patchJson("/api/tourism-office/business-owners/{$owner->id}/status", [
                'account_status' => 'approved',
            ])
            ->assertForbidden();

        $this->assertSame('pending', $owner->fresh()->account_status);
    }

    // ------------------------------------------------------------------
    // Positive controls: authorized paths still work
    // ------------------------------------------------------------------

    public function test_district_super_admin_can_access_admin_dashboard(): void
    {
        $this->actingAs($this->districtAdmin, 'sanctum')
            ->getJson('/api/admin/dashboard')
            ->assertOk();
    }

    public function test_municipality_tourism_admin_can_access_tourism_office_dashboard(): void
    {
        $this->actingAs($this->municipalityOfficer, 'sanctum')
            ->getJson('/api/tourism-office/dashboard')
            ->assertOk();
    }
}
