<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\Municipality;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class RiderProfileUpdateTest extends TestCase
{
    use RefreshDatabase;

    private User $rider;

    private Municipality $bansud;

    private Municipality $other;

    protected function setUp(): void
    {
        parent::setUp();

        $this->bansud = Municipality::firstOrCreate(['name' => 'Bansud'], ['district' => '1st', 'province' => 'Oriental Mindoro']);
        $this->other = Municipality::firstOrCreate(['name' => 'Gloria'], ['district' => '1st', 'province' => 'Oriental Mindoro']);

        $this->rider = User::create([
            'name' => 'Profile Rider',
            'email' => 'profile-rider@example.com',
            'password' => Hash::make('Password123!'),
            'role' => User::ROLE_RIDER,
            'account_status' => 'approved',
            'municipality_id' => $this->bansud->id,
        ]);
        $this->rider->profile()->create(['first_name' => 'Profile', 'last_name' => 'Rider', 'municipality_id' => $this->bansud->id]);
        $this->rider->riderDetail()->create(['current_service' => User::SERVICE_FOOD]);
    }

    private function headers(): array
    {
        return ['Authorization' => 'Bearer '.$this->rider->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
    }

    public function test_saves_phone_and_shows_the_registered_municipality_and_barangay(): void
    {
        $barangay = Barangay::create(['municipality_id' => $this->bansud->id, 'name' => 'Poblacion']);
        $this->rider->profile()->update(['barangay_id' => $barangay->id]);

        $this->putJson('/api/rider/profile', [
            'name' => 'Profile Rider',
            'email' => 'profile-rider@example.com',
            'phone' => '09171234567',
        ], $this->headers())
            ->assertOk()
            ->assertJsonPath('data.phone', '09171234567')
            ->assertJsonPath('data.municipality', 'Bansud')
            ->assertJsonPath('data.barangay', 'Poblacion');

        $this->assertSame('09171234567', $this->rider->profile()->first()->mobile_number);
    }

    public function test_rider_cannot_change_municipality_or_barangay(): void
    {
        $other = Barangay::create(['municipality_id' => $this->other->id, 'name' => 'Malamig']);

        $this->putJson('/api/rider/profile', [
            'municipality_id' => $this->other->id,
            'barangay_id' => $other->id,
        ], $this->headers())
            ->assertStatus(422)
            ->assertJsonValidationErrors(['municipality_id', 'barangay_id']);

        $profile = $this->rider->profile()->first();
        $this->assertSame($this->bansud->id, $profile->municipality_id);
        $this->assertNull($profile->barangay_id);
        $this->assertSame($this->bansud->id, $this->rider->fresh()->municipality_id);
    }

    public function test_missing_photo_file_is_reported_as_no_photo_and_upload_replaces_it(): void
    {
        Storage::fake('public');
        $this->rider->profile()->update(['avatar' => 'profiles/gone.jpg']);

        $this->getJson('/api/rider/profile', $this->headers())
            ->assertOk()
            ->assertJsonPath('data.profile_photo', null);

        $response = $this->post('/api/rider/profile/photo', [
            'photo' => UploadedFile::fake()->image('me.jpg', 600, 600)->size(3000),
        ], $this->headers())->assertOk();

        $path = $response->json('data.profile_photo');
        $this->assertNotNull($path);
        Storage::disk('public')->assertExists($path);
    }
}
