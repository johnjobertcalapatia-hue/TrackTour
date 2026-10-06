<?php

namespace App\Console\Commands;

use App\Events\OrderStatusChanged;
use App\Models\Order;
use App\Models\OrderCancellation;
use App\Notifications\OrderAutoCancelled;
use App\Services\NearestRiderService;
use App\Services\OrderRefundService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class AutoCancelUndeliveredOrder extends Command
{
    protected $signature = 'orders:auto-cancel-undelivered
        {--minutes=60 : Minutes a paid delivery order may remain undelivered before auto-cancel and refund}';

    protected $description = 'Auto-cancel and refund paid delivery orders that are not delivered within the timeout';

    public function handle(OrderRefundService $refundService): int
    {
        $minutes = (int) $this->option('minutes');
        $reason = "Order was not delivered within {$minutes} minutes.";

        $cutoff = now()->subMinutes($minutes);

        // Active delivery orders that still have an active trip and were assigned
        // (or accepted) more than $minutes ago without being delivered. Group
        // children ride on the group's single delivery (4.4). Transport rides are
        // included: they carry order_type 'transport' and are equally stuck when
        // no rider ever completes them.
        $orders = Order::whereIn('order_type', ['delivery', 'transport'])
            ->where('payment_status', 'paid')
            ->where(function ($q) {
                $q->whereHas('delivery', function ($q2) {
                    $q2->whereIn('status', [
                        'waiting',
                        'assigned',
                        'en_route_pickup',
                        'arrived_pickup',
                        'picked_up',
                        'in_transit',
                        'en_route_destination',
                        'arrived_destination',
                    ]);
                })->orWhereHas('groupOrder.delivery', function ($q2) {
                    $q2->whereIn('status', [
                        'waiting',
                        'assigned',
                        'en_route_pickup',
                        'arrived_pickup',
                        'picked_up',
                        'in_transit',
                        'en_route_destination',
                        'arrived_destination',
                    ]);
                });
            })
            ->where(function ($q) use ($cutoff) {
                $q->whereHas('delivery', function ($q2) use ($cutoff) {
                    $q2->whereNotNull('assigned_at')->where('assigned_at', '<=', $cutoff);
                })
                    ->orWhereHas('groupOrder.delivery', function ($q2) use ($cutoff) {
                        $q2->whereNotNull('assigned_at')->where('assigned_at', '<=', $cutoff);
                    })
                    ->orWhere(function ($q2) use ($cutoff) {
                        $q2->whereNotNull('accepted_at')->where('accepted_at', '<=', $cutoff);
                    });
            })
            ->get();

        if ($orders->isEmpty()) {
            $this->info("No undelivered orders past {$minutes} minutes.");

            return self::SUCCESS;
        }

        $processed = 0;
        $failed = 0;

        foreach ($orders as $order) {
            try {
                DB::transaction(function () use ($order, $refundService, $reason) {
                    // Re-check under lock so an order delivered right now is not double-processed.
                    $locked = Order::with('delivery', 'groupOrder.delivery')
                        ->where('id', $order->id)
                        ->where('payment_status', 'paid')
                        ->where(function ($q) {
                            $q->whereHas('delivery', function ($q2) {
                                $q2->whereNotIn('status', ['delivered', 'completed', 'cancelled']);
                            })->orWhereHas('groupOrder.delivery', function ($q2) {
                                $q2->whereNotIn('status', ['delivered', 'completed', 'cancelled']);
                            });
                        })
                        ->lockForUpdate()
                        ->first();

                    if (! $locked) {
                        return;
                    }

                    // Idempotency: skip if already refunded or being refunded
                    if (! in_array($locked->refund_status ?? 'none', ['none', 'failed'])) {
                        return;
                    }

                    // Mark the order as cancelled (auto-cancelled by system)
                    $locked->update([
                        'status' => 'cancelled',
                        'cancelled_by' => null,
                        'cancellation_reason' => $reason,
                        'cancelled_at' => now(),
                        'refund_status' => 'pending',
                    ]);

                    // Cancel the active delivery/dispatch under its own row lock (group
                    // children cancel the shared group trip only when no other
                    // sibling still needs it).
                    app(NearestRiderService::class)->cancelDeliveryForOrder($locked);

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
                        'reason_code' => 'delivery_timeout',
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
                        'delivery',
                        'cancelled'
                    );
                });

                $groupId = $order->group_order_id ? "group: {$order->group_order_id}" : 'standalone';
                $this->info("Auto-cancelled undelivered order #{$order->order_number} ({$groupId}).");
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
