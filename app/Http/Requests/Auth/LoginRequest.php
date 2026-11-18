<?php

namespace App\Http\Requests\Auth;

use App\Models\User;
use Illuminate\Auth\Events\Lockout;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class LoginRequest extends FormRequest
{
    private const MAX_ATTEMPTS = 5;
    private const LOCKOUT_MINUTES = 15;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'email', 'max:255'],
            'password' => ['required', 'string', 'max:255'],
        ];
    }

    public function messages(): array
    {
        return [
            'email.required' => 'Email is required.',
            'email.email' => 'Please provide a valid email address.',
            'email.max' => 'Email must not exceed 255 characters.',
            'password.required' => 'Password is required.',
            'password.max' => 'Password must not exceed 255 characters.',
        ];
    }

    public function authenticate(): void
    {
        $this->ensureIsNotRateLimited();
        $this->ensureAccountIsNotLocked();

        $user = User::where('email', $this->string('email'))->first();

        if (! $user) {
            $this->recordFailedAttempt();
            $this->recordIncident('login_failed', 'Failed login: no account for this email', 'No account found with this email address.');
            throw ValidationException::withMessages([
                'email' => 'No account found with this email address.',
            ]);
        }

        if (! Hash::check($this->string('password'), $user->password)) {
            $this->recordFailedAttempt();
            $this->recordIncident('login_failed', 'Failed login: wrong password', 'Incorrect password.', $user);
            throw ValidationException::withMessages([
                'password' => 'Incorrect password. Please try again.',
            ]);
        }

        $this->clearFailedAttempts();
    }

    private function ensureAccountIsNotLocked(): void
    {
        $user = User::where('email', $this->string('email'))->first();

        if ($user && $user->locked_until && now()->lessThan($user->locked_until)) {
            $seconds = now()->diffInSeconds($user->locked_until);
            $this->recordIncident('login_blocked', 'Login attempt on a locked account', 'The account is locked after too many failed logins.', $user);

            throw ValidationException::withMessages([
                'email' => 'Account is locked. Try again in ' . ceil($seconds / 60) . ' minute(s).',
            ]);
        }

        if ($user && $user->locked_until && now()->greaterThanOrEqualTo($user->locked_until)) {
            $user->update([
                'failed_login_attempts' => 0,
                'locked_until' => null,
            ]);
        }
    }

    private function recordFailedAttempt(): void
    {
        $user = User::where('email', $this->string('email'))->first();

        if (! $user) return;

        $attempts = $user->failed_login_attempts + 1;

        if ($attempts >= self::MAX_ATTEMPTS) {
            $user->update([
                'failed_login_attempts' => $attempts,
                'locked_until' => now()->addMinutes(self::LOCKOUT_MINUTES),
            ]);
            // Worth a look: repeated wrong passwords can mean someone is guessing.
            $this->recordIncident('account_locked', "Account locked after {$attempts} failed logins",
                'The account is locked for '.self::LOCKOUT_MINUTES.' minutes. Check whether the owner forgot the password or someone is guessing it.',
                $user, \App\Models\SystemIncident::STATUS_OPEN);
        } else {
            $user->update(['failed_login_attempts' => $attempts]);
        }
    }

    /** Failed-login history (admin → Incident History). The password is never stored. */
    private function recordIncident(string $code, string $title, string $message, ?User $user = null, string $status = \App\Models\SystemIncident::STATUS_RECORDED): void
    {
        \App\Services\SystemIncidentRecorder::record(
            'auth', $code, $code === 'account_locked' ? 'error' : 'warning', $title, $message,
            ['email' => (string) $this->string('email'), 'account' => $user?->name, 'role' => $user?->role],
            $user, $status, fingerprintKey: strtolower((string) $this->string('email')), user: $user,
        );
    }

    private function clearFailedAttempts(): void
    {
        $user = User::where('email', $this->string('email'))->first();

        if ($user) {
            $user->update([
                'failed_login_attempts' => 0,
                'locked_until' => null,
            ]);
        }
    }

    public function ensureIsNotRateLimited(): void
    {
        if (! RateLimiter::tooManyAttempts($this->throttleKey(), self::MAX_ATTEMPTS)) {
            return;
        }

        event(new Lockout($this));
        $this->recordIncident('login_rate_limited', 'Too many login attempts from one device', 'Login was paused for this email and IP address.');

        $seconds = RateLimiter::availableIn($this->throttleKey());

        throw ValidationException::withMessages([
            'email' => trans('auth.throttle', [
                'seconds' => $seconds,
                'minutes' => ceil($seconds / 60),
            ]),
        ]);
    }

    public function throttleKey(): string
    {
        return Str::transliterate(Str::lower($this->string('email')).'|'.$this->ip());
    }
}
