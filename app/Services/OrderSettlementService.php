<?php

namespace App\Services;

use App\Models\CodSettlement;
use App\Models\Order;
use App\Models\OrderSettlement;
use App\Models\Payment;
use App\Models\RestaurantWallet;
use App\Models\RestaurantWalletTransaction;
use App\Models\Refund;
use Illuminate\Support\Facades\DB;

/**
 * The sole P12 settlement writer. It locks the completed order and restaurant
 * wallet, then creates the common settlement and immutable earning ledger in
 * one transaction. GCash allocation is deliberately deferred to P12.3.
 */
class OrderSettlementService
{
    public function recordRefundDeduction(Refund $refund): ?RestaurantWalletTransaction
    {
        return DB::transaction(function () use ($refund) {
            $lockedRefund = Refund::query()->lockForUpdate()->findOrFail($refund->id);
            if ($lockedRefund->status !== 'succeeded' || ! $lockedRefund->order_id) {
                return null;
            }

            $existing = RestaurantWalletTransaction::where('refund_id', $lockedRefund->id)->first();
            if ($existing) {
                return $existing;
            }

            $settlement = OrderSettlement::where('order_id', $lockedRefund->order_id)->lockForUpdate()->first();
            if (! $settlement) {
                return null; // cancellation/refund before earning: no reversal
            }

            $order = Order::lockForUpdate()->findOrFail($lockedRefund->order_id);
            $refundAmount = round((float) $lockedRefund->amount, 2);
            $base = max(0.01, (float) $settlement->settlement_base);
            $deduction = $settlement->source === OrderSettlement::SOURCE_COD
                ? round($refundAmount * ((float) $settlement->restaurant_amount / $base), 2)
                : $refundAmount;
            $deduction = min($deduction, (float) $settlement->restaurant_amount);

            $wallet = RestaurantWallet::where('business_id', $order->business_id)->lockForUpdate()->firstOrFail();
            $availableBefore = round((float) $wallet->available_balance, 2);
            $availableAfter = round($availableBefore - $deduction, 2);
            if ($deduction <= 0 || $availableAfter < 0) {
                return null;
            }

            $transaction = RestaurantWalletTransaction::create([
                'transaction_number' => 'RWT-REF-'.$lockedRefund->id,
                'wallet_id' => $wallet->id,
                'business_id' => $order->business_id,
                'order_settlement_id' => $settlement->id,
                'refund_id' => $lockedRefund->id,
                'type' => RestaurantWalletTransaction::TYPE_REFUND_DEDUCTION,
                'reference_type' => Refund::class,
                'reference_id' => $lockedRefund->id,
                'amount' => -$deduction,
                'available_balance_before' => $availableBefore,
                'available_balance_after' => $availableAfter,
                'pending_balance_before' => $wallet->pending_balance,
                'pending_balance_after' => $wallet->pending_balance,
                'description' => 'Successful refund deduction for order #'.$order->id,
            ]);
            $wallet->update([
                'available_balance' => $availableAfter,
                'total_earned' => round((float) $wallet->total_earned - $deduction, 2),
            ]);

            return $transaction;
        });
    }
    /**
     * Post a completed, provider-confirmed GCash order using the financial
     * components persisted at checkout. The restaurant receives food subtotal
     * only; delivery fee, rider tip, and system fee are never wallet earnings.
     */
    public function recordGcashSettlement(Order $order): ?OrderSettlement
    {
        return DB::transaction(function () use ($order) {
            $lockedOrder = Order::query()->lockForUpdate()->findOrFail($order->id);
            if ($lockedOrder->status !== 'completed') {
                throw new \InvalidArgumentException('Only a completed order may be financially settled.');
            }

            // Transport (ride-hailing) orders have no restaurant: the fare belongs
            // to the ride, never to a restaurant wallet or restaurant settlement.
            if ($lockedOrder->order_type === 'transport') {
                return null;
            }

            $existing = OrderSettlement::where('order_id', $lockedOrder->id)->first();
            if ($existing) {
                return $existing;
            }

            if ($lockedOrder->payment_method !== 'gcash') {
                return null;
            }

            $payment = $this->confirmedGcashPaymentFor($lockedOrder);
            if (! $payment) {
                return null;
            }

            $subtotal = round((float) $lockedOrder->subtotal, 2);
            $deliveryFee = round((float) $lockedOrder->delivery_fee, 2);
            $tip = round((float) $lockedOrder->rider_tip, 2);
            $systemFee = round((float) $lockedOrder->system_fee, 2);
            $total = round((float) $lockedOrder->total, 2);

            // No discount allocation policy exists in the canonical checkout
            // flow yet (it persists zero). Refuse to invent one here.
            if ((float) $lockedOrder->discount !== 0.0
                || round($subtotal + $deliveryFee + $tip + $systemFee, 2) !== $total) {
                throw new \LogicException('GCash order financial components do not reconcile for settlement.');
            }

            return $this->postSettlement(
                $lockedOrder,
                OrderSettlement::SOURCE_GCASH,
                $total,
                $subtotal,
                $systemFee,
                null,
                'GCash restaurant earning for order #'.$lockedOrder->id,
            );
        });
    }

