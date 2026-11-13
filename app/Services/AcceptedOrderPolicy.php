<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\Order;
use App\Models\Payment;
use App\Services\Integrity\TransactionLedger;

/**
 * Product-owner rule (2026-11-11): once a rider has accepted the delivery,
 * the order must be fulfilled.
 *
 *   - a restaurant may not reject or cancel the order or a dish (422);
 *   - the 60-minute auto-cancel never applies (the late order is flagged);
 *   - no refund is issued (every refund path is refused at the refund layer).
 *
 * Each refused attempt is escalated to the Tourism Office: an activity-log
 * entry plus an "escalation" event in the order's transaction history, which
 * the integrity check reports as a FLAG for investigation. Before acceptance
 * the existing rejection / refund rules (and D5) apply unchanged.
 *
 * "Accepted" is the canonical P11.2 check, Order::hasAcceptedRider().
 */
class AcceptedOrderPolicy
{
    public function riderAccepted(Order $order): bool
    {
        return $order->hasAcceptedRider();
    }

    /** The accepted order that blocks refunding this payment, if any. */
    public function refundBlockingOrder(Payment $payment, ?Order $forOrder = null): ?Order
    {
        $orders = $forOrder ? collect([$forOrder]) : TransactionLedger::ordersForPayment($payment);

        return $orders->first(fn (Order $o) => $this->riderAccepted($o));
    }

    public function escalate(Order $order, string $action, string $message, array $context = [], string $type = ActivityLog::TYPE_ADMIN): void
    {
        ActivityLog::record("escalation.{$action}", $message, $order, $type);
        app(TransactionLedger::class)->record($order, 'escalation', [
            'action' => $action,
            'message' => $message,
        ] + $context, $order);
    }
}
