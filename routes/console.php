<?php

use App\Console\Commands\AdvancePreparationOrders;
use App\Console\Commands\AutoCancelUndeliveredOrder;
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

// Never auto-cancel: orders that never find a rider wait indefinitely by
// decision (the former AutoRejectWaitingOrder 10-minute auto-reject was
// removed with the restaurant accept/reject flow). This command only starts
// eligible preparations and flips due timers PREPARING → READY at 00:00.
Schedule::command(AdvancePreparationOrders::class)
    ->everyMinute()
    ->description('Start preparation for rider-accepted orders and complete due preparation timers');

Schedule::command(AutoCancelUndeliveredOrder::class)
    ->everyMinute()
    ->description('Auto-cancel and refund paid delivery orders not delivered within 60 minutes');

Schedule::command(DispatchScheduledDeliveries::class)
    ->everyMinute()
    ->description('Dispatch due scheduled deliveries to the nearest eligible rider');

Schedule::command(ReconcilePendingRefunds::class)
    ->everyThirtyMinutes()
    ->description('Reconcile pending_refund payments against the PayMongo refund state');
