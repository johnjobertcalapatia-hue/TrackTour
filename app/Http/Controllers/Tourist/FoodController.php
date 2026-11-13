<?php

namespace App\Http\Controllers\Tourist;

use App\Enums\DiscoveryGroup;
use App\Events\DeliveryStatusChanged;
use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Offering;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Review;
use App\Services\OrderService;
use App\Services\OrderRefundService;
use App\Services\DeliveryFeeService;
use App\Services\FoodPopularityService;
use App\Services\OrderTrackingService;
use App\Services\NearestRiderService;
use App\Services\TouristService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;


class FoodController extends Controller
{
    public function __construct(
        private TouristService $touristService,
        private OrderService $orderService,
        private DeliveryFeeService $deliveryFeeService,
        private NearestRiderService $nearestRiderService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $search = $request->input('search');
        $category = $request->input('category');

        $query = Offering::query()
            ->where('is_available', true)
            ->where('status', 'available')
            ->whereHas('business', fn ($q) => $q->where('status', 'approved'))
            ->whereHas('business.category', fn ($q) => $q->inDiscoveryGroup(DiscoveryGroup::Dining))
            ->with('business.category', 'category');

        if ($category && $category !== 'all') {
            $query->whereHas('category', fn ($q) => $q->where('name', $category));
        }

        // Home "Popular Food" scopes to the tourist's current municipality.
        if (filter_var($request->input('municipality_id'), FILTER_VALIDATE_INT)) {
            $query->whereHas('business', fn ($q) => $q->where('municipality_id', (int) $request->input('municipality_id')));
        }

        if ($search) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('description', 'like', "%{$search}%")
                    ->orWhereHas('business', fn ($b) => $b->where('business_name', 'like', "%{$search}%"));
            });
        }

        // Sort options shown on the tourist Food page. "popular" (default) ranks by
        // ratings + sales (offerings.popularity_score, FoodPopularityService),
        // then the bestseller flag and menu order. Within each page, items from
        // restaurants accepting orders are still listed first (stable sort below).
        match ($request->input('sort')) {
            'price_low' => $query->orderBy('price')->orderBy('id'),
            'price_high' => $query->orderByDesc('price')->orderBy('id'),
            'newest' => $query->orderByDesc('created_at')->orderByDesc('id'),
            default => $query->orderByDesc('popularity_score')->orderByDesc('bestseller')->orderBy('sort_order')->orderBy('id'),
        };

        $offerings = $query->paginate(12);

        // Real per-dish stats for this page, batched (no per-item queries), with
        // the same definitions the popularity score uses (FoodPopularityService):
        //   sold: units of the dish in delivered/completed orders
        //   food rating: approved dish reviews, else older whole-order food ratings
        $pageIds = $offerings->getCollection()->pluck('id')->all();
        ['sold' => $soldByOffering, 'ratings' => $foodRatings] = app(FoodPopularityService::class)->stats($pageIds);

        $items = $offerings->map(function ($food) use ($soldByOffering, $foodRatings) {
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
                'sold_count' => (int) ($soldByOffering[$food->id] ?? 0),
                'food_rating' => $foodRatings[$food->id]['average'] ?? null,
                'food_rating_count' => $foodRatings[$food->id]['count'] ?? 0,
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
            ->where('status', 'available')
            ->whereHas('business', fn ($q) => $q->where('status', 'approved'))
            ->whereHas('category')
            ->whereHas('business.category', fn ($q) => $q->inDiscoveryGroup(DiscoveryGroup::Dining))
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
        $offering->load('business.category', 'business.municipality', 'category', 'variations');

        $business = $offering->business;

        // Mirror the listing visibility rules from index() so a direct URL can
        // never surface an unapproved business or a non-available offering.
        if ($business->status !== 'approved'
            || ! $offering->is_available
            || $offering->status !== 'available') {
            abort(404);
        }

        $images = array_values(array_filter(array_merge(
            [$offering->image],
            is_array($offering->images) ? $offering->images : [],
        ), fn ($image) => filled($image)));

        // Reviews are business-level only (reviews carry no offering_id), so they
        // are returned strictly as restaurant context — never as an item rating.
        $reviews = Review::query()
            ->where('business_id', $business->id)
            ->where('status', 'approved')
            ->with('user')
            ->latest()
            ->take(3)
            ->get()
            ->map(fn (Review $review) => [
                'id' => $review->id,
                'rating' => $review->rating,
                'review' => $review->review,
                'user_name' => $review->user?->name,
                'created_at' => $review->created_at,
            ])
            ->values();

        return $this->successResponse([
            'id' => $offering->id,
            'name' => $offering->name,
            'description' => $offering->description,
            'price' => $offering->price,
            'compare_price' => $offering->compare_price,
            'category' => $offering->category->name ?? $business->category->name ?? 'General',
            'image' => $offering->image,
            'images' => $images,
            'is_available' => $offering->is_available,
            'is_featured' => (bool) $offering->bestseller,
            'has_variations' => (bool) $offering->has_variations,
            'variations' => $offering->variations->map(fn ($variation) => [
                'id' => $variation->id,
                'name' => $variation->name,
                'price' => (float) $variation->price,
                'is_available' => (bool) $variation->is_available,
            ])->values(),
            'preparation_time' => $offering->preparation_time,
            'unit' => $offering->unit,
            'business_id' => $business->id,
            'business_name' => $business->name,
            'business_logo' => $business->logo,
            'business_address' => $business->address,
            'business_latitude' => $business->latitude,
            'business_longitude' => $business->longitude,
            'business_review_count' => (int) ($business->review_count ?? 0),
            'business_reviews' => $reviews,
            // Restaurant strip + review summary on the food page. All values are
            // read from stored data; the summary covers every approved review.
            'business_category' => $business->category?->name,
            'business_municipality' => $business->municipality?->name,
            'business_contact_number' => $business->contact_number,
            'business_opening_time' => $business->opening_time,
            'business_closing_time' => $business->closing_time,
            'business_rating_summary' => Review::approvedSummaryFor($business->id),
            // average_rating defaults to 0 for unrated businesses; expose null so
            // clients hide the rating instead of rendering a fabricated "0.0".
            'rating' => $business->average_rating > 0 ? $business->average_rating : null,
            'is_open' => $business->isOpenNow(),
            'is_accepting_orders' => $business->isAcceptingOrders(),
            'availability' => $business->availability(),
            'open_status' => $business->openStatusLabel(),
            'schedule_summary' => $business->scheduleSummary(),
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
        $business = ($validated['business_id'] ?? null)
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

        if (! $business->acceptsPaymentMethod($validated['payment_method'])) {
            $label = $validated['payment_method'] === 'cash' ? 'cash on delivery' : 'online payments';
            return $this->errorResponse($business->business_name.' does not accept '.$label.' at the moment. Please choose another payment method.', 422);
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
                // Snapshot the menu's preparation time so later menu edits
                // never change this order's countdown (spec §16).
                'preparation_time' => $offering->preparation_time,
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

        // Stage 3: order + items are created in ONE transaction, after a final
        // availability / price recheck under row locks. A failure leaves no
        // partial order behind.
        try {
            $order = DB::transaction(function () use ($validated, $business, $orderItems, $deliverySpeed, $subtotal, $deliveryFee, $riderTip, $systemFee, $riderFinancedAmount, $riderDeliveryEarnings, $total, $fee) {
                app(\App\Services\CheckoutAvailabilityGuard::class)->assertOrderable($orderItems, (int) $business->id);

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

                return $order;
            });
        } catch (\InvalidArgumentException $exception) {
            return $this->errorResponse($exception->getMessage(), 422);
        }

        if ($order->order_type === 'delivery' && $order->status === 'waiting_restaurant') {
            app(\App\Services\SmartDispatchService::class)->scheduleDispatch($order->fresh());
        } elseif ($order->status === 'waiting_restaurant') {
            // Pickup food orders need no rider: preparation starts as soon as
            // the order is placed. (Delivery orders start when a rider
            // accepts — see PreparationStartService.)
            try {
                app(\App\Services\PreparationStartService::class)->startForOrder($order->fresh());
            } catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::warning('Preparation start after order placement failed', [
                    'order_id' => $order->id,
                    'error' => $e->getMessage(),
                ]);
            }
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

        $order->load('items.offering', 'items.business', 'business', 'delivery.rider.profile');
        $delivery = $order->activeDelivery();
        $pickupSequence = app(\App\Services\PickupSequenceService::class);
        $canonicalStops = collect();
        $pickupStateByBusiness = [];

        if ($delivery) {
            $delivery->loadMissing('codPurchases');
            $canonicalStops = $pickupSequence->stops($delivery);
            foreach ($canonicalStops as $stop) {
                $confirmed = $pickupSequence->stopConfirmed($delivery, $stop);
                $pickupStateByBusiness[(int) $stop->business_id] = [
                    'status' => $confirmed ? 'collected' : 'pending',
                    'arrived_at' => $stop->arrived_at?->toIso8601String(),
                    'pickup_confirmed_at' => $stop->pickup_confirmed_at?->toIso8601String()
                        ?? ($delivery->codPurchases
                            ->firstWhere('business_id', (int) $stop->business_id)
                            ?->collected_at?->toIso8601String()),
                    'waiting_seconds' => $stop->arrived_at
                        ? (int) $stop->arrived_at->diffInSeconds(
                            $stop->pickup_confirmed_at
                                ?? $delivery->codPurchases->firstWhere('business_id', (int) $stop->business_id)?->collected_at
                                ?? now()
                        )
                        : null,
                    'is_ready' => $pickupSequence->businessReady($delivery, (int) $stop->business_id),
                ];
            }
        }

        $progressOrders = $delivery?->childOrders() ?? collect([$order]);
        $progressItems = collect();
        foreach ($progressOrders as $progressOrder) {
            $progressOrder->loadMissing('items.business', 'business');
            foreach ($progressOrder->items as $item) {
                $progressItems->push([
                    'item' => $item,
                    'business_id' => (int) ($item->business_id ?: $progressOrder->business_id),
                    'business' => $item->business ?? $progressOrder->business,
                ]);
            }
        }

        $pickupStops = $progressItems
            ->groupBy('business_id')
            ->map(function ($entries, $businessId) use ($pickupStateByBusiness) {
                $items = $entries->pluck('item');
                $business = $entries->first()['business'];
                $pickupState = $pickupStateByBusiness[(int) $businessId] ?? [
                    'status' => 'pending',
                    'arrived_at' => null,
                    'pickup_confirmed_at' => null,
                    'waiting_seconds' => null,
                    'is_ready' => $items->every(fn ($item) => $item->status === 'ready'),
                ];

                return [
                    'business_id' => (int) $businessId,
                    'business_name' => $business?->business_name ?? $business?->name ?? 'Restaurant',
                    'address' => $business?->address,
                    'latitude' => $business?->latitude !== null ? (float) $business->latitude : null,
                    'longitude' => $business?->longitude !== null ? (float) $business->longitude : null,
                    'item_count' => $items->sum(fn ($item) => max(0, (int) $item->quantity - (int) $item->cancelled_quantity)),
                    'ready_item_count' => $items->where('status', 'ready')->sum(fn ($item) => max(0, (int) $item->quantity - (int) $item->cancelled_quantity)),
                ] + $pickupState;
            })
            ->values()
            ->all();

        $deliveryRouteActiveStatuses = [
            'picked_up',
            'in_transit',
            'en_route_destination',
            'arrived_destination',
            'delivered',
            'completed',
        ];
        $deliveryRouteActive = $delivery !== null
            && $canonicalStops->isNotEmpty()
            && $canonicalStops->every(fn ($stop) => $pickupSequence->stopConfirmed($delivery, $stop))
            && in_array($delivery->status->value ?? $delivery->status, $deliveryRouteActiveStatuses, true);

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
        $data['pickup_stops'] = $pickupStops;
        $data['delivery_route_active'] = $deliveryRouteActive;
        $data['rider_location'] = $riderLocation ? [
            'latitude' => (float) $riderLocation->latitude,
            'longitude' => (float) $riderLocation->longitude,
            'recorded_at' => $riderLocation->recorded_at?->toIso8601String(),
        ] : null;
        $data['tracking'] = app(OrderTrackingService::class)->customerBlock($order, $delivery);

        return $this->successResponse($data);
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

        // Cancellation and rider acceptance serialize on the delivery row lock
        // (docs/dispatch-escalation-plan.md §2): exactly one of them wins.
        // Before a rider accepts, the tourist may cancel and every outstanding
        // offer is withdrawn; once a rider has accepted, this pre-assignment
        // cancellation is refused.
        $outcome = \Illuminate\Support\Facades\DB::transaction(function () use ($order, $validated, $cancellableStatuses) {
            $delivery = $order->activeDelivery();
            $lockedDelivery = $delivery ? \App\Models\Delivery::lockForUpdate()->find($delivery->id) : null;
            $locked = Order::lockForUpdate()->find($order->id);

            if (! $locked || ! in_array($locked->status, $cancellableStatuses, true)) {
                return ['error' => 'This order can no longer be cancelled.'];
            }
            if ($lockedDelivery && $lockedDelivery->rider_id !== null) {
                return ['error' => 'A rider has already accepted this order, so it can no longer be cancelled here.'];
            }

            $previous = $locked->status;
            $locked->update([
                'status' => 'cancelled_by_tourist',
                'cancelled_by' => Auth::id(),
                'cancellation_reason' => $validated['reason'] ?? null,
                'cancelled_at' => now(),
            ]);

            // Withdraw the delivery and its offers (group children only when no
            // sibling still needs the shared trip — cancelDeliveryForOrder).
            app(\App\Services\NearestRiderService::class)->cancelDeliveryForOrder($locked);

            return ['previous' => $previous];
        });

        if (isset($outcome['error'])) {
            if ($request->expectsJson()) {
                return $this->errorResponse($outcome['error'], 422);
            }

            return back()->withErrors(['order' => $outcome['error']]);
        }

        $previousStatus = $outcome['previous'];
        $order->refresh();

        // Group children share one group-level payment. Cancelling one child only
        // affects that restaurant: cancel the shared trip (only when no sibling
        // still needs it) and record a local partial refund. Sibling orders
        // continue normally.
        if ($order->group_order_id) {
            // The shared trip was already handled under the lock above.
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

        if (! in_array($order->status, ['delivered', 'completed'], true)) {
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

        $saved = DB::transaction(function () use ($order, $validated) {
            $lockedOrder = Order::query()->lockForUpdate()->findOrFail($order->id);

            if (! in_array($lockedOrder->status, ['delivered', 'completed'], true)) {
                return false;
            }

            $lockedOrder->update([
                'rating' => $validated['rating'],
                'delivery_rating' => $validated['delivery_rating'] ?? null,
                'review' => $validated['review'] ?? null,
            ]);

            Review::updateOrCreate(
                ['order_id' => $lockedOrder->id],
                [
                    'business_id' => $lockedOrder->business_id,
                    'user_id' => Auth::id(),
                    'rating' => $validated['rating'],
                    'food_rating' => $validated['food_rating'] ?? null,
                    'service_rating' => $validated['service_rating'] ?? null,
                    'delivery_rating' => $validated['delivery_rating'] ?? null,
                    'review' => $validated['review'] ?? null,
                    'status' => 'pending',
                ]
            );

            return true;
        });

        if (! $saved) {
            return $this->errorResponse('You can only rate completed orders.', 422);
        }

        if ($request->expectsJson()) {
            return $this->successResponse(null, 'Thank you for your review!');
        }

        return redirect()->route('tourist.food.order-status', $order)
            ->with('success', 'Thank you for your feedback!');
    }

    /**
     * Retired (decision 2026-11-08): the RIDER now completes a food delivery
     * with a proof photo at the drop-off (POST /rider/deliveries/{d}/complete),
     * which also records the tourist's COD cash payment. The tourist no longer
     * confirms receipt; the endpoint stays to answer old clients clearly.
     */
    public function confirmDelivery(Request $request, Order $order): JsonResponse
    {
        if ($order->user_id && $order->user_id !== Auth::id()) {
            abort(403);
        }

        return $this->errorResponse('Your rider completes the delivery with a photo when your food arrives. No action is needed from you.', 422);
    }

}