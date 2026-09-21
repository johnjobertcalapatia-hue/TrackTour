<?php

use App\Http\Middleware\CheckAccountStatus;
use App\Http\Middleware\CheckBusinessOwnerApproval;
use App\Http\Middleware\CheckRole;
use App\Http\Middleware\StaffMiddleware;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Support\Facades\Route;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        then: function () {
            Route::middleware('web')->group(base_path('routes/auth.php'));
        },
    )
    // All event listeners are registered explicitly in App\Providers\EventServiceProvider.
    // Discovery is disabled to prevent each listener from firing twice (explicit + discovered).
    ->withEvents(false)
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->trustProxies(at: '*');

        $middleware->alias([
            'role' => CheckRole::class,
            'account.status' => CheckAccountStatus::class,
            'business.approved' => CheckBusinessOwnerApproval::class,
            'business.context' => SetBusinessContext::class,
            'staff' => StaffMiddleware::class,
            'token.only' => \App\Http\Middleware\TokenOnlyAuth::class,
        ]);

        $middleware->redirectGuestsTo(fn () => null);

        $middleware->validateCsrfTokens(except: [
            'payments/*',
            'payments/return',
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
