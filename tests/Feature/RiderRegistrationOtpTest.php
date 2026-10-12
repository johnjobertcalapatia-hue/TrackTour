<?php

namespace Tests\Feature;

use App\Models\Municipality;
use App\Services\OtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Rider registration must be gated by the single-use OTP issued to the mobile
 * number. The account is created only when the submitted code matches the
 * cached code, and that code is consumed so it can never register twice.
 */
class RiderRegistrationOtpTest extends TestCase
{
    use RefreshDatabase;

    private function riderPayload(string $email, string $otp): array
    {
        return [
            'first_name' => 'Pedro',
            'last_name' => 'Rider',
            'date_of_birth' => '2000-01-15',
            'email' => $email,
            'password' => 'Password123!',
            'password_confirmation' => 'Password123!',
            'role' => 'rider',
            'mobile_number' => '09171234567',
            'otp_code' => $otp,
            'referral_code' => null,
            'confirm_age' => true,
            'agree_terms' => true,
            'agree_privacy' => true,
        ];
    }

    public function test_rider_registration_without_a_issued_otp_is_rejected(): void
    {
        $response = $this->postJson('/api/register', $this->riderPayload('rider-a@example.com', '123456'));

        $response->assertStatus(422)->assertJsonValidationErrors('otp_code');
        $this->assertDatabaseMissing('users', ['email' => 'rider-a@example.com']);
    }

    public function test_rider_registration_with_a_wrong_otp_is_rejected_and_does_not_burn_the_code(): void
    {
        Cache::put('otp:09171234567', '123456', now()->addMinutes(5));

        $response = $this->postJson('/api/register', $this->riderPayload('rider-b@example.com', '654321'));

        $response->assertStatus(422)->assertJsonValidationErrors('otp_code');
        $this->assertDatabaseMissing('users', ['email' => 'rider-b@example.com']);
        // A failed attempt must leave the valid code intact for a retry.
        $this->assertSame('123456', Cache::get('otp:09171234567'));
    }

    public function test_rider_registration_with_a_valid_otp_succeeds_and_consumes_the_code(): void
    {
        Cache::put('otp:09171234567', '123456', now()->addMinutes(5));

        $response = $this->postJson('/api/register', $this->riderPayload('rider-c@example.com', '123456'));

        $response->assertStatus(201);
        $this->assertDatabaseHas('users', ['email' => 'rider-c@example.com', 'role' => 'rider']);
        // Single-use: the code is gone the moment it has been redeemed.
        $this->assertNull(Cache::get('otp:09171234567'));
    }

    public function test_otp_service_verify_and_consume_is_single_use(): void
    {
        Cache::put('otp:09998887777', '112233', now()->addMinutes(5));

        $service = app(OtpService::class);

        $this->assertTrue($service->verifyAndConsume('09998887777', '112233'));
        $this->assertFalse($service->verifyAndConsume('09998887777', '112233'));
    }

    public function test_verify_otp_endpoint_does_not_consume_the_code(): void
    {
        Mail::fake();

        Cache::put('otp:09171234567', '123456', now()->addMinutes(5));

        $this->postJson('/api/auth/verify-otp', [
            'mobile_number' => '09171234567',
            'otp_code' => '123456',
        ])->assertOk()->assertJson(['success' => true]);

        // The pre-check must not spend the code; registration still consumes it.
        $this->assertSame('123456', Cache::get('otp:09171234567'));
        $this->assertTrue(app(OtpService::class)->verifyAndConsume('09171234567', '123456'));
    }

    public function test_tourist_registration_is_not_gated_by_otp(): void
    {
        $municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
        ]);

        $response = $this->postJson('/api/register', [
            'first_name' => 'Juan',
            'last_name' => 'Tourist',
            'email' => 'tourist-otp@example.com',
            'password' => 'Password123!',
            'password_confirmation' => 'Password123!',
            'date_of_birth' => '2000-01-15',
            'mobile_number' => '09181234567',
            'role' => 'tourist',
        ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('users', ['email' => 'tourist-otp@example.com', 'role' => 'tourist']);
    }
}
