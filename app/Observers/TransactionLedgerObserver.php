<?php

namespace App\Observers;

use App\Models\Delivery;
use App\Models\DeliveryPickupStop;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Refund;
use App\Models\RiderEarning;
use App\Services\Integrity\TransactionLedger;
use Illuminate\Database\Eloquent\Model;
use Throwable;

/**
 * Feeds the transaction event ledger from the canonical records (orders,
 * items, payments, refunds, deliveries, pickup stops, rider earnings). Model
 * observers see every Eloquent write path, including the service-layer
 * transitions that emit no domain event. The observer only records: it never
 * changes the business record, and a ledger failure is reported without
 * breaking the operation (the verifier then reports the gap).
 */
class TransactionLedgerObserver
{
    public function __construct(private readonly TransactionLedger $ledger) {}

    public function created(Model $model): void
    {
        $this->safely(fn () => match (true) {
            $model instanceof Order => $this->ledger->record($model, 'order_created', TransactionLedger::orderSnapshot($model), $model),
            $model instanceof OrderItem => $this->orderItemAdded($model),
            $model instanceof Payment => $this->paymentChanged($model, null),
            $model instanceof Refund => $this->refundChanged($model, null),
            $model instanceof Delivery => $this->deliveryCreated($model),
            $model instanceof DeliveryPickupStop => $this->stopEvent($model, 'pickup_stop_created', ['status' => $model->status]),
            $model instanceof RiderEarning => $this->earning($model, 'earning_posted', null),
            $model instanceof \App\Models\TripLog => $this->tripSummary($model),
            default => null,
        });
    }

    public function updated(Model $model): void
    {
        $this->safely(fn () => match (true) {
            $model instanceof Order => $this->orderUpdated($model),
            $model instanceof OrderItem => $this->orderItemUpdated($model),
            $model instanceof Payment => $model->wasChanged(['status', 'amount', 'refunded_at']) ? $this->paymentChanged($model, $model->getOriginal('status')) : null,
            $model instanceof Refund => $model->wasChanged(['status', 'amount']) ? $this->refundChanged($model, $model->getOriginal('status')) : null,
            $model instanceof Delivery => $this->deliveryUpdated($model),
            $model instanceof DeliveryPickupStop => $this->stopUpdated($model),
            $model instanceof RiderEarning => $model->wasChanged(['total_earning', 'rider_tip', 'delivery_fee', 'status', 'rider_id', 'order_id'])
                ? $this->earning($model, 'earning_changed', $model->getOriginal())
                : null,
            default => null,
        });
    }

    // ---------------- orders ----------------

    private function orderUpdated(Order $order): void
    {
        if ($order->wasChanged('status')) {
            $this->ledger->record($order, 'order_status_changed', [
                'from' => TransactionLedger::scalar($order->getOriginal('status')),
                'to' => TransactionLedger::scalar($order->status),
            ], $order);
        }
        if ($order->wasChanged('payment_status')) {
            $this->ledger->record($order, 'order_payment_status_changed', [
                'from' => $order->getOriginal('payment_status'),
                'to' => $order->payment_status,
            ], $order);
        }
        if ($order->wasChanged(TransactionLedger::AMOUNT_FIELDS)) {
            $from = $to = [];
            foreach (TransactionLedger::AMOUNT_FIELDS as $field) {
                $from[$field] = TransactionLedger::money($order->getOriginal($field));
                $to[$field] = TransactionLedger::money($order->getAttribute($field));
            }
            $this->ledger->record($order, 'order_amounts_changed', ['from' => $from, 'to' => $to], $order);
        }
        if ($order->wasChanged('user_id')) {
            $this->ledger->record($order, 'order_customer_changed', ['from' => $order->getOriginal('user_id'), 'to' => $order->user_id], $order);
        }
    }

    private function orderItemAdded(OrderItem $item): void
    {
        $order = Order::withTrashed()->find($item->order_id);
        if ($order) {
            $this->ledger->record($order, 'order_item_added', $this->itemPayload($item), $item);
        }
    }

    private function orderItemUpdated(OrderItem $item): void
    {
        if (! $item->wasChanged(['quantity', 'cancelled_quantity', 'unit_price', 'subtotal', 'status', 'business_id'])) {
            return;
        }
        $order = Order::withTrashed()->find($item->order_id);
        if ($order) {
            $this->ledger->record($order, 'order_item_changed', $this->itemPayload($item) + [
                'from_status' => $item->getOriginal('status'),
                'from_quantity' => (int) $item->getOriginal('quantity'),
                'from_cancelled_quantity' => (int) ($item->getOriginal('cancelled_quantity') ?? 0),
                'from_subtotal' => TransactionLedger::money($item->getOriginal('subtotal')),
            ], $item);
        }
    }

