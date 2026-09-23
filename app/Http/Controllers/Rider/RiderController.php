<?php

namespace App\Http\Controllers\Rider;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\BookingDispatchLog;
use App\Models\Delivery;
use App\Models\User;
use App\Services\DeliveryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RiderController extends Controller
{
    public function __construct(
        private DeliveryService $deliveryService,
    ) {}

    public function dashboard(Request $request): JsonResponse
    {
        $userId = $request->user()->id;

        $pendingDeliveries = $this->deliveryService->getPendingDeliveries($userId)->count();
        $activeDeliveries = $this->deliveryService->getActiveDeliveries($userId)->count();

        $today = now()->startOfDay();
        $completedToday = Delivery::where('rider_id', $userId)
            ->where('status', 'completed')
            ->whereDate('delivered_at', $today)->count();

        $completedDeliveries = Delivery::with('order')
            ->where('rider_id', $userId)
            ->where('status', 'completed');
        $earningsToday = (float) (clone $completedDeliveries)
            ->whereDate('delivered_at', $today)
            ->get()
            ->sum(fn (Delivery $delivery) => (float) ($delivery->rider_commission ?? 0)
                + $delivery->childOrders()->sum(fn ($o) => (float) ($o->rider_tip ?? 0)));
        $totalEarnings = (float) (clone $completedDeliveries)
            ->get()
            ->sum(fn (Delivery $delivery) => (float) ($delivery->rider_commission ?? 0)
                + $delivery->childOrders()->sum(fn ($o) => (float) ($o->rider_tip ?? 0)));

        $rating = 0;

        $data = [
            'pending_deliveries' => $pendingDeliveries,
            'active_deliveries' => $activeDeliveries,
            'completed_today' => $completedToday,
            'earnings_today' => $earningsToday,
            'total_earnings' => $totalEarnings,
            'rating' => round($rating, 1),
        ];

        return $this->successResponse($data);
    }

    public function profile(Request $request): JsonResponse
    {
        $user = $request->user()->load('profile.municipality', 'riderDetail');

        return $this->successResponse(UserResource::make($user));
    }

    public function switchService(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user->riderDetail?->rider_status === 'busy') {
            return $this->errorResponse('Cannot switch service while on an active delivery.', 409);
        }

        $hasPendingRequest = BookingDispatchLog::where('rider_id', $user->id)
            ->where('response', 'pending')
            ->exists();

        if ($hasPendingRequest) {
            return $this->errorResponse('Cannot switch service while a booking request is pending.', 409);
        }

        $newService = $request->input('service', 'food');
        if (! in_array($newService, User::RIDER_SERVICES)) {
            $newService = User::SERVICE_FOOD;
        }

        $user->riderDetail()->updateOrCreate(
            ['user_id' => $user->id],
            ['current_service' => $newService]
        );

        return $this->successResponse(
            UserResource::make($user->fresh()->load('riderDetail')),
            'Switched to ' . ($newService === 'food' ? 'Food Delivery' : 'Transportation') . ' mode.'
        );
    }

    /**
     * Persist the rider's Auto accept preference.
     *
     * This is state ONLY — it never accepts an offer by itself. Acceptance
     * stays on the canonical atomic path (PATCH /rider/dispatch/accept →
     * NearestRiderService::handleRiderResponse), which is what still enforces
     * one active delivery per rider, offer expiry, and COD eligibility.
     */
    public function switchAutoAccept(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'auto_accept' => ['required', 'boolean'],
        ]);

        $user = $request->user();
        $enabled = (bool) $validated['auto_accept'];

        $user->riderDetail()->updateOrCreate(
            ['user_id' => $user->id],
            ['auto_accept' => $enabled]
        );

        return $this->successResponse(
            UserResource::make($user->fresh()->load('riderDetail')),
            $enabled ? 'Auto accept enabled.' : 'Auto accept disabled.'
        );
    }

    public function toggleAvailability(Request $request): JsonResponse
    {
        $user = $request->user();
        $currentStatus = $user->riderDetail?->rider_status;

        // Prevent toggling if rider is on an active delivery
        if ($currentStatus === User::RIDER_STATUS_BUSY) {
            return $this->errorResponse('You are currently on a delivery. Complete it before going offline.', 409);
        }

        if ($currentStatus === User::RIDER_STATUS_OFFLINE) {
            $user->riderDetail()->updateOrCreate(
                ['user_id' => $user->id],
                [
                    'rider_status' => User::RIDER_STATUS_AVAILABLE,
                    'current_service' => $user->riderDetail?->current_service ?? 'food',
                    'rider_status_updated_at' => now(),
                ]
            );
        } else {
            $user->riderDetail()->updateOrCreate(
                ['user_id' => $user->id],
                ['rider_status' => User::RIDER_STATUS_OFFLINE, 'rider_status_updated_at' => now()]
            );
        }

        $status = $user->fresh()->riderDetail?->rider_status;
        $label = in_array($status, [User::RIDER_STATUS_ONLINE, User::RIDER_STATUS_AVAILABLE], true) ? 'online' : 'offline';

        return $this->successResponse(
            UserResource::make($user->fresh()->load('riderDetail')),
            "You are now {$label}."
        );
    }

    public function toggleAvailable(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user->riderDetail?->rider_status === User::RIDER_STATUS_ONLINE) {
            $user->riderDetail()->updateOrCreate(
                ['user_id' => $user->id],
                ['rider_status' => User::RIDER_STATUS_AVAILABLE, 'rider_status_updated_at' => now()]
            );

            return $this->successResponse(
                UserResource::make($user->fresh()->load('riderDetail')),
                'You are now accepting requests.'
            );
        }

        if ($user->riderDetail?->rider_status === User::RIDER_STATUS_AVAILABLE) {
            $user->riderDetail()->updateOrCreate(
                ['user_id' => $user->id],
                ['rider_status' => User::RIDER_STATUS_ONLINE, 'rider_status_updated_at' => now()]
            );

            return $this->successResponse(
                UserResource::make($user->fresh()->load('riderDetail')),
                'You stopped accepting requests.'
            );
        }

        return $this->errorResponse('Cannot toggle availability in your current state.', 409);
    }

    public function earnings(Request $request): JsonResponse
    {
        $deliveries = $this->deliveryService->getRiderEarnings($request->user()->id, 15);

        $completedDeliveries = Delivery::with('order')
            ->where('rider_id', $request->user()->id)
            ->where('status', 'completed')
            ->get();
        $totalEarnings = $completedDeliveries->sum(
            fn (Delivery $delivery) => (float) ($delivery->rider_commission ?? 0)
                + $delivery->childOrders()->sum(fn ($o) => (float) ($o->rider_tip ?? 0))
        );

        return response()->json([
            'success' => true,
            'message' => 'Earnings retrieved successfully.',
            'data' => $deliveries->items(),
            'meta' => [
                'current_page' => $deliveries->currentPage(),
                'last_page' => $deliveries->lastPage(),
                'per_page' => $deliveries->perPage(),
                'total' => $deliveries->total(),
            ],
            'summary' => [
                'total_earnings' => round($totalEarnings, 2),
                'completed_deliveries' => $completedDeliveries->count(),
            ],
        ]);
    }

    public function earning(Request $request, Delivery $delivery): JsonResponse
    {
        abort_unless($delivery->rider_id === $request->user()->id, 404);

        $delivery->load(['order.business', 'order.items']);
        $order = $delivery->primaryOrder();
        $tip = (float) ($order?->rider_tip ?? 0);
        $commission = (float) ($delivery->rider_commission ?? 0);
        $isCompleted = $delivery->status?->value === 'completed' || $delivery->status === 'completed';

        return $this->successResponse([
            'id' => $delivery->id,
            'order_number' => $order?->order_number ?? 'N/A',
            'business_name' => $order?->business?->business_name ?? $order?->business?->name ?? 'Restaurant',
            'status' => $delivery->status?->value ?? $delivery->status,
            'payment_method' => $order?->payment_method ?? 'cash',
            'payment_status' => $order?->payment_status ?? 'pending',
            'customer_payment' => $order?->payment_method === 'cash' && $isCompleted ? (float) ($order?->total ?? 0) : 0,
            'delivery_fee' => (float) ($delivery->delivery_fee ?? 0),
            'tip' => $tip,
            'rider_commission' => $commission,
            'earnings' => $isCompleted ? round($commission + $tip, 2) : 0,
            'pickup_address' => $delivery->pickup_address,
            'delivery_address' => $delivery->delivery_address,
            'distance_km' => $delivery->distance_km,
            'estimated_duration_minutes' => $delivery->estimated_duration_minutes,
            'assigned_at' => $delivery->assigned_at,
            'picked_up_at' => $delivery->picked_up_at,
            'completed_at' => $delivery->delivered_at ?? $delivery->updated_at,
            'items' => $order?->items?->map(fn ($item) => [
                'name' => $item->product_name,
                'quantity' => (int) $item->quantity,
                'subtotal' => (float) $item->subtotal,
            ])->values()->all() ?? [],
        ]);
    }
}
