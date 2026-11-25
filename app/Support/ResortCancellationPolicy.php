<?php

namespace App\Support;

use App\Models\Business;
use Carbon\CarbonImmutable;

/**
 * A resort's cancellation policy (reservations Stage 7, docs/resort-reservation-architecture.md §11):
 * free cancellation until N days before check-in, then a penalty % is kept.
 *
 * The resort sets both inside the Tourism Office's limits. Stage 7 uses the
 * agreed starting defaults and limits below; Stage 9 moves them to the Tourism
 * Office settings (district default + town override + Bansud limits).
 *
 * The policy in force is snapshotted on each reservation and shown to the
 * tourist before booking. For a pay-at-the-resort reservation nothing was paid,
 * so cancelling costs nothing; refunds of GCash payments (Stage 8) use the
 * snapshot.
 */
final class ResortCancellationPolicy
{
    public const DEFAULT_FREE_DAYS = 3;

    public const DEFAULT_PENALTY_PERCENT = 50;

    /** @return array{free_days: array{min: int, max: int}, penalty_percent: array{min: int, max: int}} */
    public static function limits(): array
    {
        return [
            'free_days' => ['min' => 0, 'max' => 14],
            'penalty_percent' => ['min' => 0, 'max' => 100],
        ];
    }

    /** @return array{free_days: int, penalty_percent: int} */
    public static function forBusiness(Business $business): array
    {
        $setting = $business->resortSetting;

        return [
            'free_days' => (int) ($setting?->cancellation_free_days ?? self::DEFAULT_FREE_DAYS),
            'penalty_percent' => (int) ($setting?->cancellation_penalty_percent ?? self::DEFAULT_PENALTY_PERCENT),
        ];
    }

    /** What is stored on a reservation. */
    public static function snapshot(Business $business): array
    {
        $policy = self::forBusiness($business);

        return $policy + ['summary' => self::describe($policy)];
    }

    /** Last day a cancellation is free, for a check-in date (Y-m-d). */
    public static function freeUntil(array $policy, string $checkIn): string
    {
        return CarbonImmutable::parse($checkIn)->subDays((int) $policy['free_days'])->toDateString();
    }

    /** % of what was paid that goes back to the tourist when they cancel on $today. */
    public static function refundPercent(array $policy, string $checkIn, string $today): int
    {
        return $today <= self::freeUntil($policy, $checkIn) ? 100 : 100 - (int) $policy['penalty_percent'];
    }

    public static function describe(array $policy): string
    {
        $days = (int) $policy['free_days'];
        $penalty = (int) $policy['penalty_percent'];
        // Tourists cancel only before the check-in date, so 0 days means always free.
        if ($penalty === 0 || $days === 0) {
            return 'Free cancellation any time before check-in.';
        }

        return "Free cancellation until {$days} day".($days === 1 ? '' : 's').' before check-in; after that, '.$penalty.'% of what you paid online is kept by the resort.';
    }
}
