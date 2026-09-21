<?php

namespace App\Listeners;

use App\Events\BookingCreated;
use App\Models\Notification;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;

class SendBookingCreatedNotifications implements ShouldQueue
{
    use InteractsWithQueue;

    public function handle(BookingCreated $event): void
    {
        $business = $event->business;
        $booking = $event->booking;

        $owner = $business->owner;

        if ($owner) {
            Notification::create([
                'user_id' => $owner->id,
                'title' => 'New Booking Received',
                'message' => "Booking #{$booking->booking_number} from {$booking->customer_name}. Check-in: {$booking->check_in_date}.",
                'type' => 'booking_created',
            ]);
        }

        $staffMembers = $business->staff()
            ->where('status', 'active')
            ->whereHas('permissions', function ($query) {
                $query->where('module_code', 'bookings')->where('can_view', true);
            })
            ->get();

        foreach ($staffMembers as $staff) {
            Notification::create([
                'user_id' => $staff->user_id,
                'title' => 'New Booking Received',
                'message' => "Booking #{$booking->booking_number} from {$booking->customer_name}. Check-in: {$booking->check_in_date}.",
                'type' => 'booking_created',
            ]);
        }
    }
}
