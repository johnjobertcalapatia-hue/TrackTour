<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\Payment;
use App\Models\User;
use App\Services\Integrity\TransactionLedger;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Ride hailing — the rider confirms the payment before completing a ride
 * (owner decision 2026-11-18).
 *
 *  - GCash: the tourist can pay as soon as the ride reaches the destination
 *    (the fare is final there, including a changed destination's final
 *    fare). "Complete Ride" is accepted only once the payment is verified
 *    (PayMongo webhook → order payment_status 'paid') AND the rider confirms
 *    it was received.
 *  - Cash: the rider confirms receiving the fare; the cash settlement that
 *    follows still refuses less than the amount due.
 *  - Switch to cash: when the tourist cannot pay with GCash at the drop-off,
 *    the rider may switch an UNPAID GCash ride to cash (recorded, once). A
 *    GCash payment that still lands afterwards never changes the ride back:
 *    it is recorded and escalated for a manual refund (refunds after a
 *    rider accepted are blocked by the accepted-order policy).
 */
class RidePaymentService
{
    /** Delivery statuses at which the ride is at the drop-off (payable online). */
    public const PAYABLE_DELIVERY_STATUSES = ['arrived_destination', 'delivered', 'completed'];

    public function __construct(private readonly TransactionLedger $ledger) {}

    public static function isOnline(Order $order): bool
    {
        return strtolower((string) $order->payment_method) !== 'cash';
    }

    /** Can the tourist pay this ride online now? */
    public function canPayOnline(Order $order): bool
    {
        if ($order->status === 'completed') {
            return true;
        }
        $status = $order->delivery?->status?->value ?? $order->delivery?->status;

        return in_array($status, self::PAYABLE_DELIVERY_STATUSES, true);
    }

    /**
     * The completion gate, inside the rider's status transaction (locked
     * delivery). Returns the refusal message, or null when the ride may be
     * completed (and records the rider's confirmation).
     */
    public function confirmForCompletion(Delivery $locked, bool $riderConfirmed, int $riderId): ?string
    {
        $order = Order::whereKey($locked->order_id)->lockForUpdate()->first();
        if ($order === null || $order->order_type !== 'transport') {
            return null;
        }
        $fare = round((float) $order->total, 2);
        $online = self::isOnline($order);

        if ($online && (string) $order->payment_status !== 'paid') {
            return 'The passenger\'s GCash payment of ₱'.number_format($fare, 2).' has not been received yet. Ask them to pay in the app, or switch the ride to cash.';
        }
        if (! $riderConfirmed) {
            return $online
                ? 'Confirm that the passenger\'s GCash payment of ₱'.number_format($fare, 2).' was received before completing the ride.'
                : 'Confirm that you received ₱'.number_format($fare, 2).' in cash before completing the ride.';
        }

        $this->ledger->record($order, 'ride_payment_confirmed', [
            'delivery_id' => $locked->id,
            'rider_id' => $riderId,
            'method' => $online ? (string) $order->payment_method : 'cash',
            'fare' => $fare,
            'payment_status' => (string) $order->payment_status,
            'paid_amount' => round((float) $order->paid_amount, 2),
        ], $locked);

        return null;
    }

