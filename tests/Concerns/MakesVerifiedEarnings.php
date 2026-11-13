<?php

namespace Tests\Concerns;

use App\Models\Delivery;
use App\Models\Order;
use App\Models\Payment;
use Illuminate\Support\Str;

/**
 * Secure cashout (2026-11-11): an earning can be cashed out only when it
 * traces to a provider-confirmed online payment and a completed delivery by
 * the same rider. Tests that build earnings directly give them that chain.
 */
trait MakesVerifiedEarnings
{
    protected function verifyEarningSource(Order $order, int $riderId): void
    {
        $order->forceFill(['payment_status' => 'paid'])->save();

        Payment::create([
            'payment_number' => 'PAY-'.Str::upper(Str::random(10)),
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $order->user_id ?? \App\Models\User::factory()->create(['role' => 'tourist'])->id,
            'amount' => (float) $order->total,
            'currency' => 'PHP',
            'method' => $order->payment_method ?: 'gcash',
            'provider' => 'paymongo',
            'provider_payment_id' => 'pay_'.Str::lower(Str::random(16)),
            'status' => 'paid',
            'paid_at' => now()->subHour(),
        ]);

        Delivery::firstOrCreate(['order_id' => $order->id], [
            'rider_id' => $riderId,
            'status' => 'completed',
            'delivered_at' => now()->subMinutes(30),
            'pickup_address' => 'Pickup',
            'delivery_address' => 'Drop-off',
        ]);
    }
}
