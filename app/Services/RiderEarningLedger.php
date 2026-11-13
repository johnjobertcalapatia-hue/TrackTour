<?php

namespace App\Services;

use App\Exceptions\PayoutConflictException;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\RiderEarning;
use App\Models\RiderEarningEntry;
use App\Models\RiderPayout;
use App\Models\User;
use App\Services\Integrity\TransactionLedger;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Shared rider financial ledger (Stage 5). The only writer of
 * rider_earning_entries. Every write is idempotent (UNIQUE idempotency_key:
 * a repeat returns the existing entry) and never edits an existing entry.
 *
 * Balances are always derived from entries, per earning:
 *   earned    = Σ earned-bucket entries (commission + tip ± adjustments)
 *   reserved  = Σ reserved-bucket entries (reserved − released)
 *   paid      = Σ paid-bucket entries
 *   open      = reserved − paid          (in a live cashout, not yet paid)
 *   available = earned − open − paid     (what can still be cashed out)
 *
 * COD / cash earnings are posted with channel "cod": recorded for the rider's
 * history, never part of the online cashout balance.
 */
class RiderEarningLedger
{
    /** Post the commission and tip entries for a newly recorded earning (once). */
    public function postEarning(RiderEarning $earning, bool $backfill = false): void
    {
        $order = Order::withTrashed()->find($earning->order_id);
        $delivery = $order ? (Delivery::where('order_id', $order->id)->first()
            ?? ($order->group_order_id ? Delivery::where('group_checkout_id', $order->group_order_id)->first() : null)) : null;
        $tip = round((float) $earning->rider_tip, 2);
        $commission = round((float) $earning->total_earning - $tip, 2);
        $base = [
            'rider_id' => (int) $earning->rider_id,
            'rider_earning_id' => $earning->id,
            'order_id' => $earning->order_id,
            'delivery_id' => $delivery?->id,
            'bucket' => 'earned',
            'service' => self::service($order),
            'channel' => self::channel($order),
        ];

        $this->write($base + [
            'entry_type' => RiderEarningEntry::EARNING_POSTED,
            'amount' => $commission,
            'details' => array_filter([
                'commission_rule' => self::ruleFor($order, $commission, (float) $earning->delivery_fee),
                'delivery_fee_charged' => TransactionLedger::money($earning->delivery_fee),
                'rider_commission' => TransactionLedger::money($commission),
                'order_number' => $order?->order_number,
                'backfilled' => $backfill ?: null,
            ], fn ($v) => $v !== null),
        ], "earning:{$earning->id}:commission");

        if ($tip > 0) {
            $this->write($base + [
                'entry_type' => RiderEarningEntry::TIP_POSTED,
                'amount' => $tip,
                'details' => ['order_number' => $order?->order_number],
            ], "earning:{$earning->id}:tip");
        }
    }

    /**
     * A compensating adjustment (±) to an earning by Tourism Office staff, or
     * by the system when a completed delivery is recalculated. Never edits an
     * existing entry. Refuses while the earning sits in a live cashout.
     */
    public function adjust(RiderEarning $earning, float $amount, string $reason, ?User $actor, ?User $approver = null, ?string $key = null, array $details = []): RiderEarningEntry
    {
        $amount = round($amount, 2);
        if ($amount == 0.0) {
            throw new PayoutConflictException('An adjustment must change the amount.');
        }
        if (trim($reason) === '') {
            throw new PayoutConflictException('A reason is required for an adjustment.');
        }

        return DB::transaction(function () use ($earning, $amount, $reason, $actor, $approver, $key, $details) {
            $locked = RiderEarning::whereKey($earning->id)->lockForUpdate()->firstOrFail();
            if ($locked->payouts()->whereIn('status', RiderPayout::LIVE_STATUSES)->exists()) {
                throw new PayoutConflictException('This earning is in a cashout request being processed. Resolve the request first.');
            }
            $order = Order::withTrashed()->find($locked->order_id);
            if (round($this->earned($locked->id) + $amount, 2) < 0) {
                throw new PayoutConflictException('An adjustment cannot make an earning negative.');
            }

            return $this->write([
                'rider_id' => (int) $locked->rider_id,
                'rider_earning_id' => $locked->id,
                'order_id' => $locked->order_id,
                'entry_type' => RiderEarningEntry::ADJUSTMENT,
                'bucket' => 'earned',
                'amount' => $amount,
                'service' => self::service($order),
                'channel' => self::channel($order),
                'reason' => mb_substr($reason, 0, 500),
                'details' => $details ?: null,
                'approved_by' => $approver?->id,
            ], $key ?? 'adjust:'.Str::uuid(), $actor);
        });
    }

    /** Reserve every earning of a new cashout request at its available amount. */
    public function reserve(RiderPayout $payout, Collection $earnings): void
    {
        foreach ($earnings as $earning) {
            $this->write($this->payoutBase($payout, $earning) + [
                'entry_type' => RiderEarningEntry::CASHOUT_RESERVED,
                'bucket' => 'reserved',
                'amount' => $this->available($earning->id),
            ], "payout:{$payout->id}:reserve:{$earning->id}");
        }
    }

    /** Release a rejected / failed / cancelled request's reservations. */
    public function release(RiderPayout $payout, Collection $earnings, string $reason): void
    {
        foreach ($earnings as $earning) {
            $held = $this->reservedBy($payout->id, $earning->id);
            if ($held <= 0) {
                continue;
            }
            $this->write($this->payoutBase($payout, $earning) + [
                'entry_type' => RiderEarningEntry::RESERVATION_RELEASED,
                'bucket' => 'reserved',
                'amount' => -$held,
                'reason' => $reason,
            ], "payout:{$payout->id}:release:{$earning->id}");
        }
    }

