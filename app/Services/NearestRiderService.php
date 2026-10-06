<?php

namespace App\Services;

use App\Enums\TripStatus;
use App\Events\DeliveryAssigned;
use App\Events\DeliveryStatusChanged;
use App\Models\BookingDispatchLog;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderEarning;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class NearestRiderService
{
    const DISPATCH_TIMEOUT_SECONDS = 120;

    const MAX_DELIVERY_RADIUS_KM = 50;

    /**
     * Statuses that keep a rider tied to a delivery while the job is on the
     * road. A 'delivered' row must NOT count on its own — the query helper
     * activeBindingsQuery() only includes it while cash collection is still
     * pending (see below), so a settled/prepaid delivery never blocks a rider
     * from taking the next order.
     */
    const COD_ACTIVE_STATUSES = [
        'assigned',
        'arrived_pickup',
        'picked_up',
        'in_transit',
        'arrived_destination',
    ];

    /**
     * Deliveries that still bind a rider to an active job:
     *  - any in-road status (assigned → arrived_destination), or
     *  - a delivered COD awaiting cash settlement (cash_due set, not yet settled).
     * Delivered + settled or prepaid deliveries are terminal and free.
     */
    private function activeBindingsQuery(?int $riderId = null): Builder
    {
        return Delivery::query()
            ->when($riderId !== null, fn ($q) => $q->where('rider_id', $riderId))
            ->where(function ($q) {
                $q->whereIn('status', self::COD_ACTIVE_STATUSES)
                    ->orWhere(function ($cod) {
                        $cod->where('status', 'delivered')
                            ->whereNotNull('cash_due')
                            ->whereNull('cash_settled_at');
                    });
            });
    }

    public function __construct() {}

    public function findNearestAvailableRiders(float $pickupLat, float $pickupLng, string $serviceType = 'food', int $limit = 5, ?int $municipalityId = null): Collection
    {
        return $this->findNearestFromMySql($pickupLat, $pickupLng, $serviceType, $limit, $municipalityId);
    }

    protected function findNearestFromMySql(float $pickupLat, float $pickupLng, string $serviceType = 'food', int $limit = 5, ?int $municipalityId = null): Collection
    {
        $excludeRiderIds = $this->getBusyRiderIds();

        return User::where('role', User::ROLE_RIDER)
            ->where('account_status', User::ACCOUNT_STATUS_APPROVED)
            ->whereHas('riderDetail', function ($q) use ($serviceType) {
                $q->whereIn('rider_status', [
                    User::RIDER_STATUS_ONLINE,
                    User::RIDER_STATUS_AVAILABLE,
                ])
                    ->where('current_service', $serviceType);
            })
            ->when($municipalityId, function ($q) use ($municipalityId) {
                $q->where(function ($sub) use ($municipalityId) {
                    $sub->whereNull('municipality_id')
                        ->orWhere('municipality_id', $municipalityId);
                });
            })
            ->whereNotIn('id', $excludeRiderIds)
            ->whereHas('locations')
            ->select('users.*')
            ->selectRaw('(
                6371 * ACOS(
                    COS(RADIANS(?)) * COS(RADIANS((SELECT latitude FROM rider_locations WHERE rider_id = users.id ORDER BY recorded_at DESC LIMIT 1))) *
                    COS(RADIANS((SELECT longitude FROM rider_locations WHERE rider_id = users.id ORDER BY recorded_at DESC LIMIT 1)) - RADIANS(?)) +
                    SIN(RADIANS(?)) * SIN(RADIANS((SELECT latitude FROM rider_locations WHERE rider_id = users.id ORDER BY recorded_at DESC LIMIT 1)))
                )
            ) AS distance_km', [$pickupLat, $pickupLng, $pickupLat])
            ->having('distance_km', '<', self::MAX_DELIVERY_RADIUS_KM)
            ->orderBy('distance_km')
            ->limit($limit)
            ->with(['locations' => function ($q) {
                $q->latest('recorded_at')->limit(1);
            }])
            ->get();
    }

    /**
     * COD assignments use a stricter candidate list than regular deliveries.
     * Distance is calculated only after the inexpensive account/status checks.
     *
     * COD eligibility is CREDIT-FREE (step 3): a rider's wallet balance, credit
     * reserve and the protected ₱200 reserve are NOT consulted. The rider
     * collects the purchase cost in cash on hand at the drop-off and keeps it;
     * only the one-active-delivery + active-order-limit rules gate COD offers.
     */
    protected function findNearestEligibleCodRiders(
        Delivery $delivery,
        float $pickupLat,
        float $pickupLng,
        string $serviceType,
        int $limit,
        ?int $municipalityId
    ): Collection {
        $maxDistance = (float) config('delivery.cod_max_pickup_distance_km', 5);
        $locationMaxAge = (int) config('delivery.cod_location_max_age_minutes', 5);

        $riders = User::query()
            ->where('role', User::ROLE_RIDER)
            ->where('account_status', User::ACCOUNT_STATUS_APPROVED)
            ->whereHas('riderDetail', function ($q) use ($serviceType) {
                $q->where('rider_status', User::RIDER_STATUS_AVAILABLE)
                    ->where('current_service', $serviceType);
            })
            ->when($municipalityId, function ($q) use ($municipalityId) {
                $q->where(function ($sub) use ($municipalityId) {
                    $sub->whereNull('municipality_id')
                        ->orWhere('municipality_id', $municipalityId);
                });
            })
            ->with([
                'riderDetail',
                'locations' => fn ($q) => $q->latest('recorded_at')->limit(1),
            ])
            ->get();

        return $riders
            ->map(function (User $rider) use ($pickupLat, $pickupLng, $maxDistance, $locationMaxAge) {
                $location = $rider->locations->first();
                $lat = $location?->latitude;
                $lng = $location?->longitude;

                if (
                    $lat === null || $lng === null ||
                    (float) $lat === 0.0 || (float) $lng === 0.0 ||
                    ! $location?->recorded_at ||
                    $location->recorded_at->lt(now()->subMinutes($locationMaxAge))
                ) {
                    return null;
                }

                $distance = $this->calculateDistance($pickupLat, $pickupLng, (float) $lat, (float) $lng);
                if ($distance > $maxDistance || ! $this->passesCodActiveOrderLimit($rider)) {
                    return null;
                }

                $rider->distance_km = $distance;

                return $rider;
            })
            ->filter()
            ->sortBy('distance_km')
            ->take($limit)
            ->values();
    }

    private function passesCodActiveOrderLimit(User $rider): bool
    {
        $detail = $rider->riderDetail;
        if (! $detail) {
            return false;
        }

        $activeLimit = (int) ($detail->active_order_limit ?: config('delivery.cod_active_order_limit', 2));
        $activeOrders = $this->activeBindingsQuery($rider->id)->count();

        return $activeOrders < $activeLimit;
    }

    public function isCodDelivery(Delivery $delivery): bool
    {
        $order = $delivery->primaryOrder();
        $method = $order?->payment_method;

        if ($method === null && $delivery->isGroup()) {
            $method = $delivery->groupCheckout?->payment_method;
        }

        return strtolower((string) $method) === 'cash';
    }

    /**
     * Accept-time eligibility gate. Re-checked ATOMICALLY under the delivery +
     * rider row locks when the rider accepts, so dispatch-time eligibility is
     * verified a second time against the authoritative state:
     *
     *   - account must still be approved,
     *   - the rider must still be on the exact service that was pinged,
     *   - COD additionally requires 'available' + room under the active limit
     *     (and freezes the cash-due snapshot once the rider passes).
     *
     * The ONE-active-delivery rule is enforced separately on the rider row by
     * the caller, so it is not duplicated here.
     */
    public function validateRiderAcceptance(Delivery $delivery, int $riderId): bool
    {
        return DB::transaction(function () use ($delivery, $riderId) {
            $rider = User::lockForUpdate()->find($riderId);
            $lockedDelivery = Delivery::with('order', 'groupCheckout')->lockForUpdate()->find($delivery->id);
            $detail = $rider?->riderDetail()->lockForUpdate()->first();

            if (! $detail || ! $lockedDelivery || $lockedDelivery->rider_id !== null) {
                return false;
            }

            if ($rider->account_status !== User::ACCOUNT_STATUS_APPROVED) {
                return false;
            }

            if ($this->isCodDelivery($lockedDelivery)) {
                $activeLimit = (int) ($detail->active_order_limit ?: config('delivery.cod_active_order_limit', 2));
                $activeOrders = $this->activeBindingsQuery($riderId)
                    ->lockForUpdate()
                    ->count();

                if ($detail->rider_status !== User::RIDER_STATUS_AVAILABLE || $activeOrders >= $activeLimit) {
                    return false;
                }

                $lockedDelivery->update([
                    'cash_due' => $this->codAmountDue($lockedDelivery),
                ]);

                return true;
            }

            // Non-COD: mirror the dispatch-time gates (still online/available
            // on the exact service that was pinged).
            if (! in_array($detail->rider_status, [User::RIDER_STATUS_ONLINE, User::RIDER_STATUS_AVAILABLE], true)) {
                return false;
            }

            $serviceType = $lockedDelivery->primaryOrder()?->order_type === 'transport' ? 'transport' : 'food';

            return $detail->current_service === $serviceType;
        });
    }

    /**
     * Compatibility shim kept for the COD-dispatch suite. Delegates to the
     * generalized gate so every acceptance path shares one eligibility rule set.
     */
    public function validateCodAcceptance(Delivery $delivery, int $riderId): bool
    {
        return $this->validateRiderAcceptance($delivery, $riderId);
    }

    /**
     * Printable cash amount the tourist owes the rider at the drop-off:
     * the full order total (standalone) or the group grand total.
     */
    private function codAmountDue(Delivery $delivery): float
    {
        if ($delivery->isGroup()) {
            return round((float) ($delivery->groupCheckout?->grand_total ?? 0), 2);
        }

        $order = $delivery->order;

        return round((float) ($order?->total ?? $order?->rider_financed_amount ?? $order?->subtotal ?? 0), 2);
    }

    /**
     * P9 canonical terminal-cancel: cancel a delivery (and release any COD
     * credit reserve) ONLY if it has not already reached a terminal state.
     *
     * The delivery row is locked so this cannot race a rider's accept /
     * complete transition: whichever transaction wins the row decides the
     * state, and the loser re-reads the committed value under the same lock.
     */
    public function cancelDelivery(?Delivery $delivery): void
    {
        if (! $delivery) {
            return;
        }

        $cancelled = DB::transaction(function () use ($delivery): bool {
            $locked = Delivery::with('order')->lockForUpdate()->find($delivery->id);

            if (! $locked) {
                return false;
            }

            $status = $locked->status->value ?? $locked->status;

            if (in_array(
                $status,
                [TripStatus::DELIVERED->value, TripStatus::COMPLETED->value, TripStatus::CANCELLED->value],
                true
            )) {
                return false; // Already terminal (or delivered): nothing to cancel.
            }

            $locked->update([
                'status' => TripStatus::CANCELLED->value,
                'dispatch_status' => null,
                // Observable terminal end of the dispatch cycle (master spec §49).
                'dispatch_ended_at' => now(),
                'dispatch_end_reason' => 'order_cancelled',
            ]);

            // Stale-busy guard: cancellation must also release the rider state
            // this delivery owns. Otherwise the rider stays 'busy' forever and
            // every later POST /rider/availability/toggle answers 409 Conflict
            // ("You are currently on a delivery") even though the delivery no
            // longer exists operationally. The release runs INSIDE this
            // transaction so the invariant is atomic with the cancellation.
            //
            // The release is conditional (never a blind 'available' write):
            //  - only when the rider is still marked 'busy', and
            //  - only when no OTHER non-terminal delivery keeps them occupied
            //    (a COD delivery parked at 'delivered' until settle-cod counts
            //    as occupying, so it is never released by this path).
            // The accept path writes rider_id + rider_status='busy' in ONE
            // transaction, so a concurrent accept either is already visible
            // here (we skip the release) or commits after us and overwrites
            // the rider back to 'busy'. Both orderings stay correct.
            $riderId = $locked->rider_id;

            if ($riderId !== null && $this->riderBusyStateOwnedBy($locked, $riderId)) {
                User::find($riderId)?->riderDetail()?->updateOrCreate(
                    ['user_id' => $riderId],
                    ['rider_status' => User::RIDER_STATUS_AVAILABLE, 'rider_status_updated_at' => now()]
                );
            }

            return true;
        });

        // P11.5 — best-effort realtime notification: evict the trip from the
        // socket engine's transient RAM state and notify authorized rooms. The
        // duplicate-cancel guard above keeps repeated calls as no-ops.
        if ($cancelled) {
            try {
                $current = $delivery->fresh();
                app(WebsocketNotifierService::class)->notifyTripCancelled(
                    $current?->id ?? $delivery->id,
                    $current?->rider_id,
                );
            } catch (\Throwable $e) {
                // Real-time bridge unavailable; cancellation remains authoritative in the DB.
            }
        }
    }

    /**
     * Does the delivery being cancelled still own the rider's 'busy' state?
     *
     * True only when the rider is marked 'busy' AND has no other delivery
     * outside a terminal state (completed/cancelled). This is what keeps a
     * genuinely occupied rider busy while releasing a rider whose only
     * delivery just got cancelled.
     */
    private function riderBusyStateOwnedBy(Delivery $delivery, int $riderId): bool
    {
        $isBusy = User::find($riderId)?->riderDetail?->rider_status === User::RIDER_STATUS_BUSY;

        if (! $isBusy) {
            return false;
        }

        return ! Delivery::where('rider_id', $riderId)
            ->where('id', '!=', $delivery->id)
            ->whereNotIn('status', [TripStatus::COMPLETED->value, TripStatus::CANCELLED->value])
            ->exists();
    }

    /**
     * Cancel the delivery that fulfills an order.
     *
     * Standalone orders cancel their own delivery. Group sub-orders cancel the
     * group's shared delivery ONLY when no other non-terminal sibling order
     * still needs the trip, preserving the one-delivery-per-group invariant
     * and the group-cancel guard (4.4).
     */
    public function cancelDeliveryForOrder(Order $order): void
    {
        $delivery = $order->activeDelivery();
        if (! $delivery) {
            return;
        }

        if ($order->group_order_id === null) {
            $this->cancelDelivery($delivery);

            return;
        }

        $group = $order->groupOrder;
        if (! $group) {
            $this->cancelDelivery($delivery);

            return;
        }

        $terminalStatuses = [
            TripStatus::DELIVERED->value,
            TripStatus::COMPLETED->value,
            TripStatus::CANCELLED->value,
        ];

        $otherActiveSiblings = $group->orders()
            ->where('id', '!=', $order->id)
            ->whereNotIn('status', $terminalStatuses)
            ->exists();

        if ($otherActiveSiblings) {
            return; // The shared trip still serves another restaurant order.
        }

        $this->cancelDelivery($delivery);
    }

    public function getCodEligibility(User $rider): array
    {
        $rider->load('riderDetail');
        $detail = $rider->riderDetail;

        $activeOrders = $this->activeBindingsQuery($rider->id)->count();
        $activeLimit = (int) ($detail?->active_order_limit ?: config('delivery.cod_active_order_limit', 2));

        return [
            'account_approved' => $rider->account_status === User::ACCOUNT_STATUS_APPROVED,
            'online' => in_array($detail?->rider_status, [User::RIDER_STATUS_ONLINE, User::RIDER_STATUS_AVAILABLE], true),
            'available' => $detail?->rider_status === User::RIDER_STATUS_AVAILABLE,
            'suspended' => $rider->account_status === User::ACCOUNT_STATUS_SUSPENDED,
            'active_orders' => $activeOrders,
            'active_order_limit' => $activeLimit,
            'cod_eligibility' => $rider->account_status === User::ACCOUNT_STATUS_APPROVED
                && $detail?->rider_status === User::RIDER_STATUS_AVAILABLE
                && $activeOrders < $activeLimit,
            'max_pickup_distance_km' => (float) config('delivery.cod_max_pickup_distance_km', 5),
        ];
    }

    public function dispatchToNearest(Delivery $delivery, string $serviceType = 'food', ?int $municipalityId = null): ?User
    {
        // P3 (master spec §17/§19): ONE authoritative layer bounds every dispatch
        // entry point — scheduler retry, decline/timeout re-offer, dispatch-on-ready
        // — by the 60-minute cycle deadline. On expiry the delivery terminally
        // fails with an observable reason instead of retrying forever.
        if ($this->dispatchCycleExpired($delivery)) {
            $this->failDispatch($delivery, $this->terminalEndReason($delivery));

            return null;
        }

        $pickupLat = $delivery->pickup_latitude;
        $pickupLng = $delivery->pickup_longitude;

        if (! $pickupLat || ! $pickupLng) {
            // No silent dead end (master spec §19): an undeliverable pickup parks
            // with a retry; the attempt cap / cycle deadline later records
            // dispatch_end_reason='invalid_pickup_coordinates'.
            Log::warning('[COD Dispatch] exclusion_reason=invalid_pickup_coordinates', [
                'delivery_id' => $delivery->id,
                'order_id' => $delivery->order_id,
            ]);
            $this->parkForRetry($delivery);

            return null;
        }

        // P5.2 basic order-size safeguard (flag-only): refresh the order's size
        // tag and surface unusually large orders for operational review. This
        // does NOT gate dispatch - the one-active-delivery rule remains the only
        // hard constraint - it only makes large orders operationally visible.
        $orderForSize = $delivery->primaryOrder();
        if ($orderForSize) {
            $sizeClass = app(OrderSizeClassifier::class)->sync($orderForSize);
            if ($sizeClass === OrderSizeClassifier::LARGE) {
                Log::warning('[Dispatch] large order flagged for operational review (dispatched normally)', [
                    'delivery_id' => $delivery->id,
                    'order_id' => $orderForSize->id,
                    'size_class' => $sizeClass,
                ]);
            }
        }

        $isCod = $this->isCodDelivery($delivery);

        $priorOffers = BookingDispatchLog::where('delivery_id', $delivery->id)
            ->get(['rider_id', 'response']);

        $alreadyDispatchedRiderIds = $priorOffers->pluck('rider_id')->all();

        // A TIMED-OUT offer is not a claim: the rider never answered (missed
        // ping, closed app, dropped socket), so that rider must become
        // offerable again on the next cycle. Without reopening it, a single
        // missed ping permanently excluded the rider from this delivery —
        // UNIQUE(delivery_id, rider_id) forbids a second row, so there was no
        // path back and a delivery whose only candidate timed out dead-ended.
        // Declined / pending / accepted offers still block: a decline is an
        // answer, and an active or accepted offer must never be disturbed
        // (offer state machine + one-active-delivery rule unchanged).
        $reofferableRiderIds = $priorOffers
            ->filter(fn (BookingDispatchLog $offer) => $offer->response === 'timeout')
            ->pluck('rider_id')
            ->all();

        $nearestRiders = $isCod
            ? $this->findNearestEligibleCodRiders($delivery, (float) $pickupLat, (float) $pickupLng, $serviceType, 5, $municipalityId)
            : $this->findNearestAvailableRiders((float) $pickupLat, (float) $pickupLng, $serviceType, 5, $municipalityId);

        Log::info('[SocketDispatch] eligible MySQL riders', [
            'delivery_id' => $delivery->id,
            'count' => $nearestRiders->count(),
            'ids' => $nearestRiders->pluck('id')->all(),
        ]);

        // P3 diagnostics (master spec §57/§58): make "eligible riders = 0"
        // explain itself instead of being an opaque empty count.
        Log::info(sprintf(
            '[COD Dispatch] delivery=%d eligible riders=%d riders=[%s]',
            $delivery->id,
            $nearestRiders->count(),
            implode(',', $nearestRiders->pluck('id')->all())
        ));

        if ($nearestRiders->isEmpty() && $isCod) {
            $this->logCodExclusionDiagnostics($delivery, (float) $pickupLat, (float) $pickupLng, $serviceType, $municipalityId);
        }

        // Simultaneous-offer dispatch: ping EVERY eligible nearest rider (up to
        // the limit), not just the closest one. Each ping is a dedicated offer
        // (a booking_dispatch_logs 'pending' row + its own websocket ping). A
        // ping is never an assignment — acceptance is the atomic assignment, and
        // only the first accepted offer affects the delivery's rider_id.
        $waveRider = null;
        $offersMade = false;

        foreach ($nearestRiders as $rider) {
            if (
                in_array($rider->id, $alreadyDispatchedRiderIds)
                && ! in_array($rider->id, $reofferableRiderIds)
            ) {
                continue;
            }

            $distance = $rider->distance_km ?? $this->calculateDistance(
                (float) $pickupLat, (float) $pickupLng,
                (float) ($rider->locations->first()?->latitude ?? 0),
                (float) ($rider->locations->first()?->longitude ?? 0)
            );

            // updateOrCreate, not create: a rider whose previous offer TIMED
            // OUT has a row already (UNIQUE delivery/rider), so the reopen is
            // an UPDATE back to 'pending'. Every other prior response is
            // filtered out above and can never reach here.
            BookingDispatchLog::updateOrCreate(
                [
                    'delivery_id' => $delivery->id,
                    'rider_id' => $rider->id,
                ],
                [
                    'distance_km' => $distance,
                    'response' => 'pending',
                    'dispatched_at' => now(),
                    'responded_at' => null,
                ]
            );

            $expiresAt = now()->addSeconds(self::DISPATCH_TIMEOUT_SECONDS);

            $delivery->update([
                'dispatch_status' => 'notified',
                'dispatch_expires_at' => $expiresAt,
            ]);

            // Real-time WebSocket ping: notify the socket engine so the selected
            // rider gets an instant order_received_ping over the socket bridge.
            app(WebsocketNotifierService::class)->notifyDispatch([
                'deliveryId' => $delivery->id,
                'orderId' => $delivery->order_id,
                'restaurantName' => $delivery->primaryOrder()?->business?->name ?? 'Restaurant',
                'restaurantLat' => $delivery->pickup_latitude,
                'restaurantLng' => $delivery->pickup_longitude,
                'riderId' => $rider->id,
                'timeoutSeconds' => self::DISPATCH_TIMEOUT_SECONDS,
            ]);

            $waveRider ??= $rider;
            $offersMade = true;
        }

        if ($offersMade) {
            return $waveRider;
        }

        // No eligible rider found via MySQL (e.g. rider_locations is stale because
        // the rider is idle and not persisting location). Fall back to the live
        // socket radar so an online rider STILL receives a pollable dispatch
        // request via HTTP polling even if the websocket ping is missed.
        Log::warning('[SocketDispatch] no MySQL rider candidate, falling back to socket radar', [
            'delivery_id' => $delivery->id,
            'service_type' => $serviceType,
            'municipality_id' => $municipalityId,
        ]);

        $notifier = app(WebsocketNotifierService::class);
        $onlineRiders = $notifier->getOnlineRidersFromBridge();
        $busyRiderIds = $this->getBusyRiderIds();
        $radarMaxAgeMs = ((int) config('delivery.radar_location_max_age_seconds', 120)) * 1000;
        $nowMs = (int) floor(microtime(true) * 1000);
        $radarExclusions = [];

        $candidates = [];
        foreach ($onlineRiders as $rider) {
            if (($rider['status'] ?? '') !== 'available') {
                continue; // busy/offline radar entries are normal, not exclusions
            }
            $riderId = (int) ($rider['riderId'] ?? 0);
            $lat = (float) ($rider['lat'] ?? 0);
            $lng = (float) ($rider['lng'] ?? 0);
            if ($riderId <= 0 || $lat === 0.0 || $lng === 0.0) {
                continue;
            }
            if (
                in_array($riderId, $alreadyDispatchedRiderIds, true)
                && ! in_array($riderId, $reofferableRiderIds, true)
            ) {
                $radarExclusions[$riderId] = 'already_offered';
                continue;
            }

            // B2 (Option C, master spec §14): the live radar is the GPS freshness
            // source, but only for riders who reported inside the freshness window
            // (mirrors socket-validation.js LIMITS.radarStaleMs). A null updatedAt
            // means the bridge never stamped one — treat as fresh; the entry still
            // must pass every COD gate below on its LIVE coordinates.
            $updatedAt = $rider['updatedAt'] ?? null;
            if ($updatedAt !== null && ($nowMs - (int) $updatedAt) > $radarMaxAgeMs) {
                $radarExclusions[$riderId] = 'radar_gps_stale';
                continue;
            }

            // B1 (master spec §10): the blanket busy exclusion IS the non-COD
            // one-active-delivery rule (it mirrors findNearestFromMySql's
            // whereNotIn(getBusyRiderIds)). COD must NOT use it here: the primary
            // COD query applies no blanket exclusion, only the configured
            // active-order limit — so a rider below the COD limit with one
            // unsettled delivered COD must stay radar-eligible.
            if (! $isCod && in_array($riderId, $busyRiderIds, true)) {
                $radarExclusions[$riderId] = 'busy';
                continue;
            }

            if ($isCod) {
                $candidate = User::with('riderDetail')->find($riderId);
                $reason = null;
                if (! $candidate) {
                    $reason = 'not_found';
                } elseif ($candidate->account_status !== User::ACCOUNT_STATUS_APPROVED) {
                    $reason = 'not_approved';
                } elseif ($candidate->riderDetail?->rider_status !== User::RIDER_STATUS_AVAILABLE) {
                    $reason = 'not_available';
                } elseif ($candidate->riderDetail?->current_service !== $serviceType) {
                    $reason = 'wrong_service';
                } elseif ($this->calculateDistance((float) $delivery->pickup_latitude, (float) $delivery->pickup_longitude, $lat, $lng) >
                    (float) config('delivery.cod_max_pickup_distance_km', 5)) {
                    $reason = 'too_far';
                } elseif (! $this->passesCodActiveOrderLimit($candidate)) {
                    $reason = 'active_order_limit';
                }

                if ($reason !== null) {
                    $radarExclusions[$riderId] = $reason;
                    continue;
                }
            }

            $candidates[] = [
                'rider_id' => $riderId,
                'distance_km' => $this->calculateDistance(
                    (float) $delivery->pickup_latitude,
                    (float) $delivery->pickup_longitude,
                    $lat,
                    $lng
                ),
            ];
        }

        if ($candidates === [] && $radarExclusions !== []) {
            // P3 diagnostics (master spec §58): the radar saw riders but none
            // qualified — say why instead of only logging "0 candidates".
            Log::info('[COD Dispatch] radar exclusions', [
                'delivery_id' => $delivery->id,
                'exclusions' => $radarExclusions,
            ]);
        }

        usort($candidates, fn ($a, $b) => $a['distance_km'] <=> $b['distance_km']);

        if (! empty($candidates)) {
            // Simultaneous-offer dispatch on the radar fallback too: every
            // candidate gets its own pending offer + ping; the closest is the
            // one returned to the caller.
            $waveRider = null;
            $offersMade = false;

            foreach ($candidates as $target) {
                $targetRiderId = $target['rider_id'];

                BookingDispatchLog::create([
                    'delivery_id' => $delivery->id,
                    'rider_id' => $targetRiderId,
                    'distance_km' => $target['distance_km'],
                    'response' => 'pending',
                    'dispatched_at' => now(),
                ]);

                $delivery->update([
                    'dispatch_status' => 'notified',
                    'dispatch_expires_at' => now()->addSeconds(self::DISPATCH_TIMEOUT_SECONDS),
                ]);

                // Ping the specific socket so the rider gets an instant notification;
                // even if this fails, the HTTP poll (/rider/dispatch/pending-request)
                // will surface the BookingDispatchLog created above.
                $notifier->notifyDispatch([
                    'deliveryId' => $delivery->id,
                    'orderId' => $delivery->order_id,
                    'restaurantName' => $delivery->primaryOrder()?->business?->name ?? 'Restaurant',
                    'restaurantLat' => $delivery->pickup_latitude,
                    'restaurantLng' => $delivery->pickup_longitude,
                    'riderId' => $targetRiderId,
                    'timeoutSeconds' => self::DISPATCH_TIMEOUT_SECONDS,
                ]);

                Log::info('[SocketDispatch] socket-radar rider dispatched via HTTP-poll fallback', [
                    'delivery_id' => $delivery->id,
                    'rider_id' => $targetRiderId,
                    'distance_km' => round($target['distance_km'], 2),
                    'candidates' => count($candidates),
                ]);

                $waveRider ??= User::find($targetRiderId);
                $offersMade = true;
            }

            if ($offersMade) {
                return $waveRider;
            }
        }

        // No rider candidate in MySQL OR on the socket radar. Still broadcast a
        // blind radar ping (in case a rider connects in the next moment) and mark
        // the request as unavailable so the merchant can see the state.
        $notifier->notifyDispatch([
            'deliveryId' => $delivery->id,
            'orderId' => $delivery->order_id,
            'restaurantName' => $delivery->primaryOrder()?->business?->name ?? 'Restaurant',
            'restaurantLat' => $delivery->pickup_latitude,
            'restaurantLng' => $delivery->pickup_longitude,
            'riderId' => null,
            'timeoutSeconds' => self::DISPATCH_TIMEOUT_SECONDS,
        ]);

        // Schedule the retry NOW: `no_rider_available` used to be a terminal
        // dead end (the scheduler only selected 'scheduled'/'dispatching', and
        // dispatch-on-ready is gated on 'scheduled'), so a checkout-time
        // failure meant the order could never receive a rider later. Parking
        // dispatch_retry_at hands the delivery to the canonical
        // ScheduledDispatchProcessor loop, which re-runs this same pipeline
        // every retry_after_minutes until max_retries, then dispatch_failed.
        $this->parkForRetry($delivery);

        return null;
    }

    public function handleRiderResponse(int $deliveryId, int $riderId, string $response): array
    {
        $log = BookingDispatchLog::where('delivery_id', $deliveryId)
            ->where('rider_id', $riderId)
            ->where('response', 'pending')
            ->latest()
            ->first();

        if (! $log) {
            return [
                'success' => false,
                'message' => 'No pending dispatch request found.',
                'conflict' => true,
            ];
        }

        if ($response !== 'accepted') {
            return $this->handleNonAcceptResponse($log, $deliveryId, $riderId, $response);
        }

        $delivery = Delivery::findOrFail($deliveryId);
        $delivery->load('order');

        // Offer-level freshness check (cheap, before the locks): an expired
        // offer is recorded as 'timeout' and the delivery re-offered to a fresh
        // wave once no other rider still holds a live offer.
        if ($this->offerIsExpired($log, $delivery)) {
            return $this->expireOffer($log, $delivery);
        }

        // Serialize concurrent accepts on the delivery row FIRST (the
        // authoritative dispatch object): two different riders accepting the
        // SAME delivery serialize on it, and whichever loses sees the winner's
        // committed assignment under the lock. The rider row is also locked to
        // enforce the one-active-delivery business rule, and the offer row is
        // re-checked inside the same isolated snapshot so an expired/cancelled
        // offer can never slide into the atomic assignment.
        $outcome = DB::transaction(function () use ($delivery, $deliveryId, $riderId, $log) {
            $lockedDelivery = Delivery::with('order')->lockForUpdate()->find($deliveryId);

            if (! $lockedDelivery) {
                return 'not_found';
            }

            if ($lockedDelivery->rider_id !== null) {
                return 'already_assigned';
            }

            User::where('id', $riderId)->lockForUpdate()->first();

            // Re-check the offer under the lock: a concurrent expiry/cancel
            // must not race into the assignment.
            $lockedLog = BookingDispatchLog::lockForUpdate()->find($log->id);
            if (! $lockedLog || $lockedLog->response !== 'pending') {
                return 'offer_gone';
            }

            if ($this->offerIsExpired($lockedLog, $lockedDelivery)) {
                $lockedLog->update(['response' => 'timeout', 'responded_at' => now()]);

                return 'offer_expired';
            }

            $alreadyActive = $this->activeBindingsQuery($riderId)
                ->where('id', '!=', $lockedDelivery->id)
                ->exists();

            if ($alreadyActive) {
                return 'already_active';
            }

            if (! $this->validateRiderAcceptance($lockedDelivery, $riderId)) {
                return 'ineligible';
            }

            // The offer and the assignment commit atomically: no gap exists in
            // which another process could see 'accepted' without the delivery
            // bound to this rider (or vice versa).
            $lockedLog->update(['response' => 'accepted', 'responded_at' => now()]);

            $lockedDelivery->update([
                'rider_id' => $riderId,
                'status' => 'assigned',
                'assigned_at' => now(),
                'dispatch_status' => null,
                'dispatch_expires_at' => null,
                // Observable terminal end of the dispatch cycle (master spec §49).
                'dispatch_ended_at' => now(),
                'dispatch_end_reason' => 'rider_accepted',
            ]);

            User::where('id', $riderId)->first()?->riderDetail()?->updateOrCreate(
                ['user_id' => $riderId],
                ['rider_status' => 'busy', 'rider_status_updated_at' => now()]
            );

            // Purchasing-cash flow: create the per-restaurant cod_purchases
            // stops atomically with the assignment so the Tourism Office can
            // issue the purchasing cash immediately (idempotent).
            if ($this->isCodDelivery($lockedDelivery)) {
                app(PurchasingCashService::class)->initializeForDelivery($lockedDelivery);
            }

            return 'assigned';
        });

        if ($outcome !== 'assigned') {
            return $this->rejectAcceptOutcome($outcome, $log, $delivery);
        }

        // One active delivery: withdraw this rider's other outstanding offers
        // (their other deliveries are re-offered only when unclaimed), and
        // cancel the losing riders' offers on the claimed delivery so no other
        // rider can still see it as available. The winner's offer was already
        // set to 'accepted' atomically inside the transaction.
        $this->cancelOtherPendingOffers($riderId, $delivery->id);
        $this->cancelOtherRidersOffersForDelivery($delivery->id, $riderId);

        // Push the authoritative assignment to the real-time engine so only
        // this rider's socket may stream location into the trip room. Best
        // effort: the database assignment is the source of truth.
        try {
            app(WebsocketNotifierService::class)->notifyTripAssigned($delivery->id, $riderId);
        } catch (\Throwable $e) {
            // Real-time bridge unavailable; dispatch still succeeds.
        }

        // Rider acceptance is what unlocks the restaurant: transition the
        // order(s) waiting_restaurant → PREPARING and start the preparation
        // countdown (restaurant-defined menu prep time, snapshot-guarded).
        // Must run BEFORE DeliveryAssigned so listeners observing the
        // assignment already see the order preparing. Best effort: the
        // orders:advance-preparation scheduler self-heals any failure.
        try {
            app(PreparationStartService::class)->startForDelivery(Delivery::findOrFail($delivery->id));
        } catch (\Throwable $e) {
            Log::warning('[Dispatch] Preparation start failed', [
                'delivery_id' => $delivery->id,
                'error' => $e->getMessage(),
            ]);
        }

        // P11.5 — emit the canonical DeliveryAssigned event so the realtime
        // bridge can notify the restaurant/kitchen, tourist and assigned
        // rider rooms that an accepted rider now exists (preparation may
        // proceed). Always ordered AFTER the DB assignment commits; the
        // database assignment remains the source of truth.
        try {
            $assignedDelivery = Delivery::with('order')->findOrFail($delivery->id);
            $assignedRider = User::find($riderId);

            if ($assignedRider) {
                DeliveryAssigned::dispatch($assignedDelivery, $assignedRider, $assignedDelivery->primaryOrder());
            }
        } catch (\Throwable $e) {
            Log::warning('[Dispatch] DeliveryAssigned event failed', ['error' => $e->getMessage()]);
        }

        return ['success' => true, 'message' => 'Delivery accepted!', 'assigned' => true];
    }

    /**
     * Non-accept rider responses (decline / a poll-triggered timeout). Record
     * the response then re-offer the delivery to a fresh wave, but ONLY once no
     * other rider still holds a live offer on the same delivery — a wave is not
     * replenished until the current offers are exhausted.
     */
    private function handleNonAcceptResponse(BookingDispatchLog $log, int $deliveryId, int $riderId, string $response): array
    {
        $log->update(['response' => $response, 'responded_at' => now()]);

        $delivery = Delivery::with('order.business')->find($deliveryId);
        $nextRider = null;
        if ($delivery && in_array($delivery->dispatch_status, ['notified', 'waiting_for_rider'])) {
            $nextRider = $this->redispatchIfOffered($delivery);
        }

        return [
            'success' => true,
            'message' => 'Delivery declined.',
            'declined' => true,
            'next_dispatched' => $nextRider !== null,
        ];
    }

    /**
     * A pending offer expired before an accept arrived. Record 'timeout' and
     * start a fresh wave only when the delivery is still unclaimed and no other
     * rider holds a live offer.
     */
    private function expireOffer(BookingDispatchLog $log, Delivery $delivery): array
    {
        $log->update(['response' => 'timeout', 'responded_at' => now()]);

        $nextRider = $this->redispatchIfOffered($delivery);

        return [
            'success' => false,
            'message' => 'Request timed out.',
            'timeout' => true,
            'conflict' => true,
            'next_dispatched' => $nextRider !== null,
        ];
    }

    /**
     * Map a failed accept outcome to the canonical error shape. Conflicts
     * (already assigned / active / expired / offer no longer available) are
     * flagged so the API can respond 409 Conflict; ineligibility stays a 422.
     */
    private function rejectAcceptOutcome(string $outcome, BookingDispatchLog $log, Delivery $delivery): array
    {
        if ($outcome === 'offer_gone') {
            // The offer row changed under the lock (expired/cancelled by a
            // concurrent process). Never overwrite another transition.
            return [
                'success' => false,
                'message' => 'This delivery request is no longer available.',
                'conflict' => true,
            ];
        }

        if ($outcome === 'not_found' || $outcome === 'already_assigned') {
            // The delivery is already claimed by another rider (or gone): do NOT
            // re-offer it — there is no slot to re-offer, and a new wave would
            // spam the rider who just won the claim. This rider's offer is gone.
            $this->markOfferCancelled($log);

            return [
                'success' => false,
                'message' => $outcome === 'not_found'
                    ? 'Delivery not found.'
                    : 'This delivery was already accepted by another rider.',
                'already_assigned' => true,
                'conflict' => true,
            ];
        }

        if ($outcome === 'offer_expired') {
            // The offer expired inside the atomic accept window; the log row is
            // already 'timeout'. Re-offer once no other rider holds an offer.
            $nextRider = $this->redispatchIfOffered($delivery);

            return [
                'success' => false,
                'message' => 'Request timed out.',
                'timeout' => true,
                'conflict' => true,
                'next_dispatched' => $nextRider !== null,
            ];
        }

        // already_active / ineligible: this rider's offer is withdrawn and the
        // delivery re-offered to the next eligible rider (only if no other
        // pending offer already covers it).
        $this->markOfferCancelled($log);
        $nextRider = $this->redispatchIfOffered($delivery);

        if ($outcome === 'already_active') {
            return [
                'success' => false,
                'message' => 'You already have an active delivery. Complete it before accepting another.',
                'already_active' => true,
                'conflict' => true,
                'next_dispatched' => $nextRider !== null,
            ];
        }

        return [
            'success' => false,
            'message' => 'You are no longer eligible for this delivery.',
            'next_dispatched' => $nextRider !== null,
        ];
    }

    /**
     * A rider may hold only one active delivery. When they accept one offer,
     * every other outstanding offer to that rider is withdrawn and, if that
     * other delivery is still unclaimed, re-offered to the next available
     * rider (only once its current wave is exhausted).
     */
    private function cancelOtherPendingOffers(int $riderId, int $acceptedDeliveryId): void
    {
        $otherLogs = BookingDispatchLog::where('rider_id', $riderId)
            ->where('response', 'pending')
            ->where('delivery_id', '!=', $acceptedDeliveryId)
            ->get();

        foreach ($otherLogs as $otherLog) {
            $otherLog->update(['response' => 'cancelled', 'responded_at' => now()]);

            $this->notifyOfferCancelled($riderId, $otherLog->delivery_id, 'accepted_another_delivery');

            $this->notifyOfferCancelled($riderId, $otherLog->delivery_id, 'accepted_another_delivery');

            $otherDelivery = Delivery::with('order.business')->find($otherLog->delivery_id);

            if ($otherDelivery && $otherDelivery->rider_id === null) {
                $this->redispatchIfOffered($otherDelivery);
            }
        }
    }

    /**
     * Cancel every other rider's pending offer on the claimed delivery the
     * moment it is won, and tell each losing rider's socket that the offer is
     * no longer available (delivery_offer_cancelled). The claim already
     * committed; the delivery stays bound to the winner.
     */
    private function cancelOtherRidersOffersForDelivery(?int $deliveryId, int $winnerRiderId): void
    {
        if (! $deliveryId) {
            return;
        }

        $loserLogs = BookingDispatchLog::where('delivery_id', $deliveryId)
            ->where('rider_id', '!=', $winnerRiderId)
            ->where('response', 'pending')
            ->get();

        foreach ($loserLogs as $loserLog) {
            $loserLog->update(['response' => 'cancelled', 'responded_at' => now()]);

            $this->notifyOfferCancelled($loserLog->rider_id, $deliveryId);
        }
    }

    /**
     * Withdraw a specific offer row (guarded on 'pending' so a concurrent
     * timeout/accepted transition is never overwritten).
     */
    private function markOfferCancelled(BookingDispatchLog $log): void
    {
        BookingDispatchLog::where('id', $log->id)
            ->where('response', 'pending')
            ->update(['response' => 'cancelled', 'responded_at' => now()]);
    }

    /**
     * Re-offer a delivery to a fresh wave, but never while:
     *   - it already has an accepted rider, or
     *   - it is not in a dispatchable state, or
     *   - any other rider still holds a live pending offer (the wave is not
     *     replenished until every current offer resolves).
     */
    private function redispatchIfOffered(Delivery $delivery): ?User
    {
        if ($delivery->rider_id !== null) {
            return null;
        }

        if (! in_array($delivery->dispatch_status, ['notified', 'waiting_for_rider'], true)) {
            return null;
        }

        if (BookingDispatchLog::where('delivery_id', $delivery->id)
            ->where('response', 'pending')
            ->exists()) {
            return null;
        }

        $serviceType = $delivery->primaryOrder()?->order_type === 'transport' ? 'transport' : 'food';
        $municipalityId = $delivery->primaryOrder()?->business?->municipality_id;

        return $this->dispatchToNearest($delivery, $serviceType, $municipalityId);
    }

    /**
     * Per-offer expiry: the rider's own dispatched_at + the dispatch timeout,
     * bounded above by the wave deadline recorded on the delivery.
     */
    public function offerExpiresAt(BookingDispatchLog $log, ?Delivery $delivery = null): Carbon
    {
        $fromLog = ($log->dispatched_at?->copy() ?? now())->addSeconds(self::DISPATCH_TIMEOUT_SECONDS);
        $waveDeadline = $delivery?->dispatch_expires_at ? Carbon::parse($delivery->dispatch_expires_at) : null;

        return $waveDeadline && $waveDeadline->lt($fromLog) ? $waveDeadline : $fromLog;
    }

    public function offerIsExpired(BookingDispatchLog $log, ?Delivery $delivery = null): bool
    {
        return $this->offerExpiresAt($log, $delivery)->lte(now());
    }

    /**
     * Best-effort realtime notification: tell a rider's socket that one of
     * their offers is no longer available so the UI can drop it instantly. The
     * booking_dispatch_logs row is the source of truth; this is a hint.
     */
    private function notifyOfferCancelled(int $riderId, int $deliveryId, string $code = 'delivery_no_longer_available'): void
    {
        try {
            app(WebsocketNotifierService::class)->notifyStatusEvent('delivery_offer_cancelled', ["rider:{$riderId}"], [
                'delivery_id' => $deliveryId,
                'reason' => $code,
            ]);
        } catch (\Throwable $e) {
            Log::warning('[Dispatch] delivery_offer_cancelled notify failed', ['error' => $e->getMessage()]);
        }
    }

    public function processTimeouts(): void
    {
        $expiredLogs = BookingDispatchLog::where('response', 'pending')
            ->where(function ($q) {
                $q->where('dispatched_at', '<', now()->subSeconds(self::DISPATCH_TIMEOUT_SECONDS))
                    ->orWhereHas('delivery', function ($dq) {
                        $dq->whereNotNull('dispatch_expires_at')
                            ->where('dispatch_expires_at', '<=', now());
                    });
            })
            ->get();

        foreach ($expiredLogs as $log) {
            DB::transaction(function () use ($log) {
                // Lock the delivery row so the timeout expiry cannot race a
                // rider accept/assignment: if the rider claimed it meanwhile,
                // the delivery is NOT re-offered to someone else.
                $lockedDelivery = Delivery::with('order.business')->lockForUpdate()->find($log->delivery_id);

                $log->update(['response' => 'timeout', 'responded_at' => now()]);

                if (! $lockedDelivery || $lockedDelivery->rider_id !== null) {
                    return;
                }

                // The wave still carries other live offers — do not start a fresh
                // wave yet; only re-dispatch once every current offer resolves.
                if (BookingDispatchLog::where('delivery_id', $log->delivery_id)
                    ->where('id', '!=', $log->id)
                    ->where('response', 'pending')
                    ->exists()) {
                    return;
                }

                if (in_array($lockedDelivery->dispatch_status, ['notified', 'waiting_for_rider'])) {
                    $nextRider = $this->redispatchIfOffered($lockedDelivery);
                    if (! $nextRider) {
                        // Wave fully exhausted with no taker: park the retry so
                        // the delivery re-enters the scheduler loop instead of
                        // dying at no_rider_available forever (same reasoning
                        // as the checkout-time failure above).
                        $lockedDelivery->update([
                            'dispatch_status' => 'no_rider_available',
                            'dispatch_retry_at' => now()->addMinutes((int) config('delivery.scheduler.retry_after_minutes', 5)),
                        ]);
                    }
                }
            });
        }
    }

    /**
     * COD hook at the 'delivered' transition: freeze the cash due snapshot and
     * drop the ephemeral trip state in the WebSocket engine. The rider stays
     * busy until cash settlement completes.
     */
    public function markCodDelivered(Delivery $delivery): void
    {
        $order = $delivery->primaryOrder();
        if ($order && $delivery->cash_due === null) {
            $delivery->update(['cash_due' => $this->codAmountDue($delivery)]);
        }

        app(WebsocketNotifierService::class)
            ->notifyTripCompleted($delivery->id, $delivery->rider_id);
    }

    /**
     * Does this delivery trip need the TOURIST to confirm receipt at the
     * drop-off before it may reach 'delivered'? Food deliveries always do (the
     * rider may not mark food 'delivered' — the tourist must confirm they
     * received their food at the destination). Standalone transport rides do
     * NOT: the rider's own 'delivered' action is authoritative for those trips.
     */
    public function requiresTouristConfirmation(Delivery $delivery): bool
    {
        $order = $delivery->primaryOrder();

        if ($order && strtolower((string) ($order->order_type ?? '')) === 'transport') {
            return false;
        }

        // Anything else (group or standalone food delivery, no-order rides)
        // goes through the tourist gate. Group deliveries are always food.
        return $delivery->isGroup() || $order !== null;
    }

    public function completeDelivery(Delivery $delivery, ?array $routeHistory = null): void
    {
        // Record the rider earning for non-COD deliveries. COD earnings are
        // recorded at cash settlement instead (rider only earns once cash is in hand).
        if ($delivery->rider_id && ! $this->isCodDelivery($delivery)) {
            foreach ($delivery->childOrders() as $childOrder) {
                $this->recordEarning($delivery, $childOrder, $delivery->rider_id);
            }
        }

        if ($routeHistory !== null) {
            $delivery->update(['route_history' => $routeHistory]);
        }

        // Zero-DB replacement for the removed Firebase stopTracking path: drop the
        // ephemeral trip state in the WebSocket engine and notify the live room.
        app(WebsocketNotifierService::class)
            ->notifyTripCompleted($delivery->id, $delivery->rider_id);
    }

    /**
     * Tourist delivery-confirmation gate.
     *
     * A food delivery only reaches 'delivered' once the tourist confirms receipt
     * at the drop-off (the rider may NOT mark food deliveries delivered). This is
     * the shared authoritative transition used by the tourist confirm endpoint:
     *
     *     arrived_destination + tourist confirm
     *         → COD: delivered (cash_due frozen; order stays delivered until the
     *                rider settles the cash)
     *         → prepaid: completed (delivery + order terminal together; earnings
     *                recorded; rider released)
     *
     * Runs under a delivery row lock so a racing auto-cancel / restaurant-cancel
     * can never be resurrected. Re-confirming an already terminal delivery is an
     * idempotent no-op.
     *
     * @return array{success: bool, old_status: string, new_status: string}
     *
     * @throws \InvalidArgumentException
     */
    public function confirmDeliveryByTourist(Order $order, int $touristId): array
    {
        $delivery = $order->activeDelivery();

        if (! $delivery) {
            throw new \InvalidArgumentException('No delivery is assigned to this order.');
        }

        if (! $delivery->rider_id) {
            throw new \InvalidArgumentException('Your order is not yet with a rider.');
        }

        if (! $this->requiresTouristConfirmation($delivery)) {
            throw new \InvalidArgumentException('This trip does not require tourist confirmation.');
        }

        if ($delivery->order_id !== null && (int) $delivery->order_id !== (int) $order->id) {
            throw new \InvalidArgumentException('This delivery does not belong to this order.');
        }

        return DB::transaction(function () use ($delivery, $touristId) {
            $locked = Delivery::lockForUpdate()->find($delivery->id);

            if (! $locked) {
                throw new \InvalidArgumentException('Delivery not found.');
            }

            $currentStatus = $locked->status?->value ?? $locked->status;

            // Terminal / cancelled races already committed: re-confirming is a
            // harmless idempotent no-op that reports the true end state.
            if (in_array($currentStatus, ['delivered', 'completed', 'cancelled'], true)) {
                return ['success' => true, 'old_status' => $currentStatus, 'new_status' => $currentStatus];
            }

            if ($currentStatus !== 'arrived_destination') {
                throw new \InvalidArgumentException('Your order has not arrived yet. Please confirm once the rider reaches you.');
            }

            $oldStatus = $currentStatus;

            $locked->update([
                'status' => 'delivered',
                'delivered_at' => $locked->delivered_at ?? now(),
                'delivery_confirmed_at' => now(),
                'delivery_confirmed_by' => $touristId,
            ]);

            $finalStatus = 'delivered';

            if ($this->isCodDelivery($locked)) {
                // COD: freeze the cash snapshot and keep the rider busy until the
                // cash settlement step (settle-cod) completes the delivery.
                $this->markCodDelivered($locked);
            } else {
                // Prepaid: the delivery is complete once the tourist confirms
                // receipt, so the order reaches the canonical 'completed' state too.
                $this->completeDelivery($locked);
                $locked->update(['status' => TripStatus::COMPLETED->value]);
                $finalStatus = TripStatus::COMPLETED->value;
                User::find($locked->rider_id)?->riderDetail()?->updateOrCreate(
                    ['user_id' => $locked->rider_id],
                    ['rider_status' => User::RIDER_STATUS_AVAILABLE, 'rider_status_updated_at' => now()]
                );
            }

            return ['success' => true, 'old_status' => $oldStatus, 'new_status' => $finalStatus];
        });
    }

    /**
     * Settle a COD delivery at the drop-off: the rider hands over cash, every
     * fulfilled order is marked paid, the auditable restaurant/Tourism Office
     * allocations are booked, earnings are recorded, and delivery + orders
     * reach the completed state.
     *
     * Settlement runs per order (one cod_settlement row per restaurant order;
     * a group delivery books one settlement per fulfilled child order). The
     * booking is unconditional for COD: the persisted order.rider_financed_amount
     * is the interim settlement base (credit-free, step 3), and the legacy
     * rider-credit finalize path only runs when an old delivery still carries a
     *
     * The delivery must already be marked 'delivered'. Cash received is
     * validated server-side and change is computed here, never by the client.
     *
     * @throws \InvalidArgumentException when validation fails
     */
    public function settleCodDelivery(Delivery $delivery, float $cashReceived): array
    {
        if (! $this->isCodDelivery($delivery)) {
            throw new \InvalidArgumentException('This order is not a cash-on-delivery order.');
        }

        $delivery->load('order');
        $orders = $delivery->childOrders();
        if ($orders->isEmpty()) {
            throw new \InvalidArgumentException('Order not found for this delivery.');
        }

        if (! $delivery->rider_id) {
            throw new \InvalidArgumentException('No rider is assigned to this delivery.');
        }

        $currentStatus = $delivery->status?->value ?? $delivery->status;
        if ($currentStatus !== 'delivered') {
            throw new \InvalidArgumentException('Delivery must be marked as delivered before cash settlement.');
        }

        if ($delivery->cash_due === null) {
            $delivery->update(['cash_due' => $this->codAmountDue($delivery)]);
        }
        $cashDue = (float) $delivery->cash_due;

        if (round((float) $cashReceived, 2) < $cashDue) {
            throw new \InvalidArgumentException(
                'Cash received (₱'.number_format($cashReceived, 2).') is less than the amount due (₱'.number_format($cashDue, 2).').'
            );
        }

        $cashReceived = round((float) $cashReceived, 2);
        $changeGiven = round($cashReceived - $cashDue, 2);

        $settlement = null;

        DB::transaction(function () use ($delivery, $orders, $cashReceived, $cashDue, $changeGiven, &$settlement) {
            $lockedDelivery = Delivery::with('order', 'groupCheckout.orders')->lockForUpdate()->find($delivery->id);
            if (! $lockedDelivery) {
                throw new \InvalidArgumentException('Delivery not found for cash settlement.');
            }

            // Re-validate the authoritative state UNDER the delivery row lock so
            // a concurrent settle (double-tap) or auto-cancel that committed first
            // is seen here. Only ONE transaction can ever observe status
            // 'delivered', so cash can never be collected from the same delivery
            // twice and a cancelled order can never be settled.
            $lockedStatus = $lockedDelivery->status->value ?? $lockedDelivery->status;
            if ($lockedStatus !== 'delivered') {
                throw new \InvalidArgumentException('Delivery must be marked as delivered before cash settlement.');
            }

            $riderId = (int) $lockedDelivery->rider_id;
            if (! $riderId) {
                throw new \InvalidArgumentException('No rider is assigned to this delivery.');
            }

            $lockedOrders = $lockedDelivery->childOrders();
            if ($lockedOrders->isEmpty()) {
                throw new \InvalidArgumentException('Order not found for this delivery.');
            }

            // One physical trip, one rider commission: split it evenly across the
            // fulfilled restaurant orders so per-order earnings never inflate.
            $commissionShare = $lockedOrders->count() > 1
                ? round((float) ($lockedDelivery->rider_commission ?? 0) / $lockedOrders->count(), 2)
                : null;

            foreach ($lockedOrders as $lockedOrder) {
                $orderCashDue = (float) ($lockedOrder->total ?? $cashDue);

                $this->recordCashPayment($lockedOrder, $orderCashDue, $changeGiven, $lockedDelivery->id);

                // Mark the order settled in cash and reached the canonical completed state.
                $lockedOrder->update([
                    'status' => 'completed',
                    'payment_status' => 'paid',
                    'paid_amount' => $orderCashDue,
                    'completed_at' => now(),
                ]);

                // P11.1: book the authoritative COD allocation for EVERY fulfilled
                // restaurant order. P12.2 posts its restaurant-wallet effect only
                // after the order becomes completed, still inside this same
                // delivery settlement transaction.
                $orderSettlements = app(CodSettlementService::class)->recordAllocations($lockedDelivery, $lockedOrder, $riderId);
                foreach ($orderSettlements as $orderSettlement) {
                    app(OrderSettlementService::class)->recordCodSettlement($orderSettlement);
                    $settlement ??= $orderSettlement;
                }

                $this->recordEarning($lockedDelivery, $lockedOrder, $riderId, $commissionShare);
            }

            $lockedDelivery->update([
                'status' => TripStatus::COMPLETED->value,
                'cash_received' => $cashReceived,
                'change_given' => $changeGiven,
                'cash_settled_at' => now(),
                'delivered_at' => $lockedDelivery->delivered_at ?? now(),
            ]);

            // Rider is free to take the next delivery once cash is collected.
            User::find($riderId)?->riderDetail()?->updateOrCreate(
                ['user_id' => $riderId],
                ['rider_status' => User::RIDER_STATUS_AVAILABLE, 'rider_status_updated_at' => now()]
            );
        });

        app(WebsocketNotifierService::class)
            ->notifyTripCompleted($delivery->id, $delivery->rider_id);

        // Emit the final transition AFTER the transaction commits so the order
        // follows the delivery to 'completed' and real-time watchers/notifications
        // see the terminal state.
        DeliveryStatusChanged::dispatch(
            Delivery::with('order.business')->find($delivery->id),
            'delivered',
            TripStatus::COMPLETED->value
        );

        return [
            'success' => true,
            'delivery_id' => $delivery->id,
            'order_id' => $delivery->order_id,
            'cash_due' => $cashDue,
            'cash_received' => $cashReceived,
            'change_given' => $changeGiven,
            'settlement_id' => $settlement?->id,
            'settlement_base' => $settlement ? (float) $settlement->settlement_base : null,
            'restaurant_share' => $settlement ? (float) $settlement->restaurant_share : null,
            'platform_fee' => $settlement ? (float) $settlement->platform_fee : null,
        ];
    }

    private function recordCashPayment(Order $order, float $amount, float $changeGiven, int $deliveryId): void
    {
        $alreadySettled = Payment::where('payable_type', Order::class)
            ->where('payable_id', $order->id)
            ->where('method', 'cash')
            ->where('status', 'paid')
            ->exists();

        if ($alreadySettled) {
            return;
        }

        Payment::create([
            'payment_number' => 'CASH-'.strtoupper(Str::random(12)),
            'payable_type' => Order::class,
            'payable_id' => $order->id,
            'user_id' => $order->user_id,
            'amount' => $amount,
            'method' => 'cash',
            'provider' => 'rider',
            'status' => 'paid',
            'description' => 'Cash on delivery — change ₱'.number_format($changeGiven, 2),
            'metadata' => [
                'delivery_id' => $deliveryId,
                'cash_received' => $amount,
                'change_given' => $changeGiven,
            ],
            'paid_at' => now(),
        ]);
    }

    private function recordEarning(Delivery $delivery, Order $order, int $riderId, ?float $commissionOverride = null): void
    {
        // Standalone deliveries report the physical trip's fee; group children
        // report their own per-restaurant fee (the trip fee/commission is split).
        $deliveryFee = (float) ($delivery->order_id === null
            ? ($order->delivery_fee ?? 0)
            : ($delivery->delivery_fee ?? $order->delivery_fee ?? 0));
        $tip = (float) ($order->rider_tip ?? 0);
        $commission = $commissionOverride ?? (float) ($delivery->rider_commission ?? $deliveryFee);

        RiderEarning::updateOrCreate(
            ['rider_id' => $riderId, 'order_id' => $order->id, 'status' => 'earned'],
            [
                'delivery_fee' => $deliveryFee,
                'rider_tip' => $tip,
                'total_earning' => round($commission + $tip, 2),
                'earned_at' => now(),
            ]
        );
    }

    // ------------------------------------------------------------------
    // P3 (master spec §17/§19/§49): dispatch-cycle deadline, observable
    // termination, and no-silent-dead-end parking. One authoritative layer
    // (dispatchToNearest entry) enforces the deadline for EVERY caller:
    // scheduler retry, decline/timeout re-offer, dispatch-on-ready.
    // ------------------------------------------------------------------

    /** Cycle anchor: checkout dispatch start, else schedule/creation time. */
    private function dispatchCycleStartedAt(Delivery $delivery): Carbon
    {
        $anchor = $delivery->primaryOrder()?->dispatch_started_at
            ?? $delivery->scheduled_at
            ?? $delivery->created_at;

        return $anchor ? Carbon::parse($anchor) : now();
    }

    /**
     * The 60-minute cycle deadline derives from orders.dispatch_started_at.
     * deliveries.dispatch_expires_at intentionally keeps its WAVE/offer-deadline
     * semantics (offerExpiresAt(), AdminMapController) — it is overwritten by
     * every wave and cannot also hold the whole-cycle deadline.
     */
    public function dispatchCycleDeadline(Delivery $delivery): Carbon
    {
        return $this->dispatchCycleStartedAt($delivery)
            ->addMinutes((int) config('delivery.scheduler.dispatch_deadline_minutes', 60));
    }

    public function dispatchCycleExpired(Delivery $delivery): bool
    {
        if ($delivery->rider_id !== null) {
            return false; // An accepted rider means the dispatch cycle SUCCEEDED.
        }

        return $this->dispatchCycleDeadline($delivery)->lte(now());
    }

    /** Terminal reason derived from the delivery's own state (master spec §49). */
    public function terminalEndReason(Delivery $delivery): string
    {
        return (! $delivery->pickup_latitude || ! $delivery->pickup_longitude)
            ? 'invalid_pickup_coordinates'
            : 'no_rider_accepted';
    }

    /**
     * Observable terminal failure: never retry again, record when and why.
     * Guarded atomically so a racing accept can never be overwritten.
     */
    public function failDispatch(Delivery $delivery, string $reason): void
    {
        $updated = Delivery::query()
            ->where('id', $delivery->id)
            ->whereNull('rider_id')
            ->where(function ($q) {
                $q->whereNull('dispatch_status')
                    ->orWhere('dispatch_status', '!=', 'dispatch_failed');
            })
            ->update([
                'dispatch_status' => 'dispatch_failed',
                'dispatch_failed_at' => $delivery->dispatch_failed_at ?? now(),
                'dispatch_retry_at' => null,
                'dispatch_ended_at' => now(),
                'dispatch_end_reason' => $reason,
            ]);

        if ($updated > 0) {
            Log::warning('[COD Dispatch] dispatch terminally failed', [
                'delivery_id' => $delivery->id,
                'reason' => $reason,
            ]);
        }

        $delivery->refresh();
    }

    /**
     * No silent dead end (master spec §19): hand the delivery to the canonical
     * ScheduledDispatchProcessor loop, which re-runs the pipeline every
     * retry_after_minutes until the attempt cap / cycle deadline, then
     * terminates with dispatch_end_reason.
     */
    private function parkForRetry(Delivery $delivery): void
    {
        $delivery->update([
            'dispatch_status' => 'no_rider_available',
            'dispatch_retry_at' => now()->addMinutes((int) config('delivery.scheduler.retry_after_minutes', 5)),
        ]);
    }

    /**
     * P3 diagnostics (master spec §58): when the COD query finds nobody,
     * explain WHY every otherwise-plausible rider was excluded. Observability
     * only — never mutates eligibility. Evaluates gates in PHP (broadest query)
     * so query-level filters cannot hide their reasons.
     */
    private function logCodExclusionDiagnostics(Delivery $delivery, float $pickupLat, float $pickupLng, string $serviceType, ?int $municipalityId): void
    {
        try {
            $exclusions = [];
            $riders = User::where('role', User::ROLE_RIDER)
                ->with(['riderDetail', 'locations' => fn ($q) => $q->latest('recorded_at')->limit(1)])
                ->get();

            foreach ($riders as $rider) {
                if ($rider->account_status !== User::ACCOUNT_STATUS_APPROVED) {
                    $exclusions[$rider->id] = 'not_approved';
                    continue;
                }

                if ($municipalityId !== null
                    && $rider->municipality_id !== null
                    && (int) $rider->municipality_id !== (int) $municipalityId) {
                    $exclusions[$rider->id] = 'wrong_municipality';
                    continue;
                }

                $detail = $rider->riderDetail;
                if (! $detail) {
                    $exclusions[$rider->id] = 'no_rider_detail';
                    continue;
                }

                if ($detail->rider_status !== User::RIDER_STATUS_AVAILABLE) {
                    $exclusions[$rider->id] = 'not_available(' . $detail->rider_status . ')';
                    continue;
                }

                if ($detail->current_service !== $serviceType) {
                    $exclusions[$rider->id] = 'wrong_service(' . $detail->current_service . ')';
                    continue;
                }

                $location = $rider->locations->first();
                if (! $location || ! $location->latitude || ! $location->longitude
                    || (float) $location->latitude === 0.0 || (float) $location->longitude === 0.0) {
                    $exclusions[$rider->id] = 'gps_missing';
                    continue;
                }

                $ageMinutes = $location->recorded_at
                    ? abs(now()->diffInMinutes($location->recorded_at))
                    : PHP_INT_MAX;
                if ($ageMinutes > (int) config('delivery.cod_location_max_age_minutes', 5)) {
                    $exclusions[$rider->id] = 'gps_stale(' . round($ageMinutes, 1) . 'min)';
                    continue;
                }

                $distance = $this->calculateDistance(
                    $pickupLat,
                    $pickupLng,
                    (float) $location->latitude,
                    (float) $location->longitude
                );
                if ($distance > (float) config('delivery.cod_max_pickup_distance_km', 5)) {
                    $exclusions[$rider->id] = 'too_far(' . round($distance, 2) . 'km)';
                    continue;
                }

                if (! $this->passesCodActiveOrderLimit($rider)) {
                    $exclusions[$rider->id] = 'active_order_limit';
                    continue;
                }

                $priorOffer = BookingDispatchLog::where('delivery_id', $delivery->id)
                    ->where('rider_id', $rider->id)
                    ->first();

                // Only a NON-timed-out prior offer actually blocks (see the
                // $reofferableRiderIds reopen in dispatchToNearest). Labeling a
                // timed-out rider here would claim `already_offered` for someone
                // the query would genuinely offer — a diagnostics lie.
                if ($priorOffer && $priorOffer->response !== 'timeout') {
                    $exclusions[$rider->id] = 'already_offered';
                    continue;
                }

                // Passed every gate here but was not returned by the query —
                // should not happen; surfaced so a query/gate drift is visible.
                $exclusions[$rider->id] = 'unknown(passed gates in diagnostics)';
            }

            Log::info('[COD Dispatch] exclusion diagnostics', [
                'delivery_id' => $delivery->id,
                'pickup' => [$pickupLat, $pickupLng],
                'exclusions' => $exclusions === []
                    ? ['none' => 'no rider accounts exist for this role at all']
                    : $exclusions,
            ]);
        } catch (\Throwable $e) {
            Log::warning('[COD Dispatch] exclusion diagnostics failed', [
                'delivery_id' => $delivery->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function getBusyRiderIds(): array
    {
        return $this->activeBindingsQuery()
            ->whereNotNull('rider_id')
            ->pluck('rider_id')
            ->toArray();
    }

    public function calculateDistance(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthRadius = 6371;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) * sin($dLat / 2) +
             cos(deg2rad($lat1)) * cos(deg2rad($lat2)) *
             sin($dLng / 2) * sin($dLng / 2);
        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));

        return $earthRadius * $c;
    }
}
