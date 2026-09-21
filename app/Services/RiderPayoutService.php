<?php

namespace App\Services;

use App\Exceptions\PayoutConflictException;
use App\Models\RiderEarning;
use App\Models\RiderPayout;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

class RiderPayoutService
{
    public const LOCKING_STATUSES = [
        RiderPayout::STATUS_PENDING,
        RiderPayout::STATUS_APPROVED,
        RiderPayout::STATUS_PAID,
    ];

    public const RELEASING_STATUSES = [
        RiderPayout::STATUS_REJECTED,
        RiderPayout::STATUS_CANCELLED,
    ];

    /**
     * Earnings currently available to a rider = earned earnings NOT yet locked
     * into a payout. Locked = linked to a payout whose status is pending /
     * approved / paid. Rejected & cancelled payouts release their earnings.
     *
     * A rider can never double-draw: the pivot unique key is the idempotency
     * barrier, and this query only exposes unlocked earnings for new requests.
     */
    public function getAvailableEarnings(int $riderId): array
    {
        $earnings = RiderEarning::query()
            ->where('rider_id', $riderId)
            ->where('status', 'earned')
            ->whereDoesntHave('payouts', fn (Builder $q) => $q->whereIn('status', self::LOCKING_STATUSES))
            ->orderBy('earned_at')
            ->get();

        return [
            'earnings' => $earnings,
            'total' => round($earnings->sum(fn (RiderEarning $e) => (float) ($e->total_earning ?? $e->rider_tip ?? 0)), 2),
            'payable' => $earnings->isNotEmpty(),
        ];
    }

    /**
     * Rider-initiated payout request. Atomically locks the currently-available
     * earnings via the pivot — the UNIQUE(rider_earning_id) key is the
     * idempotency barrier, so retries can never double-book an earning.
     *
     * Two concurrent requests from the same rider are serialized on the rider
     * row (lockForUpdate) and re-checked inside the lock, so they can never
     * both read the same available earnings. While a payout is still live
     * (pending/approved) further requests return a clean 409 Conflict; the
     * UNIQUE active_payout_key index is the DB backstop for that rule. The
     * pivot UNIQUE violation is translated from a raw 500 into a 409 as well.
     *
     * Both COD-sourced and prepaid-sourced earnings are equally drawable here.
     * The rider's credit wallet (rider_credits) is a SEPARATE financing ledger
     * and is never touched by a payout.
     */
    public function requestPayout(User $rider): RiderPayout
    {
        try {
            return DB::transaction(function () use ($rider) {
                // Serialize concurrent requests for the same rider on the rider row.
                $lockedRider = User::where('id', $rider->id)->lockForUpdate()->first();
                if (! $lockedRider) {
                    throw new PayoutConflictException('Rider not found.');
                }

                // One live payout per rider: reject while one is still in flight.
                $liveExists = RiderPayout::where('rider_id', $rider->id)
                    ->whereIn('status', RiderPayout::LIVE_STATUSES)
                    ->exists();

                if ($liveExists) {
                    throw new PayoutConflictException('You already have a payout request being processed.');
                }

                $available = $this->getAvailableEarnings($rider->id);

                if ($available['earnings']->isEmpty()) {
                    throw new PayoutConflictException('You have no available earnings to withdraw right now.');
                }

                $payoutNumber = 'PYT-' . now()->format('Ymd') . '-' . strtoupper(Str::random(8));

                $payout = RiderPayout::create([
                    'rider_id' => $rider->id,
                    'payout_number' => $payoutNumber,
                    'amount' => $available['total'],
                    'status' => RiderPayout::STATUS_PENDING,
                    'active_payout_key' => $rider->id,
                    'requested_at' => now(),
                ]);

                $payout->earnings()->syncWithoutDetaching(
                    $available['earnings']->pluck('id')->mapWithKeys(fn ($id) => [$id => ['created_at' => now(), 'updated_at' => now()]])
                );

                return $payout->fresh()->load('earnings');
            });
        } catch (UniqueConstraintViolationException $e) {
            // DB backstop hit (one-live-payout index or pivot unique): surface as a
            // clean 409 instead of a raw 500.
            throw new PayoutConflictException('You already have a payout request being processed.', previous: $e);
        }
    }

    /**
     * Admin approves a pending payout (locks the linked earnings).
     */
    public function approve(RiderPayout $payout, User $admin, ?string $note = null): RiderPayout
    {
        if ($payout->status !== RiderPayout::STATUS_PENDING) {
            throw new PayoutConflictException('Only a pending payout can be approved.');
        }

        $payout->update([
            'status' => RiderPayout::STATUS_APPROVED,
            'reviewed_by' => $admin->id,
            'reviewed_at' => now(),
            'review_note' => $note,
        ]);

        return $payout->fresh()->load('earnings');
    }

    /**
     * Admin rejects a payout → linked earnings are released back to available.
     */
    public function reject(RiderPayout $payout, User $admin, ?string $note = null): RiderPayout
    {
        if (! in_array($payout->status, [RiderPayout::STATUS_PENDING, RiderPayout::STATUS_APPROVED], true)) {
            throw new PayoutConflictException('This payout cannot be rejected in its current state.');
        }

        DB::transaction(function () use ($payout, $admin, $note) {
            $payout->earnings()->detach(); // earnings become available again
            $payout->update([
                'status' => RiderPayout::STATUS_REJECTED,
                'active_payout_key' => null,
                'reviewed_by' => $admin->id,
                'reviewed_at' => now(),
                'review_note' => $note,
            ]);
        });

        return $payout->fresh();
    }

    /**
     * Admin confirms the payout was paid out to the rider. Earnings stay locked
     * forever (can never be drawn again).
     */
    public function markPaid(RiderPayout $payout, User $admin, ?string $note = null): RiderPayout
    {
        if (! in_array($payout->status, [RiderPayout::STATUS_APPROVED, RiderPayout::STATUS_PENDING], true)) {
            throw new PayoutConflictException('This payout cannot be marked paid in its current state.');
        }

        $payout->update([
            'status' => RiderPayout::STATUS_PAID,
            'active_payout_key' => null,
            'reviewed_by' => $admin->id,
            'reviewed_at' => now(),
            'review_note' => $note,
            'paid_at' => now(),
        ]);

        return $payout->fresh()->load('earnings');
    }

    /**
     * Rider cancels a payout before it is paid → earnings released.
     */
    public function cancel(RiderPayout $payout): RiderPayout
    {
        if (! in_array($payout->status, [RiderPayout::STATUS_PENDING, RiderPayout::STATUS_APPROVED], true)) {
            throw new PayoutConflictException('This payout can no longer be cancelled.');
        }

        DB::transaction(function () use ($payout) {
            $payout->earnings()->detach();
            $payout->update([
                'status' => RiderPayout::STATUS_CANCELLED,
                'active_payout_key' => null,
                'reviewed_at' => now(),
            ]);
        });

        return $payout->fresh();
    }
}