    /** The transfer is confirmed: the reserved amounts become paid out. */
    public function complete(RiderPayout $payout, Collection $earnings): void
    {
        foreach ($earnings as $earning) {
            $held = $this->reservedBy($payout->id, $earning->id);
            if ($held <= 0) {
                continue;
            }
            $this->write($this->payoutBase($payout, $earning) + [
                'entry_type' => RiderEarningEntry::PAYOUT_COMPLETED,
                'bucket' => 'paid',
                'amount' => $held,
                'details' => ['payment_reference' => $payout->payment_reference],
            ], "payout:{$payout->id}:paid:{$earning->id}");
        }
    }

    // ---------------- balances ----------------

    /**
     * Net earned for one earning, from its ledger entries only (Stage 6: no
     * fallback to the write-once row — an earning not yet posted counts as
     * ₱0 and cannot be cashed out until it is recorded).
     */
    public function earned(int $earningId): float
    {
        return round((float) RiderEarningEntry::where('rider_earning_id', $earningId)->where('bucket', 'earned')->sum('amount'), 2);
    }

    public function isPosted(int $earningId): bool
    {
        return RiderEarningEntry::where('rider_earning_id', $earningId)->where('entry_type', RiderEarningEntry::EARNING_POSTED)->exists();
    }

    public function paid(int $earningId): float
    {
        return round((float) RiderEarningEntry::where('rider_earning_id', $earningId)->where('bucket', 'paid')->sum('amount'), 2);
    }

    /** Reserved and not yet paid (live cashout). */
    public function open(int $earningId): float
    {
        $reserved = (float) RiderEarningEntry::where('rider_earning_id', $earningId)->where('bucket', 'reserved')->sum('amount');

        return round($reserved - $this->paid($earningId), 2);
    }

    public function available(int $earningId): float
    {
        return round($this->earned($earningId) - $this->open($earningId) - $this->paid($earningId), 2);
    }

    /** Σ of the rider's online earnings by state (COD excluded). */
    public function riderTotals(int $riderId): array
    {
        $sum = fn (string $bucket) => round((float) RiderEarningEntry::where('rider_id', $riderId)->where('channel', 'online')->where('bucket', $bucket)->sum('amount'), 2);
        $earned = $sum('earned');
        $paid = $sum('paid');
        $open = round($sum('reserved') - $paid, 2);

        return ['earned' => $earned, 'open' => $open, 'paid' => $paid, 'available' => round($earned - $open - $paid, 2)];
    }

    /** @return Collection<int, RiderEarningEntry> */
    public function entriesFor(int $earningId): Collection
    {
        return RiderEarningEntry::where('rider_earning_id', $earningId)->orderBy('id')->get();
    }

    // ---------------- internals ----------------

    private function reservedBy(int $payoutId, int $earningId): float
    {
        $reserved = (float) RiderEarningEntry::where('rider_payout_id', $payoutId)->where('rider_earning_id', $earningId)->where('bucket', 'reserved')->sum('amount');
        $paid = (float) RiderEarningEntry::where('rider_payout_id', $payoutId)->where('rider_earning_id', $earningId)->where('bucket', 'paid')->sum('amount');

        return round($reserved - $paid, 2);
    }

    private function payoutBase(RiderPayout $payout, RiderEarning $earning): array
    {
        $order = Order::withTrashed()->find($earning->order_id);

        return [
            'rider_id' => (int) $earning->rider_id,
            'rider_earning_id' => $earning->id,
            'order_id' => $earning->order_id,
            'rider_payout_id' => $payout->id,
            'service' => self::service($order),
            'channel' => self::channel($order),
            'details' => ['payout_number' => $payout->payout_number],
        ];
    }

    private function write(array $attributes, string $key, ?User $actor = null): RiderEarningEntry
    {
        $existing = RiderEarningEntry::where('idempotency_key', $key)->first();
        if ($existing) {
            return $existing;
        }
        $actor ??= auth()->user();

        try {
            return DB::transaction(fn () => RiderEarningEntry::create($attributes + [
                'actor_id' => $actor?->id,
                'actor_role' => $actor?->role ?? 'system',
                'idempotency_key' => $key,
            ]));
        } catch (UniqueConstraintViolationException) {
            return RiderEarningEntry::where('idempotency_key', $key)->firstOrFail();
        }
    }

    public static function service(?Order $order): ?string
    {
        if ($order === null) {
            return null;
        }

        return $order->order_type === 'transport' ? 'ride' : 'food';
    }

    public static function channel(?Order $order): ?string
    {
        if ($order === null) {
            return null;
        }

        return in_array(strtolower((string) $order->payment_method), ['cash', 'cod'], true) ? 'cod' : 'online';
    }

    /** The rule that actually produced this commission (historical ₱40 food earnings say so). */
    public static function ruleFor(?Order $order, float $commission, float $deliveryFee): ?string
    {
        if (self::service($order) === 'food' && round($commission, 2) !== round($deliveryFee, 2)) {
            return sprintf('fixed on the delivery: ₱%s (rule before 2026-11-11: flat ₱40)', number_format($commission, 2));
        }

        return self::commissionRule($order);
    }

    public static function commissionRule(?Order $order): ?string
    {
        return match (self::service($order)) {
            'ride' => 'max(₱20, 40% of fare)',
            'food' => 'full delivery fee (before any delivery-fee promotion)',
            default => null,
        };
    }
}
