<?php

namespace App\Services;

use App\Models\Delivery;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Exclusive offer review hold.
 *
 * The first rider to open an offer reserves it for a short window
 * (config delivery.offer_review_seconds). While the hold is live, no other
 * rider can see its details or accept it; the reviewer either accepts or
 * releases it ("find other offers"). Holds expire on their own so an
 * abandoned screen never blocks an order.
 *
 * Authority: the hold columns on `deliveries`, written under the delivery
 * row lock. Every accept path checks isHeldByOther() inside its own lock
 * (NearestRiderService), so the rule is enforced server-side, not by the UI.
 * A rider holds at most one offer at a time.
 */
class OfferReviewService
{
    public function seconds(): int
    {
        return max(15, (int) config('delivery.offer_review_seconds', 90));
    }

    public function isHeldByOther(Delivery $delivery, int $riderId): bool
    {
        return $delivery->review_rider_id !== null
            && (int) $delivery->review_rider_id !== $riderId
            && $delivery->review_expires_at !== null
            && Carbon::parse($delivery->review_expires_at)->isFuture();
    }

    public function isHeldBy(Delivery $delivery, int $riderId): bool
    {
        return $delivery->review_rider_id !== null
            && (int) $delivery->review_rider_id === $riderId
            && $delivery->review_expires_at !== null
            && Carbon::parse($delivery->review_expires_at)->isFuture();
    }

    /**
     * Reserve the offer for this rider.
     *
     * @return array{held: bool, reason?: string, expires_at?: Carbon}
     *               reason: reviewing (another rider holds it), taken, unavailable
     */
    public function acquire(int $deliveryId, int $riderId): array
    {
        return DB::transaction(function () use ($deliveryId, $riderId) {
            $locked = Delivery::lockForUpdate()->find($deliveryId);

            if (! $locked) {
                return ['held' => false, 'reason' => 'unavailable'];
            }
            if ($locked->rider_id !== null) {
                return ['held' => false, 'reason' => 'taken'];
            }
            if (($locked->status?->value ?? $locked->status) !== 'waiting') {
                return ['held' => false, 'reason' => 'unavailable'];
            }
            if ($this->isHeldByOther($locked, $riderId)) {
                return ['held' => false, 'reason' => 'reviewing', 'expires_at' => Carbon::parse($locked->review_expires_at)];
            }

            // One hold per rider: opening a new offer frees any other one.
            Delivery::where('review_rider_id', $riderId)
                ->where('id', '!=', $locked->id)
                ->update(['review_rider_id' => null, 'review_expires_at' => null]);

            // Re-opening your own live hold keeps its original expiry (no
            // endless renewal by refreshing); a new or lapsed hold starts fresh.
            $expiresAt = $this->isHeldBy($locked, $riderId)
                ? Carbon::parse($locked->review_expires_at)
                : now()->addSeconds($this->seconds());

            $locked->update(['review_rider_id' => $riderId, 'review_expires_at' => $expiresAt]);

            return ['held' => true, 'expires_at' => $expiresAt];
        });
    }

    /**
     * Heartbeat while the reviewer's page is open (no visible timer,
     * product decision 2026-11-07): extends the reviewer's own hold, or
     * re-takes a lapsed hold if nobody else took it. Never steals a live hold
     * from another rider. An abandoned page stops renewing and the hold lapses
     * after offer_review_seconds.
     *
     * @return array{held: bool, reason?: string}
     */
    public function renew(int $deliveryId, int $riderId): array
    {
        return DB::transaction(function () use ($deliveryId, $riderId) {
            $locked = Delivery::lockForUpdate()->find($deliveryId);

            if (! $locked || ($locked->status?->value ?? $locked->status) !== 'waiting') {
                return ['held' => false, 'reason' => 'unavailable'];
            }
            if ($locked->rider_id !== null) {
                return ['held' => false, 'reason' => 'taken'];
            }
            if ($this->isHeldByOther($locked, $riderId)) {
                return ['held' => false, 'reason' => 'reviewing'];
            }

            $locked->update(['review_rider_id' => $riderId, 'review_expires_at' => now()->addSeconds($this->seconds())]);

            return ['held' => true];
        });
    }

    /** Give the offer back (only the holder can). Idempotent. */
    public function release(int $deliveryId, int $riderId): void
    {
        Delivery::where('id', $deliveryId)
            ->where('review_rider_id', $riderId)
            ->update(['review_rider_id' => null, 'review_expires_at' => null]);
    }
}
