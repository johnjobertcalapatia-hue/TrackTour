<?php

namespace App\Console\Commands;

use App\Models\TouristLocationShare;
use Illuminate\Console\Command;

/**
 * Tourist location sharing keeps the latest position only, and not for long:
 * a position older than an hour is wiped (the consent row stays).
 */
class PruneTouristLocations extends Command
{
    protected $signature = 'tourist-locations:prune';

    protected $description = 'Clear tourist shared locations older than the retention window';

    public function handle(): int
    {
        $cleared = TouristLocationShare::query()
            ->whereNotNull('latitude')
            ->where(fn ($q) => $q->where('location_at', '<', now()->subMinutes(TouristLocationShare::RETAIN_MINUTES))
                ->orWhere('enabled', false))
            ->update(['latitude' => null, 'longitude' => null, 'accuracy_m' => null, 'location_at' => null]);

        $this->info("Cleared {$cleared} tourist location(s).");

        return self::SUCCESS;
    }
}
