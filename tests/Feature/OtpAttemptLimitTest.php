<?php

namespace Tests\Feature;

use App\Services\OtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * A mobile number may fail verification only {@see OtpService::MAX_ATTEMPTS}
 * times before it is locked out for {@see OtpService::LOCKOUT_MINUTES} minutes.
 * The limit must be enforced by the backend, not merely the UI, and issuing a
 * fresh code must not reset the counter.
 */
class OtpAttemptLimitTest extends TestCase
{
    use RefreshDatabase;

    private const MOBILE = '09171234567';

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        Mail::fake();
    }

    private function seedCode(string $code = '123456'): void
    {
        Cache::put('otp:'.self::MOBILE, $code, now()->addMinutes(5));
    }

    private function verify(string $code)
    {
        return $this->postJson('/api/auth/verify-otp', [
            'mobile_number' => self::MOBILE,
            'otp_code' => $code,
        ]);
    }

    private function sendOtp()
    {
        return $this->postJson('/api/auth/send-otp', [
            'mobile_number' => self::MOBILE,
            'email' => 'rider@example.com',
        ]);
    }

    public function test_verify_reports_remaining_attempts_before_lockout(): void
    {
        $this->seedCode();

        $this->verify('000000')
            ->assertStatus(422)
            ->assertJson(['success' => false, 'attempts_remaining' => 2]);

        $this->verify('000000')
            ->assertStatus(422)
            ->assertJson(['success' => false, 'attempts_remaining' => 1]);
    }

    public function test_three_failed_attempts_lock_the_mobile_and_refuse_a_valid_code(): void
    {
        $this->seedCode();

        $this->verify('000000')->assertStatus(422);
        $this->verify('000000')->assertStatus(422);

        // The third failure crosses the threshold -> 429 lockout.
        $this->verify('000000')
            ->assertStatus(429)
            ->assertJson(['success' => false])
            ->assertJsonStructure(['retry_after']);

        // Even the correct code is refused for the duration of the lockout.
        $this->verify('123456')->assertStatus(429);

        $this->assertTrue(app(OtpService::class)->isLockedOut(self::MOBILE));
    }

    public function test_lockout_blocks_sending_a_new_otp(): void
    {
        $this->seedCode();

        $this->verify('000000')->assertStatus(422);
        $this->verify('000000')->assertStatus(422);
        $this->verify('000000')->assertStatus(429);

        $this->sendOtp()->assertStatus(429)->assertJson(['success' => false]);
    }

    public function test_lockout_expires_after_ten_minutes(): void
    {
        $this->seedCode();

        $this->verify('000000')->assertStatus(422);
        $this->verify('000000')->assertStatus(422);
        $this->verify('000000')->assertStatus(429);

        $this->travel(11)->minutes();

        $this->assertFalse(app(OtpService::class)->isLockedOut(self::MOBILE));

        // A fresh code can be issued again once the lockout clears.
        $this->sendOtp()->assertOk();
    }

    public function test_successful_verification_resets_the_failed_attempt_counter(): void
    {
        $this->seedCode();

        $this->verify('000000')->assertStatus(422);
        $this->verify('000000')->assertStatus(422);

        // The correct code clears the counter; the pre-check does not consume it.
        $this->verify('123456')->assertOk()->assertJson(['success' => true]);
        $this->assertSame(0, (int) Cache::get('otp:'.self::MOBILE.':attempts', 0));
        $this->assertSame(OtpService::MAX_ATTEMPTS, app(OtpService::class)->remainingAttempts(self::MOBILE));

        // Two more failures are therefore still tolerated.
        $this->verify('000000')->assertStatus(422);
        $this->verify('000000')->assertStatus(422);
        $this->assertFalse(app(OtpService::class)->isLockedOut(self::MOBILE));
    }

    public function test_requesting_a_new_code_does_not_clear_the_failed_attempt_counter(): void
    {
        $this->seedCode();

        $this->verify('000000')->assertStatus(422);
        $this->verify('000000')->assertStatus(422);

        // A fresh code must not hand out a clean slate to a locked-out caller.
        $this->sendOtp()->assertOk();

        $this->verify('000000')->assertStatus(429);
        $this->assertTrue(app(OtpService::class)->isLockedOut(self::MOBILE));
    }

    public function test_registration_is_blocked_while_locked_out(): void
    {
        $this->seedCode();

        $this->verify('000000')->assertStatus(422);
        $this->verify('000000')->assertStatus(422);
        $this->verify('000000')->assertStatus(429);

        $this->postJson('/api/register', [
            'first_name' => 'Pedro',
            'last_name' => 'Rider',
            'date_of_birth' => '2000-01-15',
            'email' => 'locked-rider@example.com',
            'password' => 'Password123!',
            'password_confirmation' => 'Password123!',
            'role' => 'rider',
            'mobile_number' => self::MOBILE,
            'otp_code' => '123456',
            'confirm_age' => true,
            'agree_terms' => true,
            'agree_privacy' => true,
        ])->assertStatus(429);

        $this->assertDatabaseMissing('users', ['email' => 'locked-rider@example.com']);
    }
}
