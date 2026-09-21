<?php

namespace App\Policies;

use App\Models\Booking;
use App\Models\User;

class BookingPolicy
{
    public function viewAny(User $user): bool
    {
        if ($user->role === User::ROLE_BANSUD_TOURISM_OFFICE || $user->role === User::ROLE_TOURISM_OFFICE) {
            return true;
        }

        if ($user->role === User::ROLE_BUSINESS_OWNER) {
            return $user->businesses()->exists();
        }

        return true;
    }

    public function view(User $user, Booking $booking): bool
    {
        $business = $booking->business;

        if ($business && $business->owner_id === $user->id) {
            return true;
        }

        if ($business && $business->staff()->where('user_id', $user->id)->where('status', 'active')->exists()) {
            return true;
        }

        if ($booking->customer_email && $booking->customer_email === $user->email) {
            return true;
        }

        if ($user->role === User::ROLE_BANSUD_TOURISM_OFFICE || $user->role === User::ROLE_TOURISM_OFFICE) {
            return true;
        }

        return false;
    }

    public function updateStatus(User $user, Booking $booking): bool
    {
        $business = $booking->business;

        if ($business && $business->owner_id === $user->id) {
            return true;
        }

        if ($business && $business->staff()->where('user_id', $user->id)->where('status', 'active')->exists()) {
            return true;
        }

        return false;
    }

    public function cancel(User $user, Booking $booking): bool
    {
        if ($booking->customer_email && $booking->customer_email === $user->email) {
            return true;
        }

        $business = $booking->business;

        if ($business && $business->owner_id === $user->id) {
            return true;
        }

        if ($business && $business->staff()->where('user_id', $user->id)->where('status', 'active')->exists()) {
            return true;
        }

        return false;
    }
}
