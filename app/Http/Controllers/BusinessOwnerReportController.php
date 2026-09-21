<?php

namespace App\Http\Controllers;

use App\Models\Booking;
use App\Models\Order;
use App\Services\BusinessService;
use App\Services\CodSettlementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BusinessOwnerReportController extends Controller
{
    public function __construct(
        private BusinessService $businessService
    ) {}

    private function resolveBusinessIds(Request $request): array
    {
        $query = $request->user()->businesses();

        $businessId = $request->get('business_id');
        if ($businessId) {
            $query->where('id', $businessId);
        }

        $businessType = $request->get('business_type');
        if ($businessType) {
            $query->whereHas('category', fn($q) => $q->where('name', $businessType));
        }

        $businessCategoryId = $request->get('business_category_id');
        if ($businessCategoryId) {
            $query->where('business_category_id', $businessCategoryId);
        }

        return $query->pluck('id')->toArray();
    }

    public function sales(Request $request): JsonResponse
    {
        $businessIds = $this->resolveBusinessIds($request);
        $period = $request->get('period', 'monthly');

        $dates = $this->getDateRange($period);

        $query = Order::whereIn('business_id', $businessIds)
            ->where('status', 'completed')
            ->whereBetween('completed_at', [$dates['start'], $dates['end']]);

        $salesData = (clone $query)
            ->select(
                DB::raw('DATE(completed_at) as date'),
                DB::raw('COUNT(*) as total_orders'),
                DB::raw('SUM(total) as total_revenue')
            )
            ->groupBy('date')
            ->orderBy('date')
            ->get();

        $summary = [
            'total_revenue' => (clone $query)->sum('total'),
            'total_orders' => (clone $query)->count(),
            'average_order_value' => (clone $query)->avg('total') ?? 0,
        ];

        return $this->successResponse([
            'sales_data' => $salesData,
            'summary' => $summary,
            'period' => $period,
        ]);
    }

    public function orders(Request $request): JsonResponse
    {
        $businessIds = $this->resolveBusinessIds($request);

        $query = Order::whereIn('business_id', $businessIds);

        $orders = (clone $query)
            ->select('status', DB::raw('COUNT(*) as count'), DB::raw('SUM(total) as revenue'))
            ->groupBy('status')
            ->get();

        $totalOrders = (clone $query)->count();
        $totalRevenue = (clone $query)->sum('total');

        return $this->successResponse([
            'orders' => $orders,
            'total_orders' => $totalOrders,
            'total_revenue' => $totalRevenue,
        ]);
    }

    public function bookings(Request $request): JsonResponse
    {
        $businessIds = $this->resolveBusinessIds($request);

        $query = Booking::whereIn('business_id', $businessIds);

        $bookingsByStatus = (clone $query)
            ->select('status', DB::raw('COUNT(*) as count'), DB::raw('SUM(total_amount) as revenue'))
            ->groupBy('status')
            ->get();

        $bookingsByType = (clone $query)
            ->select('booking_type', DB::raw('COUNT(*) as count'), DB::raw('SUM(total_amount) as revenue'))
            ->groupBy('booking_type')
            ->get();

        $totalBookings = (clone $query)->count();
        $totalRevenue = (clone $query)->sum('total_amount');

        return $this->successResponse([
            'bookings_by_status' => $bookingsByStatus,
            'bookings_by_type' => $bookingsByType,
            'total_bookings' => $totalBookings,
            'total_revenue' => $totalRevenue,
        ]);
    }

    /**
     * P11.1 COD settlement ledger for the owner's restaurant(s): the 80/20
     * split of every compressed COD order is available here as the restaurant's
     * receivable, and via /admin/reports/cod-settlements as Tourism Office revenue.
     */
    public function codSettlements(Request $request): JsonResponse
    {
        $businessIds = $this->resolveBusinessIds($request);

        $service = app(CodSettlementService::class);
        $settlements = collect();
        $totals = ['settlement_base' => 0.0, 'restaurant_share' => 0.0, 'platform_fee' => 0.0];

        foreach ($businessIds as $businessId) {
            $ledger = $service->restaurantLedger((int) $businessId);
            $settlements = $settlements->merge($ledger['settlements']);
            $totals['settlement_base'] += (float) $ledger['total_settlement_base'];
            $totals['restaurant_share'] += (float) $ledger['total_restaurant_receivable'];
            $totals['platform_fee'] += (float) $ledger['total_platform_fee'];
        }

        return $this->successResponse([
            'settlements' => $settlements->sortByDesc('settled_at')->values(),
            'summary' => [
                'total_settlement_base' => round($totals['settlement_base'], 2),
                'total_restaurant_receivable' => round($totals['restaurant_share'], 2),
                'total_platform_fee' => round($totals['platform_fee'], 2),
                'count' => $settlements->count(),
            ],
        ], 'COD settlements retrieved.');
    }

    private function getDateRange(string $period): array
    {
        return match ($period) {
            'weekly' => ['start' => now()->startOfWeek(), 'end' => now()->endOfWeek()],
            'monthly' => ['start' => now()->startOfMonth(), 'end' => now()->endOfMonth()],
            'yearly' => ['start' => now()->startOfYear(), 'end' => now()->endOfYear()],
            default => ['start' => now()->startOfMonth(), 'end' => now()->endOfMonth()],
        };
    }
}
