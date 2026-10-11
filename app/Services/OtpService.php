<?php

namespace App\Services;

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

    public function send(string $mobile, string $email): string
    {
        $otp = str_pad((string) random_int(100000, 999999), 6, '0', STR_PAD_LEFT);

        Cache::put($this->key($mobile), $otp, now()->addMinutes(self::TTL_MINUTES));

        Mail::raw(
            "Your TrackTour rider registration code is {$otp}. This code expires in ".self::TTL_MINUTES.' minutes.',
            function ($message) use ($email) {
                $message->to($email)->subject('TrackTour rider registration code');
            }
        );

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
        $stored = Cache::get($this->key($mobile));

        return is_string($stored) && $stored !== '' && hash_equals($stored, $code);
    }

    /**
     * Verify a code and atomically remove it so it can be used exactly once.
     */
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

            return true;
        } finally {
            $lock->release();
        }
    }

    public function forget(string $mobile): void
    {
        Cache::forget($this->key($mobile));
    }

    private function key(string $mobile): string
    {
        return "otp:{$mobile}";
    }
}
