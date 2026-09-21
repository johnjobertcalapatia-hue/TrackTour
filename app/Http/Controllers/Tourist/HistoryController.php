<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Models\GroupCheckout;
use App\Models\Order;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class HistoryController extends Controller
{
    public function index(Request $request)
    {
        $user = Auth::user();
        $tab = $request->input('tab', 'food');

        if ($tab === 'transport') {
            $trips = Order::where('customer_email', $user->email)
                ->where('order_type', 'transport')
                ->with('business')
                ->orderBy('created_at', 'desc')
                ->paginate(10);

            return $this->successResponse(compact('trips'));
        }

        if ($tab === 'bookings') {
            $bookings = Booking::where('customer_email', $user->email)
                ->with('business')
                ->orderBy('created_at', 'desc')
                ->paginate(10);

            return $this->successResponse(compact('bookings'));
        }

        // Default: food orders — include standalone orders AND group checkouts
        $groupOrderIds = Order::where('customer_email', $user->email)
            ->where('order_type', '!=', 'transport')
            ->whereNotNull('group_order_id')
            ->pluck('group_order_id')
            ->unique();

        $standaloneOrders = Order::where('customer_email', $user->email)
            ->where('order_type', '!=', 'transport')
            ->whereNull('group_order_id')
            ->with('business', 'items')
            ->orderBy('created_at', 'desc')
            ->paginate(10);

        $groupOrders = GroupCheckout::whereIn('id', $groupOrderIds)
            ->with([
                'orders' => function ($q) {
                    $q->with('business', 'items', 'delivery');
                },
            ])
            ->orderBy('created_at', 'desc')
            ->paginate(10);

        return $this->successResponse([
            'orders' => $standaloneOrders,
            'group_orders' => $groupOrders,
        ]);
    }
}
