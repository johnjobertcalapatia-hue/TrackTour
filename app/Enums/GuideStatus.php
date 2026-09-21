<?php

namespace App\Enums;

enum GuideStatus: string
{
    case OFFLINE = 'offline';
    case AVAILABLE = 'available';
    case ASSIGNED = 'assigned';
    case EN_ROUTE_PICKUP = 'en_route_pickup';
    case ON_TOUR = 'on_tour';
    case PAUSED = 'paused';
    case EMERGENCY = 'emergency';

    public function label(): string
    {
        return match ($this) {
            self::OFFLINE => 'Offline',
            self::AVAILABLE => 'Available',
            self::ASSIGNED => 'Assigned',
            self::EN_ROUTE_PICKUP => 'En Route to Pickup',
            self::ON_TOUR => 'On Tour',
            self::PAUSED => 'Paused',
            self::EMERGENCY => 'Emergency',
        };
    }

    public function isActive(): bool
    {
        return in_array($this, [
            self::ASSIGNED,
            self::EN_ROUTE_PICKUP,
            self::ON_TOUR,
        ]);
    }

    public function isOffline(): bool
    {
        return $this === self::OFFLINE;
    }
}
