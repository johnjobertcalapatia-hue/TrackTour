<?php

namespace App\Http\Controllers;

use App\Models\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BusinessOwnerCustomerController extends Controller
{
    /**
     * GET /business-owner/customers
     *
     * Aggregated customer list from orders.
     * Customers are identified by user_id (logged-in) or customer_email (guest checkout).
     */
    public function index(Request $request): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');
        $search = $request->get('search');
        $sortBy = $request->get('sort_by', 'orders_count');
        $sortDir = $request->get('sort_dir', 'desc');
        $perPage = $request->get('perPage', 20);

        $customers = Order::whereIn('business_id', $businessIds)
            ->where('status', 'completed')
            ->select(
                'user_id',
                'customer_name',
                'customer_email',
                'customer_phone',
                DB::raw('COUNT(*) as orders_count'),
                DB::raw('SUM(total) as total_spent'),
                DB::raw('MAX(completed_at) as last_order_at'),
                DB::raw('MIN(completed_at) as first_order_at'),
                DB::raw('AVG(total) as avg_order_value'),
                DB::raw('MAX(order_number) as last_order_number')
            )
            ->groupBy('user_id', 'customer_name', 'customer_email', 'customer_phone')
            ->when($search, function ($q, $search) {
                $q->where(function ($sq) use ($search) {
                    $sq->where('customer_name', 'like', "%{$search}%")
                        ->orWhere('customer_email', 'like', "%{$search}%")
                        ->orWhere('customer_phone', 'like', "%{$search}%");
                });
            })
            ->orderBy($sortBy, $sortDir)
            ->paginate($perPage);

        $formatted = $customers->getCollection()->map(fn ($row) => [
            'id' => $row->user_id ?? 'guest_'.md5($row->customer_email),
            'name' => $row->customer_name ?? 'Guest',
            'email' => $row->customer_email,
            'phone' => $row->customer_phone,
            'is_guest' => empty($row->user_id),
            'orders_count' => (int) $row->orders_count,
            'total_spent' => round((float) $row->total_spent, 2),
            'avg_order_value' => round((float) $row->avg_order_value, 2),
            'last_order_at' => $row->last_order_at,
            'first_order_at' => $row->first_order_at,
            'last_order_number' => $row->last_order_number,
        ]);

        return $this->paginatedResponse($customers->setCollection($formatted));
    }

    /**
     * GET /business-owner/customers/summary
     *
     * Summary stats for the customer dashboard cards.
     */
    public function summary(Request $request): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');

        $baseQuery = Order::whereIn('business_id', $businessIds)
            ->where('status', 'completed');

        $totalCustomers = (clone $baseQuery)
            ->selectRaw('COUNT(DISTINCT COALESCE(user_id, customer_email)) as count')
            ->value('count');

        $regularThreshold = 3;
        $regularCustomers = (clone $baseQuery)
            ->selectRaw('COUNT(*) as count')
            ->havingRaw('COUNT(*) >= ?', [$regularThreshold])
            ->groupBy('user_id', 'customer_email')
            ->get()
            ->count();

        $totalOrders = (clone $baseQuery)->count();
        $totalRevenue = (clone $baseQuery)->sum('total');

        // New customers this month
        $newThisMonth = (clone $baseQuery)
            ->where('completed_at', '>=', now()->startOfMonth())
            ->selectRaw('COUNT(DISTINCT COALESCE(user_id, customer_email)) as count')
            ->value('count');

        return $this->successResponse([
            'total_customers' => $totalCustomers,
            'regular_customers' => $regularCustomers,
            'total_orders' => $totalOrders,
            'total_revenue' => round((float) $totalRevenue, 2),
            'new_this_month' => $newThisMonth,
        ]);
    }

    /**
     * GET /business-owner/customers/{customerId}
     *
     * Customer detail with order history.
     */
    public function show(Request $request, string $customerId): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');

        $query = Order::whereIn('business_id', $businessIds)
            ->where('status', 'completed');

        // Determine if this is a user_id or a guest identifier
        if (str_starts_with($customerId, 'guest_')) {
            $emailHash = str_replace('guest_', '', $customerId);
            $query->whereNull('user_id')
                ->whereRaw('MD5(customer_email) = ?', [$emailHash]);
        } else {
            $query->where('user_id', $customerId);
        }

        $orders = $query->select(
            'id',
            'order_number',
            'customer_name',
            'customer_email',
            'customer_phone',
            'total',
            'payment_method',
            'completed_at',
            'rating',
            'review'
        )
            ->orderBy('completed_at', 'desc')
            ->get();

        if ($orders->isEmpty()) {
            return $this->errorResponse('Customer not found.', 404);
        }

        $first = $orders->last();

        $customer = [
            'id' => $customerId,
            'name' => $first->customer_name ?? 'Guest',
            'email' => $first->customer_email,
            'phone' => $first->customer_phone,
            'is_guest' => str_starts_with($customerId, 'guest_'),
            'orders_count' => $orders->count(),
            'total_spent' => round((float) $orders->sum('total'), 2),
            'avg_order_value' => round((float) $orders->avg('total'), 2),
            'last_order_at' => $orders->first()->completed_at,
            'first_order_at' => $first->completed_at,
            'orders' => $orders,
        ];

        return $this->successResponse($customer);
    }
}
