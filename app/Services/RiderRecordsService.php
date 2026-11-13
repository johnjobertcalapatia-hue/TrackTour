<?php

namespace App\Services;

use App\Models\Delivery;
use App\Models\Order;
use App\Models\RiderEarning;
use App\Models\RiderPayout;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Collection;

/**
 * Read-only record of one rider for the Tourism Office (Admin > Riders >
 * rider). It only reads authoritative sources and never moves money:
 *
 *  - deliveries: completed deliveries split COD vs online by the order's
 *    payment method (same rule as NearestRiderService::isCodDelivery);
 *  - earnings: rider_earnings rows (delivery fee + tip), never COD cash
 *    (AGENTS.md §5.1);
 *  - cash out online: RiderPayoutService::getAvailableEarnings + payouts;
 *  - the day's COD cash: RiderCashFundService::adminDailyReceipt (office cash
 *    issued / still held, COD cash collected, the rider's own money used for
 *    COD purchases and what is remitted or reimbursed at the end of the day).
 */
class RiderRecordsService
{
    private const COMPLETED = ['completed', 'delivered'];

    private const CLOSED = ['completed', 'delivered', 'cancelled', 'failed'];

    private const COD_METHODS = ['cash', 'cod'];

    public function __construct(
        private RiderPayoutService $payouts,
        private RiderCashFundService $cashFund,
    ) {}

    public function summary(User $officer, User $rider, string $date): array
    {
        $start = CarbonImmutable::createFromFormat('!Y-m-d', $date, 'Asia/Manila')->startOfDay();
        $end = $start->addDay();

        $deliveries = Delivery::query()
            ->where('rider_id', $rider->id)
            ->with(['order', 'groupCheckout'])
            ->orderByDesc('id')
            ->get();

        $completed = $deliveries->filter(fn (Delivery $d) => in_array($this->status($d), self::COMPLETED, true));
        $completedOn = $completed->filter(function (Delivery $d) use ($start, $end) {
            $at = $d->delivered_at ?? $d->updated_at;

            return $at !== null && $at >= $start->utc() && $at < $end->utc();
        });

        $earnings = RiderEarning::query()
            ->where('rider_id', $rider->id)
            ->where('status', 'earned')
            ->with('order:id,payment_method,order_type')
            ->get();
        // Stage 6: every total comes from the permanent earnings ledger
        // (postings, tips and adjustments), never from the write-once rows.
        $entries = \App\Models\RiderEarningEntry::query()->where('rider_id', $rider->id)->where('bucket', 'earned')->get();
        $entriesOn = $entries->filter(fn ($e) => $e->created_at !== null && $e->created_at >= $start->utc() && $e->created_at < $end->utc());
        $ledgerTotals = app(\App\Services\RiderEarningLedger::class)->riderTotals($rider->id);

        $available = $this->payouts->getAvailableEarnings($rider->id);
        $payouts = RiderPayout::query()->where('rider_id', $rider->id)->orderByDesc('id')->get();

        $active = $deliveries->first(fn (Delivery $d) => ! in_array($this->status($d), self::CLOSED, true));
        $activeOrder = $active?->primaryOrder();

        return [
            'date' => $date,
            'rider' => [
                'id' => $rider->id,
                'name' => $rider->name,
                'account_status' => $rider->account_status,
                'rider_status' => $rider->riderDetail?->rider_status ?? 'offline',
                'current_service' => $rider->riderDetail?->current_service,
                'municipality' => $rider->municipality?->name,
                'active_delivery' => $active ? [
                    'delivery_id' => $active->id,
                    'order_number' => $activeOrder?->order_number,
                    'status' => $this->status($active),
                    'payment' => $this->isCod($active) ? 'cod' : 'online',
                ] : null,
            ],
            'deliveries' => [
                'all_time' => $this->counts($completed),
                'on_date' => $this->counts($completedOn),
                'cancelled' => $deliveries->filter(fn (Delivery $d) => $this->status($d) === 'cancelled')->count(),
            ],
            'earnings' => [
                'all_time' => $this->earningTotals($entries),
                'on_date' => $this->earningTotals($entriesOn),
            ],
            'cash_out' => [
                'available' => (float) $available['total'],
                // Reserved in a live cashout / paid out, from the ledger.
                'pending' => $ledgerTotals['open'],
                'paid' => $ledgerTotals['paid'],
                'payouts' => $payouts->take(10)->map(fn (RiderPayout $p) => [
                    'payout_number' => $p->payout_number,
                    'amount' => (float) $p->amount,
                    'status' => $p->status,
                    'requested_at' => $p->requested_at,
                    'paid_at' => $p->paid_at,
                ])->values(),
            ],
            'cod_cash' => $this->codCash($officer, $rider, $date),
            'recent_deliveries' => $deliveries->take(25)->map(fn (Delivery $d) => $this->deliveryRow($d, $earnings))->values(),
        ];
    }

