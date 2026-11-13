<?php

namespace App\Services;

use App\Models\TourismSetting;
use Illuminate\Support\Facades\DB;

/**
 * Ride-hailing fare policy stored in the tourism_settings table.
 *
 * Separate from the food delivery fee (DeliveryFareSettings): the Tourism
 * Office sets a base fare and a per-kilometre rate for every ride vehicle
 * type from the Admin Riders page. Rows are stored as `ride_{vehicle}_{field}`;
 * the DEFAULTS below (the original hard-coded ride prices) are the fallback
 * when no row has been saved yet.
 *
 * Ride fare = base fare + distance km x per-km rate (TransportationService).
 * Changes apply to new estimates and bookings only; a booked ride keeps the
 * fare and rates stored on its delivery notes.
 */
class RideFareSettings
{
    public const FIELDS = ['base_fare', 'per_km'];

    /** @var array<string, array{base_fare: float, per_km: float}> */
    public const DEFAULTS = [
        'motorcycle' => ['base_fare' => 50.00, 'per_km' => 15.00],
        'tricycle' => ['base_fare' => 60.00, 'per_km' => 20.00],
        'car' => ['base_fare' => 100.00, 'per_km' => 25.00],
        'van' => ['base_fare' => 150.00, 'per_km' => 30.00],
    ];

    protected ?array $cached = null;

    /**
     * @return array<string, array{base_fare: float, per_km: float}>
     */
    public function all(): array
    {
        $stored = $this->loaded();
        $fares = [];

        foreach (static::DEFAULTS as $vehicle => $defaults) {
            foreach (static::FIELDS as $field) {
                $fares[$vehicle][$field] = round((float) ($stored[static::storageKey($vehicle, $field)] ?? $defaults[$field]), 2);
            }
        }

        return $fares;
    }

    /**
     * @return array{base_fare: float, per_km: float}
     */
    public function forVehicle(string $vehicle): array
    {
        $all = $this->all();

        return $all[$vehicle] ?? $all['motorcycle'];
    }

    /**
     * Persist the edited ride fares and return the effective snapshot.
     *
     * @param  array<string, array<string, mixed>>  $values  keyed by vehicle type
     */
    public function save(array $values): array
    {
        DB::transaction(function () use ($values) {
            foreach (static::DEFAULTS as $vehicle => $defaults) {
                foreach (static::FIELDS as $field) {
                    if (! isset($values[$vehicle]) || ! array_key_exists($field, $values[$vehicle])) {
                        continue;
                    }

                    TourismSetting::updateOrCreate(
                        ['key' => static::storageKey($vehicle, $field)],
                        ['value' => (string) round((float) $values[$vehicle][$field], 2)]
                    );
                }
            }
        });

        $this->cached = null;

        return $this->all();
    }

    public static function storageKey(string $vehicle, string $field): string
    {
        return "ride_{$vehicle}_{$field}";
    }

    /**
     * @return array<string, float>
     */
    protected function loaded(): array
    {
        if ($this->cached !== null) {
            return $this->cached;
        }

        $keys = [];
        foreach (array_keys(static::DEFAULTS) as $vehicle) {
            foreach (static::FIELDS as $field) {
                $keys[] = static::storageKey($vehicle, $field);
            }
        }

        return $this->cached = TourismSetting::whereIn('key', $keys)
            ->pluck('value', 'key')
            ->map(fn ($value) => (float) $value)
            ->all();
    }
}
