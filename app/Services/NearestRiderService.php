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
use App\Models\RiderLocation;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
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

    public function __construct(
        private FirebaseService $firebase
    ) {}

    public function findNearestAvailableRiders(float $pickupLat, float $pickupLng, string $serviceType = 'food', int $limit = 5, ?int $municipalityId = null): Collection
    {
        return $this->findNearestFromMySql($pickupLat, $pickupLng, $serviceType, $limit, $municipalityId);
    }

    protected function findNearestFromFirebase(float $pickupLat, float $pickupLng, string $serviceType = 'food', int $limit = 5, ?int $municipalityId = null): Collection
    {
        $firebaseRiders = $this->firebase->getOnlineRiders();
        if (empty($firebaseRiders)) {
            return collect();
        }

        $busyRiderIds = $this->getBusyRiderIds();
        $recentRiderIds = RiderLocation::where('recorded_at', '>', now()->subMinutes(5))
            ->distinct()->pluck('rider_id')->toArray();

        $results = [];
        foreach ($firebaseRiders as $riderId => $fbData) {
            if (in_array($riderId, $busyRiderIds)) {
                continue;
            }
            if (! in_array($riderId, $recentRiderIds)) {
                continue;
            }

            $riderService = $fbData['svc'] ?? 'food';
            if ($riderService !== $serviceType) {
                continue;
            }

            $riderMunicipality = $fbData['mun'] ?? null;
            if ($municipalityId !== null && $riderMunicipality !== null && (int) $riderMunicipality !== $municipalityId) {
                continue;
            }

            $lat = $fbData['lat'] ?? null;
            $lng = $fbData['lng'] ?? null;
            if ($lat === null || $lng === null) {
                continue;
            }

            $distance = $this->calculateDistance($pickupLat, $pickupLng, (float) $lat, (float) $lng);
            if ($distance > self::MAX_DELIVERY_RADIUS_KM) {
                continue;
            }

            $results[] = [
                'rider_id' => $riderId,
                'latitude' => $lat,
                'longitude' => $lng,
                'distance_km' => $distance,
            ];
        }

        usort($results, fn ($a, $b) => $a['distance_km'] <=> $b['distance_km']);
        $results = array_slice($results, 0, $limit);

        if (empty($results)) {
            return collect();
        }

        $riderIds = array_column($results, 'rider_id');
        $distanceMap = [];
        foreach ($results as $r) {
            $distanceMap[$r['rider_id']] = $r['distance_km'];
        }

        $users = User::whereIn('id', $riderIds)
            ->where('role', User::ROLE_RIDER)
            ->where('account_status', User::ACCOUNT_STATUS_APPROVED)
            ->whereHas('riderDetail', function ($q) use ($serviceType) {
                $q->whereIn('rider_status', [
                    User::RIDER_STATUS_ONLINE,
                    User::RIDER_STATUS_AVAILABLE,
                ])
                    ->where('current_service', $serviceType);
            })
            ->with(['locations' => function ($q) {
                $q->latest('recorded_at')->limit(1);
            }])
            ->get()
            ->sortBy(fn ($u) => $distanceMap[$u->id]);

        $users->each(function ($user) use ($distanceMap) {
            $user->distance_km = $distanceMap[$user->id] ?? null;
        });

        return $users->values();
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
     * Secure a COD delivery for the accepting rider (credit-free, step 3).
     *
     * The customer's cash due is frozen at accept-time (immutable once
     * dispatched) and the rider is validated for the one-active-delivery rule.
     * NO rider credit is reserved or deducted, the ₱200 protected reserve is
     * untouched, and cod_credit_reserved stays 0 for the life of the delivery.
     */
    public function reserveCodCredit(Delivery $delivery, int $riderId): bool
    {
        if (! $this->isCodDelivery($delivery)) {
            return true;
        }

        return DB::transaction(function () use ($delivery, $riderId) {
            $rider = User::lockForUpdate()->find($riderId);
            $lockedDelivery = Delivery::with('order', 'groupCheckout')->lockForUpdate()->find($delivery->id);
            $detail = $rider?->riderDetail()->lockForUpdate()->first();

            if (! $detail || ! $lockedDelivery || $lockedDelivery->rider_id !== null) {
                return false;
            }

            $activeLimit = (int) ($detail->active_order_limit ?: config('delivery.cod_active_order_limit', 2));
            $activeOrders = $this->activeBindingsQuery($riderId)
                ->lockForUpdate()
                ->count();

            if (
                $rider->account_status !== User::ACCOUNT_STATUS_APPROVED ||
                $detail->rider_status !== User::RIDER_STATUS_AVAILABLE ||
                $activeOrders >= $activeLimit
            ) {
                return false;
            }

            $cashDue = $this->codAmountDue($lockedDelivery);

            $lockedDelivery->update([
                'cod_credit_reserved' => 0,
                'cash_due' => $cashDue,
            ]);

            return true;
        });
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

    public function releaseCodCredit(Delivery $delivery): void
    {
        $reserved = (float) ($delivery->cod_credit_reserved ?? 0);
        if ($reserved <= 0 || ! $delivery->rider_id) {
            return;
        }

        DB::transaction(function () use ($delivery, $reserved) {
            $orderId = (int) $delivery->order_id;
            $riderId = (int) $delivery->rider_id;

            app(RiderCreditService::class)->releaseCredits(
                $riderId,
                $reserved,
                $orderId,
                "Released ₱{$reserved} from cancelled COD order #{$orderId}"
            );

            $delivery->update(['cod_credit_reserved' => 0]);
        });
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

            if ($locked->rider_id !== null) {
                $this->releaseCodCredit($locked);
            }

            $locked->update([
                'status' => TripStatus::CANCELLED->value,
                'dispatch_status' => null,
            ]);

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

        // Read-only wallet snapshot for the rider's self-service view. These
        // keys are informational only — COD eligibility never depends on them
        // (credit-free, step 3) and they are immutable from this endpoint.
        $account = app(RiderCreditService::class)->getOrCreateAccount($rider->id);
        $availableCredit = $account->usable_credits;
        $totalCredits = (float) $account->total_credits;
        $reservedCredits = (float) $account->reserved_credits;

        $activeOrders = $this->activeBindingsQuery($rider->id)->count();
        $activeLimit = (int) ($detail?->active_order_limit ?: config('delivery.cod_active_order_limit', 2));

        return [
            'account_approved' => $rider->account_status === User::ACCOUNT_STATUS_APPROVED,
            'online' => in_array($detail?->rider_status, [User::RIDER_STATUS_ONLINE, User::RIDER_STATUS_AVAILABLE], true),
            'available' => $detail?->rider_status === User::RIDER_STATUS_AVAILABLE,
            'suspended' => $rider->account_status === User::ACCOUNT_STATUS_SUSPENDED,
            // Legacy keys kept for frontend compatibility, now sourced from the wallet.
            'working_credit' => $totalCredits,
            'reserved_working_credit' => $reservedCredits,
            'available_working_credit' => $availableCredit,
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
        $pickupLat = $delivery->pickup_latitude;
        $pickupLng = $delivery->pickup_longitude;

        if (! $pickupLat || ! $pickupLng) {
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

        $alreadyDispatchedRiderIds = BookingDispatchLog::where('delivery_id', $delivery->id)
            ->pluck('rider_id')
            ->toArray();

        $nearestRiders = $this->isCodDelivery($delivery)
            ? $this->findNearestEligibleCodRiders($delivery, (float) $pickupLat, (float) $pickupLng, $serviceType, 5, $municipalityId)
            : $this->findNearestAvailableRiders((float) $pickupLat, (float) $pickupLng, $serviceType, 5, $municipalityId);

        Log::info('[SocketDispatch] eligible MySQL riders', [
            'delivery_id' => $delivery->id,
            'count' => $nearestRiders->count(),
            'ids' => $nearestRiders->pluck('id')->all(),
        ]);

        foreach ($nearestRiders as $rider) {
            if (in_array($rider->id, $alreadyDispatchedRiderIds)) {
                continue;
            }

            $distance = $rider->distance_km ?? $this->calculateDistance(
                (float) $pickupLat, (float) $pickupLng,
                (float) ($rider->locations->first()?->latitude ?? 0),
                (float) ($rider->locations->first()?->longitude ?? 0)
            );

            BookingDispatchLog::create([
                'delivery_id' => $delivery->id,
                'rider_id' => $rider->id,
                'distance_km' => $distance,
                'response' => 'pending',
                'dispatched_at' => now(),
            ]);

            $expiresAt = now()->addSeconds(self::DISPATCH_TIMEOUT_SECONDS);

            $delivery->update([
                'dispatch_status' => 'notified',
                'dispatch_expires_at' => $expiresAt,
            ]);

            if (config('firebase.dispatch_enabled') && $this->firebase->isConfigured()) {
                $this->firebase->createRiderRequest($rider->id, $delivery->id, [
                    'deliveryId' => $delivery->id,
                    'orderId' => $delivery->order_id,
                    'serviceType' => $serviceType,
                    'pickupAddress' => $delivery->pickup_address,
                    'pickupLatitude' => $delivery->pickup_latitude,
                    'pickupLongitude' => $delivery->pickup_longitude,
                    'deliveryAddress' => $delivery->delivery_address,
                    'deliveryLatitude' => $delivery->delivery_latitude,
                    'deliveryLongitude' => $delivery->delivery_longitude,
                    'businessName' => $delivery->primaryOrder()?->business?->name,
                    'riderCommission' => $delivery->rider_commission,
                    'distanceKm' => $distance,
                    'status' => 'pending',
                    'expiresAt' => $expiresAt->timestamp,
                    'dispatchedAt' => now()->timestamp,
                    'createdAt' => now()->timestamp,
                ]);

                $this->firebase->createBookingRequest($delivery->id, [
                    'riderId' => $rider->id,
                    'serviceType' => $serviceType,
                    'touristId' => $delivery->primaryOrder()?->customer_email,
                    'status' => 'pending',
                    'createdAt' => now()->timestamp,
                ]);
            }

            // Real-time WebSocket ping: notify the socket engine so the selected
            // rider gets an instant order_received_ping (no Firebase write needed).
            app(WebsocketNotifierService::class)->notifyDispatch([
                'deliveryId' => $delivery->id,
                'orderId' => $delivery->order_id,
                'restaurantName' => $delivery->primaryOrder()?->business?->name ?? 'Restaurant',
                'restaurantLat' => $delivery->pickup_latitude,
                'restaurantLng' => $delivery->pickup_longitude,
                'riderId' => $rider->id,
                'timeoutSeconds' => self::DISPATCH_TIMEOUT_SECONDS,
            ]);

            return $rider;
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

        $candidates = [];
        foreach ($onlineRiders as $rider) {
            if (($rider['status'] ?? '') !== 'available') {
                continue;
            }
            $riderId = (int) ($rider['riderId'] ?? 0);
            $lat = (float) ($rider['lat'] ?? 0);
            $lng = (float) ($rider['lng'] ?? 0);
            if ($riderId <= 0 || $lat === 0.0 || $lng === 0.0) {
                continue;
            }
            if (in_array($riderId, $alreadyDispatchedRiderIds, true)) {
                continue;
            }
            if (in_array($riderId, $busyRiderIds, true)) {
                continue;
            }
            if ($this->isCodDelivery($delivery)) {
                $candidate = User::with('riderDetail')->find($riderId);
                if (
                    ! $candidate ||
                    $candidate->account_status !== User::ACCOUNT_STATUS_APPROVED ||
                    $candidate->riderDetail?->rider_status !== User::RIDER_STATUS_AVAILABLE ||
                    $candidate->riderDetail?->current_service !== $serviceType ||
                    $this->calculateDistance((float) $delivery->pickup_latitude, (float) $delivery->pickup_longitude, $lat, $lng) >
                        (float) config('delivery.cod_max_pickup_distance_km', 5) ||
                    ! $this->passesCodActiveOrderLimit($candidate)
                ) {
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

        usort($candidates, fn ($a, $b) => $a['distance_km'] <=> $b['distance_km']);

        if (! empty($candidates)) {
            $target = $candidates[0];
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

            return User::find($targetRiderId);
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

        $delivery->update(['dispatch_status' => 'no_rider_available']);

        if ($this->firebase->isConfigured()) {
            $this->firebase->updateBookingRequestStatus($delivery->id, 'no_rider_available');
        }

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
            return ['success' => false, 'message' => 'No pending dispatch request found.'];
        }

        if ($log->dispatched_at->diffInSeconds(now()) > self::DISPATCH_TIMEOUT_SECONDS) {
            $log->update(['response' => 'timeout', 'responded_at' => now()]);

            if ($this->firebase->isConfigured()) {
                $this->firebase->removeRiderRequest($riderId, $deliveryId);
            }

            $delivery = Delivery::with('order.business')->find($deliveryId);
            $nextRider = null;
            if ($delivery && in_array($delivery->dispatch_status, ['notified', 'waiting_for_rider'])) {
                $serviceType = ($delivery->primaryOrder()?->order_type === 'transport') ? 'transport' : 'food';
                $municipalityId = $delivery->primaryOrder()?->business?->municipality_id;
                $nextRider = $this->dispatchToNearest($delivery, $serviceType, $municipalityId);
            }

            return ['success' => false, 'message' => 'Request timed out.', 'timeout' => true, 'next_dispatched' => $nextRider !== null];
        }

        $log->update(['response' => $response, 'responded_at' => now()]);

        if ($response === 'accepted') {
            $delivery = Delivery::findOrFail($deliveryId);
            $delivery->load('order');

            // Serialize concurrent accepts on the delivery row FIRST (the
            // authoritative dispatch object): two different riders accepting
            // the SAME delivery serialize on it, and whichever loses sees the
            // winner's committed assignment under the lock. The rider row is
            // also locked to enforce the one-active-delivery business rule.
            $outcome = DB::transaction(function () use ($delivery, $riderId) {
                $lockedDelivery = Delivery::with('order')->lockForUpdate()->find($delivery->id);

                if (! $lockedDelivery) {
                    return 'not_found';
                }

                if ($lockedDelivery->rider_id !== null) {
                    return 'already_assigned';
                }

                User::where('id', $riderId)->lockForUpdate()->first();

                $alreadyActive = $this->activeBindingsQuery($riderId)
                    ->where('id', '!=', $lockedDelivery->id)
                    ->exists();

                if ($alreadyActive) {
                    return 'already_active';
                }

                if (! $this->reserveCodCredit($lockedDelivery, $riderId)) {
                    return 'ineligible';
                }

                $lockedDelivery->update([
                    'rider_id' => $riderId,
                    'status' => 'assigned',
                    'assigned_at' => now(),
                    'dispatch_status' => null,
                    'dispatch_expires_at' => null,
                ]);

                User::where('id', $riderId)->first()?->riderDetail()?->updateOrCreate(
                    ['user_id' => $riderId],
                    ['rider_status' => 'busy', 'rider_status_updated_at' => now()]
                );

                return 'assigned';
            });

            if ($outcome !== 'assigned') {
                $log->update(['response' => 'declined', 'responded_at' => now()]);

                // The delivery is already claimed by another rider: do NOT re-offer
                // it — there is no slot to re-offer, and a new wave would spam the
                // rider who just won the claim.
                if ($outcome === 'already_assigned' || $outcome === 'not_found') {
                    return [
                        'success' => false,
                        'message' => $outcome === 'not_found'
                            ? 'Delivery not found.'
                            : 'This delivery was already accepted by another rider.',
                        'already_assigned' => true,
                    ];
                }

                $serviceType = $delivery->primaryOrder()?->order_type === 'transport' ? 'transport' : 'food';

                return [
                    'success' => false,
                    'message' => $outcome === 'already_active'
                        ? 'You already have an active delivery. Complete it before accepting another.'
                        : 'You are no longer eligible for this COD delivery.',
                    'already_active' => $outcome === 'already_active',
                    'next_dispatched' => $this->dispatchToNearest($delivery, $serviceType, $delivery->primaryOrder()?->business?->municipality_id) !== null,
                ];
            }

            // One active delivery: withdraw this rider's other outstanding offers
            // and re-offer those deliveries to the next available rider.
            $this->cancelOtherPendingOffers($riderId, $delivery->id);

            // Push the authoritative assignment to the real-time engine so only
            // this rider's socket may stream location into the trip room. Best
            // effort: the database assignment is the source of truth.
            try {
                app(WebsocketNotifierService::class)->notifyTripAssigned($delivery->id, $riderId);
            } catch (\Throwable $e) {
                // Real-time bridge unavailable; dispatch still succeeds.
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

            if ($this->firebase->isConfigured()) {
                $this->firebase->updateRiderRequestStatus($riderId, $deliveryId, 'accepted');
                $this->firebase->updateBookingRequestStatus($deliveryId, 'accepted');
                $riderMunicipalityId = User::where('id', $riderId)->value('municipality_id');
                $this->firebase->setRiderStatus($riderId, 'busy', null, $riderMunicipalityId);
            }

            return ['success' => true, 'message' => 'Delivery accepted!', 'assigned' => true];
        }

        if ($this->firebase->isConfigured()) {
            $this->firebase->removeRiderRequest($riderId, $deliveryId);
        }

        $delivery = Delivery::with('order.business')->find($deliveryId);
        $nextRider = null;
        if ($delivery && in_array($delivery->dispatch_status, ['notified', 'waiting_for_rider'])) {
            $serviceType = ($delivery->primaryOrder()?->order_type === 'transport') ? 'transport' : 'food';
            $municipalityId = $delivery->primaryOrder()?->business?->municipality_id;
            $nextRider = $this->dispatchToNearest($delivery, $serviceType, $municipalityId);
        }

        return [
            'success' => true,
            'message' => 'Delivery declined.',
            'declined' => true,
            'next_dispatched' => $nextRider !== null,
        ];
    }

    /**
     * A rider may hold only one active delivery. When they accept one offer,
     * every other outstanding offer to that rider is withdrawn and, if the
     * delivery is still unclaimed, re-offered to the next available rider.
     */
    private function cancelOtherPendingOffers(int $riderId, int $acceptedDeliveryId): void
    {
        $otherLogs = BookingDispatchLog::where('rider_id', $riderId)
            ->where('response', 'pending')
            ->where('delivery_id', '!=', $acceptedDeliveryId)
            ->get();

        foreach ($otherLogs as $otherLog) {
            $otherLog->update(['response' => 'cancelled', 'responded_at' => now()]);

            if ($this->firebase->isConfigured()) {
                $this->firebase->removeRiderRequest($riderId, $otherLog->delivery_id);
            }

            $otherDelivery = Delivery::with('order.business')->find($otherLog->delivery_id);

            if (
                $otherDelivery
                && $otherDelivery->rider_id === null
                && in_array($otherDelivery->dispatch_status, ['notified', 'waiting_for_rider'], true)
            ) {
                $serviceType = $otherDelivery->primaryOrder()?->order_type === 'transport' ? 'transport' : 'food';
                $this->dispatchToNearest($otherDelivery, $serviceType, $otherDelivery->primaryOrder()?->business?->municipality_id);
            }
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

                if ($this->firebase->isConfigured()) {
                    $this->firebase->removeRiderRequest($log->rider_id, $log->delivery_id);
                }

                if (! $lockedDelivery || $lockedDelivery->rider_id !== null) {
                    return;
                }

                if (in_array($lockedDelivery->dispatch_status, ['notified', 'waiting_for_rider'])) {
                    $serviceType = $lockedDelivery->primaryOrder()?->order_type === 'transport' ? 'transport' : 'food';
                    $municipalityId = $lockedDelivery->primaryOrder()?->business?->municipality_id;
                    $nextRider = $this->dispatchToNearest($lockedDelivery, $serviceType, $municipalityId);
                    if (! $nextRider) {
                        $lockedDelivery->update(['dispatch_status' => 'no_rider_available']);
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
     * cod_credit_reserved > 0.
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

            $reserved = (float) ($lockedDelivery->cod_credit_reserved ?? 0);

            foreach ($lockedOrders as $lockedOrder) {
                $orderId = (int) $lockedOrder->id;
                $orderCashDue = (float) ($lockedOrder->total ?? $cashDue);

                // Legacy credit-financed COD (reserve > 0): finalize once. New
                // cash-on-hand COD (reserve == 0) never touches the wallet; the
                // rider keeps the collected cash. finalizeCredits() is the ONLY
                // wallet deduction and is never repeated here.
                if ($reserved > 0) {
                    app(RiderCreditService::class)->finalizeCredits(
                        $riderId,
                        $reserved,
                        $orderId,
                        'COD settlement for order #'.$orderId.' — cash received ₱'.number_format($cashReceived, 2)
                            .' (change ₱'.number_format($changeGiven, 2).')'
                    );
                }

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
                $orderSettlement = app(CodSettlementService::class)->record($lockedDelivery, $lockedOrder, $riderId);
                app(OrderSettlementService::class)->recordCodSettlement($orderSettlement);

                $settlement ??= $orderSettlement;

                $this->recordEarning($lockedDelivery, $lockedOrder, $riderId, $commissionShare);
            }

            $lockedDelivery->update([
                'status' => TripStatus::COMPLETED->value,
                'cash_received' => $cashReceived,
                'change_given' => $changeGiven,
                'cash_settled_at' => now(),
                'delivered_at' => $lockedDelivery->delivered_at ?? now(),
                'cod_credit_reserved' => 0,
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
