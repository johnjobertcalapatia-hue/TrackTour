<?php

namespace App\Console\Commands;

use App\Services\ScheduledDispatchProcessor;
use Illuminate\Console\Command;

class DispatchScheduledDeliveries extends Command
{
    protected $signature = 'schedule:dispatch';

    protected $description = 'Dispatch due scheduled deliveries to the nearest eligible rider';

    public function handle(): int
    {
        $count = app(ScheduledDispatchProcessor::class)->process();

        $this->info("Processed {$count} due scheduled delivery(ies).");

        return self::SUCCESS;
    }
}