    /** Delivery status as text (the column is cast to the TripStatus enum). */
    private function status(Delivery $delivery): string
    {
        $status = $delivery->status;

        return $status instanceof \BackedEnum ? (string) $status->value : (string) $status;
    }

    private function isCod(Delivery $delivery): bool
    {
        $method = $delivery->primaryOrder()?->payment_method ?? $delivery->groupCheckout?->payment_method;

        return in_array(strtolower((string) $method), self::COD_METHODS, true);
    }

    /** @param Collection<int, Delivery> $deliveries */
    private function counts(Collection $deliveries): array
    {
        $cod = $deliveries->filter(fn (Delivery $d) => $this->isCod($d))->count();

        return [
            'total' => $deliveries->count(),
            'cod' => $cod,
            'online' => $deliveries->count() - $cod,
            'rides' => $deliveries->filter(fn (Delivery $d) => $d->primaryOrder()?->order_type === 'transport')->count(),
        ];
    }

    /** @param Collection<int, RiderEarning> $earnings */
    /**
     * Earnings totals from ledger entries (bucket "earned"): commission
     * postings, tips and adjustments, split by channel.
     *
     * @param  Collection<int, \App\Models\RiderEarningEntry>  $entries
     */
    private function earningTotals(Collection $entries): array
    {
        $sum = fn (Collection $rows) => round((float) $rows->sum(fn ($e) => (float) $e->amount), 2);

        return [
            'total' => $sum($entries),
            'delivery_fee_share' => $sum($entries->where('entry_type', \App\Models\RiderEarningEntry::EARNING_POSTED)),
            'tips' => $sum($entries->where('entry_type', \App\Models\RiderEarningEntry::TIP_POSTED)),
            'adjustments' => $sum($entries->where('entry_type', \App\Models\RiderEarningEntry::ADJUSTMENT)),
            'from_cod' => $sum($entries->where('channel', 'cod')),
            'from_online' => $sum($entries->where('channel', 'online')),
        ];
    }

    /**
     * The day's COD cash, straight from the daily receipt. Null (with the
     * reason) when this Tourism Office account may not see the rider's cash,
     * e.g. the rider has no municipality or belongs to another one.
     */
    private function codCash(User $officer, User $rider, string $date): array
    {
        try {
            $receipt = $this->cashFund->adminDailyReceipt($officer, $rider, $date);
        } catch (AuthorizationException $e) {
            return ['available' => false, 'reason' => $e->getMessage()];
        }

        $t = $receipt['totals'];

        return [
            'available' => true,
            'receipt_status' => $receipt['receipt_status'],
            'policy_status' => $receipt['policy_status'],
            'cod_deliveries' => $t['eligible_delivery_count'],
            'office_cash_issued' => $t['tourism_office_cash_issued_to_date'],
            'office_cash_used' => $t['tourism_office_cash_used_to_date'],
            'office_cash_returned' => $t['tourism_office_cash_returned_to_date'],
            'office_cash_with_rider' => $t['unreturned_tourism_office_cash_balance'],
            'cod_cash_collected' => $t['cash_collected'],
            'rider_own_money_used' => $t['verified_personal_purchase_reimbursement'],
            'delivery_fee_earned' => $t['rider_delivery_fee_entitlement'],
            'tips_earned' => $t['rider_tip_entitlement'],
            'net_cod_remittance' => $t['net_cod_remittance_expected'],
            'payable_to_rider' => $t['additional_rider_payable'],
        ];
    }

    /** @param Collection<int, RiderEarning> $earnings */
    private function deliveryRow(Delivery $delivery, Collection $earnings): array
    {
        $order = $delivery->primaryOrder();
        $orderIds = $delivery->isGroup()
            ? $delivery->childOrders()->pluck('id')->all()
            : array_filter([$delivery->order_id]);
        $earned = $earnings->whereIn('order_id', $orderIds);
        $cod = $this->isCod($delivery);

        return [
            'delivery_id' => $delivery->id,
            'order_number' => $order?->order_number,
            'type' => $order?->order_type === 'transport' ? 'ride' : 'food',
            'payment' => $cod ? 'cod' : 'online',
            'status' => $this->status($delivery),
            'completed_at' => $delivery->delivered_at,
            'created_at' => $delivery->created_at,
            'order_total' => $order instanceof Order ? (float) $order->total : null,
            'cod_cash_due' => $cod ? (float) $delivery->cash_due : null,
            // Stage 5: from the permanent earnings ledger (adjustments included).
            'earning' => round((float) $earned->sum(fn (RiderEarning $e) => app(\App\Services\RiderEarningLedger::class)->earned($e->id)), 2),
            'earning_ids' => $earned->pluck('id')->values()->all(),
        ];
    }
}
