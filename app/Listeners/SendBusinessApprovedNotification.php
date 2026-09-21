<?php

namespace App\Listeners;

use App\Events\BusinessApproved;
use App\Models\Notification;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;

class SendBusinessApprovedNotification implements ShouldQueue
{
    use InteractsWithQueue;

    public function handle(BusinessApproved $event): void
    {
        $business = $event->business;
        $owner = $business->owner;

        if ($owner) {
            Notification::create([
                'user_id' => $owner->id,
                'title' => 'Business Approved',
                'message' => "Your business \"{$business->business_name}\" has been approved and is now live on the platform.",
                'type' => 'business_approved',
            ]);
        }
    }
}
