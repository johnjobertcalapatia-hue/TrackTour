<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * District Super Admin (Bansud Tourism Office) management of municipalities
 * and their Municipality Tourism Admin accounts.
 */
class AdminMunicipalityManagementTest extends TestCase
{
    use RefreshDatabase;

    private User $districtAdmin;
    private Municipality $bansud;

    protected function setUp(): void
    {
        parent::setUp();

        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->districtAdmin = $this->user(User::ROLE_BANSUD_TOURISM_OFFICE, $this->bansud);
    }

    public function test_district_admin_can_add_a_municipality_with_validation(): void
    {
        $this->actingAs($this->districtAdmin, 'sanctum')
            ->postJson('/api/admin/municipalities', ['name' => 'Gloria'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['district', 'province']);

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->postJson('/api/admin/municipalities', [
                'name' => 'Gloria',
                'district' => 'District 2',
                'province' => 'Oriental Mindoro',
                'latitude' => 12.97,
                'longitude' => 121.48,
            ])
            ->assertCreated()
            ->assertJsonPath('data.name', 'Gloria');

        $this->assertDatabaseHas('municipalities', ['name' => 'Gloria', 'district' => 'District 2']);
        $this->assertTrue(ActivityLog::where('action', 'municipality.created')->exists());

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->postJson('/api/admin/municipalities', ['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['name']);
    }

    public function test_district_admin_can_update_a_municipality(): void
    {
        $gloria = Municipality::create(['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->putJson("/api/admin/municipalities/{$gloria->id}", ['district' => 'District 1'])
            ->assertOk()
            ->assertJsonPath('data.district', 'District 1');

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->putJson("/api/admin/municipalities/{$gloria->id}", ['name' => 'Bansud'])
            ->assertStatus(422);

        $this->assertSame('Gloria', $gloria->fresh()->name);
    }

    public function test_index_lists_counts_and_supports_search(): void
    {
        $gloria = Municipality::create(['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->user(User::ROLE_RIDER, $gloria);
        $this->user(User::ROLE_TOURISM_OFFICE, $gloria);

        $response = $this->actingAs($this->districtAdmin, 'sanctum')
            ->getJson('/api/admin/municipalities?search=glo')
            ->assertOk();

        $this->assertCount(1, $response->json('data'));
        $response->assertJsonPath('data.0.name', 'Gloria')
            ->assertJsonPath('data.0.riders_count', 1)
            ->assertJsonPath('data.0.admins_count', 1)
            ->assertJsonPath('data.0.is_home', false);
    }

    public function test_home_municipality_and_municipalities_in_use_cannot_be_deleted(): void
    {
        $this->actingAs($this->districtAdmin, 'sanctum')
            ->deleteJson("/api/admin/municipalities/{$this->bansud->id}")
            ->assertStatus(422);
        $this->assertNotSoftDeleted('municipalities', ['id' => $this->bansud->id]);

        $gloria = Municipality::create(['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $owner = $this->user(User::ROLE_BUSINESS_OWNER, $gloria);
        Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => $gloria->id,
            'business_name' => 'Gloria Grill',
            'business_description' => 'Test',
            'status' => 'approved',
        ]);

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->deleteJson("/api/admin/municipalities/{$gloria->id}")
            ->assertStatus(422);
        $this->assertNotSoftDeleted('municipalities', ['id' => $gloria->id]);

        $empty = Municipality::create(['name' => 'Pola', 'district' => 'District 1', 'province' => 'Oriental Mindoro']);
        $this->actingAs($this->districtAdmin, 'sanctum')
            ->deleteJson("/api/admin/municipalities/{$empty->id}")
            ->assertSuccessful();
        $this->assertSoftDeleted('municipalities', ['id' => $empty->id]);
    }

    public function test_district_admin_creates_a_municipal_admin_who_can_use_the_municipal_portal(): void
    {
        $gloria = Municipality::create(['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->postJson("/api/admin/municipalities/{$gloria->id}/admins", [
                'first_name' => 'Maria',
                'last_name' => 'Santos',
                'email' => 'tourism@gloria.gov.ph',
                'password' => 'short',
                'password_confirmation' => 'short',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['password']);

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->postJson("/api/admin/municipalities/{$gloria->id}/admins", [
                'first_name' => 'Maria',
                'last_name' => 'Santos',
                'email' => 'tourism@gloria.gov.ph',
                'password' => 'Gloria2026!',
                'password_confirmation' => 'Gloria2026!',
            ])
            ->assertCreated()
            ->assertJsonPath('data.email', 'tourism@gloria.gov.ph');

        $officer = User::where('email', 'tourism@gloria.gov.ph')->firstOrFail();
        $this->assertSame(User::ROLE_TOURISM_OFFICE, $officer->role);
        $this->assertSame(User::ACCOUNT_STATUS_APPROVED, $officer->account_status);
        $this->assertSame($gloria->id, (int) $officer->municipality_id);
        $this->assertSame($gloria->id, (int) $officer->profile->municipality_id);

        $this->actingAs($officer, 'sanctum')
            ->getJson('/api/municipal/dashboard')
            ->assertOk()
            ->assertJsonPath('data.municipality.name', 'Gloria');

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->getJson("/api/admin/municipalities/{$gloria->id}")
            ->assertOk()
            ->assertJsonPath('data.stats.admins_count', 1)
            ->assertJsonPath('data.admins.0.email', 'tourism@gloria.gov.ph');
    }

    public function test_removing_a_municipal_admin_revokes_scope_and_sessions(): void
    {
        $gloria = Municipality::create(['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $roxas = Municipality::create(['name' => 'Roxas', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $officer = $this->user(User::ROLE_TOURISM_OFFICE, $gloria);
        $officer->createToken('session');

        // Wrong municipality → not found, nothing changes.
        $this->actingAs($this->districtAdmin, 'sanctum')
            ->deleteJson("/api/admin/municipalities/{$roxas->id}/admins/{$officer->id}")
            ->assertNotFound();
        $this->assertSame($gloria->id, (int) $officer->fresh()->municipality_id);

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->deleteJson("/api/admin/municipalities/{$gloria->id}/admins/{$officer->id}")
            ->assertOk();

        $officer->refresh();
        $this->assertNull($officer->municipality_id);
        $this->assertSame(User::ACCOUNT_STATUS_SUSPENDED, $officer->account_status);
        $this->assertSame(0, $officer->tokens()->count());

        $this->actingAs($officer, 'sanctum')
            ->getJson('/api/municipal/dashboard')
            ->assertForbidden();
    }

    public function test_only_tourism_office_accounts_can_be_removed_as_municipal_admins(): void
    {
        $gloria = Municipality::create(['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $rider = $this->user(User::ROLE_RIDER, $gloria);

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->deleteJson("/api/admin/municipalities/{$gloria->id}/admins/{$rider->id}")
            ->assertNotFound();

        $this->assertSame($gloria->id, (int) $rider->fresh()->municipality_id);
        $this->assertSame(User::ACCOUNT_STATUS_APPROVED, $rider->fresh()->account_status);
    }

    private function user(string $role, ?Municipality $municipality): User
    {
        return User::create([
            'name' => ucfirst($role).' '.Str::random(4),
            'email' => Str::lower($role.'.'.Str::random(10)).'@example.com',
            'password' => 'Password123!',
            'role' => $role,
            'account_status' => User::ACCOUNT_STATUS_APPROVED,
            'municipality_id' => $municipality?->id,
        ]);
    }
}
