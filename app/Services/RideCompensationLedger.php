<?php

namespace App\Services;

use App\Models\RiderCancellationCompensation;
use App\Models\RiderCompensationEntry;
use Illuminate\Database\UniqueConstraintViolationException;

/**
 * Stage D1: the append-only compensation ledger (rider_compensation_entries;
 * DB triggers refuse UPDATE/DELETE). Every write carries an idempotency key:
 * writing the same key twice returns the first entry and records nothing.
 *
 * Buckets: earned (± the rider's entitlement), reserved / paid (D2 payouts),
 * office (advance recovered, write-off: records that do not move the
 * rider's balance).
 */
class RideCompensationLedger
{
    public function write(RiderCancellationCompensation $c, string $type, string $bucket, float $amount, string $key, ?int $actorId = null, ?string $reason = null, array $details = [], ?int $payoutId = null): RiderCompensationEntry
    {
        $existing = RiderCompensationEntry::where('idempotency_key', $key)->first();
        if ($existing) {
            return $existing;
        }
        try {
            return RiderCompensationEntry::create([
                'compensation_id' => $c->id,
                'rider_id' => $c->rider_id,
                'penalty_id' => $c->penalty_id,
                'payout_id' => $payoutId,
                'entry_type' => $type,
                'bucket' => $bucket,
                'amount' => round($amount, 2),
                'reason' => $reason,
                'details' => $details ?: null,
                'actor_id' => $actorId,
                'idempotency_key' => $key,
                'created_at' => now(),
            ]);
        } catch (UniqueConstraintViolationException) {
            return RiderCompensationEntry::where('idempotency_key', $key)->firstOrFail();
        }
    }

    /** The rider's net entitlement from one compensation (earned bucket). */
    public function earned(int $compensationId): float
    {
        return round((float) RiderCompensationEntry::where('compensation_id', $compensationId)->where('bucket', 'earned')->sum('amount'), 2);
    }

    /** @return array{earned: float, reserved: float, paid: float} */
    public function riderTotals(int $riderId): array
    {
        $sums = RiderCompensationEntry::where('rider_id', $riderId)
            ->selectRaw('bucket, SUM(amount) as total')->groupBy('bucket')->pluck('total', 'bucket');

        return [
            'earned' => round((float) ($sums['earned'] ?? 0), 2),
            'reserved' => round((float) ($sums['reserved'] ?? 0), 2),
            'paid' => round((float) ($sums['paid'] ?? 0), 2),
        ];
    }
}
