<?php

namespace App\Http\Controllers\Rider;

use App\Enums\TripStatus;
use App\Http\Controllers\Controller;
use App\Models\BookingDispatchLog;
use App\Models\Delivery;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\NearestRiderService;
use App\Services\ScheduledDispatchProcessor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RiderDispatchController extends Controller
{
    public function __construct(
        private NearestRiderService $dispatchService
    ) {}

    public function pendingRequest(): JsonResponse
    {
        $this->dispatchService->processTimeouts();

        $rider = auth()->user();

        $pendingLog = $rider->dispatchLogs()
            ->where('response', 'pending')
            ->with(['delivery.order.business', 'delivery.order.items'])
            ->latest()
            ->first();

        if (! $pendingLog) {
            return $this->successResponse(['request' => null]);
        }

        if ($this->dispatchService->offerIsExpired($pendingLog, $pendingLog->delivery)) {
            $this->dispatchService->handleRiderResponse($pendingLog->delivery->id, $rider->id, 'timeout');

            return $this->successResponse(['request' => null]);
        }

        return $this->successResponse([
            'request' => $this->buildOfferPayload($pendingLog),
        ]);
    }

    /**
     * List ALL live offers currently held by the rider, soonest-expiring first.
     * A rider may hold several simultaneous offers (simultaneous-offer dispatch);
     * choosing one to accept is the atomic assignment. The delivery list the
     * rider already accepted is intentionally absent (that delivery is no longer
     * an offer).
     */
    public function offers(Request $request): JsonResponse
    {
        $this->dispatchService->processTimeouts();

        $logs = $request->user()->dispatchLogs()
            ->where('response', 'pending')
            ->with(['delivery.order.business', 'delivery.order.items'])
            ->orderBy('dispatched_at')
            ->get();

        $offers = $logs
            ->map(fn (BookingDispatchLog $log) => $this->buildOfferPayload($log))
            ->filter()
            ->values()
            ->all();

        return $this->successResponse(['offers' => $offers]);
    }

    /**
     * Read-only rider order board. Returns every delivery the rider may act on
     * (their own live offers) plus nearby read-only rows (claimed by another
     * rider / cancelled). Laravel owns all eligibility and the accepted rider;
     * the board only presents it. Distance is computed in PHP so it stays
     * portable to the SQLite test connection (no haversine SQL).
     */
    public function board(Request $request): JsonResponse
    {
        $this->dispatchService->processTimeouts();

        $rider = $request->user();
        $rider->load('riderDetail');

        $location = RiderLocation::where('rider_id', $rider->id)
            ->latest('recorded_at')
            ->first();

        $radiusKm = (float) config('delivery.board_radius_km', 5);
        $claimedLimit = (int) config('delivery.board_claimed_limit', 8);
        $eligibility = $this->buildBoardEligibility($rider, $location);

        $orders = [];
        $seen = [];

        // 1. Actionable: the rider's own live offers (authoritative, same source
        //    as /dispatch/offers). These are the only rows with an accept button.
        $logs = $rider->dispatchLogs()
            ->where('response', 'pending')
            ->with(['delivery.order.business', 'delivery.order.items'])
            ->orderBy('dispatched_at')
            ->get();

        foreach ($logs as $log) {
            $payload = $this->buildOfferPayload($log);
            $delivery = $log->delivery;

            // A pending log for a delivery that is no longer open (cancelled or
            // already accepted elsewhere) is not actionable; the read-only
            // sections below surface it instead.
            if (empty($payload) || empty($payload['delivery_id']) || ! $delivery
                || $delivery->status !== TripStatus::WAITING) {
                continue;
            }

            $isCod = $this->dispatchService->isCodDelivery($delivery);
            $distance = $this->deliveryDistance($delivery, $location)
                ?? ($payload['distance_km'] !== null ? (float) $payload['distance_km'] : null);

            $blocked = $this->boardAcceptBlockedReason($eligibility, $isCod, $distance, $radiusKm);

            $orders[] = array_merge($payload, [
                'rider_status' => 'looking_for_riders',
                'can_accept' => $blocked === null,
                'accept_blocked_reason' => $blocked,
                'cod' => $isCod,
                'distance_km' => $distance !== null ? round($distance, 2) : $payload['distance_km'],
                'restaurants' => $this->buildStopDetails($delivery),
            ]);
            $seen[$delivery->id] = true;
        }

        // 2. Read-only: deliveries accepted by another rider, within the board
        //    radius. No item detail is exposed for someone else's trip.
        $claimed = Delivery::query()
            ->whereNotNull('rider_id')
            ->where('rider_id', '!=', $rider->id)
            ->whereIn('status', NearestRiderService::COD_ACTIVE_STATUSES)
            ->whereNotNull('pickup_latitude')
            ->whereNotNull('pickup_longitude')
            ->where('updated_at', '>=', now()->subHours(6))
            ->latest('updated_at')
            ->limit(50)
            ->get();

        $claimedAdded = 0;
        foreach ($claimed as $delivery) {
            if (isset($seen[$delivery->id]) || $claimedAdded >= $claimedLimit) {
                continue;
            }
            $distance = $this->deliveryDistance($delivery, $location);
            if ($distance === null || $distance > $radiusKm) {
                continue;
            }
            $orders[] = $this->buildReadOnlyItem($delivery, $distance, 'accepted_by_other');
            $seen[$delivery->id] = true;
            $claimedAdded++;
        }

        // 3. Read-only: recent deliveries this rider was offered that were
        //    cancelled by the tourist/system.
        $cancelled = $rider->dispatchLogs()
            ->whereHas('delivery', fn ($q) => $q->where('status', 'cancelled'))
            ->with('delivery')
            ->latest('updated_at')
            ->limit(5)
            ->get();

        foreach ($cancelled as $log) {
            $delivery = $log->delivery;
            if (! $delivery || isset($seen[$delivery->id])) {
                continue;
            }
            $orders[] = $this->buildReadOnlyItem($delivery, null, 'cancelled');
            $seen[$delivery->id] = true;
        }

        // 4. Actionable: OPEN deliveries that no rider has claimed yet. An
        //    order whose ping wave expired or parked at no_rider_available
        //    must stay visible AND claimable for every eligible rider until
        //    someone accepts it (first accept wins, backend-atomic in
        //    NearestRiderService::claimOpenDelivery). This is what keeps the
        //    board showing ALL pending orders — not only the pings this
        //    specific rider received at placement time.
        $open = Delivery::query()
            ->whereNull('rider_id')
            ->where('status', 'waiting')
            ->whereIn('dispatch_status', NearestRiderService::OPEN_DISPATCH_STATUSES)
            ->whereHas('order', fn ($q) => $q
                ->whereIn('status', ScheduledDispatchProcessor::DISPATCHABLE_ORDER_STATUSES)
                ->orWhere(fn ($qq) => $qq->where('order_type', 'transport')->where('status', 'pending')))
            ->whereNotNull('pickup_latitude')
            ->whereNotNull('pickup_longitude')
            ->with(['order.business', 'order.items', 'groupCheckout'])
            ->latest('updated_at')
            ->limit(50)
            ->get();

        foreach ($open as $delivery) {
            if (isset($seen[$delivery->id])) {
                continue;
            }
            $distance = $this->deliveryDistance($delivery, $location);
            if ($distance === null || $distance > $radiusKm) {
                continue;
            }

            $isCod = $this->dispatchService->isCodDelivery($delivery);
            $blocked = $this->boardAcceptBlockedReason($eligibility, $isCod, $distance, $radiusKm);

            $orders[] = array_merge($this->buildOpenDeliveryPayload($delivery, $distance), [
                'rider_status' => 'looking_for_riders',
                'can_accept' => $blocked === null,
                'accept_blocked_reason' => $blocked,
                'cod' => $isCod,
                'restaurants' => $this->buildStopDetails($delivery),
            ]);
            $seen[$delivery->id] = true;
        }

        return $this->successResponse([
            'eligibility' => $eligibility,
            'orders' => $orders,
        ], 'Rider order board retrieved.');
    }

    /**
     * Shared offer payload used by both pending-request (single) and offers
     * (list). Keys match RiderDeliveryRequestData on the frontend.
     */
    private function buildOfferPayload(BookingDispatchLog $log): array
    {
        $delivery = $log->delivery;
        $expiresAt = $this->dispatchService->offerExpiresAt($log, $delivery);
        $expiresIn = max(0, (int) now()->diffInSeconds($expiresAt, false));

        if ($expiresIn <= 0) {
            return [];
        }

        $order = $delivery?->primaryOrder();
        $business = $order?->business;
        $items = $order?->items ?? $delivery?->childOrders()->flatMap(fn ($o) => $o->items) ?? collect();
        $restaurantCount = (int) collect($items)->pluck('business_id')->unique()->filter()->count();

        return [
            'id' => $log->id,
            'delivery_id' => $delivery?->id,
            'order_id' => $delivery?->order_id,
            'order_number' => $order?->order_number ?? ('TT-' . str_pad((string) ($delivery?->order_id ?? 0), 5, '0', STR_PAD_LEFT)),
            'business_name' => $business?->business_name ?? $business?->name ?? $delivery?->pickup_address ?? 'Restaurant',
            'business_address' => $business?->address ?? $delivery?->pickup_address,
            'subtotal' => (float) ($order?->subtotal ?? 0),
            'pickup_address' => $delivery?->pickup_address,
            'pickup_latitude' => $delivery?->pickup_latitude,
            'pickup_longitude' => $delivery?->pickup_longitude,
            'delivery_address' => $delivery?->delivery_address,
            'delivery_latitude' => $delivery?->delivery_latitude,
            'delivery_longitude' => $delivery?->delivery_longitude,
            'rider_commission' => $delivery?->rider_commission,
            'rider_payout' => (float) ($delivery?->rider_commission ?? 0),
            'distance_km' => $log->distance_km !== null ? (float) $log->distance_km : null,
            'duration_minutes' => (int) ($delivery?->estimated_duration_minutes ?? $order?->delivery_duration_minutes ?? 0),
            'stops' => max(1, $restaurantCount),
            'restaurant_count' => max(1, $restaurantCount),
            'delivery_fee' => (float) ($delivery?->delivery_fee ?? $order?->delivery_fee ?? 0),
            'cod_amount' => (float) ($delivery?->isGroup() ? $delivery?->groupCheckout?->grand_total : $order?->total ?? 0),
            'items' => $items->map(fn ($it) => [
                'name' => $it->product_name ?? 'Item',
                'quantity' => (int) $it->quantity,
                'price' => (float) ($it->unit_price ?? 0),
                'subtotal' => (float) ($it->subtotal ?? 0),
                'modifiers' => [],
            ])->values()->all(),
            'dispatched_at' => $log->dispatched_at,
            'expires_in' => $expiresIn,
        ];
    }

    /**
     * Board payload for an OPEN (unclaimed) delivery. Same shape as the ping
     * offer payload so the rider board renders it as a normal actionable row;
     * there is no dispatch log, so id / dispatched_at / expires_in are null
     * (the delivery has no per-rider ping deadline to count down).
     */
    private function buildOpenDeliveryPayload(Delivery $delivery, ?float $distanceKm): array
    {
        $order = $delivery->primaryOrder();
        $business = $order?->business;
        $items = $order?->items ?? $delivery->childOrders()->flatMap(fn ($o) => $o->items) ?? collect();
        $restaurantCount = (int) collect($items)->pluck('business_id')->unique()->filter()->count();

        return [
            'id' => null,
            'delivery_id' => $delivery->id,
            'order_id' => $delivery->order_id,
            'order_number' => $order?->order_number ?? ('TT-' . str_pad((string) ($delivery->order_id ?? 0), 5, '0', STR_PAD_LEFT)),
            'business_name' => $business?->business_name ?? $business?->name ?? $delivery->pickup_address ?? 'Restaurant',
            'business_address' => $business?->address ?? $delivery->pickup_address,
            'subtotal' => (float) ($order?->subtotal ?? 0),
            'pickup_address' => $delivery->pickup_address,
            'pickup_latitude' => $delivery->pickup_latitude,
            'pickup_longitude' => $delivery->pickup_longitude,
            'delivery_address' => $delivery->delivery_address,
            'delivery_latitude' => $delivery->delivery_latitude,
            'delivery_longitude' => $delivery->delivery_longitude,
            'rider_commission' => $delivery->rider_commission,
            'rider_payout' => (float) ($delivery->rider_commission ?? 0),
            'distance_km' => $distanceKm !== null ? round($distanceKm, 2) : null,
            'duration_minutes' => (int) ($delivery->estimated_duration_minutes ?? $order?->delivery_duration_minutes ?? 0),
            'stops' => max(1, $restaurantCount),
            'restaurant_count' => max(1, $restaurantCount),
            'delivery_fee' => (float) ($delivery->delivery_fee ?? $order?->delivery_fee ?? 0),
            'cod_amount' => (float) ($delivery->isGroup() ? $delivery->groupCheckout?->grand_total : $order?->total ?? 0),
            'items' => $items->map(fn ($it) => [
                'name' => $it->product_name ?? 'Item',
                'quantity' => (int) $it->quantity,
                'price' => (float) ($it->unit_price ?? 0),
                'subtotal' => (float) ($it->subtotal ?? 0),
                'modifiers' => [],
            ])->values()->all(),
            'dispatched_at' => null,
            'expires_in' => null,
        ];
    }

    public function eligibility(Request $request): JsonResponse
    {
        return $this->successResponse(
            $this->dispatchService->getCodEligibility($request->user()),
            'COD delivery eligibility retrieved.'
        );
    }

    public function accept(Request $request): JsonResponse
    {
        $deliveryId = $request->input('delivery_id');
        $riderId = auth()->id();

        if (! $deliveryId) {
            return $this->errorResponse('Missing delivery ID.', 422);
        }

        $result = $this->dispatchService->handleRiderResponse($deliveryId, $riderId, 'accepted');

        if (isset($result['success']) && $result['success']) {
            return $this->successResponse($result, 'Delivery accepted.');
        }

        // 409 Conflict for every out-of-date accept (already assigned / already
        // active / expired / offer no longer available); 422 only when the rider
        // is simply ineligible.
        $code = ! empty($result['conflict']) ? 409 : 422;

        return $this->errorResponse($result['message'] ?? 'Failed to accept delivery.', $code);
    }

    public function decline(Request $request): JsonResponse
    {
        $deliveryId = $request->input('delivery_id');
        $riderId = auth()->id();

        if (! $deliveryId) {
            return $this->errorResponse('Missing delivery ID.', 422);
        }

        $result = $this->dispatchService->handleRiderResponse($deliveryId, $riderId, 'declined');

        return $this->successResponse($result);
    }

    private function buildBoardEligibility(User $rider, ?RiderLocation $location): array
    {
        $cod = $this->dispatchService->getCodEligibility($rider);

        $maxAgeSeconds = (int) config('delivery.cod_location_max_age_minutes', 5) * 60;
        $ageSeconds = ($location && $location->recorded_at)
            ? max(0, now()->diffInSeconds($location->recorded_at))
            : null;
        $hasCoords = $location
            && (float) $location->latitude !== 0.0
            && (float) $location->longitude !== 0.0;

        return [
            'online' => $cod['online'],
            'available' => $cod['available'],
            'account_approved' => $cod['account_approved'],
            'suspended' => $cod['suspended'],
            'has_active_delivery' => ($cod['active_orders'] ?? 0) > 0,
            'active_orders' => $cod['active_orders'],
            'active_order_limit' => $cod['active_order_limit'],
            'rider_status' => $rider->riderDetail?->rider_status,
            'current_service' => $rider->riderDetail?->current_service,
            'location_ok' => $hasCoords && $ageSeconds !== null && $ageSeconds <= $maxAgeSeconds,
            'location_age_seconds' => $ageSeconds,
            'max_pickup_distance_km' => (float) config('delivery.board_radius_km', 5),
        ];
    }

    private function boardAcceptBlockedReason(array $eligibility, bool $isCod, ?float $distanceKm, float $radiusKm): ?string
    {
        if (! $eligibility['account_approved']) {
            return 'account_not_approved';
        }
        if (! $eligibility['online']) {
            return 'offline';
        }
        if ($eligibility['has_active_delivery']) {
            return 'active_delivery';
        }
        if (! $eligibility['location_ok']) {
            return 'location_stale';
        }
        if ($isCod && ! $eligibility['available']) {
            return 'unavailable';
        }
        if ($distanceKm !== null && $distanceKm > $radiusKm) {
            return 'out_of_range';
        }

        return null;
    }

    private function buildStopDetails(Delivery $delivery): array
    {
        return $delivery->childOrders()
            ->map(fn ($order) => $order->loadMissing(['business', 'items']))
            ->map(function ($order) {
                $business = $order->business;

                return [
                    'business_id' => $order->business_id,
                    'name' => $business?->business_name ?? $business?->name ?? 'Restaurant',
                    'address' => $business?->address ?? $order->delivery_address,
                    'latitude' => $business?->latitude,
                    'longitude' => $business?->longitude,
                    'items' => $order->items->map(fn ($item) => [
                        'name' => $item->product_name ?? 'Item',
                        'quantity' => (int) $item->quantity,
                        'price' => (float) ($item->unit_price ?? 0),
                        'subtotal' => (float) ($item->subtotal ?? 0),
                    ])->values()->all(),
                ];
            })
            ->values()
            ->all();
    }

    private function buildReadOnlyItem(Delivery $delivery, ?float $distanceKm, string $status): array
    {
        $order = $delivery->primaryOrder();
        $business = $order?->business;
        $restaurantCount = max(1, (int) $delivery->childOrders()
            ->pluck('business_id')
            ->filter()
            ->unique()
            ->count());

        // Deliberately minimal: someone else's (or a cancelled) trip must not
        // leak tourist details, addresses, or financials to a non-assigned rider.
        return [
            'id' => null,
            'delivery_id' => $delivery->id,
            'order_id' => $delivery->order_id,
            'order_number' => $order?->order_number ?? ('TT-' . str_pad((string) ($delivery->order_id ?? 0), 5, '0', STR_PAD_LEFT)),
            'business_name' => $business?->business_name ?? $business?->name ?? 'Restaurant',
            'restaurant_count' => $restaurantCount,
            'stops' => $restaurantCount,
            'distance_km' => $distanceKm !== null ? round($distanceKm, 2) : null,
            'duration_minutes' => (int) ($delivery->estimated_duration_minutes ?? 0),
            'rider_status' => $status,
            'can_accept' => false,
            'accept_blocked_reason' => $status,
            'items' => [],
            'restaurants' => [],
        ];
    }

    private function deliveryDistance(Delivery $delivery, ?RiderLocation $location): ?float
    {
        if (! $location
            || (float) $location->latitude === 0.0
            || (float) $location->longitude === 0.0
            || $delivery->pickup_latitude === null
            || $delivery->pickup_longitude === null) {
            return null;
        }

        return $this->dispatchService->calculateDistance(
            (float) $location->latitude,
            (float) $location->longitude,
            (float) $delivery->pickup_latitude,
            (float) $delivery->pickup_longitude,
        );
    }
}