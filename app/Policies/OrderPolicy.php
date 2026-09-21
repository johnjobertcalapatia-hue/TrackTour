<?php

namespace App\Policies;

use App\Models\Order;
use App\Models\User;

class OrderPolicy
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

    public function view(User $user, Order $order): bool
    {
        $business = $order->business;

        if ($business && $business->owner_id === $user->id) {
            return true;
        }

        if ($business && $business->staff()->where('user_id', $user->id)->where('status', 'active')->exists()) {
            return true;
        }

        if ($order->activeDelivery()?->rider_id === $user->id) {
            return true;
        }

        if ($order->customer_email && $order->customer_email === $user->email) {
            return true;
        }

        if ($user->role === User::ROLE_BANSUD_TOURISM_OFFICE || $user->role === User::ROLE_TOURISM_OFFICE) {
            return true;
        }

        return false;
    }

    public function updateStatus(User $user, Order $order): bool
    {
        $business = $order->business;

        if ($business && $business->owner_id === $user->id) {
            return true;
        }

        if ($business && $business->staff()->where('user_id', $user->id)->where('status', 'active')->exists()) {
            return true;
        }

        return false;
    }

    public function assignRider(User $user, Order $order): bool
    {
        $business = $order->business;

        if ($business && $business->owner_id === $user->id) {
            return true;
        }

        if ($business && $business->staff()->where('user_id', $user->id)->where('status', 'active')->exists()) {
            return true;
        }

        return false;
    }

    public function cancel(User $user, Order $order): bool
    {
        if ($order->customer_email && $order->customer_email === $user->email) {
            return true;
        }

        $business = $order->business;

        if ($business && $business->owner_id === $user->id) {
            return true;
        }

        if ($business && $business->staff()->where('user_id', $user->id)->where('status', 'active')->exists()) {
            return true;
        }

        return false;
    }
}
