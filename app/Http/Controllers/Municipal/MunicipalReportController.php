<?php

namespace App\Http\Controllers\Municipal;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Read-only municipality statistics for a Philippine-local date range
 * (default: the last 30 days). Sales figures are item subtotals of this
 * municipality's businesses only, so a group checkout that spans several
 * municipalities is never counted in full here. An item's business is
 * order_items.business_id (set on group checkouts) or, when that is empty,
 * the order's own business (single-restaurant orders).
 */
class MunicipalReportController extends MunicipalController
{
    public const COMPLETED_ORDER_STATUSES = ['delivered', 'completed'];

    public const EXCLUDED_ITEM_STATUSES = ['cancelled', 'rejected'];

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from', 'before_or_equal:'.now('Asia/Manila')->addDay()->toDateString()],
        ]);

        $id = $this->municipalityId($request);
        $toDate = isset($validated['to']) ? Carbon::createFromFormat('Y-m-d', $validated['to'], 'Asia/Manila') : now('Asia/Manila');
        $fromDate = isset($validated['from'])
            ? Carbon::createFromFormat('Y-m-d', $validated['from'], 'Asia/Manila')
            : $toDate->copy()->subDays(29);

        if ($fromDate->diffInDays($toDate) > 366) {
            return $this->errorResponse('Choose a range of one year or less.', 422);
        }

        $start = $fromDate->copy()->startOfDay()->utc();
        $end = $toDate->copy()->endOfDay()->utc();

        $orders = DB::table('orders')
            ->whereIn('id', $this->scope->orderIds($id))
            ->whereNull('deleted_at')
            ->whereBetween('created_at', [$start, $end]);

        $completedItems = fn () => DB::table('order_items')
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->join('businesses', fn ($j) => $j->on(DB::raw('COALESCE(order_items.business_id, orders.business_id)'), '=', 'businesses.id'))
            ->where('businesses.municipality_id', $id)
            ->whereNull('orders.deleted_at')
            ->whereIn('orders.status', self::COMPLETED_ORDER_STATUSES)
            ->whereBetween('orders.created_at', [$start, $end])
            ->where(fn ($q) => $q->whereNull('order_items.status')->orWhereNotIn('order_items.status', self::EXCLUDED_ITEM_STATUSES));

        $bookings = fn () => DB::table('bookings')
            ->join('businesses', 'businesses.id', '=', 'bookings.business_id')
            ->where('businesses.municipality_id', $id)
            ->whereNull('bookings.deleted_at')
            ->whereBetween('bookings.created_at', [$start, $end]);

        $orderDates = (clone $orders)->pluck('created_at');
        $trend = [];
        for ($day = $fromDate->copy()->startOfDay(); $day->lte($toDate); $day->addDay()) {
            $trend[$day->toDateString()] = 0;
        }
        foreach ($orderDates as $createdAt) {
            $key = Carbon::parse($createdAt, 'UTC')->timezone('Asia/Manila')->toDateString();
            if (array_key_exists($key, $trend)) {
                $trend[$key]++;
            }
        }

        $touristIds = (clone $orders)->pluck('user_id')
            ->merge($bookings()->pluck('bookings.user_id'))
            ->filter()->unique();

        return $this->successResponse([
            'range' => ['from' => $fromDate->toDateString(), 'to' => $toDate->toDateString()],
            'orders' => [
                'total' => (clone $orders)->count(),
                'completed' => (clone $orders)->whereIn('status', self::COMPLETED_ORDER_STATUSES)->count(),
                'by_status' => (clone $orders)->selectRaw('status, COUNT(*) as total')->groupBy('status')->orderByDesc('total')->get(),
                'item_sales' => round((float) $completedItems()->sum('order_items.subtotal'), 2),
                'trend' => collect($trend)->map(fn ($count, $date) => ['date' => $date, 'orders' => $count])->values(),
            ],
            'top_businesses' => $completedItems()
                ->selectRaw('businesses.id, businesses.business_name, COUNT(DISTINCT order_items.order_id) as orders, SUM(order_items.subtotal) as sales')
                ->groupBy('businesses.id', 'businesses.business_name')
                ->orderByDesc('sales')
                ->limit(5)
                ->get()
                ->map(fn ($row) => [
                    'id' => (int) $row->id,
                    'business_name' => $row->business_name,
                    'orders' => (int) $row->orders,
                    'sales' => round((float) $row->sales, 2),
                ]),
            'bookings' => [
                'total' => $bookings()->count(),
                'completed_value' => round((float) $bookings()->where('bookings.status', 'completed')->sum('bookings.total_amount'), 2),
                'by_status' => $bookings()->selectRaw('bookings.status, COUNT(*) as total')->groupBy('bookings.status')->get(),
            ],
            'businesses' => [
                'total' => $this->scope->businesses($id)->count(),
                'registered_in_range' => $this->scope->businesses($id)->whereBetween('created_at', [$start, $end])->count(),
                'by_status' => $this->scope->businesses($id)->toBase()->selectRaw('status, COUNT(*) as total')->groupBy('status')->get(),
                'by_category' => $this->scope->businesses($id)->toBase()
                    ->leftJoin('business_categories', 'business_categories.id', '=', 'businesses.business_category_id')
                    ->selectRaw("COALESCE(business_categories.name, 'Uncategorized') as category, COUNT(*) as total")
                    ->groupBy('business_categories.name')
                    ->orderByDesc('total')
                    ->get(),
            ],
            'riders' => [
                'total' => $this->scope->riders($id)->count(),
                'registered_in_range' => $this->scope->riders($id)->whereBetween('users.created_at', [$start, $end])->count(),
                'by_status' => $this->scope->riders($id)->toBase()->selectRaw('account_status as status, COUNT(*) as total')->groupBy('account_status')->get(),
                'completed_deliveries' => DB::table('deliveries')
                    ->join('users', 'users.id', '=', 'deliveries.rider_id')
                    ->where('users.role', User::ROLE_RIDER)
                    ->where('users.municipality_id', $id)
                    ->whereIn('deliveries.status', self::COMPLETED_ORDER_STATUSES)
                    ->whereBetween('deliveries.delivered_at', [$start, $end])
                    ->count(),
            ],
            'tourists' => [
                'active_in_range' => User::query()->whereIn('id', $touristIds)->where('role', User::ROLE_TOURIST)->count(),
            ],
        ]);
    }
}
