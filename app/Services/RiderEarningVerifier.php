<?php

namespace App\Services;

use App\Models\Delivery;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderEarning;

/**
 * Traces one rider earning to its source records (decision 2026-11-11:
 * "No verified transaction, no rider earnings. No verified earnings, no
 * cashout."). Every check is read from authoritative server records:
 *
 *   - the earning: server-created, status earned, positive amount
 *   - the order (food order or ride booking) and its customer
 *   - paid ONLINE: a provider-confirmed (PayMongo) paid payment, not refunded.
 *     Cash / COD earnings are never cashed out online: the rider keeps them
 *     from the cash collected (no double payment).
 *   - the delivery / trip: assigned to this rider and completed
 *   - not already in another cashout (DB: UNIQUE pivot per earning)
 */
class RiderEarningVerifier
{
    private const CASH_METHODS = ['cash', 'cod'];

    private const CLOSED_ORDER = ['cancelled', 'cancelled_by_tourist', 'rejected', 'refunded'];

    /**
     * @return array{ok: bool, checks: array<int, array{key: string, label: string, ok: bool, detail: ?string}>, source: array}
     */
    public function verify(RiderEarning $earning, ?int $ignorePayoutId = null): array
    {
        $order = $earning->order;
        $delivery = $order ? $this->deliveryFor($order) : null;
        $payment = $order ? $this->paidPayment($order) : null;
        $isRide = $order?->order_type === 'transport';
        $isCash = in_array(strtolower((string) $order?->payment_method), self::CASH_METHODS, true);

        $otherPayout = $earning->payouts()
            ->when($ignorePayoutId !== null, fn ($q) => $q->where('rider_payouts.id', '!=', $ignorePayoutId))
            ->whereIn('status', RiderPayoutService::LOCKING_STATUSES)
            ->first();

        $checks = [
            $this->check('earning', 'Server-recorded earning', $earning->status === 'earned' && (float) $earning->total_earning > 0,
                $earning->status !== 'earned' ? "Earning status is {$earning->status}." : null),
            $this->check('order', $isRide ? 'Genuine ride booking and passenger' : 'Genuine order and customer',
                $order !== null && ! in_array($order->status, self::CLOSED_ORDER, true) && filled($order->customer_email ?? $order->user_id),
                $order === null ? 'Order not found.' : (in_array($order->status, self::CLOSED_ORDER, true) ? "Order is {$order->status}." : null)),
            $this->check('online', 'Paid online (not cash / COD)', $order !== null && ! $isCash,
                $isCash ? 'Cash earnings are kept from the cash collected; they are not cashed out online.' : null),
            $this->check('payment', 'Payment confirmed by the provider and not refunded',
                $payment !== null && $payment->refunded_at === null && in_array($order?->payment_status, ['paid'], true),
                $payment === null ? 'No provider-confirmed paid payment.' : ($payment->refunded_at ? 'The payment was refunded.' : null)),
            $this->check('assigned', 'Assigned to this rider', $delivery !== null && (int) $delivery->rider_id === (int) $earning->rider_id,
                $delivery === null ? 'No delivery / trip found.' : null),
            $this->check('completed', $isRide ? 'Trip completed' : 'Delivery completed',
                $delivery !== null && in_array($this->status($delivery), ['completed', 'delivered'], true) && $delivery->delivered_at !== null,
                $delivery !== null ? 'Status: '.$this->status($delivery).'.' : null),
            $this->check('unpaid', 'Not in another cashout', $otherPayout === null,
                $otherPayout ? "Already in {$otherPayout->payout_number} ({$otherPayout->status})." : null),
        ];

        return [
            'ok' => collect($checks)->every(fn ($c) => $c['ok']),
            'checks' => $checks,
            'source' => [
                'earning_id' => $earning->id,
                'type' => $isRide ? 'ride' : 'food',
                'reference' => $order?->order_number,
                'order_id' => $order?->id,
                'customer_name' => $order?->customer_name,
                'restaurant' => $isRide ? null : ($order?->business?->business_name),
                'payment_method' => $order?->payment_method,
                // What the customer was charged vs what the provider confirmed.
                'customer_paid' => $order !== null ? round((float) $order->total, 2) : null,
                'gateway_amount' => $payment !== null ? round((float) $payment->amount, 2) : null,
                'payment_reference' => $payment?->provider_payment_id ?? $payment?->payment_number,
                'payment_provider' => $payment?->provider,
                'paid_at' => $payment?->paid_at,
                'delivery_id' => $delivery?->id,
                'completed_at' => $delivery?->delivered_at,
                'delivery_fee_share' => round((float) $earning->total_earning - (float) $earning->rider_tip, 2),
                'tip' => round((float) $earning->rider_tip, 2),
                'amount' => app(RiderEarningLedger::class)->earned($earning->id),
                'earned_at' => $earning->earned_at,
            ],
        ];
    }

    /** True when the earning may be cashed out right now (every check passes). */
    public function eligible(RiderEarning $earning): bool
    {
        return $this->verify($earning)['ok'];
    }

    private function deliveryFor(Order $order): ?Delivery
    {
        return Delivery::where('order_id', $order->id)->first()
            ?? ($order->group_order_id ? Delivery::where('group_checkout_id', $order->group_order_id)->first() : null);
    }

    private function paidPayment(Order $order): ?Payment
    {
        $direct = Payment::where('payable_type', Order::class)->where('payable_id', $order->id)
            ->where('status', 'paid')->whereNotNull('paid_at')->latest('id')->first();
        if ($direct || ! $order->group_order_id) {
            return $direct;
        }

        return Payment::where('payable_type', \App\Models\GroupCheckout::class)->where('payable_id', $order->group_order_id)
            ->where('status', 'paid')->whereNotNull('paid_at')->latest('id')->first();
    }

    private function status(Delivery $delivery): string
    {
        $s = $delivery->status;

        return $s instanceof \BackedEnum ? (string) $s->value : (string) $s;
    }

    private function check(string $key, string $label, bool $ok, ?string $detail): array
    {
        return ['key' => $key, 'label' => $label, 'ok' => $ok, 'detail' => $ok ? null : $detail];
    }
}
