<?php

namespace App\Http\Middleware;

use App\Models\Order;
use App\Models\OrderItem;
use App\Services\StaffAccess;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * `staff.order:<scope>` — limits a staff member to their own restaurant's part
 * of an order (AGENTS.md §4.1, Staff Management Stage 1). The owner's
 * canonical order actions then apply their own rules (rider-acceptance gate,
 * accepted-order policy, unpaid checks).
 *
 *  - shared: the order contains at least one of their business's items;
 *  - item:   the {item} belongs to the {order} and to their business;
 *  - whole:  every item of the order is their business's, so a whole-order
 *            action never touches another restaurant's items.
 */
class StaffOrderScopeMiddleware
{
    public function __construct(private StaffAccess $access) {}

    public function handle(Request $request, Closure $next, string $scope = 'shared'): Response
    {
        $user = $request->user();
        $order = $request->route('order');
        $order = $order instanceof Order ? $order : Order::find($order);

        if (! $order || ! $this->access->staffSharesOrder($user, $order)) {
            return $this->deny('This order has none of your restaurant\'s items.');
        }

        if ($scope === 'item') {
            $item = $request->route('item');
            $item = $item instanceof OrderItem ? $item : OrderItem::find($item);
            if (! $item || (int) $item->order_id !== (int) $order->id || ! $this->access->staffOwnsItem($user, $item)) {
                return $this->deny('You can only update your own restaurant\'s items.');
            }
        }

        if ($scope === 'whole' && ! $this->access->staffOwnsWholeOrder($user, $order)) {
            return $this->deny('This order includes other restaurants\' items. Update your own items one by one.');
        }

        return $next($request);
    }

    private function deny(string $message): Response
    {
        return response()->json(['success' => false, 'message' => $message, 'code' => 'staff_order_scope'], 403);
    }
}
