<?php

namespace App\Listeners;

use App\Events\UserRegistered;
use App\Models\Notification;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;

class SendWelcomeNotification implements ShouldQueue
{
    use InteractsWithQueue;

    public function handle(UserRegistered $event): void
    {
        $user = $event->user;

        $roleMessages = [
            'tourist' => 'Welcome to TrackTour! Explore the best tourism destinations, restaurants, and services in Bansud.',
            'business_owner' => 'Welcome to TrackTour! Register your business and reach more customers. Your account is pending approval.',
            'rider' => 'Welcome to TrackTour! Start accepting deliveries once your account is approved.',
        ];

        $message = $roleMessages[$user->role]
            ?? 'Welcome to TrackTour! Thank you for registering.';

        Notification::create([
            'user_id' => $user->id,
            'title' => 'Welcome to TrackTour!',
            'message' => $message,
            'type' => 'welcome',
        ]);
    }
}
