<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ApiResponseTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::create([
            'email' => 'test@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);
    }

    public function test_success_response_format(): void
    {
        $response = $this->actingAs($this->user, 'sanctum')
            ->getJson('/api/user');

        $response->assertOk()
            ->assertJson([
                'success' => true,
                'message' => 'Success',
            ])
            ->assertJsonStructure([
                'success',
                'message',
                'data',
            ]);
    }

    public function test_error_response_format(): void
    {
        $response = $this->actingAs($this->user, 'sanctum')
            ->postJson('/api/tourist/favorites/toggle', []);

        $response->assertStatus(422);
    }

    public function test_paginated_response_format(): void
    {
        $admin = User::create([
            'email' => 'admin-paginate@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'bansud_tourism_office',
            'account_status' => 'approved',
        ]);

        $response = $this->actingAs($admin, 'sanctum')
            ->getJson('/api/admin/users');

        $response->assertOk()
            ->assertJsonStructure([
                'success',
                'data',
                'meta',
            ]);
    }

    public function test_unauthorized_response(): void
    {
        $response = $this->getJson('/api/user');

        $response->assertStatus(401)
            ->assertJson([
                'message' => 'Unauthenticated.',
            ]);
    }

    public function test_forbidden_response(): void
    {
        $response = $this->actingAs($this->user, 'sanctum')
            ->getJson('/api/admin/dashboard');

        $response->assertStatus(403);
    }

    public function test_validation_error_response(): void
    {
        $response = $this->actingAs($this->user, 'sanctum')
            ->postJson('/api/tourist/favorites/toggle', [
                'favoritable_type' => 'invalid',
            ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['favoritable_id']);
    }

    public function test_created_response(): void
    {
        $response = $this->postJson('/api/register', [
            'first_name' => 'New',
            'last_name' => 'Tourist',
            'email' => 'newtourist@example.com',
            'password' => 'Password123!',
            'password_confirmation' => 'Password123!',
            'date_of_birth' => '2000-01-15',
            'mobile_number' => '09171234567',
            'role' => 'tourist',
        ]);

        $response->assertStatus(201)
            ->assertJson([
                'success' => true,
            ]);
    }

    public function test_not_found_response(): void
    {
        $response = $this->actingAs($this->user, 'sanctum')
            ->getJson('/api/tourist/explore/business/99999');

        $response->assertStatus(404);
    }

    public function test_error_response_with_message(): void
    {
        $response = $this->actingAs($this->user, 'sanctum')
            ->postJson('/api/tourist/favorites/toggle', [
                'favoritable_type' => 'invalid',
                'favoritable_id' => 'not_a_number',
            ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['favoritable_id']);
    }
}
