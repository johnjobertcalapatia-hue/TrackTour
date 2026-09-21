<?php

namespace App\Enums;

enum TripStatus: string
{
    case WAITING = 'waiting';
    case ASSIGNED = 'assigned';
    case EN_ROUTE_PICKUP = 'en_route_pickup';
    case ARRIVED_PICKUP = 'arrived_pickup';
    case PICKED_UP = 'picked_up';
    case IN_TRANSIT = 'in_transit';
    case TOUR_STARTED = 'tour_started';
    case EN_ROUTE_DESTINATION = 'en_route_destination';
    case ARRIVED_DESTINATION = 'arrived_destination';
    case DELIVERED = 'delivered';
    case COMPLETED = 'completed';
    case CANCELLED = 'cancelled';

    public function label(): string
    {
        return match ($this) {
            self::WAITING => 'Waiting for Guide',
            self::ASSIGNED => 'Guide Assigned',
            self::EN_ROUTE_PICKUP => 'En Route to Pickup',
            self::ARRIVED_PICKUP => 'Arrived at Pickup',
            self::PICKED_UP => 'Picked Up',
            self::IN_TRANSIT => 'In Transit',
            self::TOUR_STARTED => 'Tour Started',
            self::EN_ROUTE_DESTINATION => 'En Route to Destination',
            self::ARRIVED_DESTINATION => 'Arrived at Destination',
            self::DELIVERED => 'Delivered',
            self::COMPLETED => 'Completed',
            self::CANCELLED => 'Cancelled',
        };
    }

    public function isActive(): bool
    {
        return in_array($this, [
            self::ASSIGNED,
            self::EN_ROUTE_PICKUP,
            self::ARRIVED_PICKUP,
            self::PICKED_UP,
            self::IN_TRANSIT,
            self::TOUR_STARTED,
            self::EN_ROUTE_DESTINATION,
            self::ARRIVED_DESTINATION,
        ]);
    }

    public function isCompleted(): bool
    {
        return in_array($this, [self::COMPLETED, self::CANCELLED]);
    }
}
