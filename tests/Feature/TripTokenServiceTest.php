<?php

namespace Tests\Feature;

use App\Services\TripTokenService;
use Tests\TestCase;

class TripTokenServiceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config(['socket.bridge_secret' => 'fixture-secret']);
    }

    public function test_issues_a_two_part_hmac_token(): void
    {
        $token = app(TripTokenService::class)->issue(101, 'customer', 55, 3600, 1_700_000_000_000);

        $this->assertIsString($token);
        $this->assertStringContainsString('.', $token);

        [$payloadB64, $signature] = explode('.', $token, 2);
        $this->assertNotEmpty($payloadB64);
        $this->assertNotEmpty($signature);
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]+$/', $payloadB64);
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]+$/', $signature);
    }

    public function test_matches_the_reference_fixture_across_languages(): void
    {
        // Byte-for-byte parity with the Node reference computed in
        // tests/js/socket-token.test.js (same secret, delivery, role, sub, exp).
        $token = app(TripTokenService::class)->issue(101, 'customer', 55, 3600, 1_700_000_000_000);

        $this->assertSame(
            'eyJ2IjoxLCJkZWxpdmVyeUlkIjoiMTAxIiwicm9sZSI6ImN1c3RvbWVyIiwic3ViIjo1NSwiZXhwIjoxNzAwMDAzNjAwMDAwfQ.Fn5VOeeSLx4MktdA8FcjKjqF_D9h-5h1jbGf8Y5FM4U',
            $token
        );
    }

    public function test_payload_round_trips_through_base64url(): void
    {
        $token = app(TripTokenService::class)->issue(101, 'customer', 55, 3600, 1_700_000_000_000);

        [$payloadB64] = explode('.', $token, 2);
        $raw = base64_decode(strtr($payloadB64, '-_', '+/').str_repeat('=', (4 - strlen($payloadB64) % 4) % 4), true);
        $payload = json_decode($raw, true);

        $this->assertSame([
            'v' => 1,
            'deliveryId' => '101',
            'role' => 'customer',
            'sub' => 55,
            'exp' => 1_700_003_600_000,
        ], $payload);
    }

    public function test_role_defaults_to_customer_and_rider_is_preserved(): void
    {
        $service = app(TripTokenService::class);

        $customerToken = $service->issue(1, 'nonsense_role', null, 60, 1_700_000_000_000);
        $riderToken = $service->issue(1, 'rider', 7, 60, 1_700_000_000_000);

        [$customerB64] = explode('.', $customerToken, 2);
        [$riderB64] = explode('.', $riderToken, 2);
        $decode = fn (string $b64) => json_decode(base64_decode(strtr($b64, '-_', '+/')), true);

        $this->assertSame('customer', $decode($customerB64)['role']);
        $this->assertSame('rider', $decode($riderB64)['role']);
        $this->assertSame(7, $decode($riderB64)['sub']);
    }

    public function test_throws_when_bridge_secret_is_empty(): void
    {
        config(['socket.bridge_secret' => '']);

        $this->expectException(\RuntimeException::class);
        app(TripTokenService::class)->issue(1, 'customer', null, 60, 1_700_000_000_000);
    }
}