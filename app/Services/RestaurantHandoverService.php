<?php

namespace App\Services;

use App\Models\Business;
use App\Models\Order;
use App\Models\RestaurantHandover;
use App\Models\Staff;
use App\Models\StaffActivityLog;
use App\Models\User;
use App\Services\Integrity\TransactionLedger;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * "Handed to rider" (Staff Management §5, docs/staff-management-plan.md): the
 * restaurant records that it physically gave its items to the accepted rider.
 *
 * It only ADDS a record. The rider still confirms pickup on their own
 * (PickupSequenceService::confirmStop) — no pickup stop, delivery or order
 * status is changed here.
 */
class RestaurantHandoverService
{
    /** Item statuses that count as "ready" (or already past ready). */
    private const READY = ['ready', 'picked_up', 'in_transit', 'delivered', 'completed'];

    /**
     * @return array{already_confirmed: bool, handover: RestaurantHandover}
     */
    public function confirm(Order $order, Business $business, User $actor): array
    {
        $delivery = $order->activeDelivery();
        if (! $delivery || ! $delivery->rider_id) {
            throw new \InvalidArgumentException('No rider has accepted this order yet.');
        }

        $existing = RestaurantHandover::where('delivery_id', $delivery->id)->where('business_id', $business->id)->first();
        if ($existing) {
            return ['already_confirmed' => true, 'handover' => $existing];
        }

        // This restaurant's active items (an item without a restaurant belongs to the order's).
        $items = $order->items()->whereNotIn('status', ['cancelled', 'rejected'])->get(['id', 'status', 'business_id'])
            ->filter(fn ($item) => (int) ($item->business_id ?: $order->business_id) === (int) $business->id);
        if ($items->isEmpty()) {
            throw new \InvalidArgumentException('This order has none of your items to hand over.');
        }
        if ($items->contains(fn ($item) => ! in_array((string) $item->status, self::READY, true))) {
            // For cash orders, "ready" already requires the rider's payment confirmation (CodPickupPaymentGuard).
            throw new \InvalidArgumentException('Mark all your items ready before handing them to the rider.');
        }

        try {
            $handover = DB::transaction(function () use ($order, $business, $actor, $delivery) {
                $handover = RestaurantHandover::create([
                    'delivery_id' => $delivery->id,
                    'order_id' => $order->id,
                    'business_id' => $business->id,
                    'rider_id' => $delivery->rider_id,
                    'confirmed_by' => $actor->id,
                    'confirmed_at' => now(),
                ]);

                app(TransactionLedger::class)->record($order, 'restaurant_handover_confirmed', [
                    'business_id' => $business->id,
                    'rider_id' => $delivery->rider_id,
                    'confirmed_by' => $actor->id,
                    'actor_role' => $actor->role,
                ], $handover);

                if ($actor->role === 'staff' && ($staff = Staff::where('user_id', $actor->id)->first())) {
                    StaffActivityLog::record($staff, 'staff.handover_confirmed', "Handed order {$order->order_number} to the rider.", [
                        'order_id' => $order->id,
                        'rider_id' => $delivery->rider_id,
                    ], $actor);
                }

                return $handover;
            });
        } catch (QueryException $e) {
            // A simultaneous confirmation won the UNIQUE(delivery, restaurant) race.
            $handover = RestaurantHandover::where('delivery_id', $delivery->id)->where('business_id', $business->id)->firstOrFail();

            return ['already_confirmed' => true, 'handover' => $handover];
        }

        return ['already_confirmed' => false, 'handover' => $handover];
    }
}
