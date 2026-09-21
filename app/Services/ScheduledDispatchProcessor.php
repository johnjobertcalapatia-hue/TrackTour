<?php

namespace App\Services;

use App\Models\Delivery;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * P2 scheduled dispatch processor.
 *
 * A thin orchestration layer only: it finds due scheduled deliveries and hands
 * each one to the existing canonical dispatch pipeline (NearestRiderService::dispatchToNearest)
 * which owns eligibility, COD-credit filtering, nearest-rider selection and the
 * BookingDispatchLog rider offer. We deliberately do NOT create a second dispatch
 * mechanism here.
 *
 * Lifecycle:
 *   delivery.dispatch_status = 'scheduled'  (created by SmartDispatchService)
 *   delivery.scheduled_at <= now             (or dispatch_retry_at <= now)
 *   -> atomic claim ('dispatching' + attempts++)
 *   -> NearestRiderService::dispatchToNearest()
 *      - rider found            -> 'notified' (offer created)
 *      - no rider available     -> retry (back to 'scheduled' + dispatch_retry_at)
 *                                  or 'dispatch_failed' once attempts are exhausted
 *
 * The atomic claim prevents two overlapping scheduler processes from dispatching
 * the same delivery twice; a stale 'dispatching' claim (crashed worker) is
 * recovered on the next run.
 */
class ScheduledDispatchProcessor
{
    /**
     * Order statuses that still qualify for a scheduled dispatch. Anything else
     * (cancelled, rejected, pending_payment, ...) is skipped.
     *
     * Dispatch is scheduled as soon as an order enters `waiting_restaurant` and
     * remains schedulable for `accepted` / `preparing` / `ready` orders when the
     * initial offer could not be created immediately.
     */
    public const DISPATCHABLE_ORDER_STATUSES = ['waiting_restaurant', 'accepted', 'preparing', 'ready'];

    public function __construct(
        private NearestRiderService $nearestRiderService,
    ) {}

    public function process(): int
    {
        $processed = 0;

        foreach ($this->dueDeliveryIds() as $deliveryId) {
            if ($this->processDelivery($deliveryId)) {
                $processed++;
            }
        }

        return $processed;
    }

    /**
     * Deliveries that are due now: scheduled (initial or retry) with their due
     * timestamp reached, plus stale 'dispatching' claims from a crashed worker.
     */
    private function dueDeliveryIds(): array
    {
        $claimTimeout = now()->subMinutes((int) config('delivery.scheduler.claim_timeout_minutes', 5));

        return Delivery::query()
            ->whereHas('order', function ($q) {
                $q->whereIn('status', self::DISPATCHABLE_ORDER_STATUSES);
            })
            ->where(function ($q) use ($claimTimeout) {
                $q->where('dispatch_status', 'scheduled')
                    ->where(function ($retry) {
                        $retry->whereNull('dispatch_retry_at')
                            ->orWhere('dispatch_retry_at', '<=', now());
                    })
                    ->where(function ($due) {
                        $due->whereNull('scheduled_at')
                            ->orWhere('scheduled_at', '<=', now());
                    })
                    ->orWhere(function ($stale) use ($claimTimeout) {
                        $stale->where('dispatch_status', 'dispatching')
                            ->where('updated_at', '<=', $claimTimeout);
                    });
            })
            ->pluck('id')
            ->all();
    }

    /**
     * Atomically claim and dispatch a single delivery. Returns true when the
     * delivery was actually processed (attempt made or final-state set).
     */
    private function processDelivery(int $deliveryId): bool
    {
        return DB::transaction(function () use ($deliveryId) {
            $delivery = Delivery::with('order.business')->lockForUpdate()->find($deliveryId);

            // Re-check under the row lock so an overlapping scheduler run skips us.
            if (! $delivery || ! in_array($delivery->dispatch_status, ['scheduled', 'dispatching'], true)) {
                return false;
            }

            $order = $delivery->order;
            if (! $order || ! in_array($order->status, self::DISPATCHABLE_ORDER_STATUSES, true)) {
                // Order is no longer eligible (cancelled/rejected/etc.): never dispatch it.
                return false;
            }

            // Legacy rows carry the schedule time on the order instead of the delivery.
            if ($delivery->scheduled_at === null) {
                $delivery->scheduled_at = $order->dispatch_scheduled_at;
                $delivery->save();
            }

            if ($delivery->scheduled_at !== null && $delivery->scheduled_at->isFuture()) {
                return false; // Not due yet.
            }

            // Claim: this prevents a concurrent scheduler from double-offering.
            $attempt = ($delivery->dispatch_attempts ?? 0) + 1;
            $delivery->update([
                'dispatch_status' => 'dispatching',
                'dispatch_attempts' => $attempt,
                'dispatch_retry_at' => null,
            ]);
            $delivery->refresh();

            $rider = null;
            try {
                // Hand off to the existing dispatch pipeline (eligibility, COD
                // credit, nearest-rider ordering and BookingDispatchLog offer).
                $rider = $this->nearestRiderService->dispatchToNearest(
                    $delivery,
                    'food',
                    $order->business?->municipality_id,
                );
            } catch (\Throwable $e) {
                Log::warning('Scheduled dispatch attempt failed', [
                    'delivery_id' => $delivery->id,
                    'order_id' => $order->id,
                    'attempt' => $attempt,
                    'error' => $e->getMessage(),
                ]);
            }

            if ($rider) {
                // dispatchToNearest already marked the delivery 'notified'.
                return true;
            }

            $maxAttempts = 1 + (int) config('delivery.scheduler.max_retries', 4);

            if ($attempt >= $maxAttempts) {
                $delivery->update([
                    'dispatch_status' => 'dispatch_failed',
                    'dispatch_failed_at' => now(),
                ]);
            } else {
                $delivery->update([
                    'dispatch_status' => 'scheduled',
                    'dispatch_retry_at' => now()->addMinutes((int) config('delivery.scheduler.retry_after_minutes', 5)),
                ]);
            }

            return true;
        });
    }
}