<?php

namespace App\Services;

use App\Models\GroupCheckout;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;

class OrderRefundService
{
    /**
     * Refund a paid Order that is being rejected or cancelled.
     *
     * Provider-authoritative (P11.3): the order is only ever marked refunded
     * after PayMongo confirms the refund succeeded. A provider failure leaves
     * the order refund_status 'failed' (retryable) and a pending refund stays
     * 'pending' until the webhook/reconciliation settles it. No-ops (and does
     * not mark the order refunded) when no payable Payment exists.
     */
    public function refundPaidOrder(Order $order, string $reason): void
    {
        $payment = Payment::where('payable_type', Order::class)
            ->where('payable_id', $order->id)
            ->whereIn('status', ['authorized', 'paid', 'pending_refund'])
            ->latest('id')
            ->first();

        // No Order-level payment (e.g. grouped orders are paid at group level):
        // do not mark refunded since nothing was refunded.
        if (! $payment) {
            return;
        }

        // Already in flight with the provider — the refund webhook or the
        // reconciliation command finalizes it. Never mark refunded locally.
        if ($payment->status === 'pending_refund') {
            return;
        }

        app(PaymentRefundProcessor::class)->initiateRefund(
            payment: $payment,
            amount: (float) $payment->amount,
            reason: $reason,
            forOrder: $order,
            userId: $order->user_id,
        );
    }

    /**
     * Record a partial refund for a single child order of a group checkout.
     *
     * Grouped orders are paid as ONE group-level transaction, so we never call
     * PayMongo per child order. Instead we record the refund locally in the
     * refunds ledger against the group payment, cap the total at the paid
     * amount, and mark the child order (and the group's aggregate status)
     * accordingly. One restaurant's refund never affects the other children.
     */
    public function refundPaidGroupChild(Order $order, string $reason): void
    {
        $group = $order->groupOrder;
        if (! $group) {
            return;
        }

        $payment = $group->payments()
            ->whereIn('status', ['authorized', 'paid'])
            ->latest('id')
            ->first();

        $order->update(['payment_status' => 'refunded']);

        if (! $payment) {
            $group->refreshAggregateStatus();
            return;
        }

        $refundAmount = round(min((float) $order->total, $this->availableGroupRefund($group)), 2);

        $this->recordRefund(
            payment: $payment,
            group: $group,
            order: $order,
            amount: $refundAmount,
            originalAmount: (float) $order->total,
            deduction: 0.0,
            orderItemId: null,
            reason: $reason ?: 'Cancelled by tourist',
            userId: $order->user_id,
        );

        $this->markPaymentFullyRefunded($payment, $group);
        $group->refreshAggregateStatus();
    }