    private function itemPayload(OrderItem $item): array
    {
        return [
            'item_id' => $item->id,
            'business_id' => $item->business_id,
            'offering_id' => $item->offering_id,
            'product_name' => $item->product_name,
            'quantity' => (int) $item->quantity,
            'cancelled_quantity' => (int) ($item->cancelled_quantity ?? 0),
            'unit_price' => TransactionLedger::money($item->unit_price),
            'subtotal' => TransactionLedger::money($item->subtotal),
            'status' => TransactionLedger::scalar($item->status),
        ];
    }

    // ---------------- payments and refunds ----------------

    private function paymentChanged(Payment $payment, ?string $from): void
    {
        $to = $payment->status;
        $type = match (true) {
            $to === 'paid' && $from !== 'paid' => 'payment_verified',
            in_array($to, ['refunded', 'pending_refund'], true) && $from !== $to => 'payment_refund_status',
            default => 'payment_status_changed',
        };
        $this->ledger->recordForOrders(TransactionLedger::ordersForPayment($payment), $type, [
            'payment_id' => $payment->id,
            'payment_number' => $payment->payment_number,
            'provider' => $payment->provider,
            'provider_reference' => $payment->provider_payment_id,
            'method' => $payment->method,
            'amount' => TransactionLedger::money($payment->amount),
            'currency' => $payment->currency,
            'from' => $from,
            'to' => $to,
            'refunded' => $payment->refunded_at !== null,
        ], $payment);
    }

    private function refundChanged(Refund $refund, ?string $from): void
    {
        $this->ledger->recordForOrders(TransactionLedger::ordersForRefund($refund), 'refund_status_changed', [
            'refund_id' => $refund->id,
            'payment_id' => $refund->payment_id,
            'order_item_id' => $refund->order_item_id,
            'provider_refund_id' => $refund->provider_refund_id,
            'amount' => TransactionLedger::money($refund->amount),
            'from' => $from,
            'to' => $refund->status,
        ], $refund);
    }

    // ---------------- deliveries and pickups ----------------

    private function deliveryCreated(Delivery $delivery): void
    {
        $orders = TransactionLedger::ordersForDelivery($delivery);
        $this->ledger->recordForOrders($orders, 'delivery_created', [
            'delivery_id' => $delivery->id,
            'status' => TransactionLedger::scalar($delivery->status),
            'delivery_fee' => TransactionLedger::money($delivery->delivery_fee),
            'rider_commission' => TransactionLedger::money($delivery->rider_commission),
        ], $delivery);
        if ($delivery->rider_id) {
            $this->ledger->recordForOrders($orders, 'rider_assigned', ['delivery_id' => $delivery->id, 'rider_id' => (int) $delivery->rider_id, 'previous_rider_id' => null], $delivery);
        }
    }

    private function deliveryUpdated(Delivery $delivery): void
    {
        $cache = null;
        $orders = function () use (&$cache, $delivery) {
            return $cache ??= TransactionLedger::ordersForDelivery($delivery);
        };

        if ($delivery->wasChanged('rider_id')) {
            $previous = $delivery->getOriginal('rider_id');
            $this->ledger->recordForOrders($orders(), $delivery->rider_id ? 'rider_assigned' : 'rider_released', [
                'delivery_id' => $delivery->id,
                'rider_id' => $delivery->rider_id ? (int) $delivery->rider_id : null,
                'previous_rider_id' => $previous ? (int) $previous : null,
            ], $delivery);
        }
        if ($delivery->wasChanged('status')) {
            $this->ledger->recordForOrders($orders(), 'delivery_status_changed', [
                'delivery_id' => $delivery->id,
                'rider_id' => $delivery->rider_id ? (int) $delivery->rider_id : null,
                'from' => TransactionLedger::scalar($delivery->getOriginal('status')),
                'to' => TransactionLedger::scalar($delivery->status),
            ], $delivery);
        }
        if ($delivery->wasChanged('delivery_confirmed_at') && $delivery->delivery_confirmed_at !== null) {
            $this->ledger->recordForOrders($orders(), 'delivery_confirmed', [
                'delivery_id' => $delivery->id,
                'confirmed_by' => $delivery->delivery_confirmed_by ? (int) $delivery->delivery_confirmed_by : null,
                'proof_photo' => (bool) $delivery->delivery_proof_path,
                'proof_distance_m' => $delivery->delivery_proof_distance_m !== null ? (float) $delivery->delivery_proof_distance_m : null,
            ], $delivery);
        }
        if ($delivery->wasChanged(['delivery_fee', 'rider_commission'])) {
            $this->ledger->recordForOrders($orders(), 'delivery_fee_changed', [
                'delivery_id' => $delivery->id,
                'from_delivery_fee' => TransactionLedger::money($delivery->getOriginal('delivery_fee')),
                'delivery_fee' => TransactionLedger::money($delivery->delivery_fee),
                'from_rider_commission' => TransactionLedger::money($delivery->getOriginal('rider_commission')),
                'rider_commission' => TransactionLedger::money($delivery->rider_commission),
            ], $delivery);
        }
    }

