<?php

namespace App\Services;

use App\Models\Business;
use App\Models\GroupCheckout;
use App\Models\Offering;
use App\Models\Order;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

class GroupOrderService
{
    public function __construct(
        private DeliveryFeeService $deliveryFeeService,
    ) {
    }

    /** Create one canonical order containing restaurant-owned item groups. */
    public function createGroup(\Illuminate\Contracts\Auth\Authenticatable $user, array $payload): GroupCheckout
    {
        $orderType = $payload['order_type'];
        $deliveryLat = $orderType === 'delivery' ? (float) $payload['delivery_latitude'] : null;
        $deliveryLng = $orderType === 'delivery' ? (float) $payload['delivery_longitude'] : null;

        $subtotalTotal = 0.0;
        $orderItems = [];
        $businesses = [];

        foreach ($payload['restaurants'] as $restaurantGroup) {
            $businessId = (int) $restaurantGroup['business_id'];
            $business = Business::findOrFail($businessId);

            if (! $business->isAcceptingOrders()) {
                $detail = $business->force_closed
                    ? 'currently temporarily closed'
                    : ($business->isOpenNow()
                        ? 'currently not accepting orders'
                        : 'currently closed ('.$business->nextOpeningLabel().')');
                throw new InvalidArgumentException($business->business_name.' is '.$detail.'. Please remove its items before continuing.');
            }

            $businesses[$businessId] = $business;

            foreach ($restaurantGroup['items'] as $item) {
                $offering = Offering::findOrFail($item['offering_id']);
                if ((int) $offering->business_id !== $businessId) {
                    throw new InvalidArgumentException('All items must belong to the selected restaurant.');
                }
                if (! $offering->is_available) {
                    throw new InvalidArgumentException($offering->name.' is no longer available.');
                }

                $qty = (int) $item['quantity'];
                $itemSubtotal = round($offering->price * $qty, 2);

                $subtotalTotal += $itemSubtotal;
                $orderItems[] = [
                    'business_id' => $businessId,
                    'offering_id' => $offering->id,
                    'product_name' => $offering->name,
                    'quantity' => $qty,
                    'unit_price' => $offering->price,
                    'subtotal' => $itemSubtotal,
                    'notes' => $item['notes'] ?? null,
                ];
            }
        }

        if (empty($orderItems) || empty($businesses)) {
            throw new InvalidArgumentException('No valid restaurant items were provided.');
        }

        $riderTip = round((float) ($payload['rider_tip'] ?? 0), 2);
        $firstBusiness = array_values($businesses)[0];
        $fee = $orderType === 'delivery'
            ? $this->deliveryFeeService->calculateOrderDeliveryFee($firstBusiness, $deliveryLat, $deliveryLng)
            : null;
        $deliveryTotal = (float) ($fee['delivery_fee'] ?? 0);
        $systemFeeTotal = Order::calculateSystemFee($subtotalTotal);
        $riderFinancedAmount = Order::calculateRiderFinancedAmount($subtotalTotal, $systemFeeTotal);
        $grandTotal = round($subtotalTotal + $deliveryTotal + $systemFeeTotal + $riderTip, 2);

        return DB::transaction(function () use ($user, $orderType, $payload, $subtotalTotal, $deliveryTotal, $systemFeeTotal, $riderTip, $grandTotal, $deliveryLat, $deliveryLng, $orderItems, $firstBusiness, $fee, $riderFinancedAmount) {
            $group = GroupCheckout::create([
                'reference_number' => 'TT-GROUP-'.strtoupper(str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT)),
                'user_id' => $user->getAuthIdentifier(),
                'customer_name' => $user->fullName,
                'customer_email' => $user->email,
                'customer_phone' => $payload['customer_phone'],
                'order_type' => $orderType,
                'subtotal' => $subtotalTotal,
                'delivery_total' => $deliveryTotal,
                'system_fee_total' => $systemFeeTotal,
                'delivery_speed' => $payload['delivery_speed'] ?? 'standard',
                'rider_tip' => $riderTip,
                'discount' => 0,
                'grand_total' => $grandTotal,
                'payment_method' => $payload['payment_method'] ?? 'gcash',
                'payment_status' => 'pending',
                'status' => 'pending',
                'delivery_address' => $payload['delivery_address'] ?? null,
                'delivery_latitude' => $deliveryLat,
                'delivery_longitude' => $deliveryLng,
                'notes' => $payload['notes'] ?? null,
            ]);

            $order = Order::create([
                    'order_number' => 'TT-'.strtoupper(str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT)),
                    'business_id' => $firstBusiness->id,
                    'group_order_id' => $group->id,
                    'user_id' => $user->getAuthIdentifier(),
                    'customer_name' => $user->fullName,
                    'customer_email' => $user->email,
                    'customer_phone' => $payload['customer_phone'],
                    'order_type' => $orderType,
                    'delivery_speed' => $payload['delivery_speed'] ?? 'standard',
                    'payment_method' => $payload['payment_method'] ?? 'gcash',
                    'payment_status' => 'pending',
                    'status' => ($payload['payment_method'] ?? 'gcash') === 'cash' ? 'waiting_restaurant' : 'pending_payment',
                    'subtotal' => $subtotalTotal,
                    'delivery_fee' => $deliveryTotal,
                    'rider_tip' => $riderTip,
                    'discount' => 0,
                    'system_fee' => $systemFeeTotal,
                    'rider_financed_amount' => $riderFinancedAmount,
                    'rider_delivery_earnings' => $deliveryTotal,
                    'total' => $grandTotal,
                    'delivery_address' => $payload['delivery_address'] ?? null,
                    'delivery_distance_km' => $fee['distance_km'] ?? null,
                    'delivery_duration_minutes' => $fee['estimated_duration_minutes'] ?? null,
                    'pickup_latitude' => $fee['pickup_latitude'] ?? null,
                    'pickup_longitude' => $fee['pickup_longitude'] ?? null,
                    'delivery_latitude' => $deliveryLat,
                    'delivery_longitude' => $deliveryLng,
                    'delivery_fee_calculated_at' => $fee['calculated_at'] ?? null,
                    'delivery_distance_is_estimated' => $fee['is_estimated'] ?? false,
                    'notes' => $payload['notes'] ?? null,
            ]);

            foreach ($orderItems as $item) {
                $order->items()->create($item);
            }

            // One group checkout => ONE physical delivery with ONE rider trip
            // (step 4/5). COD group deliveries are dispatched immediately at
            // creation; restaurant sub-orders never spawn their own delivery.
            if ($orderType === 'delivery' && $group->payment_method === 'cash') {
                app(SmartDispatchService::class)->scheduleGroupDispatch($group->fresh());
            }

            return $group->fresh();
        });
    }
}
