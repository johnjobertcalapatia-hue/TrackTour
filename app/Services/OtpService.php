<?php

namespace App\Services;

use App\Mail\RiderOtpMail;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Issues and verifies the one-time codes used to prove ownership of a mobile
 * number (rider registration).
 *
 * A code lives in the cache for {@see self::TTL_MINUTES} minutes. Verification
 * that gates a durable side effect (creating the rider account) must go through
 * {@see self::verifyAndConsume()} so the code is single-use: the atomic
 * check-and-remove is the authoritative boundary that stops a replay.
 */
class OtpService
{
    public const TTL_MINUTES = 5;

    /** Failed verifications allowed before a temporary lockout starts. */
    public const MAX_ATTEMPTS = 3;

    /** How long verification (and further sends) stay blocked after the limit. */
    public const LOCKOUT_MINUTES = 10;

    public function send(string $mobile, string $email): string
    {
        $otp = str_pad((string) random_int(100000, 999999), 6, '0', STR_PAD_LEFT);

        Cache::put($this->key($mobile), $otp, now()->addMinutes(self::TTL_MINUTES));

        // A newly issued code intentionally does NOT reset the failed-attempt
        // counter: otherwise a locked-out caller could bypass the limit simply
        // by requesting a fresh code.

        Mail::to($email)->send(new RiderOtpMail($otp, $mobile));

        // SMS delivery requires a configured provider; retain the mobile target in logs for local integration.
        Log::info("Rider OTP generated for mobile {$mobile} and email {$email}");

        return $otp;
    }

    /**
     * Check a code without consuming it.
     *
     * This backs the UX pre-check endpoint; it must NOT remove the code so the
     * subsequent registration request can still consume it.
     */
    public function verify(string $mobile, string $code): bool
    {
        if ($this->isLockedOut($mobile)) {
            return false;
        }

        $stored = Cache::get($this->key($mobile));
        $valid = is_string($stored) && $stored !== '' && hash_equals($stored, $code);

        if ($valid) {
            Cache::forget($this->attemptsKey($mobile));
        } else {
            $this->recordFailure($mobile);
        }

        return $valid;
    }

    public function verifyAndConsume(string $mobile, string $code): bool
    {
        $lock = Cache::lock($this->key($mobile).':lock', 10);

        if (! $lock->get()) {
            return false;
        }

        try {
            if (! $this->verify($mobile, $code)) {
                return false;
            }

            Cache::forget($this->key($mobile));
            Cache::forget($this->attemptsKey($mobile));

            return true;
        } finally {
            $lock->release();
        }
    }

    /**
     * Whether failed attempts have temporarily blocked this mobile number.
     */
    public function isLockedOut(string $mobile): bool
    {
        return Cache::has($this->lockKey($mobile));
    }

    /**
     * Seconds left before the lockout clears (0 when not locked out).
     */
    public function lockoutSecondsRemaining(string $mobile): int
    {
        $until = Cache::get($this->lockKey($mobile));

        if (! is_numeric($until)) {
            return 0;
        }

        return max(0, (int) $until - now()->timestamp);
    }

    /**
     * Failed verifications still available before lockout.
     */
    public function remainingAttempts(string $mobile): int
    {
        if ($this->isLockedOut($mobile)) {
            return 0;
        }

        $used = (int) Cache::get($this->attemptsKey($mobile), 0);

        return max(0, self::MAX_ATTEMPTS - $used);
    }

    /**
     * Count a failed verification; the MAX_ATTEMPTS-th failure arms the lockout.
     */
    protected function recordFailure(string $mobile): void
    {
        $attemptsKey = $this->attemptsKey($mobile);
        $attempts = (int) Cache::get($attemptsKey, 0) + 1;

        if ($attempts >= self::MAX_ATTEMPTS) {
            $until = now()->addMinutes(self::LOCKOUT_MINUTES);
            Cache::put($this->lockKey($mobile), $until->timestamp, $until);
            Cache::forget($attemptsKey);
            // Invalidate the code too, so the lockout cannot be sidestepped.
            Cache::forget($this->key($mobile));

            return;
        }

        Cache::put($attemptsKey, $attempts, now()->addMinutes(self::LOCKOUT_MINUTES));
    }

    public function forget(string $mobile): void
    {
        Cache::forget($this->key($mobile));
    }

    private function key(string $mobile): string
    {
        return "otp:{$mobile}";
    }

    private function attemptsKey(string $mobile): string
    {
        return "otp:{$mobile}:attempts";
    }

    private function lockKey(string $mobile): string
    {
        return "otp:{$mobile}:lockout";
    }
}
