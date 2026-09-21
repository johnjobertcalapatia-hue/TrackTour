<?php

namespace App\Providers;

use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\ServiceProvider;

/**
 * P11.5 — Load the realtime channel authorizer routes (`routes/channels.php`)
 * and advertise the broadcasting endpoints for private-channel authorization.
 *
 * The P11.5 socket engine is Zero-DB: Laravel authorizes rooms here (the source
 * of truth) on top of the engine's own HMAC token join protocol.
 */
class BroadcastServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Broadcast::routes();

        require base_path('routes/channels.php');
    }
}