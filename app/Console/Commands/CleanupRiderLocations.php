<?php

namespace App\Console\Commands;

use App\Models\RiderLocation;
use Illuminate\Console\Command;

class CleanupRiderLocations extends Command
{
    protected $signature = 'tracking:cleanup-locations
        {--days=30 : Delete rider_locations older than this many days}';

    protected $description = 'Delete rider_location records older than the specified retention period';

    public function handle(): int
    {
        $days = (int) $this->option('days');
        $cutoff = now()->subDays($days);

        $deleted = RiderLocation::where('recorded_at', '<', $cutoff)->delete();

        $this->info("Deleted {$deleted} rider_location records older than {$days} days.");

        return self::SUCCESS;
    }
}
