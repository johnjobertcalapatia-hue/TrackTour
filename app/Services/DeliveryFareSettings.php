<?php

namespace App\Services;

use App\Models\TourismSetting;
use Illuminate\Support\Facades\DB;

/**
 * Delivery fare policy stored in the tourism_settings table.
 *
 * The Tourism Office can edit the standard fare and additional fees used by
 * the rider fare calculation from the Admin Riders page. Values stored under
 * the key `delivery_{field}` override the `config('delivery.*')` defaults,
 * which remain the fallback when no row has been saved yet.
 *
 * Registered as a singleton so every fare consumer in a request (DeliveryFeeService,
 * OrderResource, ...) reads the same snapshot, and `save()` resets the cache.
 */
class DeliveryFareSettings
{
    public const KEYS = [
        'base_fare',
        'included_kilometers',
        'per_kilometer',
        'minimum_fee',
        'service_adjustment',
        'surge_multiplier',
    ];

    protected ?array $cached = null;

    public function all(): array
    {
        return [
            'base_fare' => $this->baseFare(),
            'included_kilometers' => $this->includedKilometers(),
            'per_kilometer' => $this->perKilometer(),
            'minimum_fee' => $this->minimumFee(),
            'service_adjustment' => $this->serviceAdjustment(),
            'surge_multiplier' => $this->surgeMultiplier(),
        ];
    }

    public function baseFare(): float
    {
        return $this->float('base_fare', (float) config('delivery.base_fare'));
    }

    public function includedKilometers(): float
    {
        return $this->float('included_kilometers', (float) config('delivery.included_kilometers', 2.00));
    }

    public function perKilometer(): float
    {
        return $this->float('per_kilometer', (float) config('delivery.per_kilometer'));
    }

    public function minimumFee(): float
    {
        return $this->float('minimum_fee', (float) config('delivery.minimum_fee'));
    }

    public function serviceAdjustment(): float
    {
        return $this->float('service_adjustment', (float) config('delivery.service_adjustment'));
    }

    public function surgeMultiplier(): float
    {
        return $this->float('surge_multiplier', (float) config('delivery.surge_multiplier'));
    }

    /**
     * Persist the edited fare policy and return the effective snapshot.
     *
     * @param  array<string, mixed>  $values  keyed by the fare field names
     */
    public function save(array $values): array
    {
        DB::transaction(function () use ($values) {
            foreach (static::KEYS as $key) {
                if (! array_key_exists($key, $values)) {
                    continue;
                }

                TourismSetting::updateOrCreate(
                    ['key' => static::storageKey($key)],
                    ['value' => (string) round((float) $values[$key], 2)]
                );
            }
        });

        $this->cached = null;

        return $this->all();
    }

    public static function storageKey(string $key): string
    {
        return "delivery_{$key}";
    }

    protected function float(string $key, float $default): float
    {
        $value = $this->loaded()[$key] ?? $default;

        return round((float) $value, 2);
    }

    /**
     * @return array<string, float>
     */
    protected function loaded(): array
    {
        if ($this->cached !== null) {
            return $this->cached;
        }

        $keys = array_map(static fn (string $key) => static::storageKey($key), static::KEYS);

        $this->cached = TourismSetting::whereIn('key', $keys)
            ->pluck('value', 'key')
            ->mapWithKeys(static function ($value, string $key) {
                return [str_replace('delivery_', '', $key) => (float) $value];
            })
            ->all();

        return $this->cached;
    }
}