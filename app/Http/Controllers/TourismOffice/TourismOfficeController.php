<?php

namespace App\Http\Controllers\TourismOffice;

use App\Http\Controllers\Controller;
use App\Models\ApprovalRequest;
use App\Models\Business;
use App\Models\Order;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TourismOfficeController extends Controller
{
    public function dashboard(Request $request)
    {
        $totalBusinesses = Business::count();
        $activeBusinesses = Business::where('status', 'approved')->count();
        $totalTourists = User::where('role', 'tourist')->count();
        $totalOrders = Order::count();
        $totalRevenue = (float) Order::where('status', 'completed')->sum('total');
        $pendingApprovals = ApprovalRequest::where('status', 'pending')->count();

        $recentBusinesses = Business::with('category', 'municipality')
            ->latest()->take(10)
            ->get()
            ->map(fn ($b) => [
                'id' => $b->id,
                'name' => $b->business_name,
                'category' => $b->category?->name ?? 'N/A',
                'status' => $b->status,
                'municipality' => $b->municipality?->name ?? 'N/A',
            ]);

        $topMunicipalities = DB::table('municipalities')
            ->leftJoin('businesses', 'municipalities.id', '=', 'businesses.municipality_id')
            ->select(
                'municipalities.name',
                DB::raw('count(businesses.id) as businesses'),
                DB::raw('0 as bookings')
            )
            ->whereNull('municipalities.deleted_at')
            ->groupBy('municipalities.name')
            ->orderByDesc('businesses')
            ->take(5)
            ->get();

        $data = [
            'stats' => [
                'total_businesses' => $totalBusinesses,
                'active_businesses' => $activeBusinesses,
                'total_tourists' => $totalTourists,
                'total_orders' => $totalOrders,
                'total_revenue' => $totalRevenue,
                'pending_approvals' => $pendingApprovals,
            ],
            'recent_businesses' => $recentBusinesses,
            'top_municipalities' => $topMunicipalities,
        ];

        return $this->successResponse($data);
    }
}
