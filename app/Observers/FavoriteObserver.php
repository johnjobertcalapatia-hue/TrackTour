<?php

namespace App\Observers;

use App\Models\Business;
use App\Models\Favorite;

class FavoriteObserver
{
    public function created(Favorite $favorite): void
    {
        $this->updateFavoriteCount($favorite, 1);
    }

    public function deleted(Favorite $favorite): void
    {
        $this->updateFavoriteCount($favorite, -1);
    }

    public function restored(Favorite $favorite): void
    {
        $this->updateFavoriteCount($favorite, 1);
    }

    protected function updateFavoriteCount(Favorite $favorite, int $delta): void
    {
        if ($favorite->favoritable_type !== Business::class) {
            return;
        }

        $business = Business::find($favorite->favoritable_id);
        if (! $business) {
            return;
        }

        $business->update([
            'favorite_count' => max(0, $business->favorite_count + $delta),
        ]);

        $business->updatePopularityScore();
    }
}
