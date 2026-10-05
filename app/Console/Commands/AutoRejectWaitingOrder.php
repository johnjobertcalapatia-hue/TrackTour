<?php

namespace App\Console\Commands;

use App\Events\OrderStatusChanged;
use App\Models\Order;
use App\Models\OrderCancellation;
use App\Notifications\OrderAutoCancelled;
use App\Services\OrderRefundService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class AutoRejectWaitingOrder extends Command
{
    protected $signature = 'orders:auto-reject-waiting
        {--minutes=10 : Minutes a paid order may wait in waiting_restaurant before auto-reject and refund}';

    protected $description = 'Auto-reject and refund paid orders that have been waiting for restaurant acceptance beyond the timeout';

    public function handle(OrderRefundService $refundService): int
    {
        $minutes = (int) $this->option('minutes');
        $reason = "Restaurant did not accept or respond within {$minutes} minutes.";

        // Use acceptance_deadline when available, fallback to updated_at for legacy orders
        $orders = Order::where('status', 'waiting_restaurant')
            ->where('payment_status', 'paid')
            ->where(function ($q) use ($minutes) {
                $q->where(function ($q2) use ($minutes) {
                    // Orders with explicit acceptance_deadline that have expired
                    $q2->whereNotNull('acceptance_deadline')
                        ->where('acceptance_deadline', '<=', now());
                })->orWhere(function ($q2) use ($minutes) {
                    // Legacy orders without deadline: use updated_at + minutes
                    $q2->whereNull('acceptance_deadline')
                        ->where('updated_at', '<=', now()->subMinutes($minutes));
                });
            })
            ->get();

        if ($orders->isEmpty()) {
            $this->info("No waiting orders past {$minutes} minutes.");

            return self::SUCCESS;
        }

        $processed = 0;
        $failed = 0;

        foreach ($orders as $order) {
            try {
                DB::transaction(function () use ($order, $refundService, $reason) {
                    // Re-check under lock so an order accepted right now is not double-processed.
                    $locked = Order::where('id', $order->id)
                        ->where('status', 'waiting_restaurant')
                        ->lockForUpdate()
                        ->first();

                    if (! $locked) {
                        return;
                    }

                    // Idempotency: skip if already refunded or being refunded
                    if (! in_array($locked->refund_status ?? 'none', ['none', 'failed'])) {
                        return;
                    }

                    // Mark the order as cancelled (rejected = auto-cancelled by system)
                    $locked->update([
                        'status' => 'rejected',
                        'cancelled_by' => null,
                        'cancellation_reason' => $reason,
                        'cancelled_at' => now(),
                        'refund_status' => 'pending',
                    ]);

                    // Cancel any active delivery/dispatch (credit-free COD has no
                    // reserve to release). Group children cancel the shared group
                    // trip only when no other sibling still needs it.
                    app(\App\Services\NearestRiderService::class)->cancelDeliveryForOrder($locked);

                    // Process refund — standalone or grouped
                    if ($locked->group_order_id) {
                        $refundService->refundPaidGroupChild($locked, $reason);
                    } else {
                        $refundService->refundPaidOrder($locked, $reason);
                    }

                    // Calculate actual refund amount from the refunds ledger and
                    // keep the refund_status set by the refund service (the P11.3
                    // processor: 'refunded' | 'pending' | 'failed').
                    $fresh = $locked->fresh();
                    $refundAmount = round((float) $fresh->refunded_amount, 2);
                    $refundStatus = $fresh->refund_status ?: ($refundAmount > 0 ? 'refunded' : 'pending');

                    // Update refund tracking fields on the order
                    $locked->update([
                        'refund_status' => $refundStatus,
                        'refund_amount' => $refundAmount,
                        'refunded_at' => $fresh->refunded_at ?: ($refundStatus === 'refunded' ? now() : null),
                    ]);

                    // Create cancellation audit record
                    OrderCancellation::create([
                        'order_id' => $locked->id,
                        'cancelled_by' => 'system',
                        'reason_code' => 'restaurant_timeout',
                        'reason' => $reason,
                        'cancelled_at' => now(),
                        'refund_status' => match ($refundStatus) {
                            'refunded' => 'succeeded',
                            'failed' => 'failed',
                            default => 'pending',
                        },
                        'refund_amount' => $refundAmount,
                        'refunded_at' => $refundStatus === 'refunded' ? now() : null,
                    ]);

                    // Notify the tourist
                    $user = $locked->user;
                    if ($user) {
                        $user->notify(new OrderAutoCancelled($locked, $reason));
                    }

                    // Broadcast status change to the restaurant (existing Realtime channel)
                    OrderStatusChanged::dispatch(
                        $locked->fresh(),
                        'waiting_restaurant',
                        'rejected'
                    );
                });

                $groupId = $order->group_order_id ? "group: {$order->group_order_id}" : 'standalone';
                $this->info("Auto-cancelled order #{$order->order_number} ({$groupId}).");
                $processed++;
            } catch (\Exception $e) {
                $this->error("Failed to auto-cancel order #{$order->order_number}: {$e->getMessage()}");
                $failed++;
            }
        }

        $this->info("Done. Processed: {$processed}, failed: {$failed}.");

        return self::SUCCESS;
    }
}