    private function stopUpdated(DeliveryPickupStop $stop): void
    {
        if ($stop->wasChanged('arrived_at') && $stop->arrived_at !== null) {
            $this->stopEvent($stop, 'pickup_arrived', ['evidence' => $stop->arrival_evidence]);
        }
        if ($stop->wasChanged('pickup_confirmed_at') && $stop->pickup_confirmed_at !== null) {
            $this->stopEvent($stop, 'pickup_confirmed', ['evidence' => $stop->pickup_evidence]);
        } elseif ($stop->wasChanged('status')) {
            $this->stopEvent($stop, 'pickup_stop_status_changed', ['from' => TransactionLedger::scalar($stop->getOriginal('status'))]);
        }
    }

    private function stopEvent(DeliveryPickupStop $stop, string $type, array $extra): void
    {
        $delivery = Delivery::find($stop->delivery_id);
        if (! $delivery) {
            return;
        }
        $this->ledger->recordForOrders(TransactionLedger::ordersForDelivery($delivery), $type, [
            'delivery_id' => $delivery->id,
            'stop_id' => $stop->id,
            'business_id' => $stop->business_id,
            'sequence' => $stop->sequence,
            'status' => TransactionLedger::scalar($stop->status),
        ] + $extra, $stop);
    }

    // ---------------- trip summary (Stage 4) ----------------

    private function tripSummary(\App\Models\TripLog $log): void
    {
        $delivery = Delivery::find($log->delivery_id);
        if (! $delivery) {
            return;
        }
        $this->ledger->recordForOrders(TransactionLedger::ordersForDelivery($delivery), 'trip_summary', [
            'delivery_id' => $delivery->id,
            'rider_id' => $log->rider_id ? (int) $log->rider_id : null,
            'distance_m' => $log->distance_meters !== null ? (float) $log->distance_meters : null,
            'duration_s' => $log->duration_seconds !== null ? (int) $log->duration_seconds : null,
            'point_count' => $log->point_count !== null ? (int) $log->point_count : null,
            'started_at' => $log->started_at ? \Illuminate\Support\Carbon::parse($log->started_at)->toIso8601String() : null,
            'ended_at' => $log->ended_at ? \Illuminate\Support\Carbon::parse($log->ended_at)->toIso8601String() : null,
        ], $log);
    }

    // ---------------- rider earnings ----------------

    private function earning(RiderEarning $earning, string $type, ?array $original): void
    {
        $order = Order::withTrashed()->find($earning->order_id);
        if (! $order) {
            return;
        }
        $payload = [
            'earning_id' => $earning->id,
            'rider_id' => (int) $earning->rider_id,
            'delivery_fee' => TransactionLedger::money($earning->delivery_fee),
            'rider_tip' => TransactionLedger::money($earning->rider_tip),
            'total_earning' => TransactionLedger::money($earning->total_earning),
            'status' => $earning->status,
        ];
        if ($original !== null) {
            $payload['from'] = [
                'rider_id' => isset($original['rider_id']) ? (int) $original['rider_id'] : null,
                'delivery_fee' => TransactionLedger::money($original['delivery_fee'] ?? null),
                'rider_tip' => TransactionLedger::money($original['rider_tip'] ?? null),
                'total_earning' => TransactionLedger::money($original['total_earning'] ?? null),
                'status' => $original['status'] ?? null,
            ];
        }
        $this->ledger->record($order, $type, $payload, $earning);
    }

    private function safely(callable $fn): void
    {
        try {
            $fn();
        } catch (Throwable $e) {
            report($e);
        }
    }
}
