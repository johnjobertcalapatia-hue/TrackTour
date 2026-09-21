<?php

namespace App\Listeners;

use App\Events\BusinessRejected;
use App\Models\Notification;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;

class SendBusinessRejectedNotification implements ShouldQueue
{
    use InteractsWithQueue;

    public function handle(BusinessRejected $event): void
    {
        $business = $event->business;
        $owner = $business->owner;

        if ($owner) {
            $message = "Your business \"{$business->business_name}\" has been rejected.";

            if ($event->reason) {
                $message .= " Reason: {$event->reason}";
            }

            $message .= ' Please update your business information and resubmit.';

            Notification::create([
                'user_id' => $owner->id,
                'title' => 'Business Rejected',
                'message' => $message,
                'type' => 'business_rejected',
            ]);
        }
    }
}
