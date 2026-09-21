<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class EmailVerificationTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::create([
            'email' => 'tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);
    }

    public function test_email_verification_screen_can_be_rendered(): void
    {
        $response = $this->be($this->user)->get('/verify-email');

        $response->assertStatus(200);
    }

    public function test_user_can_request_a_new_verification_link(): void
    {
        $response = $this->be($this->user)
            ->postJson('/api/email/verification-notification');

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ]);
    }

    public function test_verified_user_is_told_email_is_already_verified(): void
    {
        $this->user->forceFill(['email_verified_at' => now()])->save();

        $response = $this->be($this->user)
            ->postJson('/api/email/verification-notification');

        $response->assertOk()
            ->assertJson([
                'success' => true,
                'message' => 'Email already verified.',
            ]);
    }
}