<?php

namespace App\Services;

use App\Models\RiderCancellationCompensation as Comp;
use App\Models\RiderCompensationEntry;
use App\Models\RiderEarningEntry;
use App\Models\User;

/**
 * Stage D2 (§P.6): a rider's earnings statement, read only from the two
 * append-only ledgers (rider_earning_entries; rider_compensation_entries).
 * Normal earnings and cancellation compensation are separate lines and are
 * never counted twice (compensation is never a rider_earnings row).
 *
 *   ride / delivery earnings  online earnings by service (earned bucket)
 *   cash kept                 cash / COD earnings the rider kept from what
 *                             they collected (not paid out online)
 *   adjustments               staff / system adjustments (online)
 *   cancellation compensation earned net of voids (by cancelled booking)
 *   total payable, previously paid, remaining balance — online only
 */
class RiderStatementService
{
    public function __construct(
        private readonly RideCompensationLedger $compLedger,
        private readonly PayoutStatementService $statements,
        private readonly RiderPayoutService $payouts,
    ) {}

    public function for(User $rider): array
    {
        $online = fn (string $bucket, ?string $service = null, ?array $types = null) => round((float) RiderEarningEntry::where('rider_id', $rider->id)
            ->where('channel', 'online')->where('bucket', $bucket)
            ->when($service, fn ($q) => $q->where('service', $service))
            ->when($types, fn ($q) => $q->whereIn('entry_type', $types))
            ->sum('amount'), 2);

        $posted = [RiderEarningEntry::EARNING_POSTED, RiderEarningEntry::TIP_POSTED];
        $ride = $online('earned', 'ride', $posted);
        $delivery = $online('earned', 'food', $posted);
        $adjustments = $online('earned', null, [RiderEarningEntry::ADJUSTMENT]);
        $earningsPaid = $online('paid');
        $cashKept = round((float) RiderEarningEntry::where('rider_id', $rider->id)->where('channel', 'cod')->where('bucket', 'earned')->sum('amount'), 2);

        $comp = $this->compLedger->riderTotals($rider->id);
        $compPaid = $comp['paid'];
        $compEarned = $comp['earned'];

        $earningsEarned = round($ride + $delivery + $adjustments, 2);
        $totalEarned = round($earningsEarned + $compEarned, 2);
        $paid = round($earningsPaid + $compPaid, 2);

        $payableEarnings = round((float) $this->payouts->getAvailableEarnings($rider->id)['total'], 2);
        $payableComp = round((float) $this->statements->payableCompensation($rider->id)->sum('amount'), 2);

        return [
            'rider' => ['id' => $rider->id, 'name' => $rider->name],
            'lines' => [
                'ride_earnings' => $ride,
                'delivery_earnings' => $delivery,
                'cancellation_compensation' => $compEarned,
                'adjustments' => $adjustments,
            ],
            'cash_kept' => $cashKept,
            'total_earned' => $totalEarned,
            'total_payable_now' => round($payableEarnings + $payableComp, 2),
            'payable_now' => ['earnings' => $payableEarnings, 'cancellation_compensation' => $payableComp],
            'previously_paid' => $paid,
            'paid' => ['earnings' => $earningsPaid, 'cancellation_compensation' => $compPaid],
            'remaining_balance' => round($totalEarned - $paid, 2),
            'compensations' => Comp::with('cancelledOrder:id,order_number', 'penalty:id,status,collection_method,received_at')
                ->where('rider_id', $rider->id)->latest('id')->limit(100)->get()
                ->map(fn (Comp $c) => $c->present() + [
                    'penalty_status' => $c->penalty?->status,
                    'collection_method' => $c->penalty?->collection_method,
                    'received_at' => $c->penalty?->received_at?->toIso8601String(),
                    'ledger_earned' => $this->compLedger->earned($c->id),
                    'paid_amount' => round((float) RiderCompensationEntry::where('compensation_id', $c->id)->where('bucket', 'paid')->sum('amount'), 2),
                ])->values(),
        ];
    }
}
