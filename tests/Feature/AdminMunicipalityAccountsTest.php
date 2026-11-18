<?php

namespace Tests\Feature;

use App\Models\Municipality;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Bansud Tourism Office creating and managing municipal Tourism Office
 * accounts from one place (/admin/municipality-accounts) and from the general
 * Create User form.
 */
class AdminMunicipalityAccountsTest extends TestCase
{
    use RefreshDatabase;

    private User $districtAdmin;
    private Municipality $bansud;
    private Municipality $gloria;
    private Municipality $roxas;

    protected function setUp(): void
    {
        parent::setUp();

        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->gloria = Municipality::create(['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->roxas = Municipality::create(['name' => 'Roxas', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->districtAdmin = $this->user(User::ROLE_BANSUD_TOURISM_OFFICE, $this->bansud);
    }

    public function test_creates_a_municipality_account_for_the_chosen_municipality(): void
    {
        $payload = [
            'first_name' => 'Rosa',
            'last_name' => 'Villanueva',
            'email' => 'tourism@roxas.gov.ph',
            'password' => 'Roxas2026!',
            'password_confirmation' => 'Roxas2026!',
        ];

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->postJson('/api/admin/municipality-accounts', $payload)
            ->assertStatus(422)
            ->assertJsonValidationErrors(['municipality_id']);

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->postJson('/api/admin/municipality-accounts', $payload + ['municipality_id' => $this->roxas->id])
            ->assertCreated()
            ->assertJsonPath('data.email', 'tourism@roxas.gov.ph');

        $officer = User::where('email', 'tourism@roxas.gov.ph')->firstOrFail();
        $this->assertSame(User::ROLE_TOURISM_OFFICE, $officer->role);
        $this->assertSame($this->roxas->id, (int) $officer->municipality_id);

        $this->actingAs($officer, 'sanctum')
            ->getJson('/api/municipal/dashboard')
            ->assertOk()
            ->assertJsonPath('data.municipality.name', 'Roxas');
    }

    public function test_cannot_create_an_account_for_a_deleted_municipality(): void
    {
        $this->roxas->delete();

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->postJson('/api/admin/municipality-accounts', [
                'municipality_id' => $this->roxas->id,
                'first_name' => 'Rosa',
                'last_name' => 'Villanueva',
                'email' => 'tourism@roxas.gov.ph',
                'password' => 'Roxas2026!',
                'password_confirmation' => 'Roxas2026!',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['municipality_id']);

        $this->assertDatabaseMissing('users', ['email' => 'tourism@roxas.gov.ph']);
    }

    public function test_lists_accounts_with_filters_and_coverage_stats(): void
    {
        $gloriaOfficer = $this->user(User::ROLE_TOURISM_OFFICE, $this->gloria);
        $unassigned = $this->user(User::ROLE_TOURISM_OFFICE, null, User::ACCOUNT_STATUS_SUSPENDED);
        $this->user(User::ROLE_RIDER, $this->gloria);

        $response = $this->actingAs($this->districtAdmin, 'sanctum')
            ->getJson('/api/admin/municipality-accounts')
            ->assertOk()
            ->assertJsonPath('meta.stats.total', 2)
            ->assertJsonPath('meta.stats.active', 1)
            ->assertJsonPath('meta.stats.unassigned', 1)
            // Roxas has none; Bansud (home) is managed by the district office.
            ->assertJsonPath('meta.stats.municipalities_without_account', 1);
        $this->assertCount(2, $response->json('data'));

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->getJson('/api/admin/municipality-accounts?municipality_id=unassigned')
            ->assertOk()
            ->assertJsonPath('data.0.id', $unassigned->id)
            ->assertJsonCount(1, 'data');

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->getJson("/api/admin/municipality-accounts?municipality_id={$this->gloria->id}")
            ->assertOk()
            ->assertJsonPath('data.0.id', $gloriaOfficer->id)
            ->assertJsonPath('data.0.municipality', 'Gloria');
    }

    public function test_reassigning_a_removed_account_restores_portal_access(): void
    {
        $officer = $this->user(User::ROLE_TOURISM_OFFICE, null, User::ACCOUNT_STATUS_SUSPENDED);

        $this->actingAs($officer, 'sanctum')->getJson('/api/municipal/dashboard')->assertForbidden();

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->postJson("/api/admin/municipality-accounts/{$officer->id}/assign", ['municipality_id' => $this->gloria->id])
            ->assertOk()
            ->assertJsonPath('data.municipality', 'Gloria');

        $officer->refresh();
        $this->assertSame($this->gloria->id, (int) $officer->municipality_id);
        $this->assertSame(User::ACCOUNT_STATUS_APPROVED, $officer->account_status);

        $this->actingAs($officer, 'sanctum')->getJson('/api/municipal/dashboard')->assertOk();

        $rider = $this->user(User::ROLE_RIDER, $this->roxas);
        $this->actingAs($this->districtAdmin, 'sanctum')
            ->postJson("/api/admin/municipality-accounts/{$rider->id}/assign", ['municipality_id' => $this->gloria->id])
            ->assertNotFound();
        $this->assertSame($this->roxas->id, (int) $rider->fresh()->municipality_id);
    }

    public function test_create_user_form_binds_a_tourism_office_account_to_its_municipality(): void
    {
        $base = [
            'first_name' => 'Lito',
            'last_name' => 'Ramos',
            'email' => 'tourism@gloria.gov.ph',
            'password' => 'Password123!',
            'password_confirmation' => 'Password123!',
            'role' => 'tourism_office',
            'account_status' => 'approved',
        ];

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->postJson('/api/admin/users', $base)
            ->assertStatus(422)
            ->assertJsonValidationErrors(['municipality_id']);

        $this->actingAs($this->districtAdmin, 'sanctum')
            ->postJson('/api/admin/users', $base + ['municipality_id' => $this->gloria->id])
            ->assertCreated();

        $officer = User::where('email', 'tourism@gloria.gov.ph')->firstOrFail();
        $this->assertSame($this->gloria->id, (int) $officer->municipality_id);
        $this->assertSame('Lito Ramos', $officer->name);
        $this->actingAs($officer, 'sanctum')->getJson('/api/municipal/dashboard')->assertOk();
    }

    public function test_create_user_form_works_with_first_and_last_name_for_other_roles(): void
    {
        $this->actingAs($this->districtAdmin, 'sanctum')
            ->postJson('/api/admin/users', [
                'first_name' => 'Kim',
                'last_name' => 'Lee',
                'email' => 'kim@example.com',
                'password' => 'Password123!',
                'password_confirmation' => 'Password123!',
                'role' => 'tourist',
                'municipality_id' => $this->gloria->id, // ignored for non-office roles
            ])
            ->assertCreated();

        $tourist = User::where('email', 'kim@example.com')->firstOrFail();
        $this->assertNull($tourist->municipality_id);
        $this->assertSame('Kim Lee', $tourist->name);
    }

    public function test_municipal_offices_cannot_manage_municipality_accounts(): void
    {
        $officer = $this->user(User::ROLE_TOURISM_OFFICE, $this->gloria);

        $this->actingAs($officer, 'sanctum')->getJson('/api/admin/municipality-accounts')->assertForbidden();
        $this->actingAs($officer, 'sanctum')
            ->postJson('/api/admin/municipality-accounts', ['municipality_id' => $this->gloria->id])
            ->assertForbidden();
    }

    private function user(string $role, ?Municipality $municipality, string $status = User::ACCOUNT_STATUS_APPROVED): User
    {
        return User::create([
            'name' => ucfirst($role).' '.Str::random(4),
            'email' => Str::lower($role.'.'.Str::random(10)).'@example.com',
            'password' => 'Password123!',
            'role' => $role,
            'account_status' => $status,
            'municipality_id' => $municipality?->id,
        ]);
    }
}
