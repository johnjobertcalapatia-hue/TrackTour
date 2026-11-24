<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ActsForBusiness;
use App\Models\Booking;
use App\Models\Order;
use App\Services\BusinessService;
use App\Services\CodSettlementService;
use App\Support\ReportDateRange;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BusinessOwnerReportController extends Controller
{
    use ActsForBusiness;

    public function __construct(
        private BusinessService $businessService
    ) {}

    private function resolveBusinessIds(Request $request): array
    {
        $query = $this->actingBusinesses($request);

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
        // Date From / Date To override the period (ReportDateRange).
        $range = ReportDateRange::fromRequest($request);
        $period = $range->period;
        $window = $range->salesWindow();

        $query = ReportDateRange::apply(
            Order::whereIn('business_id', $businessIds)->where('status', 'completed'),
            'completed_at', $window['start'], $window['end']
        );

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
            'custom_range' => $range->custom,
        ]);
    }

    /**
     * GET reports/overview?from=Y-m-d&to=Y-m-d: Reports & Analytics page. KPIs
     * with the change against the previous period of the same length, the sales
     * trend, top-selling items, orders by status and revenue per week.
     */
    public function overview(Request $request, \App\Services\OwnerReportOverview $overview): JsonResponse
    {
        $validated = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);
        $days = \Illuminate\Support\Carbon::parse($validated['from'])->diffInDays(\Illuminate\Support\Carbon::parse($validated['to'])) + 1;
        if ($days > 366) {
            return $this->errorResponse('Choose a range of one year or less.', 422, ['to' => ['Choose a range of one year or less.']]);
        }

        return $this->successResponse($overview->build($this->resolveBusinessIds($request), $validated['from'], $validated['to']));
    }

    public function orders(Request $request): JsonResponse
    {
        $businessIds = $this->resolveBusinessIds($request);

        // Orders placed between Date From and Date To (all time without dates).
        $query = ReportDateRange::fromRequest($request)->applyCustom(Order::whereIn('business_id', $businessIds), 'created_at');

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

        // Bookings made between Date From and Date To (all time without dates).
        $query = ReportDateRange::fromRequest($request)->applyCustom(Booking::whereIn('business_id', $businessIds), 'created_at');

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

}
