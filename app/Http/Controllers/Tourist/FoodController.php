<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Offering;
use App\Models\Order;
use App\Models\Review;
use App\Services\OrderService;
use App\Services\OrderRefundService;
use App\Services\DeliveryFeeService;
use App\Services\TouristService;
use App\Services\TripTokenService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;


class FoodController extends Controller
{
    public function __construct(
        private TouristService $touristService,
        private OrderService $orderService,
        private DeliveryFeeService $deliveryFeeService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $search = $request->input('search');
        $category = $request->input('category');

        $query = Offering::query()
            ->where('is_available', true)
            ->where('status', 'active')
            ->whereHas('business', fn ($q) => $q->where('status', 'approved'))
            ->whereHas('business.category', function ($q) {
                $q->where(function ($qq) {
                    $qq->where('name', 'like', '%restaurant%')
                        ->orWhere('name', 'like', '%food%')
                        ->orWhere('name', 'like', '%cafe%')
                        ->orWhere('name', 'like', '%food hub%');
                });
            })
            ->with('business.category', 'category');

        if ($category && $category !== 'all') {
            $query->whereHas('category', fn ($q) => $q->where('name', $category));
        }

        if ($search) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('description', 'like', "%{$search}%")
                    ->orWhereHas('business', fn ($b) => $b->where('business_name', 'like', "%{$search}%"));
            });
        }

        $offerings = $query
            ->orderByDesc('bestseller')
            ->orderBy('sort_order')
            ->paginate(12);

        $items = $offerings->map(function ($food) {
            return (object) [
                'id' => $food->id,
                'name' => $food->name,
                'description' => $food->description,
                'price' => $food->price,
                'category' => $food->category->name ?? $food->business->category->name ?? 'General',
                'image' => $food->image,
                'is_available' => $food->is_available,
                'business_name' => $food->business->name,
                'business_id' => $food->business_id,
                'business_latitude' => $food->business->latitude,
                'business_longitude' => $food->business->longitude,
                'rating' => $food->business->average_rating ?? null,
                'is_open' => $food->business->isOpenNow(),
                'is_accepting_orders' => $food->business->isAcceptingOrders(),
                'availability' => $food->business->availability(),
                'open_status' => $food->business->openStatusLabel(),
                'schedule_summary' => $food->business->scheduleSummary(),
                'created_at' => $food->created_at,
            ];
        })
        ->sortByDesc(fn ($food) =>
            ($food->is_accepting_orders ? 100 : 0)
            + ($food->is_open ? 10 : 0)
            + ($food->availability === 'open' ? 5 : ($food->availability === 'temporarily_closed' ? 1 : 0))
        )
        ->values();

        $categories = Offering::query()
            ->where('is_available', true)
            ->where('status', 'active')
            ->whereHas('business', fn ($q) => $q->where('status', 'approved'))
            ->whereHas('category')
            ->whereHas('business.category', function ($q) {
                $q->where(function ($qq) {
                    $qq->where('name', 'like', '%restaurant%')
                        ->orWhere('name', 'like', '%food%')
                        ->orWhere('name', 'like', '%cafe%')
                        ->orWhere('name', 'like', '%food hub%');
                });
            })
            ->with('category')
            ->get()
            ->map(fn ($food) => $food->category->name)
            ->filter()
            ->unique()
            ->values();

        return $this->successResponse([
            'data' => $items,
            'categories' => $categories,
            'meta' => [
                'current_page' => $offerings->currentPage(),
                'last_page' => $offerings->lastPage(),
                'per_page' => $offerings->perPage(),
                'total' => $offerings->total(),
            ],
        ]);
    }

    public function show(Offering $offering, Request $request): JsonResponse
    {
        $offering->load('business.category', 'category');

        if ($offering->business->status !== 'approved' || ! $offering->is_available) {
            abort(404);
        }

        return $this->successResponse([
            'id' => $offering->id,
            'name' => $offering->name,
            'description' => $offering->description,
            'price' => $offering->price,
            'category' => $offering->category->name ?? $offering->business->category->name ?? 'General',
            'image' => $offering->image,
            'is_available' => $offering->is_available,
            'is_featured' => (bool) $offering->bestseller,
            'business_id' => $offering->business_id,
            'business_name' => $offering->business->name,
            'business_latitude' => $offering->business->latitude,
            'business_longitude' => $offering->business->longitude,
            'rating' => $offering->business->average_rating ?? null,
            'is_open' => $offering->business->isOpenNow(),
            'is_accepting_orders' => $offering->business->isAcceptingOrders(),
            'availability' => $offering->business->availability(),
            'open_status' => $offering->business->openStatusLabel(),
            'schedule_summary' => $offering->business->scheduleSummary(),
        ]);
    }

    /**
     * POST /tourist/food/delivery-fee
     * Returns the exact delivery fee from the backend calculation (source of truth).
     */
    public function quoteDeliveryFee(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'business_id' => 'required|exists:businesses,id',
            'delivery_latitude' => 'required|numeric|between:-90,90',
            'delivery_longitude' => 'required|numeric|between:-180,180',
        ]);

        $business = Business::findOrFail($validated['business_id']);

        try {
            $fee = $this->deliveryFeeService->calculateOrderDeliveryFee(
                $business,
                (float) $validated['delivery_latitude'],
                (float) $validated['delivery_longitude']
            );
        } catch (\InvalidArgumentException $exception) {
            return $this->errorResponse($exception->getMessage(), 422);
        }

        return $this->successResponse([
            'delivery_fee' => $fee['delivery_fee'],
            'distance_km' => $fee['distance_km'],
            'estimated_duration_minutes' => $fee['estimated_duration_minutes'],
            'base_fare' => $fee['base_fare'],
            'distance_charge' => $fee['distance_charge'],
            'service_adjustment' => $fee['service_adjustment'],
            'is_estimated' => $fee['is_estimated'],
        ]);
    }

    /**
     * POST /tourist/food/availability
     * Returns current availability for a list of business ids so the cart can
     * block checkout for restaurants that have since closed.
     */
    public function checkAvailability(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'business_ids' => 'required|array|min:1|max:20',
            'business_ids.*' => 'integer|exists:businesses,id',
        ]);

        $businesses = Business::whereIn('id', array_unique($validated['business_ids']))->get();

        $result = $businesses->mapWithKeys(function ($business) {
            return [$business->id => [
                'is_open' => $business->isOpenNow(),
                'is_accepting_orders' => $business->isAcceptingOrders(),
                'availability' => $business->availability(),
                'open_status' => $business->openStatusLabel(),
                'business_name' => $business->business_name,
            ]];
        });

        return $this->successResponse(['restaurants' => $result]);
    }

    public function orderFlat(Request $request)
    {
        $validated = $request->validate([
            'business_id' => 'nullable|exists:businesses,id',
            'items' => 'required|array|min:1',
            'items.*.offering_id' => 'required|exists:offerings,id',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.notes' => 'nullable|string|max:500',
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
        }

        $firstOffering = Offering::findOrFail($validated['items'][0]['offering_id']);
        $business = $validated['business_id']
            ? Business::findOrFail($validated['business_id'])
            : $firstOffering->business;

        if (! $business) {
            return $this->errorResponse('Unable to determine the business for this order. Please try again.', 422);
        }

        if (! $business->isAcceptingOrders()) {
            $message = $business->force_closed
                ? 'The restaurant is temporarily closed. Please try again later.'
                : ($business->isOpenNow() ? 'The restaurant is currently not accepting orders.' : 'The restaurant is currently closed. '.$business->nextOpeningLabel().'.');
            return $this->errorResponse($message, 422);
        }

        $subtotal = 0;
        $orderItems = [];

        foreach ($validated['items'] as $item) {
            $offering = Offering::findOrFail($item['offering_id']);
            if ((int) $offering->business_id !== (int) $business->id) {
                return $this->errorResponse('All items must belong to the selected restaurant.', 422);
            }
            if (! $offering->is_available) {
                return $this->errorResponse($offering->name.' is no longer available.', 422);
            }
            $qty = $item['quantity'];
            $subtotal += $offering->price * $qty;
            $orderItems[] = [
                'offering_id' => $offering->id,
                'product_name' => $offering->name,
                'quantity' => $qty,
                'unit_price' => $offering->price,
                'subtotal' => $offering->price * $qty,
                'notes' => $item['notes'] ?? null,
            ];
        }

        try {
            $fee = $validated['order_type'] === 'delivery'
                ? $this->deliveryFeeService->calculateOrderDeliveryFee(
                    $business,
                    (float) $validated['delivery_latitude'],
                    (float) $validated['delivery_longitude']
                )
                : null;
        } catch (\InvalidArgumentException $exception) {
            return $this->errorResponse($exception->getMessage(), 422);
        }
        $deliveryFee = $fee['delivery_fee'] ?? 0;

        // Calculate COD financial fields per spec
        $systemFee = \App\Models\Order::calculateSystemFee($subtotal);
        $riderFinancedAmount = \App\Models\Order::calculateRiderFinancedAmount($subtotal, $systemFee);
        $riderDeliveryEarnings = $deliveryFee;
        $total = $subtotal + $deliveryFee + $systemFee + $riderTip;

        $order = Order::create([
            'order_number' => 'TT-'. strtoupper(str_pad(random_int(1, 99999), 5, '0', STR_PAD_LEFT)),
            'business_id' => $business->id,
            'user_id' => Auth::id(),
            'customer_name' => Auth::user()->fullName,
            'customer_email' => Auth::user()->email,
            'customer_phone' => $validated['customer_phone'],
            'order_type' => $validated['order_type'],
            'delivery_speed' => $deliverySpeed,
            'payment_method' => $validated['payment_method'] ?? 'gcash',
            'payment_status' => 'pending',
            'status' => $validated['payment_method'] === 'cash' ? 'waiting_restaurant' : 'pending_payment',
            'subtotal' => $subtotal,
            'delivery_fee' => $deliveryFee,
            'rider_tip' => $riderTip,
            'discount' => 0,
            'system_fee' => $systemFee,
            'rider_financed_amount' => $riderFinancedAmount,
            'rider_delivery_earnings' => $riderDeliveryEarnings,
            'total' => $total,
            'notes' => $validated['notes'] ?? null,
            'delivery_address' => $validated['delivery_address'] ?? null,
            'delivery_distance_km' => $fee['distance_km'] ?? null,
            'delivery_duration_minutes' => $fee['estimated_duration_minutes'] ?? null,
            'pickup_latitude' => $fee['pickup_latitude'] ?? null,
            'pickup_longitude' => $fee['pickup_longitude'] ?? null,
            'delivery_latitude' => $fee['delivery_latitude'] ?? null,
            'delivery_longitude' => $fee['delivery_longitude'] ?? null,
            'delivery_fee_calculated_at' => $fee['calculated_at'] ?? null,
            'delivery_distance_is_estimated' => $fee['is_estimated'] ?? false,
        ]);

        foreach ($orderItems as $item) {
            $order->items()->create($item);
        }

        if ($order->order_type === 'delivery' && $order->status === 'waiting_restaurant') {
            app(\App\Services\SmartDispatchService::class)->scheduleDispatch($order->fresh());
        }

        return $this->createdResponse([
            'order' => $order,
            'message' => 'Order placed! Your order number is '.$order->order_number,
        ], 'Order placed successfully.');
    }

    public function orderStatus(Request $request, Order $order)
    {
        if ($order->user_id && $order->user_id !== Auth::id()) {
            abort(403);
        }

        $order->load('items.offering', 'business', 'delivery.rider.profile');
        $delivery = $order->activeDelivery();

        $dispatchLogs = null;
        $riderLocation = null;
        if ($delivery) {
            $dispatchLogs = $delivery->dispatchLogs()
                ->with('rider.profile')
                ->latest()
                ->get();

            if ($delivery->rider_id) {
                $riderLocation = \App\Models\RiderLocation::where('rider_id', $delivery->rider_id)
                    ->latest('recorded_at')
                    ->first();
            }
        }

        $data = compact('order', 'delivery', 'dispatchLogs');
        $data['rider_location'] = $riderLocation ? [
            'latitude' => (float) $riderLocation->latitude,
            'longitude' => (float) $riderLocation->longitude,
            'recorded_at' => $riderLocation->recorded_at?->toIso8601String(),
        ] : null;
        $data['tracking'] = $this->orderTrackingBlock($order, $delivery);

        return $this->successResponse($data);
    }

    /**
     * P6: hand the authorized tourist an HMAC trip token so they can join the
     * live socket trip room (socket-primary tracking). Null when there is no
     * assigned rider yet or the order has reached a terminal state.
     */
    private function orderTrackingBlock(Order $order, ?\App\Models\Delivery $delivery): ?array
    {
        if (! $delivery || ! $delivery->rider_id) {
            return null;
        }

        $terminalStatuses = ['delivered', 'completed', 'cancelled', 'cancelled_by_tourist', 'rejected', 'refunded'];
        if (in_array($order->status, $terminalStatuses, true)) {
            return null;
        }

        if (! $order->user_id) {
            return null;
        }

        try {
            $token = app(TripTokenService::class)->issue($delivery->id, 'customer', (int) $order->user_id);
        } catch (\RuntimeException) {
            return null;
        }

        return [
            'delivery_id' => $delivery->id,
            'room' => "trip:{$delivery->id}",
            'token' => $token,
            'role' => 'customer',
        ];
    }

    public function cancelOrder(Request $request, Order $order)
    {
        if ($order->user_id && $order->user_id !== Auth::id()) {
            abort(403);
        }

        $cancellableStatuses = ['pending_payment', 'waiting_restaurant'];

        if (! in_array($order->status, $cancellableStatuses)) {
            if ($request->expectsJson()) {
                return $this->errorResponse('This order can no longer be cancelled.', 422);
            }
            return back()->withErrors(['order' => 'This order can no longer be cancelled.']);
        }

        $validated = $request->validate([
            'reason' => 'nullable|string|max:500',
        ]);

        $previousStatus = $order->status;
        $order->update([
            'status' => 'cancelled_by_tourist',
            'cancelled_by' => Auth::id(),
            'cancellation_reason' => $validated['reason'] ?? null,
            'cancelled_at' => now(),
        ]);

        // Group children share one group-level payment. Cancelling one child only
        // affects that restaurant: cancel the shared trip (only when no sibling
        // still needs it) and record a local partial refund. Sibling orders
        // continue normally.
        if ($order->group_order_id) {
            app(\App\Services\NearestRiderService::class)->cancelDeliveryForOrder($order);

            app(OrderRefundService::class)->refundPaidGroupChild(
                $order,
                $validated['reason'] ?? 'Cancelled by tourist'
            );

            if ($request->expectsJson()) {
                return $this->successResponse(null, 'Order cancelled. The refund for this restaurant will be returned.');
            }

            return redirect()->route('tourist.food.order-status', $order)
                ->with('success', 'Order cancelled. Refund will be returned.');
        }

        if ($previousStatus === 'waiting_restaurant' || $order->payment_status === 'authorized') {
            // Provider-authoritative refund (P11.3): the order is only marked
            // refunded once PayMongo confirms the refund succeeded; a failure
            // stays retryable and a pending refund is settled by webhook /
            // reconciliation.
            app(OrderRefundService::class)->refundPaidOrder(
                $order,
                $validated['reason'] ?? 'Cancelled by tourist'
            );
        }

        if ($request->expectsJson()) {
            return $this->successResponse(null, 'Order cancelled.');
        }

        return redirect()->route('tourist.food.order-status', $order)
            ->with('success', 'Order cancelled successfully.');
    }

    /**
     * POST /tourist/food/order/{order}/cancel-item
     * Cancel a quantity of a single food item and record the matching partial refund.
     * Items may only be cancelled while the order is still waiting to be accepted
     * (before the restaurant accepts / starts preparing and before pickup).
     */
    public function cancelItem(Request $request, Order $order)
    {
        if ($order->user_id && $order->user_id !== Auth::id()) {
            abort(403);
        }

        $validated = $request->validate([
            'item_id' => ['required', 'integer'],
            'quantity' => ['required', 'integer', 'min:1'],
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        $item = $order->items()->find($validated['item_id']);
        if (! $item) {
            return $this->errorResponse('Order item not found.', 404);
        }

        $blocked = ['accepted', 'preparing', 'ready', 'assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit', 'out_for_delivery', 'en_route_destination', 'arrived_destination', 'delivered', 'completed', 'rejected', 'cancelled', 'cancelled_by_tourist', 'refunded'];
        if (in_array($order->status, $blocked, true)) {
            return $this->errorResponse('This item can no longer be cancelled.', 422);
        }

        $quantity = (int) $validated['quantity'];
        if ($quantity > $item->activeQuantity()) {
            return $this->errorResponse('Cannot cancel more than the ordered quantity.', 422);
        }

        app(OrderRefundService::class)->refundCancelledItem(
            $item,
            $quantity,
            $validated['reason'] ?? 'Item cancelled by tourist',
            Auth::id(),
            Auth::id(),
        );

        return $this->successResponse(null, 'Item cancelled. The refund will be returned.');
    }

    public function rateOrder(Request $request, Order $order)
    {
        if ($order->user_id && $order->user_id !== Auth::id()) {
            abort(403);
        }

        if ($order->status !== 'delivered') {
            if ($request->expectsJson()) {
                return $this->errorResponse('You can only rate completed orders.', 422);
            }
            return back()->withErrors(['order' => 'You can only rate completed orders.']);
        }

        $validated = $request->validate([
            'rating' => 'required|integer|min:1|max:5',
            'food_rating' => 'nullable|integer|min:1|max:5',
            'service_rating' => 'nullable|integer|min:1|max:5',
            'delivery_rating' => 'nullable|integer|min:1|max:5',
            'review' => 'nullable|string|max:1000',
        ]);

        $order->update([
            'rating' => $validated['rating'],
            'review' => $validated['review'],
        ]);

        Review::create([
            'business_id' => $order->business_id,
            'user_id' => Auth::id(),
            'rating' => $validated['rating'],
            'food_rating' => $validated['food_rating'] ?? null,
            'service_rating' => $validated['service_rating'] ?? null,
            'delivery_rating' => $validated['delivery_rating'] ?? null,
            'review' => $validated['review'] ?? null,
            'status' => 'pending',
        ]);

        if ($request->expectsJson()) {
            return $this->successResponse(null, 'Thank you for your review!');
        }

        return redirect()->route('tourist.food.order-status', $order)
            ->with('success', 'Thank you for your feedback!');
    }

}