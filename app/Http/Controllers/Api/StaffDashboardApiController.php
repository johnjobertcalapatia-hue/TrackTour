<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Staff\StaffUpdateBookingStatusRequest;
use App\Http\Requests\Staff\StaffUpdateOrderStatusRequest;
use App\Http\Resources\BookingResource;
use App\Http\Resources\OrderResource;
use App\Models\Booking;
use App\Models\Order;
use App\Services\StaffService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class StaffDashboardApiController extends Controller
{
    public function __construct(private StaffService $staffService) {}

    private function getStaffAndBusiness(int $userId): ?array
    {
        $staff = $this->staffService->getStaffByUser($userId);

        if (! $staff) {
            return null;
        }

        return ['staff' => $staff, 'business' => $staff->business];
    }

    public function dashboard(Request $request): JsonResponse
    {
        $ctx = $this->getStaffAndBusiness($request->user()->id);
        if (! $ctx) {
            return $this->notFoundResponse('No staff profile found.');
        }

        $staff = $ctx['staff'];
        $business = $ctx['business'];

        $todaySummary = array_merge(
            $this->getOrderSummary($business->id),
            $this->getBookingSummary($business->id)
        );

        $recentOrders = Order::where('business_id', $business->id)
            ->latest()->take(10)
            ->get(['id', 'order_number', 'customer_name', 'status', 'total', 'created_at']);

        $recentBookings = Booking::where('business_id', $business->id)
            ->latest()->take(10)
            ->get(['id', 'booking_number', 'customer_name', 'booking_type', 'status', 'check_in_date', 'check_out_date', 'total_amount', 'created_at']);

        $dashboardType = 'generic';
        if (method_exists($business, 'isRestaurant') && $business->isRestaurant()) {
            $dashboardType = 'orders';
        } elseif (method_exists($business, 'isAccommodation') && $business->isAccommodation()) {
            $dashboardType = 'bookings';
        }

        return $this->successResponse([
            'staff' => [
                'id' => $staff->id,
                'full_name' => $staff->full_name,
                'employee_id' => $staff->employee_id,
                'status' => $staff->status,
                'role' => $staff->staffRole?->name ?? 'Staff',
                'profile_picture' => $staff->profile_picture,
            ],
            'business' => [
                'id' => $business->id,
                'name' => $business->business_name,
                'category' => $business->category?->name ?? 'Business',
                'status' => $business->status,
            ],
            'dashboard_type' => $dashboardType,
            'today_summary' => $todaySummary,
            'recent_orders' => OrderResource::collection($recentOrders),
            'recent_bookings' => BookingResource::collection($recentBookings),
        ]);
    }

    public function orders(Request $request): JsonResponse
    {
        $ctx = $this->getStaffAndBusiness($request->user()->id);
        if (! $ctx) {
            return $this->notFoundResponse('No staff profile found.');
        }

        $business = $ctx['business'];
        $status = $request->get('status', 'all');
        $type = $request->get('type');
        $search = $request->get('search');

        $query = Order::where('business_id', $business->id)
            ->with(['items.offering', 'delivery.rider.profile']);

        if ($status && $status !== 'all') {
            $query->where('status', $status);
        }
        if ($type) {
            $query->where('order_type', $type);
        }
        if ($search) {
            $query->where(function ($q) use ($search) {
                $q->where('order_number', 'like', "%{$search}%")
                    ->orWhere('customer_name', 'like', "%{$search}%");
            });
        }

        $orders = $query->latest()->paginate(20)->withQueryString();

        $statusCounts = Order::where('business_id', $business->id)
            ->selectRaw('status, count(*) as count')
            ->groupBy('status')
            ->pluck('count', 'status');

        $todaySummary = $this->getOrderSummary($business->id);

        return $this->successResponse([
            'orders' => OrderResource::collection($orders),
            'status_counts' => $statusCounts,
            'today_summary' => $todaySummary,
            'pagination' => [
                'current_page' => $orders->currentPage(),
                'last_page' => $orders->lastPage(),
                'per_page' => $orders->perPage(),
                'total' => $orders->total(),
            ],
        ], 'Orders retrieved.');
    }

    public function updateOrderStatus(StaffUpdateOrderStatusRequest $request, Order $order): JsonResponse
    {
        $ctx = $this->getStaffAndBusiness($request->user()->id);
        if (! $ctx || $order->business_id !== $ctx['business']->id) {
            return $this->forbiddenResponse('Unauthorized.');
        }

        if ($order->order_type === 'delivery'
            && ! $order->hasAcceptedRider()
            && in_array($request->status, ['preparing', 'ready'], true)
        ) {
            return $this->errorResponse('This delivery order cannot be prepared until a rider has accepted the delivery.', 422);
        }

        $order->update([
            'status' => $request->status,
            'cancellation_reason' => $request->cancellation_reason ?? null,
            'cancelled_at' => in_array($request->status, ['cancelled', 'rejected']) ? now() : null,
            'completed_at' => $request->status === 'completed' ? now() : null,
        ]);

        return $this->successResponse(null, "Order status updated to {$request->status}.");
    }

    public function bookings(Request $request): JsonResponse
    {
        $ctx = $this->getStaffAndBusiness($request->user()->id);
        if (! $ctx) {
            return $this->notFoundResponse('No staff profile found.');
        }

        $business = $ctx['business'];
        $status = $request->get('status', 'all');
        $type = $request->get('type');
        $search = $request->get('search');

        $query = Booking::where('business_id', $business->id)->with('items');

        if ($status && $status !== 'all') {
            $query->where('status', $status);
        }
        if ($type) {
            $query->where('booking_type', $type);
        }
        if ($search) {
            $query->where(function ($q) use ($search) {
                $q->where('booking_number', 'like', "%{$search}%")
                    ->orWhere('customer_name', 'like', "%{$search}%");
            });
        }

        $bookings = $query->latest()->paginate(20)->withQueryString();

        $statusCounts = Booking::where('business_id', $business->id)
            ->selectRaw('status, count(*) as count')
            ->groupBy('status')
            ->pluck('count', 'status');

        $todaySummary = $this->getBookingSummary($business->id);

        return $this->successResponse([
            'bookings' => BookingResource::collection($bookings),
            'status_counts' => $statusCounts,
            'today_summary' => $todaySummary,
            'pagination' => [
                'current_page' => $bookings->currentPage(),
                'last_page' => $bookings->lastPage(),
                'per_page' => $bookings->perPage(),
                'total' => $bookings->total(),
            ],
        ], 'Bookings retrieved.');
    }

    public function updateBookingStatus(StaffUpdateBookingStatusRequest $request, Booking $booking): JsonResponse
    {
        $ctx = $this->getStaffAndBusiness($request->user()->id);
        if (! $ctx || $booking->business_id !== $ctx['business']->id) {
            return $this->forbiddenResponse('Unauthorized.');
        }

        $booking->update([
            'status' => $request->status,
            'cancellation_reason' => $request->cancellation_reason ?? null,
            'cancelled_at' => in_array($request->status, ['cancelled', 'rejected']) ? now() : null,
            'completed_at' => $request->status === 'completed' ? now() : null,
        ]);

        return $this->successResponse(null, "Booking status updated to {$request->status}.");
    }

    private function getOrderSummary(int $businessId): array
    {
        $today = now()->today();
        $startOfDay = $today->copy()->startOfDay();
        $endOfDay = $today->copy()->endOfDay();

        $base = Order::where('business_id', $businessId);

        return [
            'pending' => (clone $base)->whereIn('status', ['pending_payment', 'waiting_restaurant'])->count(),
            'confirmed' => (clone $base)->whereIn('status', ['accepted', 'preparing', 'ready'])->count(),
            'in_progress' => (clone $base)->whereIn('status', ['preparing', 'ready'])->count(),
            'completed_today' => (clone $base)->where('status', 'completed')
                ->whereBetween('completed_at', [$startOfDay, $endOfDay])->count(),
            'cancelled_today' => (clone $base)->whereIn('status', ['cancelled', 'rejected'])
                ->whereBetween('cancelled_at', [$startOfDay, $endOfDay])->count(),
            'revenue_today' => (clone $base)->where('status', 'completed')
                ->whereBetween('completed_at', [$startOfDay, $endOfDay])->sum('total'),
        ];
    }

    private function getBookingSummary(int $businessId): array
    {
        $today = now()->today();
        $startOfDay = $today->copy()->startOfDay();
        $endOfDay = $today->copy()->endOfDay();

        $base = Booking::where('business_id', $businessId);

        return [
            'pending' => (clone $base)->where('status', 'pending')->count(),
            'confirmed' => (clone $base)->where('status', 'confirmed')->count(),
            'in_progress' => (clone $base)->where('status', 'in_progress')->count(),
            'completed_today' => (clone $base)->where('status', 'completed')
                ->whereBetween('completed_at', [$startOfDay, $endOfDay])->count(),
            'cancelled_today' => (clone $base)->whereIn('status', ['cancelled', 'rejected'])
                ->whereBetween('cancelled_at', [$startOfDay, $endOfDay])->count(),
            'revenue_today' => (clone $base)->where('status', 'completed')
                ->whereBetween('completed_at', [$startOfDay, $endOfDay])->sum('total_amount'),
        ];
    }
}
