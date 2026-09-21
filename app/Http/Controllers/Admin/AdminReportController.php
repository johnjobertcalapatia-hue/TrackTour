<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Models\Business;
use App\Models\Order;
use App\Models\User;
use App\Services\AdminService;
use App\Services\CodSettlementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class AdminReportController extends Controller
{
    public function __construct(
        private AdminService $adminService
    ) {}

    public function system(): JsonResponse
    {
        $stats = [
            'total_users' => User::count(),
            'total_businesses' => Business::count(),
            'verified_businesses' => Business::where('status', 'verified')->count(),
            'total_orders' => Order::count(),
            'total_bookings' => Booking::count(),
            'users_by_role' => User::select('role', DB::raw('count(*) as total'))
                ->groupBy('role')
                ->pluck('total', 'role'),
            'monthly_registrations' => User::select(
                DB::raw("DATE_FORMAT(created_at, '%Y-%m') as month"),
                DB::raw('count(*) as total')
            )
                ->groupBy('month')
                ->orderBy('month', 'desc')
                ->take(12)
                ->get(),
        ];

        return $this->successResponse($stats, 'System report retrieved.');
    }

    public function tourism(): JsonResponse
    {
        $stats = $this->adminService->getSystemStats();

        return $this->successResponse($stats, 'Tourism report retrieved.');
    }

    public function business(): JsonResponse
    {
        $businesses = Business::with('owner', 'municipality')
            ->select('businesses.*', DB::raw('(SELECT COUNT(*) FROM orders WHERE orders.business_id = businesses.id) as order_count'))
            ->latest()
            ->paginate(15);

        return $this->paginatedResponse($businesses, 'Business report retrieved.');
    }

    /**
     * P11.1 Tourism Office / admin COD settlement revenue ledger: the 20%
     * platform fee (and the full 80/20 split) of every settled COD delivery.
     * Each row documents its source: order_id, delivery_id, restaurant
     * (business_id), rider_id, gross settlement base, and the TO share.
     */
    public function codSettlements(): JsonResponse
    {
        $ledger = app(CodSettlementService::class)->tourismOfficeLedger();

        return $this->successResponse($ledger, 'COD settlements retrieved.');
    }

    public function rider(): JsonResponse
    {
        $riders = User::where('role', User::ROLE_RIDER)
            ->latest()
            ->paginate(15);

        return $this->paginatedResponse($riders, 'Rider report retrieved.');
    }

    public function customer(): JsonResponse
    {
        $customers = User::where('role', User::ROLE_TOURIST)
            ->latest()
            ->paginate(15);

        return $this->paginatedResponse($customers, 'Customer report retrieved.');
    }
}
