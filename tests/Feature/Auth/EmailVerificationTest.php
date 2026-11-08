<?php

namespace Tests\Feature\Auth;

use App\Mail\EmailVerificationOtpMail;
use App\Models\User;
use App\Services\EmailVerificationOtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class EmailVerificationTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private string $token;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        Mail::fake();

        $this->user = User::create([
            'email' => 'tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);
        $this->token = $this->user->createToken('test-token')->plainTextToken;
    }

    private function authenticatedRequest(): self
    {
        return $this->withHeader('Authorization', 'Bearer '.$this->token);
    }

    public function test_email_verification_screen_redirects_to_the_spa(): void
    {
        $response = $this->be($this->user)->get('/verify-email');

        $response->assertRedirect(config('app.frontend_url').'/verify-email');
    }

    public function test_user_can_request_a_hashed_email_verification_code(): void
    {
        $response = $this->authenticatedRequest()
            ->postJson('/api/email/verification-notification');

        $response->assertOk()
            ->assertJson([
                'success' => true,
                'message' => 'A verification code has been sent to your email address.',
                'data' => ['retry_after' => 0],
            ]);

        $storedHash = Cache::get('email-verification-otp:'.$this->user->id);
        $this->assertIsString($storedHash);
        $this->assertNotSame('', $storedHash);
        Mail::assertSent(EmailVerificationOtpMail::class, fn (EmailVerificationOtpMail $mail) => $mail->hasTo($this->user->email));
    }

    public function test_resend_is_rate_limited_without_sending_a_second_code(): void
    {
        $this->authenticatedRequest()->postJson('/api/email/verification-notification')->assertOk();

        $this->authenticatedRequest()
            ->postJson('/api/email/verification-notification')
            ->assertOk()
            ->assertJsonPath('data.retry_after', EmailVerificationOtpService::RESEND_COOLDOWN_SECONDS);

        Mail::assertSent(EmailVerificationOtpMail::class, 1);
    }

    public function test_valid_code_marks_email_verified_and_cannot_be_replayed(): void
    {
        $this->authenticatedRequest()->postJson('/api/email/verification-notification')->assertOk();

        $code = null;
        Mail::assertSent(EmailVerificationOtpMail::class, function (EmailVerificationOtpMail $mail) use (&$code) {
            $code = $mail->otp;

            return $mail->hasTo($this->user->email);
        });

        $storedHash = Cache::get('email-verification-otp:'.$this->user->id);
        $this->assertTrue(Hash::check($code, $storedHash));

        $this->authenticatedRequest()
            ->postJson('/api/email/verification-otp', ['otp_code' => $code])
            ->assertOk()
            ->assertJsonPath('success', true);

        $this->assertNotNull($this->user->fresh()->email_verified_at);
        $this->assertFalse(Cache::has('email-verification-otp:'.$this->user->id));

        $this->authenticatedRequest()
            ->postJson('/api/email/verification-otp', ['otp_code' => $code])
            ->assertOk()
            ->assertJsonPath('message', 'Email already verified.');
    }

    public function test_five_failed_attempts_lock_verification(): void
    {
        $this->authenticatedRequest()->postJson('/api/email/verification-notification')->assertOk();

        for ($attempt = 1; $attempt < EmailVerificationOtpService::MAX_ATTEMPTS; $attempt++) {
            $this->authenticatedRequest()
                ->postJson('/api/email/verification-otp', ['otp_code' => '000000'])
                ->assertStatus(422)
                ->assertJsonPath('attempts_remaining', EmailVerificationOtpService::MAX_ATTEMPTS - $attempt);
        }

        $this->authenticatedRequest()
            ->postJson('/api/email/verification-otp', ['otp_code' => '000000'])
            ->assertStatus(429)
            ->assertJsonStructure(['retry_after']);

        $this->assertTrue(app(EmailVerificationOtpService::class)->isLockedOut($this->user));
    }

    public function test_verification_code_expires(): void
    {
        $this->authenticatedRequest()->postJson('/api/email/verification-notification')->assertOk();

        $code = null;
        Mail::assertSent(EmailVerificationOtpMail::class, function (EmailVerificationOtpMail $mail) use (&$code) {
            $code = $mail->otp;

            return true;
        });

        $this->travel(11)->minutes();

        $this->authenticatedRequest()
            ->postJson('/api/email/verification-otp', ['otp_code' => $code])
            ->assertStatus(422);
    }

    public function test_verified_user_does_not_receive_another_code(): void
    {
        $this->user->forceFill(['email_verified_at' => now()])->save();

        $this->authenticatedRequest()
            ->postJson('/api/email/verification-notification')
            ->assertOk()
            ->assertJsonPath('message', 'Email already verified.');

        Mail::assertNothingSent();
    }

    public function test_email_verification_requires_a_personal_access_token(): void
    {
        $this->postJson('/api/email/verification-notification')->assertUnauthorized();
        Mail::assertNothingSent();
    }
}
