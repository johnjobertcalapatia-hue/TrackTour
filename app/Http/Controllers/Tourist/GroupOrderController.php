<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Models\GroupCheckout;
use App\Services\GroupOrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use InvalidArgumentException;

class GroupOrderController extends Controller
{
    public function __construct(private GroupOrderService $groupOrderService)
    {
    }

    /**
     * POST /tourist/food/group-order
     * Creates a group checkout and one independent order per restaurant.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'restaurants' => 'required|array|min:2',
            'restaurants.*.business_id' => 'required|exists:businesses,id',
            'restaurants.*.items' => 'required|array|min:1',
            'restaurants.*.items.*.offering_id' => 'required|exists:offerings,id',
            'restaurants.*.items.*.quantity' => 'required|integer|min:1',
            'restaurants.*.items.*.notes' => 'nullable|string|max:500',
            'order_type' => 'required|in:delivery,pickup',
            'delivery_speed' => 'required_if:order_type,delivery|in:standard,fast',
            'rider_tip' => 'nullable|numeric|min:0|max:100',
            'delivery_address' => 'required_if:order_type,delivery|nullable|string|max:500',
            'delivery_latitude' => 'required_if:order_type,delivery|nullable|numeric|between:-90,90',
            'delivery_longitude' => 'required_if:order_type,delivery|nullable|numeric|between:-180,180',
            'customer_phone' => 'required|string|max:20',
            'payment_method' => 'required|in:cash,gcash,card',
            'notes' => 'nullable|string|max:500',
        ]);

        $deliverySpeed = $validated['order_type'] === 'delivery'
            ? ($validated['delivery_speed'] ?? 'standard')
            : 'standard';
        $riderTip = $deliverySpeed === 'fast' ? round((float) ($validated['rider_tip'] ?? 0), 2) : 0;
        if ($validated['order_type'] === 'delivery' && $deliverySpeed === 'fast' && ($riderTip < 20 || $riderTip > 100)) {
            return $this->errorResponse('Fast Delivery requires a rider tip between ₱20 and ₱100.', 422);
        }
        if ($validated['order_type'] === 'pickup') {
            $validated['delivery_speed'] = 'standard';
            $validated['rider_tip'] = 0;
        } else {
            $validated['delivery_speed'] = $deliverySpeed;
            $validated['rider_tip'] = $riderTip;
        }

        $closedNames = [];
        foreach ($validated['restaurants'] as $restaurantGroup) {
            $business = \App\Models\Business::find($restaurantGroup['business_id']);
            if (! $business || ! $business->isAcceptingOrders()) {
                $closedNames[] = $business?->business_name ?? 'One restaurant';
            }
        }

        if (! empty($closedNames)) {
            return $this->errorResponse(
                'One or more restaurants in your cart are currently closed: '.implode(', ', array_unique($closedNames)).'. Please remove their items before continuing.',
                422
            );
        }

        try {
            $group = $this->groupOrderService->createGroup(Auth::user(), $validated);
        } catch (InvalidArgumentException $exception) {
            return $this->errorResponse($exception->getMessage(), 422);
        }

        return $this->createdResponse([
            'group_order' => $group->load('orders.items', 'orders.business'),
        ], 'Group order placed successfully.');
    }

    /**
     * GET /tourist/food/group-order/{id}
     * Returns one consolidated receipt for the group checkout.
     */
    public function show(Request $request, int $id): JsonResponse
    {
        $group = GroupCheckout::with([
            'orders.items.offering',
            'orders.business',
            'orders.delivery.rider.profile',
            'payments',
        ])->findOrFail($id);

        if ($group->user_id && $group->user_id !== Auth::id()) {
            abort(403);
        }

        return $this->successResponse(['group_order' => $group]);
    }
}
