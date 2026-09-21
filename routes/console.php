<?php

use App\Console\Commands\AutoCancelUndeliveredOrder;
use App\Console\Commands\AutoRejectWaitingOrder;
use App\Console\Commands\CheckExpiredDocuments;
use App\Console\Commands\CleanupRiderLocations;
use App\Console\Commands\DispatchScheduledDeliveries;
use App\Console\Commands\ReconcilePendingRefunds;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command(CleanupRiderLocations::class, ['--days' => 30])
    ->daily()
    ->description('Purge old GPS checkpoint data, keeping only the encoded polyline');

Schedule::command(CheckExpiredDocuments::class)
    ->everySixHours()
    ->description('Suspend businesses with expired documents and reinstate renewed ones');

Schedule::command(AutoRejectWaitingOrder::class)
    ->everyMinute()
    ->description('Auto-reject and refund paid orders where the restaurant did not respond within 10 minutes');

Schedule::command(AutoCancelUndeliveredOrder::class)
    ->everyMinute()
    ->description('Auto-cancel and refund paid delivery orders not delivered within 60 minutes');

Schedule::command(DispatchScheduledDeliveries::class)
    ->everyMinute()
    ->description('Dispatch due scheduled deliveries to the nearest eligible rider');

Schedule::command(ReconcilePendingRefunds::class)
    ->everyThirtyMinutes()
    ->description('Reconcile pending_refund payments against the PayMongo refund state');
