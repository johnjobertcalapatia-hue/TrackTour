<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\UserProfile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ProfileTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tourist = User::create([
            'email' => 'tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->tourist->profile()->create([
            'first_name' => 'Tourist',
            'last_name' => 'User',
            'mobile_number' => '09171234567',
        ]);
    }

    public function test_profile_can_be_viewed(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/profile');

        $response
            ->assertOk()
            ->assertJson([
                'success' => true,
                'data' => [
                    'email' => 'tourist@example.com',
                    'first_name' => 'Tourist',
                    'last_name' => 'User',
                ],
            ]);
    }

    public function test_profile_information_can_be_updated(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->putJson('/api/tourist/profile', [
                'name' => 'Test User',
                'email' => 'updated@example.com',
                'mobile_number' => '09179876543',
            ]);

        $response
            ->assertOk()
            ->assertJson([
                'success' => true,
                'message' => 'Profile updated successfully.',
            ]);

        $this->assertSame('updated@example.com', $this->tourist->fresh()->email);

        $profile = $this->tourist->fresh()->profile;
        $this->assertSame('Test User', $profile->first_name);
        $this->assertSame('09179876543', $profile->mobile_number);
    }

    public function test_email_verification_status_is_unchanged_when_the_email_address_is_unchanged(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->putJson('/api/tourist/profile', [
                'name' => 'Test User',
                'email' => $this->tourist->email,
            ]);

        $response->assertOk();

        $this->assertSame('tourist@example.com', $this->tourist->fresh()->email);
        $this->assertNull($this->tourist->fresh()->email_verified_at);
        $this->assertSame('Test User', $this->tourist->fresh()->profile->first_name);
    }
}