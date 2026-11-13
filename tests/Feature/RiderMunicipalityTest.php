<?php

namespace Tests\Feature;

use App\Models\Municipality;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * A rider's municipality decides which Tourism Office sees them on the COD
 * cash advance list and may issue them cash. Before 2026-11-11 the rider
 * sign-up never saved it, so no Tourism Office could issue cash to anyone.
 */
class RiderMunicipalityTest extends TestCase
{
    use RefreshDatabase;

    private Municipality $bansud;

    private Municipality $gloria;

    private User $office;

    protected function setUp(): void
    {
        parent::setUp();

        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => '2nd District', 'province' => 'Oriental Mindoro']);
        $this->gloria = Municipality::create(['name' => 'Gloria', 'district' => '2nd District', 'province' => 'Oriental Mindoro']);
        $this->office = User::create([
            'email' => 'office@bansud.gov.ph',
            'password' => Hash::make('Password123!'),
            'role' => User::ROLE_BANSUD_TOURISM_OFFICE,
            'account_status' => 'approved',
            'municipality_id' => $this->bansud->id,
        ]);
    }

    private function signUp(array $overrides = [])
    {
        Cache::put('otp:09171234567', '123456', now()->addMinutes(5));

        return $this->postJson('/api/register', array_merge([
            'first_name' => 'Pedro',
            'last_name' => 'Rider',
            'date_of_birth' => '2000-01-15',
            'email' => 'pedro@example.com',
            'password' => 'Password123!',
            'password_confirmation' => 'Password123!',
            'role' => 'rider',
            'municipality_id' => $this->bansud->id,
            'mobile_number' => '09171234567',
            'otp_code' => '123456',
            'confirm_age' => true,
            'agree_terms' => true,
            'agree_privacy' => true,
        ], $overrides));
    }

    private function riderWithoutMunicipality(): User
    {
        $rider = User::create([
            'name' => 'Aldrin Robledo',
            'email' => 'aldrin@example.com',
            'password' => Hash::make('Password123!'),
            'role' => User::ROLE_RIDER,
            'account_status' => 'approved',
        ]);
        $rider->profile()->create(['first_name' => 'Aldrin', 'last_name' => 'Robledo', 'mobile_number' => '09170000001']);

        return $rider;
    }

    public function test_rider_sign_up_requires_a_municipality(): void
    {
        $this->signUp(['municipality_id' => null])
            ->assertStatus(422)
            ->assertJsonValidationErrors('municipality_id');

        $this->signUp(['municipality_id' => 999])
            ->assertStatus(422)
            ->assertJsonValidationErrors('municipality_id');

        $this->assertDatabaseMissing('users', ['email' => 'pedro@example.com']);
        // A rejected sign-up never burns the one-time code.
        $this->assertSame('123456', Cache::get('otp:09171234567'));
    }

    public function test_rider_sign_up_saves_the_municipality_on_the_account_and_profile(): void
    {
        $this->signUp()->assertStatus(201);

        $rider = User::where('email', 'pedro@example.com')->firstOrFail();
        $this->assertSame($this->bansud->id, (int) $rider->municipality_id);
        $this->assertSame($this->bansud->id, (int) $rider->profile->municipality_id);
    }

    public function test_signed_up_rider_appears_on_the_cash_advance_list_of_their_tourism_office(): void
    {
        $this->signUp()->assertStatus(201);

        $riders = $this->actingAs($this->office, 'sanctum')
            ->getJson('/api/admin/cash-advances')
            ->assertOk()
            ->json('data.riders');

        $this->assertSame(['Pedro Rider'], array_column($riders, 'name'));
    }

    public function test_office_can_set_a_riders_municipality_and_then_issue_cash(): void
    {
        $rider = $this->riderWithoutMunicipality();

        // Without a municipality the rider is invisible and cannot be issued cash.
        $this->actingAs($this->office, 'sanctum')->getJson('/api/admin/cash-advances')
            ->assertOk()->assertJsonPath('data.riders', []);
        $this->actingAs($this->office, 'sanctum')
            ->postJson("/api/admin/riders/{$rider->id}/cash-fund/advances", ['amount' => 500, 'idempotency_key' => (string) Str::uuid()])
            ->assertStatus(403);

        $this->actingAs($this->office, 'sanctum')
            ->putJson("/api/admin/riders/{$rider->id}/municipality", ['municipality_id' => $this->bansud->id])
            ->assertOk()
            ->assertJsonPath('data.municipality_id', $this->bansud->id)
            ->assertJsonPath('data.municipality', 'Bansud');

        $this->assertSame($this->bansud->id, (int) $rider->fresh()->municipality_id);
        $this->assertSame($this->bansud->id, (int) $rider->profile->fresh()->municipality_id);
        $this->assertDatabaseHas('activity_logs', ['action' => 'rider.municipality_updated', 'model_id' => $rider->id]);

        $this->actingAs($this->office, 'sanctum')->getJson('/api/admin/cash-advances')
            ->assertOk()->assertJsonPath('data.riders.0.name', 'Aldrin Robledo');
        $this->actingAs($this->office, 'sanctum')
            ->postJson("/api/admin/riders/{$rider->id}/cash-fund/advances", ['amount' => 500, 'idempotency_key' => (string) Str::uuid()])
            ->assertSuccessful();
    }

    public function test_a_rider_moved_to_another_municipality_leaves_this_offices_list(): void
    {
        $this->signUp()->assertStatus(201);
        $rider = User::where('email', 'pedro@example.com')->firstOrFail();

        $this->actingAs($this->office, 'sanctum')
            ->putJson("/api/admin/riders/{$rider->id}/municipality", ['municipality_id' => $this->gloria->id])
            ->assertOk();

        $this->actingAs($this->office, 'sanctum')->getJson('/api/admin/cash-advances')
            ->assertOk()->assertJsonPath('data.riders', []);
    }

    public function test_municipality_change_is_validated_and_admin_only(): void
    {
        $rider = $this->riderWithoutMunicipality();

        $this->actingAs($this->office, 'sanctum')
            ->putJson("/api/admin/riders/{$rider->id}/municipality", ['municipality_id' => 999])
            ->assertStatus(422)
            ->assertJsonValidationErrors('municipality_id');

        $this->actingAs($this->office, 'sanctum')
            ->putJson("/api/admin/riders/{$this->office->id}/municipality", ['municipality_id' => $this->bansud->id])
            ->assertStatus(404);

        $this->actingAs($rider, 'sanctum')
            ->putJson("/api/admin/riders/{$rider->id}/municipality", ['municipality_id' => $this->bansud->id])
            ->assertStatus(403);

        $this->assertNull($rider->fresh()->municipality_id);
    }
}
