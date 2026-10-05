<?php

namespace App\Http\Controllers\Rider;

use App\Http\Controllers\Controller;
use App\Models\BookingDispatchLog;
use App\Services\NearestRiderService;
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
}