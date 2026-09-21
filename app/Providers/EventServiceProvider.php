<?php

namespace App\Providers;

use App\Events\BookingCreated;
use App\Events\BookingStatusChanged;
use App\Events\BusinessApproved;
use App\Events\BusinessRejected;
use App\Events\DeliveryAssigned;
use App\Events\DeliveryStatusChanged;
use App\Events\OrderCreated;
use App\Events\OrderStatusChanged;
use App\Events\ReviewCreated;
use App\Events\UserRegistered;
use App\Listeners\SendBookingCreatedNotifications;
use App\Listeners\SendBookingStatusNotification;
use App\Listeners\SendBusinessApprovedNotification;
use App\Listeners\SendBusinessRejectedNotification;
use App\Listeners\ForwardStatusEventsToBridge;
use App\Listeners\SendDeliveryAssignedNotification;
use App\Listeners\SendDeliveryStatusNotification;
use App\Listeners\SendOrderCreatedNotifications;
use App\Listeners\SyncOrderStatusFromDelivery;
use App\Listeners\SendOrderStatusNotification;
use App\Listeners\SendWelcomeNotification;
use App\Listeners\UpdateBusinessRating;
use Illuminate\Foundation\Support\Providers\EventServiceProvider as ServiceProvider;

class EventServiceProvider extends ServiceProvider
{
    protected $listen = [
        OrderCreated::class => [
            SendOrderCreatedNotifications::class,
        ],
        OrderStatusChanged::class => [
            SendOrderStatusNotification::class,
            ForwardStatusEventsToBridge::class,
        ],
        BookingCreated::class => [
            SendBookingCreatedNotifications::class,
        ],
        BookingStatusChanged::class => [
            SendBookingStatusNotification::class,
        ],
        BusinessApproved::class => [
            SendBusinessApprovedNotification::class,
        ],
        BusinessRejected::class => [
            SendBusinessRejectedNotification::class,
        ],
        DeliveryAssigned::class => [
            SendDeliveryAssignedNotification::class,
            ForwardStatusEventsToBridge::class,
        ],
        DeliveryStatusChanged::class => [
            SyncOrderStatusFromDelivery::class,
            SendDeliveryStatusNotification::class,
            ForwardStatusEventsToBridge::class,
        ],
        UserRegistered::class => [
            SendWelcomeNotification::class,
        ],
        ReviewCreated::class => [
            UpdateBusinessRating::class,
        ],
    ];

    public function boot(): void
    {
        //
    }
}
