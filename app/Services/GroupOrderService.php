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

    /**
     * Create a group checkout plus one independent order per restaurant.
     *
     * Items from the same restaurant are grouped into a single restaurant
     * order with its own acceptance lifecycle and a delivery fee calculated
     * once for that restaurant. This mirrors the single-order flow: one
     * `orders` row per restaurant, each with one or more order items.
     */
    public function createGroup(\Illuminate\Contracts\Auth\Authenticatable $user, array $payload): GroupCheckout
    {
        $orderType = $payload['order_type'];
        $deliveryLat = $orderType === 'delivery' ? (float) $payload['delivery_latitude'] : null;
        $deliveryLng = $orderType === 'delivery' ? (float) $payload['delivery_longitude'] : null;

        $subtotalTotal = 0.0;
        $deliveryTotal = 0.0;
        $systemFeeTotal = 0.0;
        $restaurantOrders = [];
        $deliveryFeeCache = [];

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

            // Calculate delivery fee once per restaurant
            if (! isset($deliveryFeeCache[$businessId])) {
                $fee = $orderType === 'delivery'
                    ? $this->deliveryFeeService->calculateOrderDeliveryFee($business, $deliveryLat, $deliveryLng)
                    : null;
                $deliveryFeeCache[$businessId] = $fee;
            }
            $fee = $deliveryFeeCache[$businessId];
            $deliveryFee = (float) ($fee['delivery_fee'] ?? 0);

            if (! isset($restaurantOrders[$businessId])) {
                $restaurantOrders[$businessId] = [
                    'business' => $business,
                    'items' => [],
                    'subtotal' => 0.0,
                    'delivery_fee' => $deliveryFee,
                    'fee' => $fee,
                ];
            }

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
                $restaurantOrders[$businessId]['items'][] = [
                    'offering_id' => $offering->id,
                    'product_name' => $offering->name,
                    'quantity' => $qty,
                    'unit_price' => $offering->price,
                    'subtotal' => $itemSubtotal,
                    'notes' => $item['notes'] ?? null,
                ];
                $restaurantOrders[$businessId]['subtotal'] += $itemSubtotal;
            }
        }

        if (empty($restaurantOrders)) {
            throw new InvalidArgumentException('No valid restaurant items were provided.');
        }

        $restaurantOrders = array_values($restaurantOrders);
        $riderTip = round((float) ($payload['rider_tip'] ?? 0), 2);
        $tipPerOrder = count($restaurantOrders) > 0 ? round($riderTip / count($restaurantOrders), 2) : 0;

        foreach ($restaurantOrders as &$data) {
            $data['subtotal'] = round($data['subtotal'], 2);
            $data['tip'] = $tipPerOrder;

            // Calculate system fee (10% of food subtotal)
            $data['system_fee'] = Order::calculateSystemFee($data['subtotal']);

            // Calculate rider financed amount (food subtotal + system fee)
            $data['rider_financed_amount'] = Order::calculateRiderFinancedAmount($data['subtotal'], $data['system_fee']);

            // Rider delivery earnings = delivery fee
            $data['rider_delivery_earnings'] = $data['delivery_fee'];

            // Total includes system fee
            $data['total'] = round($data['subtotal'] + $data['delivery_fee'] + $data['system_fee'] + $data['tip'], 2);

            $deliveryTotal += $data['delivery_fee'];
            $systemFeeTotal += $data['system_fee'];
        }
        unset($data);

        $grandTotal = round($subtotalTotal + $deliveryTotal + $systemFeeTotal + $riderTip, 2);

        return DB::transaction(function () use ($user, $orderType, $payload, $subtotalTotal, $deliveryTotal, $systemFeeTotal, $riderTip, $grandTotal, $deliveryLat, $deliveryLng, $restaurantOrders) {
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

            foreach ($restaurantOrders as $data) {
                $order = Order::create([
                    'order_number' => 'TT-'.strtoupper(str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT)),
                    'business_id' => $data['business']->id,
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
                    'subtotal' => $data['subtotal'],
                    'delivery_fee' => $data['delivery_fee'],
                    'rider_tip' => $data['tip'],
                    'discount' => 0,
                    'system_fee' => $data['system_fee'],
                    'rider_financed_amount' => $data['rider_financed_amount'],
                    'rider_delivery_earnings' => $data['rider_delivery_earnings'],
                    'total' => $data['total'],
                    'delivery_address' => $payload['delivery_address'] ?? null,
                    'delivery_distance_km' => $data['fee']['distance_km'] ?? null,
                    'delivery_duration_minutes' => $data['fee']['estimated_duration_minutes'] ?? null,
                    'pickup_latitude' => $data['fee']['pickup_latitude'] ?? null,
                    'pickup_longitude' => $data['fee']['pickup_longitude'] ?? null,
                    'delivery_latitude' => $deliveryLat,
                    'delivery_longitude' => $deliveryLng,
                    'delivery_fee_calculated_at' => $data['fee']['calculated_at'] ?? null,
                    'delivery_distance_is_estimated' => $data['fee']['is_estimated'] ?? false,
                    'notes' => $payload['notes'] ?? null,
                ]);

                foreach ($data['items'] as $item) {
                    $order->items()->create($item);
                }
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
