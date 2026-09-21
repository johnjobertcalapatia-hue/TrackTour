<?php

namespace App\Http\Controllers;

use App\Models\Booking;
use App\Models\Offering;
use App\Models\Order;
use App\Models\Promotion;
use App\Services\BusinessService;
use Illuminate\Http\Request;

class BusinessOwnerDashboardController extends Controller
{
    public function __construct(
        private BusinessService $businessService
    ) {}

    public function index(Request $request)
    {
        $userId = $request->user()->id;
        $businesses = $this->businessService->getByOwner($userId);

        $selectedBusinessId = $request->input('business_id');
        if ($selectedBusinessId) {
            $filteredBusiness = $businesses->firstWhere('id', $selectedBusinessId);
            if ($filteredBusiness) {
                $businessIds = collect([$filteredBusiness->id]);
                $activeBusiness = $filteredBusiness;
            } else {
                $businessIds = $businesses->pluck('id');
                $activeBusiness = $businesses->first();
            }
        } else {
            $businessIds = $businesses->pluck('id');
            $activeBusiness = $businesses->first();
        }

        $totalOrders = 0;
        $totalRevenue = 0;
        $activeBookings = 0;
        $pendingOrders = 0;
        $totalMenuItems = 0;
        $activePromotions = 0;

        if ($businessIds->isNotEmpty()) {
            $orderStats = Order::whereIn('business_id', $businessIds)
                ->selectRaw('COUNT(*) as total_orders, COALESCE(SUM(CASE WHEN status = ? THEN total ELSE 0 END), 0) as total_revenue, COALESCE(SUM(CASE WHEN status IN (?, ?) THEN 1 ELSE 0 END), 0) as pending_orders', ['completed', 'pending_payment', 'waiting_restaurant'])
                ->first();
            $totalOrders = $orderStats->total_orders;
            $totalRevenue = $orderStats->total_revenue;
            $pendingOrders = $orderStats->pending_orders;

            $activeBookings = Booking::whereIn('business_id', $businessIds)
                ->whereIn('status', ['pending', 'confirmed', 'in_progress'])->count();
            $totalMenuItems = Offering::whereIn('business_id', $businessIds)->count();
            $activePromotions = Promotion::whereIn('business_id', $businessIds)
                ->where('is_active', true)->count();
        }

        $recentOrders = Order::whereIn('business_id', $businessIds)
            ->latest()->take(5)
            ->get(['id', 'order_number', 'customer_name', 'status', 'total', 'created_at']);

        $recentBookings = Booking::whereIn('business_id', $businessIds)
            ->latest()->take(5)
            ->get(['id', 'booking_number', 'customer_name', 'status', 'check_in_date', 'check_out_date', 'total_amount', 'created_at']);

        $allBusinesses = $businesses->map(fn ($b) => [
            'id' => $b->id,
            'name' => $b->business_name,
            'category' => $b->category?->name ?? 'Business',
            'status' => $b->status,
            'logo' => $b->logo,
            'module_codes' => $b->module_codes,
        ]);

        $data = [
            'businesses' => $allBusinesses,
            'selected_business_id' => $selectedBusinessId ? (int) $selectedBusinessId : null,
            'business' => $activeBusiness ? [
                'name' => $activeBusiness->business_name,
                'category' => $activeBusiness->category?->name ?? 'Business',
            ] : null,
            'stats' => [
                'total_orders' => $totalOrders,
                'total_revenue' => (float) $totalRevenue,
                'active_bookings' => $activeBookings,
                'pending_orders' => $pendingOrders,
                'total_menu_items' => $totalMenuItems,
                'active_promotions' => $activePromotions,
            ],
            'recent_orders' => $recentOrders,
            'recent_bookings' => $recentBookings,
        ];

        return $this->successResponse($data);
    }
}