    /**
     * The rider switches an unpaid GCash ride to cash at the drop-off.
     *
     * @return array{ok: bool, message: string, status: int}
     */
    public function switchToCash(Delivery $delivery, User $rider): array
    {
        return DB::transaction(function () use ($delivery, $rider) {
            $locked = Delivery::lockForUpdate()->find($delivery->id);
            $order = $locked ? Order::whereKey($locked->order_id)->lockForUpdate()->first() : null;
            if (! $locked || ! $order || (int) $locked->rider_id !== (int) $rider->id) {
                return ['ok' => false, 'message' => 'You are not assigned to this trip.', 'status' => 403];
            }
            if ($order->order_type !== 'transport') {
                return ['ok' => false, 'message' => 'Only rides can switch to cash.', 'status' => 422];
            }
            if (! self::isOnline($order)) {
                return ['ok' => true, 'message' => 'This ride is already paid in cash.', 'status' => 200];
            }
            $status = $locked->status?->value ?? $locked->status;
            if ($status !== 'arrived_destination') {
                return ['ok' => false, 'message' => 'You can switch to cash only at the drop-off, before completing the ride.', 'status' => 422];
            }
            $paid = (string) $order->payment_status === 'paid'
                || Payment::where('payable_type', Order::class)->where('payable_id', $order->id)->whereIn('status', ['authorized', 'paid'])->exists();
            if ($paid) {
                return ['ok' => false, 'message' => 'The passenger has already paid with GCash. Complete the ride instead.', 'status' => 409];
            }

            $from = (string) $order->payment_method;
            $order->update(['payment_method' => 'cash']);
            $notes = json_decode((string) $locked->notes, true) ?: [];
            $notes['payment_switched_to_cash'] = ['at' => now()->toIso8601String(), 'by' => $rider->id, 'from' => $from];
            $locked->forceFill(['notes' => json_encode($notes)])->save();

            $this->ledger->record($order, 'ride_payment_switched_to_cash', [
                'delivery_id' => $locked->id,
                'rider_id' => $rider->id,
                'from' => $from,
                'fare' => round((float) $order->total, 2),
            ], $locked);
            ActivityLog::record(
                'ride.payment_switched_to_cash',
                "Ride {$order->order_number}: the rider switched the payment from {$from} to cash at the drop-off (₱".number_format((float) $order->total, 2).').',
                $order,
                ActivityLog::TYPE_FINANCIAL,
            );

            return ['ok' => true, 'message' => 'Switched to cash. Collect the fare from the passenger.', 'status' => 200];
        });
    }

    /** Was this ride switched from GCash to cash by the rider? */
    public static function switchedToCash(Order $order): bool
    {
        $notes = json_decode((string) ($order->delivery?->notes ?? ''), true) ?: [];

        return isset($notes['payment_switched_to_cash']);
    }

    /**
     * A GCash payment verified for a ride that was switched to cash: keep
     * the ride on cash (the rider collected it), record the payment, and
     * escalate for a manual refund. Returns true when handled.
     */
    public function handleLatePaymentAfterCashSwitch(Order $order, Payment $payment): bool
    {
        if ($order->order_type !== 'transport' || ! self::switchedToCash($order)) {
            return false;
        }
        $this->ledger->record($order, 'ride_payment_after_cash_switch', [
            'payment_id' => $payment->id,
            'amount' => round((float) $payment->amount, 2),
            'method' => (string) $payment->method,
        ], $payment);
        app(AcceptedOrderPolicy::class)->escalate(
            $order,
            'ride_payment_after_cash_switch',
            'The passenger paid ₱'.number_format((float) $payment->amount, 2).' with GCash after the ride was switched to cash. Refund the GCash payment to the passenger manually.',
            ['payment_id' => $payment->id],
            ActivityLog::TYPE_FINANCIAL,
        );
        Log::warning('GCash payment landed on a ride switched to cash', ['order_id' => $order->id, 'payment_id' => $payment->id]);

        return true;
    }

    /** Tell the rider (and the tourist's other screens) that the ride was paid. Best effort. */
    public function notifyPaid(Order $order): void
    {
        $delivery = $order->delivery;
        try {
            app(WebsocketNotifierService::class)->notifyStatusEvent('order.status.changed', array_filter([
                $delivery?->rider_id ? 'user:'.$delivery->rider_id : null,
                $order->user_id ? 'user:'.$order->user_id : null,
            ]), ['order_id' => $order->id, 'delivery_id' => $delivery?->id, 'payment_status' => 'paid']);
        } catch (\Throwable) {
            // Polling picks it up.
        }
    }
}
