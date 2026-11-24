<?php

namespace Tests\Feature;

use App\Models\Municipality;
use App\Models\TouristLocationShare;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Opt-in tourist location sharing with the tourism office: off by default,
 * latest position only, wiped on opt-out and after an hour.
 */
class TouristLocationSharingTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $tourist;

    protected function setUp(): void
    {
        parent::setUp();
        $bansud = Municipality::create(['name' => 'Bansud', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->admin = $this->user('bansud_tourism_office', 'Bansud Admin', $bansud->id);
        $this->tourist = $this->user('tourist', 'Tina Tourist');
    }

    public function test_sharing_is_off_by_default_and_pings_are_refused(): void
    {
        $this->actingAs($this->tourist, 'sanctum')->getJson('/api/tourist/location-sharing')
            ->assertOk()->assertJsonPath('data.enabled', false);

        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/tourist/location-sharing/ping', ['latitude' => 12.86, 'longitude' => 121.45])
            ->assertStatus(409);

        $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/live/tourists')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_opted_in_tourist_appears_live_and_opting_out_wipes_the_position(): void
    {
        $this->actingAs($this->tourist, 'sanctum')->putJson('/api/tourist/location-sharing', ['enabled' => true])
            ->assertOk()->assertJsonPath('data.enabled', true);
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/tourist/location-sharing/ping', ['latitude' => 12.86, 'longitude' => 121.45, 'accuracy' => 12])
            ->assertOk();

        $rows = $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/live/tourists')->assertOk()->json('data');
        $this->assertCount(1, $rows);
        $this->assertSame('Tina Tourist', $rows[0]['name']);
        $this->assertEquals(12.86, $rows[0]['location']['lat']);

        // A stale position (app closed) drops off the live map.
        TouristLocationShare::where('user_id', $this->tourist->id)->update(['location_at' => now()->subMinutes(6)]);
        $this->actingAs($this->admin, 'sanctum')->getJson('/api/admin/live/tourists')->assertJsonCount(0, 'data');

        $this->actingAs($this->tourist, 'sanctum')->putJson('/api/tourist/location-sharing', ['enabled' => false])->assertOk();
        $share = TouristLocationShare::where('user_id', $this->tourist->id)->first();
        $this->assertFalse($share->enabled);
        $this->assertNull($share->latitude);
        $this->assertNull($share->location_at);
    }

    public function test_prune_clears_positions_older_than_an_hour(): void
    {
        $old = TouristLocationShare::create(['user_id' => $this->tourist->id, 'enabled' => true, 'latitude' => 12.8, 'longitude' => 121.4, 'location_at' => now()->subMinutes(61)]);
        $other = $this->user('tourist', 'Fresh Tourist');
        $fresh = TouristLocationShare::create(['user_id' => $other->id, 'enabled' => true, 'latitude' => 12.9, 'longitude' => 121.5, 'location_at' => now()]);

        $this->artisan('tourist-locations:prune')->assertSuccessful();

        $this->assertNull($old->fresh()->latitude);
        $this->assertTrue($old->fresh()->enabled);
        $this->assertEquals(12.9, $fresh->fresh()->latitude);
    }

    public function test_only_the_bansud_admin_can_see_tourist_locations_and_only_tourists_can_share(): void
    {
        foreach (['tourism_office', 'rider', 'tourist', 'business_owner'] as $role) {
            $this->actingAs($this->user($role, ucfirst($role)), 'sanctum')->getJson('/api/admin/live/tourists')->assertForbidden();
        }
        $this->actingAs($this->user('rider', 'Rider'), 'sanctum')->putJson('/api/tourist/location-sharing', ['enabled' => true])->assertForbidden();
    }

    private function user(string $role, string $name, ?int $municipalityId = null): User
    {
        return User::create([
            'name' => $name, 'email' => Str::lower($role.'.'.Str::random(8)).'@example.com', 'password' => 'Password123!',
            'role' => $role, 'account_status' => 'approved', 'municipality_id' => $municipalityId,
        ]);
    }
}