    /**
     * Cancel a quantity of a single order item and record the matching refund.
     *
     * Refund base = the item's unit price x the cancelled quantity, minus the
     * configured deduction rate. If the cancelled item was the restaurant's last
     * active item of a delivery order, the restaurant's delivery fee is also
     * refunded (full, no deduction) and its delivery/rider dispatch is cancelled.
     */
    public function refundCancelledItem(OrderItem $item, int $quantity, string $reason, ?int $cancelledBy = null, ?int $userId = null): void
    {
        $order = $item->order;
        if (! $order) {
            return;
        }

        $base = round((float) $item->unit_price * $quantity, 2);
        $deduction = round($base * (float) config('refunds.deduction_rate'), 2);
        $refundAmount = round($base - $deduction, 2);

        $item->update([
            'cancelled_quantity' => (int) $item->cancelled_quantity + $quantity,
            'cancelled_by' => $cancelledBy ?: $order->user_id,
            'cancellation_reason' => $reason ?: 'Cancelled by tourist',
            'cancelled_at' => now(),
        ]);

        $group = $order->groupOrder;
        $payment = $group
            ? $group->payments()->whereIn('status', ['authorized', 'paid'])->latest('id')->first()
            : Payment::where('payable_type', Order::class)
                ->where('payable_id', $order->id)
                ->whereIn('status', ['authorized', 'paid'])
                ->latest('id')
                ->first();

        if ($payment) {
            $this->recordRefund(
                payment: $payment,
                group: $group,
                order: $order,
                amount: $refundAmount,
                originalAmount: $base,
                deduction: $deduction,
                orderItemId: $item->id,
                reason: $reason ?: 'Cancelled by tourist',
                userId: $userId ?: $order->user_id,
            );
        }

        $order->load('items');
        $remainingActiveQty = $order->items->sum(fn ($i) => $i->activeQuantity());

        if ($remainingActiveQty <= 0) {
            $refundDeliveryFee = $order->order_type === 'delivery'
                && config('refunds.refund_delivery_fee_on_last_item', true)
                && (float) $order->delivery_fee > 0;

            if ($refundDeliveryFee && $payment) {
                $this->recordRefund(
                    payment: $payment,
                    group: $group,
                    order: $order,
                    amount: round(min((float) $order->delivery_fee, $this->availableRefund($group, $order)), 2),
                    originalAmount: (float) $order->delivery_fee,
                    deduction: 0.0,
                    orderItemId: null,
                    reason: 'Delivery no longer needed',
                    userId: $userId ?: $order->user_id,
                );
            }

            if ($order->group_order_id && $order->activeDelivery()) {
                app(\App\Services\NearestRiderService::class)->cancelDeliveryForOrder($order);
            } elseif ($order->delivery) {
                app(\App\Services\NearestRiderService::class)->cancelDelivery($order->delivery);
            }

            $order->update([
                'status' => 'cancelled_by_tourist',
                'cancelled_by' => $cancelledBy ?: $order->user_id,
                'cancellation_reason' => $reason ?: 'All items cancelled',
                'cancelled_at' => now(),
            ]);
        }

        if ($group) {
            if ($payment) {
                $this->markPaymentFullyRefunded($payment, $group);
            }
            $group->refreshAggregateStatus();
        }
    }

    /**
     * Record a single refund ledger row against the payment (group or standalone),
     * capped at the amount remaining to refund. Updates the order's refund
     * tracking fields.
     */
    private function recordRefund(
        Payment $payment,
        ?GroupCheckout $group,
        Order $order,
        float $amount,
        float $originalAmount,
        float $deduction,
        ?int $orderItemId,
        string $reason,
        ?int $userId,
    ): void {
        $amount = round(min($amount, $this->availableRefund($group, $order)), 2);
        if ($amount <= 0) {
            return;
        }

        $record = [
            'payment_id' => $payment->id,
            'order_id' => $order->id,
            'payable_type' => $group ? GroupCheckout::class : Order::class,
            'payable_id' => $group ? $group->id : $order->id,
            'order_item_id' => $orderItemId,
            'user_id' => $userId ?: $order->user_id,
            'amount' => $amount,
            'original_amount' => round($originalAmount, 2),
            'refund_deduction' => round($deduction, 2),
            'currency' => $payment->currency ?? 'PHP',
            'reason' => $reason ?: 'Cancelled',
            'status' => 'succeeded',
            'refunded_at' => now(),
        ];

        if ($group) {
            $group->refunds()->create($record);
            $group->increment('refunded_amount', $amount);
        } else {
            $order->refunds()->create($record);
            $order->increment('refunded_amount', $amount);
        }

        // Update refund tracking fields on the order
        $totalRefunded = round((float) $order->fresh()->refunded_amount, 2);
        $order->update([
            'refund_status' => 'refunded',
            'refund_amount' => $totalRefunded,
            'refunded_at' => now(),
        ]);
    }

    /**
     * Amount still available to refund against the given payment container.
     */
    private function availableRefund(?GroupCheckout $group, Order $order): float
    {
        if ($group) {
            return $this->availableGroupRefund($group);
        }

        $paid = (float) ($order->paid_amount ?: $order->total);
        return round($paid - (float) $order->refunded_amount, 2);
    }

    private function availableGroupRefund(GroupCheckout $group): float
    {
        $paid = (float) ($group->paid_amount ?: $group->grand_total);
        return round($paid - (float) $group->refunded_amount, 2);
    }

    private function markPaymentFullyRefunded(Payment $payment, GroupCheckout $group): void
    {
        $paid = (float) ($group->paid_amount ?: $group->grand_total);
        if ($payment->status === 'paid' && round((float) $group->fresh()->refunded_amount, 2) >= $paid) {
            $payment->update(['status' => 'refunded', 'refunded_at' => now()]);
            $group->update(['payment_status' => 'refunded']);
        }
    }
}
