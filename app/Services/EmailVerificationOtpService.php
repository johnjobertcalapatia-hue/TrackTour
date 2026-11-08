<?php

namespace App\Services;

use App\Mail\EmailVerificationOtpMail;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;

class EmailVerificationOtpService
{
    public const TTL_MINUTES = 10;

    public const RESEND_COOLDOWN_SECONDS = 60;

    public const MAX_ATTEMPTS = 5;

    public const LOCKOUT_MINUTES = 15;

    /**
     * Send a code when the resend window is open; return seconds until it opens.
     */
    public function send(User $user): int
    {
        $cooldownKey = $this->cooldownKey($user);
        $cooldownLock = Cache::lock($cooldownKey.':lock', 10);

        if (! $cooldownLock->get()) {
            return 1;
        }

        try {
            if ($this->isLockedOut($user)) {
                return $this->lockoutSecondsRemaining($user);
            }

            $sentAt = Cache::get($cooldownKey);

            if (is_numeric($sentAt)) {
                $remaining = (int) $sentAt - now()->timestamp;

                if ($remaining > 0) {
                    return $remaining;
                }
            }

            $otp = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            Cache::put($this->codeKey($user), Hash::make($otp), now()->addMinutes(self::TTL_MINUTES));

            Mail::to($user->email)->send(new EmailVerificationOtpMail($otp));

            Cache::put(
                $cooldownKey,
                now()->addSeconds(self::RESEND_COOLDOWN_SECONDS)->timestamp,
                now()->addSeconds(self::RESEND_COOLDOWN_SECONDS),
            );

            return 0;
        } finally {
            $cooldownLock->release();
        }
    }

    /**
     * Validate and consume the code once, marking the email verified atomically
     * with respect to concurrent attempts using the cache lock.
     */
    public function verifyAndConsume(User $user, string $otp): bool
    {
        $lock = Cache::lock($this->codeKey($user).':lock', 10);

        if (! $lock->get()) {
            return false;
        }

        try {
            if ($this->isLockedOut($user)) {
                return false;
            }

            $storedHash = Cache::get($this->codeKey($user));

            if (! is_string($storedHash) || ! Hash::check($otp, $storedHash)) {
                $this->recordFailure($user);

                return false;
            }

            $user->forceFill(['email_verified_at' => now()])->save();
            Cache::forget($this->codeKey($user));
            Cache::forget($this->attemptsKey($user));
            Cache::forget($this->cooldownKey($user));

            return true;
        } finally {
            $lock->release();
        }
    }

    public function isLockedOut(User $user): bool
    {
        return Cache::has($this->lockoutKey($user));
    }

    public function lockoutSecondsRemaining(User $user): int
    {
        $until = Cache::get($this->lockoutKey($user));

        return is_numeric($until) ? max(0, (int) $until - now()->timestamp) : 0;
    }

    public function remainingAttempts(User $user): int
    {
        if ($this->isLockedOut($user)) {
            return 0;
        }

        return max(0, self::MAX_ATTEMPTS - (int) Cache::get($this->attemptsKey($user), 0));
    }

    private function recordFailure(User $user): void
    {
        $attemptsKey = $this->attemptsKey($user);
        $attempts = (int) Cache::get($attemptsKey, 0) + 1;

        if ($attempts >= self::MAX_ATTEMPTS) {
            $until = now()->addMinutes(self::LOCKOUT_MINUTES);
            Cache::put($this->lockoutKey($user), $until->timestamp, $until);
            Cache::forget($attemptsKey);
            Cache::forget($this->codeKey($user));

            return;
        }

        Cache::put($attemptsKey, $attempts, now()->addMinutes(self::LOCKOUT_MINUTES));
    }

    private function codeKey(User $user): string
    {
        return "email-verification-otp:{$user->id}";
    }

    private function cooldownKey(User $user): string
    {
        return "email-verification-otp:{$user->id}:resend";
    }

    private function attemptsKey(User $user): string
    {
        return "email-verification-otp:{$user->id}:attempts";
    }

    private function lockoutKey(User $user): string
    {
        return "email-verification-otp:{$user->id}:lockout";
    }
}
