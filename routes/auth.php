<?php

use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\Auth\ConfirmablePasswordController;
use App\Http\Controllers\Auth\EmailVerificationNotificationController;
use App\Http\Controllers\Auth\NewPasswordController;
use App\Http\Controllers\Auth\PasswordController;
use App\Http\Controllers\Auth\PasswordResetLinkController;
use App\Http\Controllers\Auth\RegisteredUserController;
use App\Http\Controllers\Auth\VerifyEmailController;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

// The React SPA owns the server-rendered auth screens (login, register,
// password reset, verification, confirm password). The API service is
// backend-only: it must never render those Blade views (they no longer exist)
// and must keep the named routes so email links keep generating valid URLs.
// GET screen requests redirect to the deployed frontend equivalent.
$spa = static function (string $path, Request $request): RedirectResponse {
    $target = rtrim((string) config('app.frontend_url'), '/').$path;
    $query = (string) $request->getQueryString();

    if ($query !== '') {
        $target .= (str_contains($target, '?') ? '&' : '?').$query;
    }

    return redirect()->away($target);
};

Route::middleware('guest')->group(function () use ($spa) {
    Route::get('register', fn (Request $request): RedirectResponse => $spa('/register', $request))
        ->name('register');

    Route::post('register', [RegisteredUserController::class, 'store']);

    Route::post('register/save-step', [RegisteredUserController::class, 'saveStep'])
        ->name('register.save-step');

    Route::post('register/check-unique', [RegisteredUserController::class, 'checkUnique'])
        ->name('register.check-unique');

    Route::get('register/session-data', [RegisteredUserController::class, 'getSessionData'])
        ->name('register.session-data');

    Route::get('login', fn (Request $request): RedirectResponse => $spa('/login', $request))
        ->name('login');

    Route::post('login', [AuthenticatedSessionController::class, 'store']);

    Route::get('forgot-password', fn (Request $request): RedirectResponse => $spa('/forgot-password', $request))
        ->name('password.request');

    Route::post('forgot-password', [PasswordResetLinkController::class, 'store'])
        ->name('password.email');

    Route::get('reset-password/{token}', fn (Request $request, string $token): RedirectResponse => $spa('/reset-password?token='.urlencode($token), $request))
        ->name('password.reset');

    Route::post('reset-password', [NewPasswordController::class, 'store'])
        ->name('password.store');
});

Route::middleware('auth')->group(function () use ($spa) {
    Route::get('verify-email', fn (Request $request): RedirectResponse => $spa('/verify-email', $request))
        ->name('verification.notice');

    Route::get('verify-email/{id}/{hash}', VerifyEmailController::class)
        ->middleware(['signed', 'throttle:6,1'])
        ->name('verification.verify');

    Route::post('email/verification-notification', [EmailVerificationNotificationController::class, 'store'])
        ->middleware('throttle:6,1')
        ->name('verification.send');

    Route::get('confirm-password', fn (Request $request): RedirectResponse => $spa('/confirm-password', $request))
        ->name('password.confirm');

    Route::post('confirm-password', [ConfirmablePasswordController::class, 'store']);

    Route::put('password', [PasswordController::class, 'update'])->name('password.update');

    Route::post('logout', [AuthenticatedSessionController::class, 'destroy'])
        ->name('logout');
});
