<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The registration forms probe email availability on-type. The probe is a
 * non-mutating convenience check; the authoritative uniqueness still runs on
 * register. These tests pin the probe's contract.
 */
class CheckEmailAvailabilityTest extends TestCase
{
    use RefreshDatabase;

    public function test_available_email_is_reported_available(): void
    {
        $this->postJson('/api/auth/check-email', ['email' => 'free@example.com'])
            ->assertOk()
            ->assertJson([
                'success' => true,
                'data' => ['email' => 'free@example.com', 'available' => true],
            ]);
    }

    public function test_taken_email_is_reported_unavailable(): void
    {
        User::factory()->create(['email' => 'taken@example.com']);

        $this->postJson('/api/auth/check-email', ['email' => 'taken@example.com'])
            ->assertOk()
            ->assertJson([
                'success' => true,
                'data' => ['email' => 'taken@example.com', 'available' => false],
            ]);
    }

    public function test_email_check_is_case_insensitive_and_trimmed(): void
    {
        User::factory()->create(['email' => 'mixed@example.com']);

        $this->postJson('/api/auth/check-email', ['email' => '  MiXeD@Example.COM '])
            ->assertOk()
            ->assertJson([
                'success' => true,
                'data' => ['email' => 'mixed@example.com', 'available' => false],
            ]);
    }

    public function test_invalid_email_is_rejected(): void
    {
        $this->postJson('/api/auth/check-email', ['email' => 'not-an-email'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('email');
    }

    public function test_email_is_required(): void
    {
        $this->postJson('/api/auth/check-email', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors('email');
    }
}