    public function recordCodSettlement(CodSettlement $codSettlement): OrderSettlement
    {
        return DB::transaction(function () use ($codSettlement) {
            $lockedCodSettlement = CodSettlement::query()
                ->lockForUpdate()
                ->findOrFail($codSettlement->id);

            $order = Order::query()->lockForUpdate()->findOrFail($lockedCodSettlement->order_id);
            if ($order->status !== 'completed') {
                throw new \InvalidArgumentException('Only a completed order may be financially settled.');
            }

            $existing = OrderSettlement::query()
                ->where('order_id', $order->id)
                ->where('business_id', $lockedCodSettlement->business_id)
                ->first();
            if ($existing) {
                return $existing;
            }

            $businessIsInOrder = (int) $lockedCodSettlement->business_id === (int) $order->business_id
                || $order->items()
                    ->where('business_id', $lockedCodSettlement->business_id)
                    ->exists();
            if (! $businessIsInOrder) {
                throw new \LogicException('COD settlement business does not match its order.');
            }

            $base = round((float) $lockedCodSettlement->settlement_base, 2);
            $restaurantAmount = round((float) $lockedCodSettlement->restaurant_share, 2);
            $platformAmount = round((float) $lockedCodSettlement->platform_fee, 2);
            if ($base <= 0 || round($restaurantAmount + $platformAmount, 2) !== $base) {
                throw new \LogicException('COD settlement allocation does not reconcile to its base.');
            }

            $wallet = RestaurantWallet::query()
                ->where('business_id', $lockedCodSettlement->business_id)
                ->lockForUpdate()
                ->first();
            if (! $wallet) {
                throw new \LogicException('Approved restaurant wallet is required before settlement.');
            }

            $availableBefore = round((float) $wallet->available_balance, 2);
            $pendingBefore = round((float) $wallet->pending_balance, 2);
            $availableAfter = round($availableBefore + $restaurantAmount, 2);

            $settlement = OrderSettlement::create([
                'settlement_number' => 'ORD-STL-COD-'.$order->id.'-'.$lockedCodSettlement->business_id,
                'order_id' => $order->id,
                'business_id' => $lockedCodSettlement->business_id,
                'cod_settlement_id' => $lockedCodSettlement->id,
                'source' => OrderSettlement::SOURCE_COD,
                'payment_method' => $order->payment_method,
                'settlement_base' => $base,
                'restaurant_amount' => $restaurantAmount,
                'platform_amount' => $platformAmount,
                'status' => OrderSettlement::STATUS_SETTLED,
                'settled_at' => now(),
            ]);

            RestaurantWalletTransaction::create([
                'transaction_number' => 'RWT-SET-'.$settlement->id,
                'wallet_id' => $wallet->id,
                'business_id' => $lockedCodSettlement->business_id,
                'order_settlement_id' => $settlement->id,
                'type' => RestaurantWalletTransaction::TYPE_ORDER_EARNING,
                'reference_type' => OrderSettlement::class,
                'reference_id' => $settlement->id,
                'amount' => $restaurantAmount,
                'available_balance_before' => $availableBefore,
                'available_balance_after' => $availableAfter,
                'pending_balance_before' => $pendingBefore,
                'pending_balance_after' => $pendingBefore,
                'description' => 'COD restaurant earning for order #'.$order->id,
            ]);

            $wallet->update([
                'available_balance' => $availableAfter,
                'total_earned' => round((float) $wallet->total_earned + $restaurantAmount, 2),
            ]);

            return $settlement;
        });
    }

    private function confirmedGcashPaymentFor(Order $order): ?Payment
    {
        $payment = Payment::query()
            ->where('payable_type', Order::class)
            ->where('payable_id', $order->id)
            ->where('method', 'gcash')
            ->where('provider', 'paymongo')
            ->where('status', 'paid')
            ->latest('id')
            ->first();

        if ($payment) {
            return $payment;
        }

        return $order->groupOrder?->payments()
            ->where('method', 'gcash')
            ->where('provider', 'paymongo')
            ->where('status', 'paid')
            ->latest('id')
            ->first();
    }

    private function postSettlement(
        Order $order,
        string $source,
        float $base,
        float $restaurantAmount,
        float $platformAmount,
        ?int $codSettlementId,
        string $description,
    ): OrderSettlement {
        $wallet = RestaurantWallet::query()
            ->where('business_id', $order->business_id)
            ->lockForUpdate()
            ->firstOrFail();
        $availableBefore = round((float) $wallet->available_balance, 2);
        $pendingBefore = round((float) $wallet->pending_balance, 2);
        $availableAfter = round($availableBefore + $restaurantAmount, 2);

        $settlement = OrderSettlement::create([
            'settlement_number' => 'ORD-STL-'.strtoupper($source).'-'.$order->id,
            'order_id' => $order->id,
            'business_id' => $order->business_id,
            'cod_settlement_id' => $codSettlementId,
            'source' => $source,
            'payment_method' => $order->payment_method,
            'settlement_base' => $base,
            'restaurant_amount' => $restaurantAmount,
            'platform_amount' => $platformAmount,
            'status' => OrderSettlement::STATUS_SETTLED,
            'settled_at' => now(),
        ]);
        RestaurantWalletTransaction::create([
            'transaction_number' => 'RWT-SET-'.$settlement->id,
            'wallet_id' => $wallet->id,
            'business_id' => $order->business_id,
            'order_settlement_id' => $settlement->id,
            'type' => RestaurantWalletTransaction::TYPE_ORDER_EARNING,
            'reference_type' => OrderSettlement::class,
            'reference_id' => $settlement->id,
            'amount' => $restaurantAmount,
            'available_balance_before' => $availableBefore,
            'available_balance_after' => $availableAfter,
            'pending_balance_before' => $pendingBefore,
            'pending_balance_after' => $pendingBefore,
            'description' => $description,
        ]);
        $wallet->update([
            'available_balance' => $availableAfter,
            'total_earned' => round((float) $wallet->total_earned + $restaurantAmount, 2),
        ]);

        return $settlement;
    }
}
