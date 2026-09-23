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
 *       or 'no_rider_available' + dispatch_retry_at
 *         (parked by a failed immediate/checkout dispatch — re-enters the loop
 *          here instead of dying as a terminal state)
 *   delivery.scheduled_at <= now             (or dispatch_retry_at <= now)
 *   -> atomic claim ('dispatching' + attempts++)
 *   -> NearestRiderService::dispatchToNearest()
 *      - rider found            -> 'notified' (offer created)
 *      - no rider available     -> retry (back to the pre-claim state +
 *                                  dispatch_retry_at)
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
     * timestamp reached, plus stale 'dispatching' claims from a crashed worker,
     * plus 'no_rider_available' deliveries whose retry time has arrived (or
     * legacy rows that never carried a retry timestamp — the attempt cap bounds
     * them to dispatch_failed, so they cannot loop forever).
     */
    private function dueDeliveryIds(): array
    {
        $claimTimeout = now()->subMinutes((int) config('delivery.scheduler.claim_timeout_minutes', 5));

        return Delivery::query()
            ->leftJoin('orders', 'orders.id', '=', 'deliveries.order_id')
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
                    ->orWhere(function ($redispatch) {
                        $redispatch->where('dispatch_status', 'no_rider_available')
                            ->where(function ($retry) {
                                $retry->whereNull('dispatch_retry_at')
                                    ->orWhere('dispatch_retry_at', '<=', now());
                            })
                            ->where(function ($due) {
                                $due->whereNull('scheduled_at')
                                    ->orWhere('scheduled_at', '<=', now());
                            });
                    })
                    ->orWhere(function ($stale) use ($claimTimeout) {
                        // Table-qualified: dueDeliveryIds() leftJoins `orders`,
                        // and both tables have updated_at — the bare column is
                        // ambiguous (SQLite rejects it outright, MySQL picks one).
                        $stale->where('dispatch_status', 'dispatching')
                            ->where('deliveries.updated_at', '<=', $claimTimeout);
                    });
            })
            // Priority dispatch (₱25/₱50/₱100 tip tiers): when several
            // deliveries come due in the same wave, the higher priority tip
            // claims a rider offer first; FIFO within the same tier.
            ->orderByDesc(DB::raw('COALESCE(orders.rider_tip, 0)'))
            ->orderBy('deliveries.scheduled_at')
            ->pluck('deliveries.id')
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
            // 'no_rider_available' is accepted here because a parked immediate
            // failure was selected as due — it is claimed like any other retry.
            if (! $delivery || ! in_array($delivery->dispatch_status, ['scheduled', 'dispatching', 'no_rider_available'], true)) {
                return false;
            }

            // Captured BEFORE the claim: after a failed attempt we restore this
            // state so a delivery parked at 'no_rider_available' keeps showing
            // the merchant-accurate "no rider" state while it stays in the
            // retry loop (scheduled rows return to 'scheduled').
            $originStatus = $delivery->dispatch_status;

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

            // P3 (master spec §54): the scheduler must never retry an expired
            // dispatch — terminate it observably instead of claiming another
            // attempt. dispatchToNearest enforces the same deadline for
            // non-scheduler callers; this pre-claim check keeps attempt counts
            // honest (no increment on an already-dead cycle).
            if ($this->nearestRiderService->dispatchCycleExpired($delivery)) {
                $this->nearestRiderService->failDispatch(
                    $delivery,
                    $this->nearestRiderService->terminalEndReason($delivery)
                );

                return true;
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

            $maxAttempts = 1 + (int) config('delivery.scheduler.max_retries', 11);

            // Terminal when the attempt cap is reached OR the cycle deadline
            // expired mid-backoff — always with an observable reason
            // (master spec §19: no silent retry dead ends).
            if ($attempt >= $maxAttempts || $this->nearestRiderService->dispatchCycleExpired($delivery)) {
                $this->nearestRiderService->failDispatch(
                    $delivery,
                    $this->nearestRiderService->terminalEndReason($delivery)
                );
            } else {
                $delivery->update([
                    'dispatch_status' => $originStatus === 'no_rider_available' ? 'no_rider_available' : 'scheduled',
                    'dispatch_retry_at' => now()->addMinutes((int) config('delivery.scheduler.retry_after_minutes', 5)),
                ]);
            }

            return true;
        });
    }
}