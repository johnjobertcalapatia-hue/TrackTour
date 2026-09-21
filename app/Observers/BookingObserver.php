<?php

namespace App\Observers;

use App\Models\Booking;
use App\Models\Business;

class BookingObserver
{
    public function created(Booking $booking): void
    {
        $this->updateBookingCount($booking->business_id);
    }

    public function updated(Booking $booking): void
    {
        $this->updateBookingCount($booking->business_id);
    }

    public function deleted(Booking $booking): void
    {
        $this->updateBookingCount($booking->business_id);
    }

    protected function updateBookingCount(int $businessId): void
    {
        $bookingModel = new Booking;
        $count = $bookingModel->where('business_id', $businessId)
            ->whereIn('status', ['confirmed', 'in_progress', 'completed'])
            ->count();

        $business = Business::find($businessId);
        if (! $business) {
            return;
        }

        $business->update([
            'booking_count' => $count,
        ]);

        $business->updatePopularityScore();
    }
}
