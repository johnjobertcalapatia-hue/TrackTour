<?php

namespace App\Support;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

/**
 * Date filter for the business owner reports and their exports.
 *
 * `from` / `to` (Y-m-d, either may be left out) override the `period`
 * (weekly / monthly / yearly). Without dates, sales use the period and order /
 * booking reports cover all time, as before. Dates are Manila calendar days.
 */
final class ReportDateRange
{
    private function __construct(
        public readonly ?Carbon $start,
        public readonly ?Carbon $end,
        public readonly bool $custom,
        public readonly string $period,
    ) {}

    public static function fromRequest(Request $request): self
    {
        $request->validate([
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
            'period' => ['nullable', 'in:weekly,monthly,yearly'],
        ]);

        $tz = 'Asia/Manila';
        $from = $request->filled('from') ? Carbon::createFromFormat('Y-m-d', $request->input('from'), $tz)->startOfDay() : null;
        $to = $request->filled('to') ? Carbon::createFromFormat('Y-m-d', $request->input('to'), $tz)->endOfDay() : null;
        if ($from && $to && $from->gt($to)) {
            throw ValidationException::withMessages(['from' => 'Date From cannot be after Date To.']);
        }

        $period = (string) $request->input('period', 'monthly');

        return new self($from?->utc(), $to?->utc(), $from !== null || $to !== null, $period);
    }

    /** Sales: the custom dates, else the period (this week / month / year). */
    public function salesWindow(): array
    {
        if ($this->custom) {
            return ['start' => $this->start, 'end' => $this->end];
        }

        return match ($this->period) {
            'weekly' => ['start' => now()->startOfWeek(), 'end' => now()->endOfWeek()],
            'yearly' => ['start' => now()->startOfYear(), 'end' => now()->endOfYear()],
            default => ['start' => now()->startOfMonth(), 'end' => now()->endOfMonth()],
        };
    }

    /** Limit a query on a date column to [start, end]; either end may be open. */
    public static function apply(Builder $query, string $column, ?Carbon $start, ?Carbon $end): Builder
    {
        if ($start) {
            $query->where($column, '>=', $start);
        }
        if ($end) {
            $query->where($column, '<=', $end);
        }

        return $query;
    }

    /** Order / booking reports: only the custom dates (no dates = all time). */
    public function applyCustom(Builder $query, string $column): Builder
    {
        return $this->custom ? self::apply($query, $column, $this->start, $this->end) : $query;
    }

    /** A label for export file names, e.g. "2026-11-01_to_2026-11-23" or "monthly". */
    public function label(): string
    {
        if (! $this->custom) {
            return $this->period;
        }
        $f = fn (?Carbon $d) => $d ? $d->copy()->timezone('Asia/Manila')->format('Y-m-d') : 'any';

        return $f($this->start).'_to_'.$f($this->end);
    }
}
