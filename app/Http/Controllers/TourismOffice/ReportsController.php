<?php

namespace App\Http\Controllers\TourismOffice;

use App\Enums\TripStatus;
use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\Review;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReportsController extends Controller
{
    public function index(Request $request)
    {
        $period = $request->get('period', '30_days');
        $dateFrom = match ($period) {
            '7_days' => now()->subDays(7)->startOfDay(),
            '30_days' => now()->subDays(30)->startOfDay(),
            '90_days' => now()->subDays(90)->startOfDay(),
            '12_months' => now()->subYear()->startOfDay(),
            default => now()->subDays(30)->startOfDay(),
        };

        $revenueTrend = Order::where('status', 'completed')
            ->where('created_at', '>=', $dateFrom)
            ->selectRaw("DATE_FORMAT(created_at, '%Y-%m-%d') as date, SUM(total) as revenue, COUNT(*) as order_count")
            ->groupBy('date')
            ->orderBy('date')
            ->get();

        $tripVolume = Delivery::where('created_at', '>=', $dateFrom)
            ->selectRaw("DATE_FORMAT(created_at, '%Y-%m-%d') as date, COUNT(*) as total")
            ->groupBy('date')
            ->orderBy('date')
            ->get();

        $guideLeaderboard = Delivery::where('status', TripStatus::COMPLETED)
            ->where('delivered_at', '>=', $dateFrom)
            ->select('rider_id', DB::raw('COUNT(*) as trips'))
            ->with('rider.profile')
            ->groupBy('rider_id')
            ->orderByDesc('trips')
            ->limit(10)
            ->get()
            ->map(fn ($d) => [
                'id' => $d->rider_id,
                'name' => $d->rider?->fullName,
                'trips' => (int) $d->trips,
            ]);

        $businessPerformance = Order::where('status', 'completed')
            ->where('created_at', '>=', $dateFrom)
            ->select('business_id', DB::raw('COUNT(*) as orders'), DB::raw('SUM(total) as revenue'))
            ->with('business')
            ->groupBy('business_id')
            ->orderByDesc('revenue')
            ->limit(10)
            ->get()
            ->map(fn ($o) => [
                'id' => $o->business_id,
                'name' => $o->business?->business_name ?? 'Unknown',
                'orders' => (int) $o->orders,
                'revenue' => (float) $o->revenue,
            ]);

        $avgRating = Review::where('status', 'approved')
            ->where('created_at', '>=', $dateFrom)
            ->avg('rating');

        $municipalityStats = Business::select('municipality_id', DB::raw('COUNT(*) as total'))
            ->with('municipality')
            ->groupBy('municipality_id')
            ->orderByDesc('total')
            ->get()
            ->map(fn ($b) => [
                'name' => $b->municipality?->name ?? 'Unknown',
                'businesses' => (int) $b->total,
            ]);

        $orderTypeBreakdown = Order::where('created_at', '>=', $dateFrom)
            ->select('order_type', DB::raw('COUNT(*) as total'))
            ->groupBy('order_type')
            ->get()
            ->map(fn ($o) => [
                'type' => $o->order_type,
                'total' => (int) $o->total,
            ]);

        $tripStatusBreakdown = Delivery::where('created_at', '>=', $dateFrom)
            ->select('status', DB::raw('COUNT(*) as total'))
            ->groupBy('status')
            ->get()
            ->map(fn ($d) => [
                'status' => $d->status,
                'total' => (int) $d->total,
            ]);

        $dailySummary = Order::where('status', 'completed')
            ->where('created_at', '>=', $dateFrom)
            ->selectRaw("DATE_FORMAT(created_at, '%Y-%m-%d') as date,
                SUM(total) as revenue,
                COUNT(*) as orders,
                AVG(total) as avg_order_value")
            ->groupBy('date')
            ->orderBy('date')
            ->get();

        $summary = [
            'total_revenue' => Order::where('status', 'completed')->where('created_at', '>=', $dateFrom)->sum('total'),
            'total_orders' => Order::where('created_at', '>=', $dateFrom)->count(),
            'completed_orders' => Order::where('status', 'completed')->where('created_at', '>=', $dateFrom)->count(),
            'total_trips' => Delivery::where('created_at', '>=', $dateFrom)->count(),
            'completed_trips' => Delivery::where('status', TripStatus::COMPLETED)->where('delivered_at', '>=', $dateFrom)->count(),
            'active_guides' => User::where('role', User::ROLE_RIDER)->where('rider_status', User::RIDER_STATUS_AVAILABLE)->count(),
            'registered_guides' => User::where('role', User::ROLE_RIDER)->where('account_status', User::ACCOUNT_STATUS_APPROVED)->count(),
            'avg_rating' => $avgRating ? round($avgRating, 1) : 0,
            'total_businesses' => Business::count(),
            'total_tourists' => User::where('role', User::ROLE_TOURIST)->count(),
        ];

        return $this->successResponse(compact(
            'revenueTrend', 'tripVolume', 'guideLeaderboard',
            'businessPerformance', 'municipalityStats',
            'orderTypeBreakdown', 'tripStatusBreakdown',
            'dailySummary', 'summary', 'period'
        ));
    }
}
