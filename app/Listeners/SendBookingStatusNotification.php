<?php

namespace App\Listeners;

use App\Events\BookingStatusChanged;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;

class SendBookingStatusNotification implements ShouldQueue
{
    use InteractsWithQueue;

    public function handle(BookingStatusChanged $event): void
    {
        $booking = $event->booking;
        $statusMessages = [
            'confirmed' => 'Your booking has been confirmed.',
            'pending' => 'Your booking is pending confirmation.',
            'checked_in' => 'You have been checked in.',
            'checked_out' => 'You have been checked out.',
            'completed' => 'Your booking has been completed.',
            'cancelled' => 'Your booking has been cancelled.',
        ];

        $message = $statusMessages[$event->newStatus]
            ?? "Your booking status has been updated to: {$event->newStatus}.";

        $user = User::where('email', $booking->customer_email)->first();

        if ($user) {
            Notification::create([
                'user_id' => $user->id,
                'title' => 'Booking Status Updated',
                'message' => "Booking #{$booking->booking_number}: {$message}",
                'type' => 'booking_status_changed',
            ]);
        }
    }
}
