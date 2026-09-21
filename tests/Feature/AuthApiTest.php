<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AuthApiTest extends TestCase
{
    use RefreshDatabase;

    private array $validTouristData = [
        'first_name' => 'Juan',
        'last_name' => 'Tourist',
        'email' => 'tourist@example.com',
        'password' => 'Password123!',
        'password_confirmation' => 'Password123!',
        'date_of_birth' => '2000-01-15',
        'mobile_number' => '09171234567',
        'role' => 'tourist',
    ];

    private array $validRiderData = [
        'name' => 'Pedro Rider',
        'email' => 'rider@example.com',
        'password' => 'Password123!',
        'password_confirmation' => 'Password123!',
        'role' => 'rider',
        'municipality_id' => 1,
    ];

    public function test_user_can_register_as_tourist(): void
    {
        $response = $this->postJson('/api/register', $this->validTouristData);

        $response->assertStatus(201)
            ->assertJsonStructure([
                'success',
                'message',
                'data' => [
                    'user' => ['id', 'email', 'role', 'account_status'],
                    'token',
                ],
            ])
            ->assertJson([
                'success' => true,
                'data' => [
                    'user' => [
                        'email' => 'tourist@example.com',
                        'role' => 'tourist',
                        'account_status' => 'approved',
                    ],
                ],
            ]);

        $this->assertDatabaseHas('users', [
            'email' => 'tourist@example.com',
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);
    }

    public function test_user_can_register_as_rider(): void
    {
        $municipality = \App\Models\Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
        ]);

        $response = $this->postJson('/api/register', [
            'first_name' => 'Pedro',
            'last_name' => 'Rider',
            'email' => 'rider@example.com',
            'password' => 'Password123!',
            'password_confirmation' => 'Password123!',
            'role' => 'rider',
            'municipality_id' => $municipality->id,
            'mobile_number' => '09171234567',
            'otp_code' => '123456',
            'referral_code' => null,
            'confirm_age' => true,
            'agree_terms' => true,
            'agree_privacy' => true,
        ]);

        $response->assertStatus(201)
            ->assertJsonStructure([
                'success',
                'message',
                'data' => [
                    'user' => ['id', 'email', 'role'],
                    'token',
                ],
            ])
            ->assertJson([
                'success' => true,
                'data' => [
                    'user' => [
                        'email' => 'rider@example.com',
                        'role' => 'rider',
                    ],
                ],
            ]);

        $this->assertDatabaseHas('users', [
            'email' => 'rider@example.com',
            'role' => 'rider',
        ]);
    }

    public function test_user_can_login(): void
    {
        User::create([
            'email' => 'login@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $response = $this->postJson('/api/login', [
            'email' => 'login@example.com',
            'password' => 'Password123!',
        ]);

        $response->assertOk()
            ->assertJsonStructure([
                'success',
                'message',
                'data' => [
                    'user' => ['id', 'email', 'role'],
                    'token',
                ],
            ])
            ->assertJson([
                'success' => true,
                'data' => [
                    'user' => [
                        'email' => 'login@example.com',
                    ],
                ],
            ]);
    }

    public function test_user_cannot_login_with_invalid_credentials(): void
    {
        User::create([
            'email' => 'login@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $response = $this->postJson('/api/login', [
            'email' => 'login@example.com',
            'password' => 'WrongPassword!',
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors('password');
    }

    public function test_user_can_logout(): void
    {
        $user = User::create([
            'email' => 'logout@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $token = $user->createToken('api-token')->plainTextToken;

        $response = $this->withHeader('Authorization', 'Bearer ' . $token)
            ->postJson('/api/logout');

        $response->assertOk()
            ->assertJson([
                'success' => true,
                'message' => 'Logged out successfully.',
            ]);

        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_user_can_get_profile(): void
    {
        $user = User::create([
            'email' => 'profile@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $token = $user->createToken('api-token')->plainTextToken;

        $response = $this->withHeader('Authorization', 'Bearer ' . $token)
            ->getJson('/api/user');

        $response->assertOk()
            ->assertJson([
                'success' => true,
                'data' => [
                    'email' => 'profile@example.com',
                    'role' => 'tourist',
                ],
            ]);
    }

    public function test_authenticated_routes_require_token(): void
    {
        $response = $this->getJson('/api/user');

        $response->assertStatus(401)
            ->assertJson([
                'message' => 'Unauthenticated.',
            ]);
    }
}
