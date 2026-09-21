<?php

namespace App\Services;

use RuntimeException;

/**
 * Mints HMAC trip tokens for the Zero-DB socket engine (socket-token.js).
 *
 * The socket engine has no database access, so Laravel vouches for a trip-room
 * participant by signing `{v, deliveryId, role, sub, exp}` with the shared
 * bridge secret. The engine verifies the signature, expiry and the delivery
 * binding before admitting a socket into a `trip:<deliveryId>` room.
 *
 * Token format: base64url(payloadJSON) "." base64url(HMAC_SHA256(payloadJSON, secret))
 */
class TripTokenService
{
    public const VERSION = 1;

    public function issue(int $deliveryId, string $role = 'customer', ?int $subjectId = null, ?int $ttlSeconds = null, ?float $nowMs = null): string
    {
        $secret = $this->secret();
        if ($secret === '') {
            throw new RuntimeException('Socket bridge secret is empty; cannot mint trip tokens.');
        }

        $now = $nowMs ?? now()->timestamp * 1000;
        $ttl = $ttlSeconds ?? (int) config('socket.trip_token_ttl_seconds', 7200);

        $payload = [
            'v' => self::VERSION,
            'deliveryId' => (string) $deliveryId,
            'role' => $role === 'rider' ? 'rider' : 'customer',
            'sub' => $subjectId,
            'exp' => (int) $now + $ttl * 1000,
        ];

        $payloadB64 = $this->base64UrlEncode((string) json_encode($payload, JSON_THROW_ON_ERROR));

        return $payloadB64.'.'.$this->sign($payloadB64, $secret);
    }

    public function issueBusinessToken(int $businessId, ?int $subjectId = null, ?int $ttlSeconds = null, ?float $nowMs = null): string
    {
        $secret = $this->secret();
        if ($secret === '') {
            throw new RuntimeException('Socket bridge secret is empty; cannot mint business tokens.');
        }

        $now = $nowMs ?? now()->timestamp * 1000;
        $ttl = $ttlSeconds ?? (int) config('socket.trip_token_ttl_seconds', 7200);

        $payload = [
            'v' => self::VERSION,
            'businessId' => (string) $businessId,
            'role' => 'merchant',
            'sub' => $subjectId,
            'exp' => (int) $now + $ttl * 1000,
        ];

        $payloadB64 = $this->base64UrlEncode((string) json_encode($payload, JSON_THROW_ON_ERROR));

        return $payloadB64.'.'.$this->sign($payloadB64, $secret);
    }

    /**
     * P11.5 — Mint an HMAC token so a tourist socket may join (and receive
     * status events in) `user:<userId>`. Verified by the Zero-DB engine's
     * socket-token.js `verifyUserToken` / `canJoinUserRoom`.
     */
    public function issueUserToken(int $userId, ?int $ttlSeconds = null, ?float $nowMs = null): string
    {
        $secret = $this->secret();
        if ($secret === '') {
            throw new RuntimeException('Socket bridge secret is empty; cannot mint user tokens.');
        }

        $now = $nowMs ?? now()->timestamp * 1000;
        $ttl = $ttlSeconds ?? (int) config('socket.trip_token_ttl_seconds', 7200);

        $payload = [
            'v' => self::VERSION,
            'userId' => (string) $userId,
            'role' => 'user',
            'sub' => $userId,
            'exp' => (int) $now + $ttl * 1000,
        ];

        $payloadB64 = $this->base64UrlEncode((string) json_encode($payload, JSON_THROW_ON_ERROR));

        return $payloadB64.'.'.$this->sign($payloadB64, $secret);
    }

    private function sign(string $data, string $secret): string
    {
        return $this->base64UrlEncode((string) hash_hmac('sha256', $data, $secret, true));
    }

    private function base64UrlEncode(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private function secret(): string
    {
        return (string) config('socket.bridge_secret', '');
    }
}