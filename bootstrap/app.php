<?php

use App\Http\Middleware\CheckAccountStatus;
use App\Http\Middleware\CheckBusinessOwnerApproval;
use App\Http\Middleware\CheckRole;
use App\Http\Middleware\StaffMiddleware;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Env;

/*
 * XAMPP Apache on Windows runs PHP as a threaded module (apache2handler,
 * mpm_winnt). putenv()/getenv() share ONE process environment across those
 * threads and are not thread-safe, so concurrent requests could read the
 * environment while another request was rewriting it and miss DB_CONNECTION.
 * Laravel then fell back to its default (sqlite → empty database.sqlite) and
 * answered 500 "no such table: businesses" at random (/tourist/stays,
 * /tourist/for-you, …). Keeping .env values in the per-request $_ENV/$_SERVER
 * only removes the race. CLI, tests and production (non-threaded) are
 * unaffected.
 */
if (PHP_SAPI === 'apache2handler' && PHP_OS_FAMILY === 'Windows') {
    Env::disablePutenv();
}

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
            // Staff Management Stage 1: active staff, permission, own-restaurant order scope.
            'staff.active' => StaffMiddleware::class,
            'staff.can' => \App\Http\Middleware\StaffPermissionMiddleware::class,
            'staff.order' => \App\Http\Middleware\StaffOrderScopeMiddleware::class,
            'token.only' => \App\Http\Middleware\TokenOnlyAuth::class,
            'municipal.scope' => \App\Http\Middleware\EnsureMunicipalScope::class,
        ]);

        $middleware->redirectGuestsTo(fn () => null);

        $middleware->validateCsrfTokens(except: [
            'payments/*',
            'payments/return',
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // System incident history (admin → Incident History). Recording never
        // changes the response: every callback returns null.
        $exceptions->report(function (\Throwable $e) {
            \App\Services\SystemIncidentRecorder::exception($e);
        });
        $exceptions->render(function (\Illuminate\Validation\ValidationException $e, \Illuminate\Http\Request $request) {
            if ($request->allFiles() !== []) {
                \App\Services\SystemIncidentRecorder::uploadRejected($request, $e->errors());
            }

            return null;
        });
        $exceptions->render(function (\Throwable $e, \Illuminate\Http\Request $request) {
            $forbidden = $e instanceof \Illuminate\Auth\Access\AuthorizationException
                || ($e instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface && $e->getStatusCode() === 403);
            if ($forbidden) {
                \App\Services\SystemIncidentRecorder::record(
                    'access', 'access_denied', 'warning',
                    'Access denied: /'.ltrim($request->path(), '/'),
                    $e->getMessage() ?: 'The account is not allowed to open this page.',
                    ['role' => $request->user()?->role],
                    status: \App\Models\SystemIncident::STATUS_RECORDED,
                    fingerprintKey: ($request->user()?->id ?? 'guest').'|'.$request->path(),
                );
            }

            return null;
        });
    })->create();
