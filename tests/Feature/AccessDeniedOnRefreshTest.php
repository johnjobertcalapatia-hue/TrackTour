<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AccessDeniedOnRefreshTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Core bug: After login, refreshing any protected page redirects to /unauthorized.
     *
     * With the TokenOnlyAuth middleware (replacing auth:sanctum), session auth is
     * completely bypassed. Only Bearer tokens are used.
     */
    public function test_bearer_token_user_returned_not_session_user(): void
    {
        $tourist = User::create([
            'email' => 'tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $businessOwner = User::create([
            'email' => 'owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $token = $tourist->createToken('api-token')->plainTextToken;

        $this->actingAs($businessOwner, 'web');

        $response = $this->withHeader('Authorization', 'Bearer ' . $token)
            ->getJson('/api/user');

        $response->assertOk();

        $data = $response->json('data');
        $this->assertEquals('tourist@example.com', $data['email'],
            'Should return the Bearer token user (tourist), not the session user (business_owner).'
        );
        $this->assertEquals('tourist', $data['role']);
    }

    /**
     * Bearer token user can access role-protected routes even when a stale
     * session belongs to a user with a DIFFERENT role.
     */
    public function test_bearer_token_role_check_not_session_role(): void
    {
        $tourist = User::create([
            'email' => 'tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $businessOwner = User::create([
            'email' => 'owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $token = $tourist->createToken('api-token')->plainTextToken;

        $this->actingAs($businessOwner, 'web');

        $response = $this->withHeader('Authorization', 'Bearer ' . $token)
            ->getJson('/api/tourist/profile');

        $this->assertNotEquals(403, $response->status(),
            'Should use Bearer token user role (tourist), not session user role (business_owner).'
        );
    }

    /**
     * Without a Bearer token, request is rejected as unauthenticated.
     */
    public function test_no_token_returns_401(): void
    {
        $response = $this->getJson('/api/user');

        $response->assertStatus(401);
    }

    /**
     * Invalid token is rejected.
     */
    public function test_invalid_token_returns_401(): void
    {
        $response = $this->withHeader('Authorization', 'Bearer invalid-token-12345')
            ->getJson('/api/user');

        $response->assertStatus(401);
    }

    /**
     * Expired token is rejected.
     */
    public function test_expired_token_returns_401(): void
    {
        $user = User::create([
            'email' => 'expired@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $token = $user->createToken('api-token', ['*'], now()->subHour())->plainTextToken;

        $response = $this->withHeader('Authorization', 'Bearer ' . $token)
            ->getJson('/api/user');

        $response->assertStatus(401);
    }

    /**
     * Login returns token, /user returns correct user, logout invalidates token.
     */
    public function test_full_auth_lifecycle(): void
    {
        $user = User::create([
            'email' => 'lifecycle@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $loginResponse = $this->postJson('/api/login', [
            'email' => 'lifecycle@example.com',
            'password' => 'Password123!',
        ]);

        $loginResponse->assertOk();
        $token = $loginResponse->json('data.token');
        $this->assertNotNull($token);

        $userResponse = $this->withHeader('Authorization', 'Bearer ' . $token)
            ->getJson('/api/user');

        $userResponse->assertOk();
        $this->assertEquals('lifecycle@example.com', $userResponse->json('data.email'));

        $logoutResponse = $this->withHeader('Authorization', 'Bearer ' . $token)
            ->postJson('/api/logout');

        $logoutResponse->assertOk();

        $afterLogout = $this->withHeader('Authorization', 'Bearer ' . $token)
            ->getJson('/api/user');

        $afterLogout->assertStatus(401);
    }
}
