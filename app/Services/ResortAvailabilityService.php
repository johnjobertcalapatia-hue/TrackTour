<?php

namespace App\Services;

use App\Exceptions\ResortUnavailableException;
use App\Models\Business;
use App\Models\ResortBlockedDate;
use App\Models\ResortOffering;
use App\Models\ResortOfferingAllocation;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * Resort availability (reservations Stage 6, docs/resort-reservation-architecture.md §11).
 *
 * What one reservation line uses ("claims"):
 *  - day_use, duration: the date (whole day);
 *  - time_slot: the date at a start time (slots from the resort's opening hours, one per duration);
 *  - overnight: every night from check-in up to the night before check-out.
 * How much it uses: `units` → the quantity; `capacity` / `slots` → the number of guests.
 *
 * A date is unavailable when the owner blocked it (whole resort or this offering), when the
 * resort is closed that weekday (day-based offerings; nights of an overnight stay may fall on a
 * closed day — the reservation stage refuses only a check-in on one), or when the remaining
 * capacity is too small. Capacity is the offering's inventory_quantity.
 *
 * reserve()/release() change `resort_offering_allocations` inside the caller's transaction, under
 * lockForUpdate on the (offering, date, slot) rows; the UNIQUE row and the unsigned counter are the
 * database backstop. Dates are Philippine dates.
 */
final class ResortAvailabilityService
{
    public const TZ = 'Asia/Manila';

    /** Longest calendar a single request may ask for. */
    public const MAX_RANGE_DAYS = 62;

    /** How far ahead a tourist may reserve. */
    public const MAX_ADVANCE_DAYS = 365;

    public const MAX_NIGHTS = 30;

    /** Hours used for time slots when the resort has not set any. */
    public const DEFAULT_OPEN = '08:00';

    public const DEFAULT_CLOSE = '17:00';

    private const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    public function today(): string
    {
        return CarbonImmutable::now(self::TZ)->toDateString();
    }

    /**
     * Dates an offering occupies for a stay.
     *
     * @return list<string>
     */
    public function datesFor(ResortOffering $offering, string $checkIn, ?string $checkOut = null): array
    {
        if ($offering->booking_mode !== 'overnight') {
            return [$checkIn];
        }
        $start = CarbonImmutable::parse($checkIn);
        $end = CarbonImmutable::parse($checkOut ?? $start->addDay()->toDateString());
        $dates = [];
        for ($d = $start; $d->lt($end); $d = $d->addDay()) {
            $dates[] = $d->toDateString();
        }

        return $dates;
    }

    /** How much of the inventory a line uses on each of its dates. */
    public function usage(ResortOffering $offering, int $quantity, int $guests): int
    {
        return $offering->inventory_mode === 'units' ? max(1, $quantity) : max(1, $guests);
    }

    /** Closed when the resort has opening hours and none on that weekday. No hours set = open daily. */
    public function isClosedDay(Business $business, string $date): bool
    {
        $hours = is_array($business->business_hours) ? array_filter($business->business_hours) : [];
        if ($hours === []) {
            return false;
        }

        return $business->getScheduleForDay($this->dayKey($date)) === [];
    }

    /**
     * Start times for a time-slot offering on a date: from opening, one every
     * duration_minutes, each ending by closing time.
     *
     * @return list<string> HH:MM
     */
    public function slotsFor(ResortOffering $offering, Business $business, string $date): array
    {
        if ($offering->booking_mode !== 'time_slot' || ! $offering->duration_minutes) {
            return [];
        }
        $hours = is_array($business->business_hours) ? array_filter($business->business_hours) : [];
        $periods = $hours === []
            ? [['open' => self::DEFAULT_OPEN, 'close' => self::DEFAULT_CLOSE]]
            : $business->getScheduleForDay($this->dayKey($date));

        $slots = [];
        foreach ($periods as $period) {
            $open = $this->minutes($period['open']);
            $close = $this->minutes($period['close']);
            if ($close <= $open) {
                $close = 24 * 60; // open past midnight: slots until midnight
            }
            for ($t = $open; $t + $offering->duration_minutes <= $close; $t += $offering->duration_minutes) {
                $slots[] = sprintf('%02d:%02d', intdiv($t, 60), $t % 60);
            }
        }
        $slots = array_values(array_unique($slots));
        sort($slots);

        return $slots;
    }

    /** @return Collection<int, ResortBlockedDate> */
    public function blocks(Business $business, string $from, string $to): Collection
    {
        return ResortBlockedDate::where('business_id', $business->id)->overlapping($from, $to)->get();
    }

    /** @param Collection<int, ResortBlockedDate> $blocks */
    public function blockFor(Collection $blocks, int $offeringId, string $date): ?ResortBlockedDate
    {
        return $blocks->first(fn (ResortBlockedDate $b) => ($b->resort_offering_id === null || (int) $b->resort_offering_id === $offeringId)
            && $b->start_date->toDateString() <= $date && $b->end_date->toDateString() >= $date);
    }

    /**
     * Availability calendar for offerings over [from, to].
     *
     * @param  Collection<int, ResortOffering>  $offerings
     * @return array{from: string, to: string, closed_dates: list<string>, blocked: list<array>, offerings: list<array>}
     */
    public function calendar(Business $business, Collection $offerings, string $from, string $to): array
    {
        $dates = [];
        for ($d = CarbonImmutable::parse($from); $d->lte(CarbonImmutable::parse($to)); $d = $d->addDay()) {
            $dates[] = $d->toDateString();
        }
        $blocks = $this->blocks($business, $from, $to);
        $reserved = ResortOfferingAllocation::whereIn('resort_offering_id', $offerings->modelKeys())
            ->whereBetween('date', [$from, $to])->get()
            ->groupBy(fn ($a) => $a->resort_offering_id.'|'.$a->date->toDateString())
            ->map(fn ($rows) => $rows->pluck('reserved_quantity', 'slot'));
        $closed = array_values(array_filter($dates, fn ($date) => $this->isClosedDay($business, $date)));

        return [
            'from' => $from,
            'to' => $to,
            'closed_dates' => $closed,
            'blocked' => $blocks->map(fn (ResortBlockedDate $b) => [
                'id' => $b->id,
                'resort_offering_id' => $b->resort_offering_id,
                'start_date' => $b->start_date->toDateString(),
                'end_date' => $b->end_date->toDateString(),
                'reason' => $b->reason,
            ])->values()->all(),
            'offerings' => $offerings->map(function (ResortOffering $o) use ($business, $dates, $blocks, $reserved, $closed) {
                $capacity = (int) $o->inventory_quantity;
                $days = [];
                foreach ($dates as $date) {
                    $taken = $reserved->get($o->id.'|'.$date, collect());
                    $blocked = $this->blockFor($blocks, $o->id, $date) !== null;
                    $isClosed = in_array($date, $closed, true);
                    $day = ['date' => $date, 'capacity' => $capacity, 'blocked' => $blocked, 'closed' => $isClosed];
                    if ($o->booking_mode === 'time_slot') {
                        $day['slots'] = collect($this->slotsFor($o, $business, $date))
                            ->map(fn ($slot) => ['slot' => $slot, 'available' => ($blocked || $isClosed) ? 0 : max(0, $capacity - (int) ($taken[$slot] ?? 0))])
                            ->values()->all();
                        $day['available'] = collect($day['slots'])->max('available') ?? 0;
                    } else {
                        $day['reserved'] = (int) ($taken[''] ?? 0);
                        // An overnight stay may not check in on a closed day, but nights on closed days are fine.
                        $day['available'] = ($blocked || ($isClosed && $o->booking_mode !== 'overnight')) ? 0 : max(0, $capacity - $day['reserved']);
                    }
                    $days[] = $day;
                }

                return [
                    'id' => $o->id,
                    'name' => $o->name,
                    'booking_mode' => $o->booking_mode,
                    'inventory_mode' => $o->inventory_mode,
                    'capacity' => $capacity,
                    'dates' => $days,
                ];
            })->values()->all(),
        ];
    }

    /**
     * The claims of one reservation line.
     *
     * @return list<array{offering: ResortOffering, date: string, slot: string, quantity: int}>
     */
    public function claimsFor(ResortOffering $offering, string $checkIn, ?string $checkOut, ?string $slot, int $quantity, int $guests): array
    {
        $use = $this->usage($offering, $quantity, $guests);

        return array_map(fn ($date) => [
            'offering' => $offering,
            'date' => $date,
            'slot' => $offering->booking_mode === 'time_slot' ? (string) $slot : '',
            'quantity' => $use,
        ], $this->datesFor($offering, $checkIn, $checkOut));
    }

    /**
     * Check claims without reserving (a quote, or the form). Throws when any is unavailable.
     *
     * @param  list<array{offering: ResortOffering, date: string, slot: string, quantity: int}>  $claims
     */
    public function assertAvailable(Business $business, array $claims): void
    {
        $this->check($business, $this->merge($claims), lock: false);
    }

    /**
     * Reserve claims. Must run inside the caller's transaction: on failure nothing is kept.
     *
     * @param  list<array{offering: ResortOffering, date: string, slot: string, quantity: int}>  $claims
     */
    public function reserve(Business $business, array $claims): void
    {
        $this->requireTransaction();
        $merged = $this->merge($claims);
        $rows = $this->check($business, $merged, lock: true);
        foreach ($merged as $key => $claim) {
            $rows[$key]->forceFill(['reserved_quantity' => $rows[$key]->reserved_quantity + $claim['quantity']])->save();
        }
    }

    /**
     * Give claims back (cancel, reject, expiry). Never goes below zero.
     *
     * @param  list<array{offering: ResortOffering, date: string, slot: string, quantity: int}>  $claims
     */
    public function release(array $claims): void
    {
        $this->requireTransaction();
        foreach ($this->merge($claims) as $claim) {
            $row = ResortOfferingAllocation::where('resort_offering_id', $claim['offering']->id)
                ->where('date', $claim['date'])->where('slot', $claim['slot'])->lockForUpdate()->first();
            if ($row) {
                $row->forceFill(['reserved_quantity' => max(0, $row->reserved_quantity - $claim['quantity'])])->save();
            }
        }
    }

    // ------------------------------------------------------------------ internals

    /**
     * @param  array<string, array{offering: ResortOffering, date: string, slot: string, quantity: int}>  $claims
     * @return array<string, ResortOfferingAllocation> locked rows by claim key (when $lock)
     */
    private function check(Business $business, array $claims, bool $lock): array
    {
        if ($claims === []) {
            return [];
        }
        $dates = array_column($claims, 'date');
        $blocks = $this->blocks($business, min($dates), max($dates));
        $today = $this->today();
        $lastDay = CarbonImmutable::parse($today)->addDays(self::MAX_ADVANCE_DAYS)->toDateString();
        $problems = [];
        $rows = [];

        foreach ($claims as $key => $claim) {
            /** @var ResortOffering $o */
            $o = $claim['offering'];
            $date = $claim['date'];
            $base = ['offering_id' => $o->id, 'offering' => $o->name, 'date' => $date, 'slot' => $claim['slot'] ?: null];

            if ((int) $o->business_id !== (int) $business->id || $o->trashed()) {
                $problems[] = $base + ['reason' => 'unknown', 'message' => "{$o->name} is not offered by this resort."];

                continue;
            }
            if ($date < $today || $date > $lastDay) {
                $problems[] = $base + ['reason' => 'out_of_window', 'message' => "{$date} is outside the booking window."];

                continue;
            }
            if ($block = $this->blockFor($blocks, $o->id, $date)) {
                $problems[] = $base + ['reason' => 'blocked', 'message' => "{$o->name} is not available on {$date}".($block->reason ? " ({$block->reason})" : '').'.'];

                continue;
            }
            if ($o->booking_mode !== 'overnight' && $this->isClosedDay($business, $date)) {
                $problems[] = $base + ['reason' => 'closed', 'message' => "The resort is closed on {$date}."];

                continue;
            }
            if ($o->booking_mode === 'time_slot' && ! in_array($claim['slot'], $this->slotsFor($o, $business, $date), true)) {
                $problems[] = $base + ['reason' => 'slot', 'message' => "{$o->name} has no {$claim['slot']} slot on {$date}."];

                continue;
            }

            $reserved = 0;
            if ($lock) {
                ResortOfferingAllocation::insertOrIgnore([
                    'resort_offering_id' => $o->id, 'date' => $date, 'slot' => $claim['slot'], 'reserved_quantity' => 0,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
                $rows[$key] = ResortOfferingAllocation::where('resort_offering_id', $o->id)
                    ->where('date', $date)->where('slot', $claim['slot'])->lockForUpdate()->firstOrFail();
                $reserved = $rows[$key]->reserved_quantity;
            } else {
                $reserved = (int) ResortOfferingAllocation::where('resort_offering_id', $o->id)
                    ->where('date', $date)->where('slot', $claim['slot'])->value('reserved_quantity');
            }

            $available = max(0, (int) $o->inventory_quantity - $reserved);
            if ($claim['quantity'] > $available) {
                $problems[] = $base + ['reason' => 'sold_out', 'available' => $available,
                    'message' => $available === 0
                        ? "{$o->name} is fully booked on {$date}".($claim['slot'] ? " at {$claim['slot']}" : '').'.'
                        : "Only {$available} of {$o->name} left on {$date}".($claim['slot'] ? " at {$claim['slot']}" : '').'.'];
            }
        }

        if ($problems !== []) {
            throw new ResortUnavailableException($problems);
        }

        return $rows;
    }

    /**
     * One entry per (offering, date, slot), sorted so every transaction locks rows in the same order.
     *
     * @param  list<array{offering: ResortOffering, date: string, slot: string, quantity: int}>  $claims
     * @return array<string, array{offering: ResortOffering, date: string, slot: string, quantity: int}>
     */
    private function merge(array $claims): array
    {
        $merged = [];
        foreach ($claims as $claim) {
            $key = sprintf('%010d|%s|%s', $claim['offering']->id, $claim['date'], $claim['slot']);
            if (isset($merged[$key])) {
                $merged[$key]['quantity'] += $claim['quantity'];
            } else {
                $merged[$key] = $claim;
            }
        }
        ksort($merged);

        return $merged;
    }

    private function requireTransaction(): void
    {
        if (DB::transactionLevel() === 0) {
            throw new LogicException('Resort allocations change only inside a database transaction.');
        }
    }

    private function dayKey(string $date): string
    {
        return self::DAY_KEYS[CarbonImmutable::parse($date)->dayOfWeek];
    }

    private function minutes(string $hm): int
    {
        [$h, $m] = array_map('intval', explode(':', substr($hm, 0, 5)) + [0, 0]);

        return $h * 60 + $m;
    }
}
