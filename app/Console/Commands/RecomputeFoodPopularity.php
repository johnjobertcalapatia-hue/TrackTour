<?php

namespace App\Console\Commands;

use App\Services\FoodPopularityService;
use Illuminate\Console\Command;

/**
 * Refreshes offerings.popularity_score (ratings + sales) for every dish.
 * Reviews refresh their own dishes immediately; this catches sales and
 * moderation changes. Scheduled every 10 minutes.
 */
class RecomputeFoodPopularity extends Command
{
    protected $signature = 'food:recompute-popularity';

    protected $description = 'Recompute dish popularity scores from ratings and sales';

    public function handle(FoodPopularityService $service): int
    {
        $updated = $service->recompute();
        $this->info("Updated {$updated} dish popularity score(s).");

        return self::SUCCESS;
    }
}
