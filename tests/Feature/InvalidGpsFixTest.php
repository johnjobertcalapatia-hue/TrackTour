<?php

namespace Tests\Feature;

use App\Models\Municipality;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * A GPS fix with an exact 0 latitude or longitude is a reading missing an axis
 * (emulated / overridden location with an empty field), never a real rider
 * position. Production saved one (12.96, 0.0) on 2026-11-10: the rider was then
 * "12,949 km" from the drop-off and could not complete the delivery. Such fixes
 * are refused and never saved.
 */
class InvalidGpsFixTest extends TestCase
{
    use RefreshDatabase;

    private User $rider;

    protected function setUp(): void
    {
        parent::setUp();
        $muni = Municipality::create(['name' => 'Bansud', 'district' => '1st', 'province' => 'Oriental Mindoro']);
        $this->rider = User::create(['email' => 'rider@gps.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved', 'rider_status' => 'available', 'current_service' => 'food', 'municipality_id' => $muni->id]);
        RiderDetail::create(['user_id' => $this->rider->id, 'rider_status' => 'available', 'current_service' => 'food']);
    }

    private function send(float $lat, float $lng)
    {
        return $this->be($this->rider)->postJson('/api/rider/map/location', ['latitude' => $lat, 'longitude' => $lng]);
    }

    public function test_a_fix_with_zero_longitude_is_refused_and_not_saved(): void
    {
        $this->send(12.9604387, 0.0)->assertStatus(422)
            ->assertJsonPath('message', 'Your device reported an invalid location. Check the location settings on your phone and try again.');
        $this->assertSame(0, RiderLocation::count());
    }

    public function test_a_fix_with_zero_latitude_is_refused_and_not_saved(): void
    {
        $this->send(0.0, 121.4676283)->assertStatus(422);
        $this->assertSame(0, RiderLocation::count());
    }

    public function test_a_real_fix_is_saved(): void
    {
        $this->send(12.9604387, 121.4676283)->assertOk();
        $this->assertSame(1, RiderLocation::where('rider_id', $this->rider->id)->count());
    }
}
