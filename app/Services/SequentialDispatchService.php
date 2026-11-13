<?php

namespace App\Services;

use App\Enums\TripStatus;
use App\Models\BookingDispatchLog;
use App\Models\Delivery;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Sequential targeted dispatch for food deliveries and ride bookings
 * (docs/dispatch-escalation-plan.md, Stage 2; rides since 2026-11-11, where
 * the "first pickup" is the tourist's pickup point).
 *
 *   plan pickup sequence (farthest restaurant from the tourist first)
 *   → offer to the nearest eligible rider to the FIRST pickup, 30 s
 *   → reject / timeout → next nearest eligible rider (never the same rider)
 *   → after 4 unsuccessful targeted offers, or when no eligible targeted
 *     rider remains → manual Available Deliveries board (dispatch_phase=manual)
 *
 * This is the food branch of the ONE dispatch system: NearestRiderService::
 * dispatchToNearest() delegates here, and every existing trigger (checkout,
 * scheduler, decline, timeout worker, late accept) reaches it through that
 * entry point. Acceptance stays NearestRiderService::handleRiderResponse()
 * (atomic, first accept wins, one active delivery per rider).
 *
 * Invariants (all under the delivery row lock):
 *   - at most ONE live targeted offer per delivery (deliveries.current_offer_id)
 *   - at most max_attempts targeted offers per delivery
 *   - never the same rider twice for the same delivery (UNIQUE delivery/rider)
 *   - eligibility is re-evaluated before every offer (fresh candidate query)
 *   - the server owns every deadline (booking_dispatch_logs.expires_at)
 */
class SequentialDispatchService
{
    public const PHASE_TARGETED = 'targeted';

    public const PHASE_MANUAL = 'manual';

    public function __construct(
        private NearestRiderService $riders,
        private PickupSequencePlanner $planner,
    ) {}

    public function offerSeconds(): int
    {
        return max(15, (int) config('delivery.sequential.offer_seconds', 30));
    }

    public function maxAttempts(): int
    {
        return max(1, (int) config('delivery.sequential.max_attempts', 4));
    }

    /**
     * Send the next targeted offer, or move the delivery to the manual board.
     * Returns the targeted rider, or null when no offer was sent (offer still
     * live, delivery taken/cancelled, or now on the manual board).
     */
    public function offerNext(Delivery $delivery, string $serviceType = 'food', ?int $municipalityId = null): ?User
    {
        // Slow road-distance work (OSRM) never runs while a row lock is held:
        // only when the caller is not already inside a transaction do we plan
        // the sequence by road and road-rank the closest candidates up front.
        // Inside the lock the candidate list is re-queried (fresh eligibility)
        // and only the ORDER from this pre-ranking is reused.
        $roadRank = [];
        if (DB::transactionLevel() === 0 && (bool) config('delivery.dispatch_road_distance', true)) {
            $fresh = $delivery->fresh();
            if ($fresh && $fresh->rider_id === null && $fresh->dispatch_phase !== self::PHASE_MANUAL) {
                $this->planner->ensurePlanned($fresh, allowRoad: true);
                $fresh->refresh();
                $offered = BookingDispatchLog::where('delivery_id', $fresh->id)->pluck('rider_id')->map(fn ($id) => (int) $id)->all();
                $pre = $this->riders->targetedCandidates($fresh, $serviceType, $municipalityId, $offered, max(1, (int) config('delivery.sequential.candidate_pool', 10)));
                foreach ($this->preferRoadDistance($fresh, $pre) as $rank => $c) {
                    $roadRank[$c['rider_id']] = $rank;
                }
            }
        }

        $result = DB::transaction(function () use ($delivery, $serviceType, $municipalityId, $roadRank) {
            $locked = Delivery::lockForUpdate()->find($delivery->id);

            if (! $locked || $locked->rider_id !== null) {
                return null;
            }
            if (($locked->status?->value ?? $locked->status) !== TripStatus::WAITING->value) {
                return null;
            }
            if ($locked->dispatch_phase === self::PHASE_MANUAL) {
                return null; // Already on the manual board.
            }
            if (! $this->riders->deliveryHasDispatchableOrder($locked)) {
                return null; // Order cancelled/expired: never offer it.
            }

            // One live targeted offer per delivery.
            if ($this->hasLiveOffer($locked)) {
                return null;
            }

            if ((int) $locked->targeted_attempts >= $this->maxAttempts()) {
                $this->moveToManual($locked, 'targeted_attempts_exhausted');

                return null;
            }

            // Sequence is normally planned before the lock (with road
            // distance); inside the lock only the straight-line fallback runs.
            $this->planner->ensurePlanned($locked, allowRoad: false);
            $locked->refresh();

            $alreadyOffered = BookingDispatchLog::where('delivery_id', $locked->id)->pluck('rider_id')->map(fn ($id) => (int) $id)->all();
            $candidates = $this->riders->targetedCandidates(
                $locked,
                $serviceType,
                $municipalityId,
                $alreadyOffered,
                max(1, (int) config('delivery.sequential.candidate_pool', 10)),
            );
            if ($roadRank !== []) {
                // Keep fresh eligibility, reuse the road-distance order.
                usort($candidates, fn ($a, $b) => [$roadRank[$a['rider_id']] ?? PHP_INT_MAX, $a['distance_km']] <=> [$roadRank[$b['rider_id']] ?? PHP_INT_MAX, $b['distance_km']]);
            }

            if ($candidates === []) {
                $this->moveToManual($locked, 'no_eligible_rider');

                return null;
            }

            $target = $candidates[0];
            $attempt = (int) $locked->targeted_attempts + 1;
            $expiresAt = now()->addSeconds($this->offerSeconds());

            $offer = BookingDispatchLog::create([
                'delivery_id' => $locked->id,
                'rider_id' => $target['rider_id'],
                'distance_km' => round((float) $target['distance_km'], 3),
                'attempt_no' => $attempt,
                'phase' => self::PHASE_TARGETED,
                'response' => 'pending',
                'dispatched_at' => now(),
                'expires_at' => $expiresAt,
            ]);

            $locked->update([
                'dispatch_status' => 'notified',
                'dispatch_phase' => self::PHASE_TARGETED,
                'targeted_attempts' => $attempt,
                'current_offer_id' => $offer->id,
                'dispatch_expires_at' => $expiresAt,
                'dispatch_retry_at' => null,
            ]);

            Log::info('[SequentialDispatch] targeted offer sent', [
                'delivery_id' => $locked->id,
                'rider_id' => $target['rider_id'],
                'attempt' => $attempt,
                'distance_km' => round((float) $target['distance_km'], 2),
                'expires_at' => $expiresAt->toIso8601String(),
            ]);

            return ['delivery' => $locked, 'rider_id' => $target['rider_id'], 'attempt' => $attempt];
        });

        if (! $result) {
            return null;
        }

        $this->ping($result['delivery'], $result['rider_id'], $result['attempt']);

        return User::find($result['rider_id']);
    }

    /**
     * Enforce the existing dispatch-cycle deadline on sequential deliveries
     * (targeted or manual phase), which the legacy retry scheduler no longer
     * selects. Terminates with the observable reason and withdraws any live
     * offer; an accepted delivery is never touched. Stage 4 extends this to
     * order cancellation + refund. Returns how many deliveries expired.
     */
    public function expireOverdue(): int
    {
        $expired = 0;
        $ids = Delivery::query()
            ->whereNotNull('dispatch_phase')
            ->whereNull('rider_id')
            ->where('status', TripStatus::WAITING->value)
            ->where(fn ($q) => $q->whereNull('dispatch_status')->orWhere('dispatch_status', '!=', 'dispatch_failed'))
            ->pluck('id');

        foreach ($ids as $id) {
            $done = DB::transaction(function () use ($id) {
                $locked = Delivery::lockForUpdate()->find($id);
                if (! $locked || $locked->rider_id !== null || ! $this->riders->dispatchCycleExpired($locked)) {
                    return false;
                }

                $riderIds = BookingDispatchLog::where('delivery_id', $locked->id)->where('response', 'pending')->pluck('rider_id')->all();
                BookingDispatchLog::where('delivery_id', $locked->id)->where('response', 'pending')
                    ->update(['response' => 'timeout', 'responded_at' => now()]);
                $locked->update(['current_offer_id' => null]);
                $this->riders->failDispatch($locked, $this->riders->terminalEndReason($locked));

                foreach ($riderIds as $riderId) {
                    DB::afterCommit(fn () => $this->riders->notifyRiderOfferEnded((int) $riderId, (int) $locked->id, 'dispatch_expired'));
                }

                return true;
            });
            $expired += $done ? 1 : 0;
        }

        return $expired;
    }

    /** A pending, unexpired targeted offer exists for the delivery. */
    private function hasLiveOffer(Delivery $locked): bool
    {
        return BookingDispatchLog::where('delivery_id', $locked->id)
            ->where('phase', self::PHASE_TARGETED)
            ->where('response', 'pending')
            ->where('expires_at', '>', now())
            ->exists();
    }

    /**
     * Targeted phase over (4 unsuccessful offers, or nobody eligible): the
     * delivery waits on the manual Available Deliveries board.
     */
    private function moveToManual(Delivery $locked, string $reason): void
    {
        $locked->update([
            'dispatch_status' => 'waiting_for_rider',
            'dispatch_phase' => self::PHASE_MANUAL,
            'current_offer_id' => null,
            'dispatch_expires_at' => null,
            'dispatch_retry_at' => null,
        ]);

        Log::info('[SequentialDispatch] moved to manual board', [
            'delivery_id' => $locked->id,
            'reason' => $reason,
            'targeted_attempts' => (int) $locked->targeted_attempts,
        ]);
    }

    /**
     * D4: candidates are ranked by straight-line distance; when road distance
     * is enabled the closest few are re-ranked by OSRM road distance (short
     * timeout, straight-line fallback per candidate).
     *
     * @param  array<int, array{rider_id: int, distance_km: float}>  $candidates
     * @return array<int, array{rider_id: int, distance_km: float}>
     */
    private function preferRoadDistance(Delivery $delivery, array $candidates): array
    {
        if (count($candidates) < 2 || ! (bool) config('delivery.dispatch_road_distance', true)) {
            return $candidates;
        }

        $top = (int) config('delivery.dispatch_road_candidates', 3);
        $head = array_slice($candidates, 0, $top);
        $tail = array_slice($candidates, $top);
        $fees = app(DeliveryFeeService::class);
        $originalTimeout = config('delivery.routing_timeout');

        try {
            config(['delivery.routing_timeout' => (int) config('delivery.dispatch_routing_timeout', 2)]);
            foreach ($head as $i => $c) {
                $loc = app(PickupSequenceService::class)->latestRiderLocation($c['rider_id']);
                if (! $loc) {
                    continue;
                }
                $route = $fees->calculateRouteDistance((float) $loc['latitude'], (float) $loc['longitude'], (float) $delivery->pickup_latitude, (float) $delivery->pickup_longitude);
                if ($route !== null && isset($route['distance_km'])) {
                    $head[$i]['distance_km'] = (float) $route['distance_km'];
                }
            }
        } catch (\Throwable $e) {
            Log::info('[SequentialDispatch] road ranking unavailable, straight line kept', ['error' => $e->getMessage()]);
        } finally {
            config(['delivery.routing_timeout' => $originalTimeout]);
        }

        usort($head, fn ($a, $b) => $a['distance_km'] <=> $b['distance_km']);

        return array_merge($head, $tail);
    }

    /** Socket ping for the targeted rider; the HTTP poll is the fallback. */
    private function ping(Delivery $delivery, int $riderId, int $attempt): void
    {
        try {
            app(WebsocketNotifierService::class)->notifyDispatch([
                'deliveryId' => $delivery->id,
                'orderId' => $delivery->order_id,
                'restaurantName' => $delivery->primaryOrder()?->business?->business_name ?? $delivery->pickup_address ?? 'Restaurant',
                'restaurantLat' => $delivery->pickup_latitude,
                'restaurantLng' => $delivery->pickup_longitude,
                'riderId' => $riderId,
                'timeoutSeconds' => $this->offerSeconds(),
                'attempt' => $attempt,
            ]);
        } catch (\Throwable $e) {
            Log::warning('[SequentialDispatch] ping failed (HTTP poll remains)', ['delivery_id' => $delivery->id, 'error' => $e->getMessage()]);
        }
    }
}
