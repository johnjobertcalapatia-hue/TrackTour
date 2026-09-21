<?php

namespace App\Http\Controllers\Rider;

use App\Http\Controllers\Controller;
use App\Models\Delivery;
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

        $delivery = $pendingLog->delivery;
        $dispatchedAt = $pendingLog->dispatched_at ? \Illuminate\Support\Carbon::parse($pendingLog->dispatched_at) : null;
        $expiresAt = $delivery?->dispatch_expires_at ? \Illuminate\Support\Carbon::parse($delivery->dispatch_expires_at) : null;
        $isExpired = ($dispatchedAt && $dispatchedAt->diffInSeconds(now()) >= NearestRiderService::DISPATCH_TIMEOUT_SECONDS)
            || ($expiresAt && $expiresAt->isPast());

        if ($isExpired) {
            $this->dispatchService->handleRiderResponse($delivery->id, $rider->id, 'timeout');

            return $this->successResponse(['request' => null]);
        }

        $expiresIn = $expiresAt ? max(0, (int) now()->diffInSeconds($expiresAt, false)) : 0;

        $order = $delivery?->primaryOrder();
        $business = $order?->business;
        $items = $order?->items ?? $delivery?->childOrders()->flatMap(fn ($o) => $o->items) ?? collect();

        return $this->successResponse([
            'request' => [
                'id' => $pendingLog->id,
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
                'distance_km' => $pendingLog->distance_km !== null ? (float) $pendingLog->distance_km : null,
                'duration_minutes' => (int) ($delivery?->estimated_duration_minutes ?? $order?->delivery_duration_minutes ?? 0),
                'items' => $items->map(fn ($it) => [
                    'name' => $it->product_name ?? 'Item',
                    'quantity' => (int) $it->quantity,
                    'price' => (float) ($it->unit_price ?? 0),
                    'subtotal' => (float) ($it->subtotal ?? 0),
                    'modifiers' => [],
                ])->values()->all(),
                'dispatched_at' => $pendingLog->dispatched_at,
                'expires_in' => max(0, $expiresIn),
            ],
        ]);
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

        return $this->errorResponse($result['message'] ?? 'Failed to accept delivery.', 422);
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
