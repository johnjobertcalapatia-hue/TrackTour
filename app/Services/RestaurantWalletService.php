<?php

namespace App\Services;

use App\Models\Business;
use App\Models\RestaurantWallet;

/**
 * P12.1 wallet account lifecycle only. It intentionally has no money-moving
 * methods: P12.2 will own atomic settlement and ledger posting.
 */
class RestaurantWalletService
{
    public function ensureForBusiness(Business $business): ?RestaurantWallet
    {
        $business->loadMissing('category');

        if ($business->status !== 'approved' || ! $business->isRestaurant()) {
            return null;
        }

        return RestaurantWallet::firstOrCreate(
            ['business_id' => $business->id],
            [
                'available_balance' => 0,
                'pending_balance' => 0,
                'total_earned' => 0,
                'total_withdrawn' => 0,
            ],
        );
    }
}
