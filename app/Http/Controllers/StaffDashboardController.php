<?php

namespace App\Http\Controllers;

use App\Models\Booking;
use App\Models\Business;
use App\Models\Order;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Carbon;

class StaffDashboardController extends Controller
{
    public function updateOrderStatus(Request $request, Order $order)
    {
        $staff = $request->staff;
        $business = $staff->business;

        if ($order->business_id !== $business->id) {
            abort(403);
        }

        $validated = $request->validate([
            'status' => ['required', 'string', 'in:confirmed,preparing,ready,completed,cancelled,rejected'],
            'cancellation_reason' => ['nullable', 'string', 'max:1000'],
        ]);

        $order->update([
            'status' => $validated['status'],
            'cancellation_reason' => $validated['cancellation_reason'] ?? null,
            'cancelled_at' => in_array($validated['status'], ['cancelled', 'rejected']) ? now() : null,
            'completed_at' => $validated['status'] === 'completed' ? now() : null,
        ]);

        return back()->with('success', "Order status updated to {$validated['status']}.");
    }

    public function updateBookingStatus(Request $request, Booking $booking)
    {
        $staff = $request->staff;
        $business = $staff->business;

        if ($booking->business_id !== $business->id) {
            abort(403);
        }

        $validated = $request->validate([
            'status' => ['required', 'string', 'in:confirmed,in_progress,completed,cancelled,rejected'],
            'cancellation_reason' => ['nullable', 'string', 'max:1000'],
        ]);

        $booking->update([
            'status' => $validated['status'],
            'cancellation_reason' => $validated['cancellation_reason'] ?? null,
            'cancelled_at' => in_array($validated['status'], ['cancelled', 'rejected']) ? now() : null,
            'completed_at' => $validated['status'] === 'completed' ? now() : null,
        ]);

        return back()->with('success', "Booking status updated to {$validated['status']}.");
    }

    private function getOrderSummary(int $businessId): array
    {
        $today = Carbon::today();
        $startOfDay = $today->startOfDay();
        $endOfDay = $today->endOfDay();

        $baseQuery = Order::where('business_id', $businessId);

        $pending = (clone $baseQuery)->whereIn('status', ['pending_payment', 'waiting_restaurant'])->count();
        $confirmed = (clone $baseQuery)->whereIn('status', ['accepted', 'preparing', 'ready'])->count();
        $inProgress = (clone $baseQuery)->whereIn('status', ['preparing', 'ready'])->count();
        $completedToday = (clone $baseQuery)
            ->where('status', 'completed')
            ->whereBetween('completed_at', [$startOfDay, $endOfDay])
            ->count();
        $cancelledToday = (clone $baseQuery)
            ->whereIn('status', ['cancelled', 'rejected'])
            ->whereBetween('cancelled_at', [$startOfDay, $endOfDay])
            ->count();
        $revenueToday = (clone $baseQuery)
            ->where('status', 'completed')
            ->whereBetween('completed_at', [$startOfDay, $endOfDay])
            ->sum('total');

        return [
            'pending' => $pending,
            'confirmed' => $confirmed,
            'in_progress' => $inProgress,
            'completed_today' => $completedToday,
            'cancelled_today' => $cancelledToday,
            'revenue_today' => $revenueToday,
        ];
    }

    private function getBookingSummary(int $businessId): array
    {
        $today = Carbon::today();
        $startOfDay = $today->startOfDay();
        $endOfDay = $today->endOfDay();

        $baseQuery = Booking::where('business_id', $businessId);

        $pending = (clone $baseQuery)->where('status', 'pending')->count();
        $confirmed = (clone $baseQuery)->where('status', 'confirmed')->count();
        $inProgress = (clone $baseQuery)->where('status', 'in_progress')->count();
        $completedToday = (clone $baseQuery)
            ->where('status', 'completed')
            ->whereBetween('completed_at', [$startOfDay, $endOfDay])
            ->count();
        $cancelledToday = (clone $baseQuery)
            ->whereIn('status', ['cancelled', 'rejected'])
            ->whereBetween('cancelled_at', [$startOfDay, $endOfDay])
            ->count();
        $revenueToday = (clone $baseQuery)
            ->where('status', 'completed')
            ->whereBetween('completed_at', [$startOfDay, $endOfDay])
            ->sum('total_amount');

        return [
            'pending' => $pending,
            'confirmed' => $confirmed,
            'in_progress' => $inProgress,
            'completed_today' => $completedToday,
            'cancelled_today' => $cancelledToday,
            'revenue_today' => $revenueToday,
        ];
    }
}
