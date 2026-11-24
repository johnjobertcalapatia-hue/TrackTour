<?php

namespace App\Services;

use App\Models\Business;
use App\Models\CommissionRateSnapshot;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\TourismSetting;
use App\Models\User;
use App\Services\Integrity\CanonicalJson;
use App\Services\Integrity\TransactionLedger;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Commission rates (Earnings Stage 1, 2026-11-24 — docs/secure-transaction-audit.md §R).
 *
 * Stored in tourism_settings as `commission.<field>`:
 *  - municipality_id NULL → the district default, set by the Bansud super admin;
 *  - municipality_id = a town → that town's own override, set by its office.
 *
 * A town rate falls back field by field: town override → district default →
 * the built-in default (today's rule). District-only fields (the TrackTour
 * share and the Fast Delivery amounts) have no town override.
 *
 * Every order keeps the rates it was booked with (CommissionRateSnapshot):
 * food at checkout (the restaurant's town), rides when a driver accepts (the
 * driver's town). Stage 1 records the rates only; the amount calculations
 * still use their current rules until Stage 2.
 *
 * Limits (§R5, 2026-11-24): Bansud sets the lowest and highest value a town
 * may use for each rate (`commission.limits`, district row). The district
 * defaults sit inside them and every town's own value must too, so the rate
 * that applies anywhere is always within Bansud's limits.
 */
class CommissionRateSettings
{
    public const PREFIX = 'commission.';

    /** Rates each municipality may override. */
    public const TOWN_FIELDS = [
        'ride_driver_percent',
        'ride_driver_minimum',
        'food_system_fee_percent',
        'food_office_percent',
        'fast_platform_percent',
        'fast_rider_percent',
        'fast_office_percent',
        'cashout_fee_percent',
    ];

    /** Rates only the Bansud super admin sets, for the whole district. */
    public const DISTRICT_FIELDS = [
        'platform_net_percent',
        'fast_amount_minimum',
        'fast_amount_maximum',
    ];

    public const FAST_SPLIT_FIELDS = ['fast_platform_percent', 'fast_rider_percent', 'fast_office_percent'];

    public const FAST_OPTIONS_KEY = 'fast_amount_options';

    public const LIMITS_KEY = 'limits';

    /** Names used in messages (match the pages' labels). */
    public const LABELS = [
        'ride_driver_percent' => 'Driver share of the fare',
        'ride_driver_minimum' => 'Driver minimum per ride',
        'food_system_fee_percent' => 'System fee added to food',
        'food_office_percent' => 'Office share of food + fee',
        'fast_platform_percent' => 'Fast Delivery TrackTour share',
        'fast_rider_percent' => 'Fast Delivery rider share',
        'fast_office_percent' => 'Fast Delivery office share',
        'cashout_fee_percent' => 'Online cash-out fee',
    ];

    /** Peso amounts (not percentages). */
    public const PESO_FIELDS = ['ride_driver_minimum', 'fast_amount_minimum', 'fast_amount_maximum'];

    /**
     * Today's rules, used until an office saves its own values. The food
     * rates follow the current configuration so a deployment that changed
     * SYSTEM_FEE_PERCENTAGE / COD_PLATFORM_FEE_PERCENT keeps its values.
     *
     * @return array<string, float>
     */
    public function builtInDefaults(): array
    {
        return [
            'ride_driver_percent' => 40.0,
            'ride_driver_minimum' => 20.0,
            'food_system_fee_percent' => (float) config('delivery.system_fee_percentage', 10.0),
            'food_office_percent' => (float) config('delivery.cod_platform_fee_percent', 20),
            'fast_platform_percent' => 10.0,
            'fast_rider_percent' => 30.0,
            'fast_office_percent' => 60.0,
            'cashout_fee_percent' => 2.0,
            'platform_net_percent' => 10.0,
            'fast_amount_minimum' => 20.0,
            'fast_amount_maximum' => 100.0,
        ];
    }

    /** @return list<float> */
    public function builtInFastOptions(): array
    {
        return [25.0, 50.0, 100.0];
    }

    /**
     * The starting limits for a town's own rates (product owner, 2026-11-24).
     * A rate with no limit listed may use its full range until Bansud narrows it.
     *
     * @return array<string, array{min: float, max: float}>
     */
    public function builtInLimits(): array
    {
        $limits = [];
        foreach (self::TOWN_FIELDS as $field) {
            [$min, $max] = $this->absoluteRange($field);
            $limits[$field] = ['min' => $min, 'max' => $max];
        }

        return array_merge($limits, [
            'ride_driver_percent' => ['min' => 30.0, 'max' => 70.0],
            'ride_driver_minimum' => ['min' => 10.0, 'max' => 50.0],
            'food_system_fee_percent' => ['min' => 0.0, 'max' => 20.0],
            'cashout_fee_percent' => ['min' => 0.0, 'max' => 5.0],
        ]);
    }

    /**
     * The limits in force: Bansud's saved values, else the starting limits.
     *
     * @return array<string, array{min: float, max: float}>
     */
    public function limits(): array
    {
        $raw = $this->rows()['__limits'] ?? null;
        $saved = is_string($raw) ? json_decode($raw, true) : null;
        $limits = $this->builtInLimits();
        if (is_array($saved)) {
            foreach (self::TOWN_FIELDS as $field) {
                if (isset($saved[$field]['min'], $saved[$field]['max']) && is_numeric($saved[$field]['min']) && is_numeric($saved[$field]['max'])) {
                    $limits[$field] = ['min' => (float) $saved[$field]['min'], 'max' => (float) $saved[$field]['max']];
                }
            }
        }

        return $limits;
    }

    /**
     * The district defaults (what a town without its own value uses).
     *
     * @return array{rates: array<string, float>, fast_amount_options: list<float>, sources: array<string, string>}
     */
    public function district(): array
    {
        $stored = $this->rows()[''] ?? [];
        $builtIn = $this->builtInDefaults();
        $rates = [];
        $sources = [];
        foreach (array_merge(self::TOWN_FIELDS, self::DISTRICT_FIELDS) as $field) {
            $has = array_key_exists($field, $stored);
            $rates[$field] = $has ? (float) $stored[$field] : $builtIn[$field];
            $sources[$field] = $has ? 'district' : 'default';
        }

        return ['rates' => $rates, 'fast_amount_options' => $this->fastOptions(), 'sources' => $sources, 'limits' => $this->limits()];
    }

    /**
     * The rates that apply in one municipality (null → district defaults).
     *
     * @return array{municipality_id: int|null, rates: array<string, float>, fast_amount_options: list<float>, sources: array<string, string>}
     */
    public function effective(?int $municipalityId): array
    {
        $district = $this->district();
        $own = $municipalityId ? ($this->rows()[(string) $municipalityId] ?? []) : [];
        $rates = $district['rates'];
        $sources = $district['sources'];
        foreach (self::TOWN_FIELDS as $field) {
            if (array_key_exists($field, $own)) {
                $rates[$field] = (float) $own[$field];
                $sources[$field] = 'town';
            }
        }

        return [
            'municipality_id' => $municipalityId,
            'rates' => $rates,
            'fast_amount_options' => $district['fast_amount_options'],
            'sources' => $sources,
        ];
    }

    /**
     * A town's own saved values (null = uses the district default).
     *
     * @return array<string, float|null>
     */
    public function overrides(int $municipalityId): array
    {
        $own = $this->rows()[(string) $municipalityId] ?? [];
        $out = [];
        foreach (self::TOWN_FIELDS as $field) {
            $out[$field] = array_key_exists($field, $own) ? (float) $own[$field] : null;
        }

        return $out;
    }

    /** Validation rules for the district defaults form (every field required). */
    public function districtRules(): array
    {
        $rules = [];
        foreach (array_merge(self::TOWN_FIELDS, self::DISTRICT_FIELDS) as $field) {
            $rules[$field] = ['required', 'numeric', ...$this->bounds($field)];
        }
        $rules[self::FAST_OPTIONS_KEY] = ['required', 'array', 'min:1', 'max:6'];
        $rules[self::FAST_OPTIONS_KEY.'.*'] = ['required', 'numeric', 'min:1', 'max:10000', 'distinct'];
        // Optional: left out, the limits in force are kept.
        $rules[self::LIMITS_KEY] = ['sometimes', 'array'];
        foreach (self::TOWN_FIELDS as $field) {
            foreach (['min', 'max'] as $end) {
                $rules[self::LIMITS_KEY.".{$field}.{$end}"] = ['required_with:'.self::LIMITS_KEY, 'numeric', ...$this->bounds($field)];
            }
        }

        return $rules;
    }

    /** Validation rules for a town's own rates (null clears the override). */
    public function townRules(): array
    {
        $rules = [];
        foreach (self::TOWN_FIELDS as $field) {
            $rules[$field] = ['present', 'nullable', 'numeric', ...$this->bounds($field)];
        }

        return $rules;
    }

    /**
     * Save the district defaults. Returns [before, after] for the audit log.
     *
     * @param  array<string, mixed>  $values  validated by districtRules()
     */
    public function saveDistrict(array $values): array
    {
        $before = $this->district();
        $rates = [];
        foreach (array_merge(self::TOWN_FIELDS, self::DISTRICT_FIELDS) as $field) {
            $rates[$field] = round((float) $values[$field], 2);
        }
        $options = collect($values[self::FAST_OPTIONS_KEY])->map(fn ($v) => round((float) $v, 2))->sort()->values()->all();
        $limits = $this->limits();
        if (isset($values[self::LIMITS_KEY])) {
            foreach (self::TOWN_FIELDS as $field) {
                $limits[$field] = [
                    'min' => round((float) $values[self::LIMITS_KEY][$field]['min'], 2),
                    'max' => round((float) $values[self::LIMITS_KEY][$field]['max'], 2),
                ];
            }
        }
        foreach (self::TOWN_FIELDS as $field) {
            $label = self::LABELS[$field];
            if ($limits[$field]['min'] > $limits[$field]['max']) {
                throw ValidationException::withMessages([self::LIMITS_KEY.".{$field}.min" => "{$label}: the lowest allowed value cannot be above the highest."]);
            }
            if (! $this->withinLimit($rates[$field], $limits[$field])) {
                throw ValidationException::withMessages([$field => sprintf('%s: the district default %s is outside the allowed range %s.', $label, self::format($field, $rates[$field]), self::range($field, $limits[$field]))]);
            }
        }

        $this->assertFastSplit(array_intersect_key($rates, array_flip(self::FAST_SPLIT_FIELDS)), 'The district');
        if ($rates['fast_amount_minimum'] > $rates['fast_amount_maximum']) {
            throw ValidationException::withMessages(['fast_amount_minimum' => 'The lowest Fast Delivery amount cannot be above the highest.']);
        }
        foreach ($options as $amount) {
            if ($amount < $rates['fast_amount_minimum'] || $amount > $rates['fast_amount_maximum']) {
                throw ValidationException::withMessages([self::FAST_OPTIONS_KEY => sprintf('Every Fast Delivery amount must be between ₱%s and ₱%s.', number_format($rates['fast_amount_minimum'], 2), number_format($rates['fast_amount_maximum'], 2))]);
            }
        }
        // Every town must still have a valid Fast Delivery split under the new defaults.
        foreach (array_keys($this->rows()) as $town) {
            if ($town === '' || str_starts_with((string) $town, '__')) {
                continue;
            }
            $own = $this->rows()[$town];
            $merged = [];
            foreach (self::FAST_SPLIT_FIELDS as $field) {
                $merged[$field] = array_key_exists($field, $own) ? (float) $own[$field] : $rates[$field];
            }
            $this->assertFastSplit($merged, 'A municipality with its own Fast Delivery rates');
        }
        // A town's own value may not be left outside new limits. Bansud cannot
        // change another town's rates, so the save is refused and names them.
        $outside = [];
        foreach ($this->rows() as $town => $own) {
            if ($town === '' || str_starts_with((string) $town, '__')) {
                continue;
            }
            foreach (self::TOWN_FIELDS as $field) {
                if (array_key_exists($field, $own) && ! $this->withinLimit((float) $own[$field], $limits[$field])) {
                    $outside[] = ['town' => (int) $town, 'field' => $field, 'value' => (float) $own[$field]];
                }
            }
        }
        if ($outside !== []) {
            $names = Municipality::whereIn('id', array_column($outside, 'town'))->pluck('name', 'id');
            $lines = array_map(fn ($o) => sprintf('%s: %s is %s (new range %s)', $names[$o['town']] ?? 'Municipality #'.$o['town'], self::LABELS[$o['field']], self::format($o['field'], $o['value']), self::range($o['field'], $limits[$o['field']])), $outside);
            throw ValidationException::withMessages([self::LIMITS_KEY => 'These municipalities use rates outside the new limits: '.implode('; ', $lines).'. Ask their office to change them first, or keep a wider limit.']);
        }

        DB::transaction(function () use ($rates, $options, $limits) {
            foreach ($rates as $field => $value) {
                $this->put(null, $field, (string) $value);
            }
            $this->put(null, self::FAST_OPTIONS_KEY, json_encode($options));
            $this->put(null, self::LIMITS_KEY, json_encode($limits));
        });
        return [$before, $this->district()];
    }

    /**
     * Save one town's own rates (null clears that field back to the district
     * default). Returns [before, after] effective rates for the audit log.
     *
     * @param  array<string, mixed>  $values  validated by townRules()
     */
    public function saveTown(int $municipalityId, array $values): array
    {
        $before = $this->effective($municipalityId);
        $district = $this->district()['rates'];
        $merged = [];
        foreach (self::FAST_SPLIT_FIELDS as $field) {
            $merged[$field] = $values[$field] !== null ? round((float) $values[$field], 2) : $district[$field];
        }
        $this->assertFastSplit($merged, 'The');
        $limits = $this->limits();
        foreach (self::TOWN_FIELDS as $field) {
            if ($values[$field] !== null && ! $this->withinLimit(round((float) $values[$field], 2), $limits[$field])) {
                throw ValidationException::withMessages([$field => sprintf('%s must be within %s, the range Bansud allows.', self::LABELS[$field], self::range($field, $limits[$field]))]);
            }
        }

        DB::transaction(function () use ($municipalityId, $values) {
            foreach (self::TOWN_FIELDS as $field) {
                if ($values[$field] === null) {
                    TourismSetting::where('municipality_id', $municipalityId)->where('key', self::PREFIX.$field)->delete();
                } else {
                    $this->put($municipalityId, $field, (string) round((float) $values[$field], 2));
                }
            }
        });
        return [$before, $this->effective($municipalityId)];
    }

    /** "field: old → new" lines between two rate sets. */
    public static function describeChanges(array $before, array $after): array
    {
        $changes = [];
        foreach ($after['rates'] as $field => $value) {
            $old = (float) ($before['rates'][$field] ?? 0);
            if (round($old, 2) !== round((float) $value, 2)) {
                $changes[] = sprintf('%s: %s → %s', $field, self::format($field, $old), self::format($field, (float) $value));
            }
        }
        if (isset($before['fast_amount_options'], $after['fast_amount_options']) && $before['fast_amount_options'] != $after['fast_amount_options']) {
            $changes[] = sprintf('fast_amount_options: %s → %s', implode('/', $before['fast_amount_options']), implode('/', $after['fast_amount_options']));
        }
        foreach ($after['limits'] ?? [] as $field => $limit) {
            $old = $before['limits'][$field] ?? null;
            if ($old === null || round((float) $old['min'], 2) !== round((float) $limit['min'], 2) || round((float) $old['max'], 2) !== round((float) $limit['max'], 2)) {
                $changes[] = sprintf('%s limit: %s → %s', $field, $old ? self::range($field, $old) : 'none', self::range($field, $limit));
            }
        }

        return $changes;
    }

    /**
     * The rates to keep with an order booked in a municipality.
     *
     * @return array{rates: array<string, mixed>, fingerprint: string}
     */
    public function snapshot(?int $municipalityId): array
    {
        $effective = $this->effective($municipalityId);
        $rates = $effective['rates'] + [self::FAST_OPTIONS_KEY => $effective['fast_amount_options']];
        ksort($rates);

        return ['rates' => $rates, 'fingerprint' => hash('sha256', CanonicalJson::encode($rates))];
    }

    /**
     * Keep the rates a food order was placed with: one snapshot for each
     * restaurant town in the order. Runs inside the checkout transaction.
     */
    public function captureFoodOrder(Order $order): void
    {
        $businessIds = $order->items()->whereNotNull('business_id')->pluck('business_id')
            ->push($order->business_id)->filter()->unique()->values();
        $towns = Business::whereIn('id', $businessIds)->pluck('municipality_id')->unique()->values();
        if ($towns->isEmpty()) {
            $towns = collect([null]);
        }
        foreach ($towns as $town) {
            $this->capture($order, CommissionRateSnapshot::CONTEXT_FOOD_CHECKOUT, $town ? (int) $town : null);
        }
    }

    /**
     * Keep the rates a ride was accepted under (the driver's town). Runs
     * inside the acceptance transaction; other services are ignored.
     */
    public function captureRide(Delivery $delivery, int $riderId): void
    {
        $order = $delivery->primaryOrder();
        if (! $order || $order->order_type !== 'transport') {
            return;
        }
        $town = User::whereKey($riderId)->value('municipality_id');
        $this->capture($order, CommissionRateSnapshot::CONTEXT_RIDE_ACCEPTED, $town ? (int) $town : null);
    }

    private function capture(Order $order, string $context, ?int $municipalityId): void
    {
        $exists = CommissionRateSnapshot::where('order_id', $order->id)->where('context', $context)
            ->where(fn ($q) => $municipalityId === null ? $q->whereNull('municipality_id') : $q->where('municipality_id', $municipalityId))
            ->exists();
        if ($exists) {
            return;
        }

        $snapshot = $this->snapshot($municipalityId);
        $row = CommissionRateSnapshot::create([
            'order_id' => $order->id,
            'municipality_id' => $municipalityId,
            'context' => $context,
            'rates' => $snapshot['rates'],
            'fingerprint' => $snapshot['fingerprint'],
            'captured_at' => now(),
        ]);

        app(TransactionLedger::class)->record($order, 'commission_rates_captured', [
            'context' => $context,
            'municipality_id' => $municipalityId,
            'rates' => $snapshot['rates'],
            'fingerprint' => $snapshot['fingerprint'],
        ], $row);
    }

    private function assertFastSplit(array $split, string $who): void
    {
        $sum = round(array_sum(array_map('floatval', $split)), 2);
        if (abs($sum - 100.0) > 0.001) {
            throw ValidationException::withMessages([
                'fast_office_percent' => sprintf('%s Fast Delivery split must add up to 100%% (TrackTour + rider + office = %s%%).', $who, rtrim(rtrim(number_format($sum, 2), '0'), '.')),
            ]);
        }
    }

    private function bounds(string $field): array
    {
        [$min, $max] = $this->absoluteRange($field);

        return ['min:'.$min, 'max:'.$max];
    }

    /** @return array{0: float, 1: float} The widest range a field can ever take. */
    private function absoluteRange(string $field): array
    {
        return match ($field) {
            'ride_driver_minimum' => [0.0, 1000.0],
            'fast_amount_minimum', 'fast_amount_maximum' => [1.0, 10000.0],
            default => [0.0, 100.0],
        };
    }

    /** @param  array{min: float, max: float}  $limit */
    private function withinLimit(float $value, array $limit): bool
    {
        return $value >= $limit['min'] - 0.0001 && $value <= $limit['max'] + 0.0001;
    }

    /** @param  array{min: float|int, max: float|int}  $limit */
    private static function range(string $field, array $limit): string
    {
        return self::format($field, (float) $limit['min']).'–'.self::format($field, (float) $limit['max']);
    }

    private static function format(string $field, float $value): string
    {
        return in_array($field, self::PESO_FIELDS, true) ? '₱'.number_format($value, 2) : rtrim(rtrim(number_format($value, 2), '0'), '.').'%';
    }

    /** @return list<float> */
    private function fastOptions(): array
    {
        $raw = $this->rows()['__options'] ?? null;
        $decoded = is_string($raw) ? json_decode($raw, true) : null;

        return is_array($decoded) && $decoded !== []
            ? array_values(array_map('floatval', $decoded))
            : $this->builtInFastOptions();
    }

    private function put(?int $municipalityId, string $field, string $value): void
    {
        TourismSetting::updateOrCreate(
            ['municipality_id' => $municipalityId, 'key' => self::PREFIX.$field],
            ['value' => $value],
        );
    }

    /**
     * Saved rows keyed by town id ('' = district); the Fast Delivery amounts
     * list is kept under '__options'. Read fresh on every call (a tiny table)
     * so a long-lived instance never works from stale rates.
     *
     * @return array<string, mixed>
     */
    private function rows(): array
    {
        $rows = [];
        foreach (TourismSetting::where('key', 'like', self::PREFIX.'%')->get(['municipality_id', 'key', 'value']) as $row) {
            $field = substr($row->key, strlen(self::PREFIX));
            if ($field === self::FAST_OPTIONS_KEY || $field === self::LIMITS_KEY) {
                if ($row->municipality_id === null) {
                    $rows[$field === self::LIMITS_KEY ? '__limits' : '__options'] = $row->value;
                }

                continue;
            }
            $known = $row->municipality_id === null
                ? in_array($field, array_merge(self::TOWN_FIELDS, self::DISTRICT_FIELDS), true)
                : in_array($field, self::TOWN_FIELDS, true);
            if ($known && is_numeric($row->value)) {
                $rows[(string) ($row->municipality_id ?? '')][$field] = (float) $row->value;
            }
        }

        return $rows;
    }
}
