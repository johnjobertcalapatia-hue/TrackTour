<?php

namespace App\Services;

use App\Models\Delivery;
use App\Models\User;

/**
 * Which vehicles can do what, from each rider's registered vehicle.
 *
 * - Every rider vehicle may do food delivery.
 * - Only motor vehicles may do ride-hailing: a bicycle can carry food but not
 *   a passenger.
 * - A tourist can book a ride vehicle type only while at least one approved,
 *   ride-hailing-eligible rider has that vehicle registered.
 * - A ride is offered to, and can be accepted by, only a rider whose
 *   registered vehicle is the booked vehicle type.
 */
class RideVehicles
{
    public const RIDER_VEHICLES = ['motorcycle', 'tricycle', 'car', 'van', 'bicycle'];

    public const RIDE_HAILING = ['motorcycle', 'tricycle', 'car', 'van'];

    public const LABELS = ['motorcycle' => 'Motorcycle', 'tricycle' => 'Tricycle', 'car' => 'Car', 'van' => 'Van', 'bicycle' => 'Bicycle'];

    public static function canRideHail(?string $vehicle): bool
    {
        return $vehicle !== null && in_array($vehicle, self::RIDE_HAILING, true);
    }

    /** Booked vehicle of a ride-hailing delivery (null for food deliveries). */
    public static function bookedVehicle(Delivery $delivery): ?string
    {
        if ($delivery->primaryOrder()?->order_type !== 'transport') {
            return null;
        }
        $notes = is_array($delivery->notes) ? $delivery->notes : json_decode((string) $delivery->notes, true);

        return is_array($notes) && ! empty($notes['vehicle_type']) ? (string) $notes['vehicle_type'] : 'motorcycle';
    }

    /** True when the rider's registered vehicle may serve this delivery. */
    public static function riderMatches(?string $riderVehicle, Delivery $delivery): bool
    {
        $booked = self::bookedVehicle($delivery);

        return $booked === null || ($riderVehicle !== null && $riderVehicle === $booked);
    }

    /**
     * Ride vehicle types tourists may book now, from registered vehicles of
     * approved, ride-hailing-eligible riders.
     *
     * @return array<int, array{slug: string, name: string, available: bool, riders_registered: int, riders_online: int}>
     */
    public function bookable(): array
    {
        $riders = User::query()
            ->where('role', User::ROLE_RIDER)
            ->where('account_status', User::ACCOUNT_STATUS_APPROVED)
            ->eligibleForService(User::SERVICE_TRANSPORT)
            ->join('rider_details', 'rider_details.user_id', '=', 'users.id')
            ->whereIn('rider_details.vehicle_type', self::RIDE_HAILING)
            ->get(['rider_details.vehicle_type', 'rider_details.rider_status']);

        return array_map(function (string $slug) use ($riders) {
            $mine = $riders->where('vehicle_type', $slug);
            $online = $mine->whereIn('rider_status', [User::RIDER_STATUS_ONLINE, User::RIDER_STATUS_AVAILABLE])->count();

            return [
                'slug' => $slug,
                'name' => self::LABELS[$slug],
                'available' => $mine->isNotEmpty(),
                'riders_registered' => $mine->count(),
                'riders_online' => $online,
            ];
        }, self::RIDE_HAILING);
    }

    /** @return array<int, string> */
    public function bookableSlugs(): array
    {
        return array_values(array_map(fn ($v) => $v['slug'], array_filter($this->bookable(), fn ($v) => $v['available'])));
    }
}
