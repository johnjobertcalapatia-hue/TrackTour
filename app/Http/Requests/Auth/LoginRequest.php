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
            throw ValidationException::withMessages([
                'email' => 'No account found with this email address.',
            ]);
        }

        if (! Hash::check($this->string('password'), $user->password)) {
            $this->recordFailedAttempt();
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
        } else {
            $user->update(['failed_login_attempts' => $attempts]);
        }
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
