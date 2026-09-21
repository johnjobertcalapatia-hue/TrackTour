<?php

namespace App\Policies;

use App\Models\Delivery;
use App\Models\User;

class DeliveryPolicy
{
    public function viewAny(User $user): bool
    {
        if ($user->role === User::ROLE_BANSUD_TOURISM_OFFICE || $user->role === User::ROLE_TOURISM_OFFICE) {
            return true;
        }

        if ($user->role === User::ROLE_RIDER) {
            return true;
        }

        if ($user->role === User::ROLE_BUSINESS_OWNER) {
            return $user->businesses()->exists();
        }

        return false;
    }

    public function view(User $user, Delivery $delivery): bool
    {
        if ($delivery->rider_id === $user->id) {
            return true;
        }

        // A group delivery is visible to any restaurant owner/staff whose order
        // rides on the shared trip (4.4).
        foreach ($delivery->childOrders() as $order) {
            $business = $order->business;

            if ($business && $business->owner_id === $user->id) {
                return true;
            }

            if ($business && $business->staff()->where('user_id', $user->id)->where('status', 'active')->exists()) {
                return true;
            }
        }

        if ($user->role === User::ROLE_BANSUD_TOURISM_OFFICE || $user->role === User::ROLE_TOURISM_OFFICE) {
            return true;
        }

        return false;
    }

    public function updateStatus(User $user, Delivery $delivery): bool
    {
        return $delivery->rider_id === $user->id;
    }

    public function accept(User $user, Delivery $delivery): bool
    {
        if ($user->role !== User::ROLE_RIDER) {
            return false;
        }

        return in_array($user->riderDetail?->rider_status, [
            User::RIDER_STATUS_ONLINE,
            User::RIDER_STATUS_AVAILABLE,
        ]);
    }
}
