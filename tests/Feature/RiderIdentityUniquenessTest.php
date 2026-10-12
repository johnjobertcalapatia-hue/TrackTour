<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * Rider registration collects a date of birth (18+). A rider may not register
 * twice under the same first name + last name + date of birth, while a
 * same-named non-rider (e.g. a tourist) does not block a rider registration.
 */
class RiderIdentityUniquenessTest extends TestCase
{
    use RefreshDatabase;

    private function seedOtp(string $mobile): void
    {
        Cache::put('otp:'.$mobile, '123456', now()->addMinutes(5));
    }

    private function riderPayload(array $overrides = []): array
    {
        return array_merge([
            'first_name' => 'Pedro',
            'last_name' => 'Rider',
            'date_of_birth' => '2000-01-15',
            'email' => 'rider@example.com',
            'password' => 'Password123!',
            'password_confirmation' => 'Password123!',
            'role' => 'rider',
            'mobile_number' => '09171234567',
            'otp_code' => '123456',
            'referral_code' => null,
            'confirm_age' => true,
            'agree_terms' => true,
            'agree_privacy' => true,
        ], $overrides);
    }

    private function existingRider(string $first, string $last, string $dob): User
    {
        $user = User::factory()->create(['role' => User::ROLE_RIDER]);
        $user->profile()->create([
            'first_name' => $first,
            'last_name' => $last,
            'date_of_birth' => $dob,
            'mobile_number' => '09990000000',
        ]);

        return $user;
    }

    public function test_duplicate_name_and_date_of_birth_is_rejected(): void
    {
        $this->existingRider('Pedro', 'Rider', '2000-01-15');
        $this->seedOtp('09171234567');

        $this->postJson('/api/register', $this->riderPayload())
            ->assertStatus(422)
            ->assertJsonValidationErrors('last_name');

        $this->assertDatabaseMissing('users', ['email' => 'rider@example.com']);
    }

    public function test_duplicate_check_is_case_insensitive(): void
    {
        $this->existingRider('Pedro', 'Rider', '2000-01-15');
        $this->seedOtp('09171234567');

        $this->postJson('/api/register', $this->riderPayload([
            'first_name' => 'PEDRO',
            'last_name' => 'rider',
        ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('last_name');
    }

    public function test_same_name_with_a_different_date_of_birth_is_allowed(): void
    {
        $this->existingRider('Pedro', 'Rider', '2000-01-15');
        $this->seedOtp('09171234567');

        $this->postJson('/api/register', $this->riderPayload([
            'date_of_birth' => '1999-05-05',
        ]))->assertStatus(201);

        $this->assertDatabaseHas('users', ['email' => 'rider@example.com', 'role' => 'rider']);
    }

    public function test_same_name_and_date_of_birth_of_a_non_rider_does_not_block(): void
    {
        $tourist = User::factory()->create(['role' => User::ROLE_TOURIST]);
        $tourist->profile()->create([
            'first_name' => 'Pedro',
            'last_name' => 'Rider',
            'date_of_birth' => '2000-01-15',
            'mobile_number' => '09991111111',
        ]);
        $this->seedOtp('09171234567');

        $this->postJson('/api/register', $this->riderPayload())->assertStatus(201);

        $this->assertDatabaseHas('users', ['email' => 'rider@example.com', 'role' => 'rider']);
    }

    public function test_underage_rider_is_rejected(): void
    {
        $this->seedOtp('09171234567');

        $this->postJson('/api/register', $this->riderPayload([
            'date_of_birth' => now()->subYears(17)->format('Y-m-d'),
        ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('date_of_birth');

        $this->assertDatabaseMissing('users', ['email' => 'rider@example.com']);
    }

    public function test_date_of_birth_is_required(): void
    {
        $this->seedOtp('09171234567');

        $this->postJson('/api/register', $this->riderPayload([
            'date_of_birth' => '',
        ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('date_of_birth');
    }
}
