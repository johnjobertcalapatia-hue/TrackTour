<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\CodSettlement;
use App\Models\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Admin POS & SALES module — read-only Tourism Office monitoring surface.
 *
 * The canonical pipeline this module reports on is:
 *
 *   ORDER → Payment method (COD | GCash) → Payment = Paid → Order status → POS & SALES
 *
 * "Payment = Paid" is produced by the two authoritative paid sinks, never by
 * this controller:
 *
 *   - GCash:  PaymentController::markPayablePaid() (PayMongo webhook verdict)
 *   - COD:    NearestRiderService::settleCodDelivery() (cash collected at drop-off)
 *
 * A Sale is therefore an Order whose payment_status is 'paid' and that has not
 * been cancelled/refunded. This controller aggregates such paid orders plus the
 * COD settlement ledger (CodSettlementService) for the Tourism Office's 20%
 * platform revenue. It performs NO mutation of money state.
 */
class AdminPosSalesController extends Controller
{
    /**
     * Order statuses that no longer represent a sale (money returned/cancelled).
     */
    private const NON_SALE_STATUSES = ['cancelled', 'cancelled_by_tourist', 'rejected', 'refunded'];

    /**
     * GET /admin/pos/sales
     *
     * Period-scoped sales dashboard: gross revenue, transaction count, payment
     * method split, order-status funnel, system fees and the settled COD ledger.
     */
    public function sales(Request $request): JsonResponse
    {
        [$start, $end] = $this->resolvePeriod($request);
        $method = $request->get('payment_method');
        $query = $this->paidOrders($start, $end, $method);

        $grossSales = (float) (clone $query)->sum('total');
        $transactions = (clone $query)->count();
        $systemFees = (float) (clone $query)->sum('system_fee');

        $byMethod = collect((clone $query)
            ->select(DB::raw($this->methodExpr().' as payment_method'),
                DB::raw('count(*) as transactions'),
                DB::raw('COALESCE(SUM(total), 0) as revenue'))
            ->groupBy('payment_method')
            ->get())
            ->map(fn ($row) => [
                'payment_method' => (string) $row->payment_method,
                'transactions' => (int) $row->transactions,
                'revenue' => round((float) $row->revenue, 2),
            ])
            ->values()
            ->all();

        $byOrderStatus = collect((clone $query)
            ->select('status', DB::raw('count(*) as total'))
            ->groupBy('status')
            ->pluck('total', 'status'))
            ->toArray();

        $settlement = CodSettlement::query();
        if ($start) {
            $settlement->where('settled_at', '>=', $start);
        }
        if ($end) {
            $settlement->where('settled_at', '<=', $end);
        }

        return $this->successResponse([
            'period' => [
                'label' => $request->get('period', 'today'),
                'start' => $start?->toIso8601String(),
                'end' => $end?->toIso8601String(),
            ],
            'summary' => [
                'gross_sales' => round($grossSales, 2),
                'transactions' => $transactions,
                'average_order_value' => $transactions > 0 ? round($grossSales / $transactions, 2) : 0,
                'pending_amount' => round($this->pendingAmount(), 2),
                'system_fees' => round($systemFees, 2),
                'cod_settlements' => [
                    'transactions' => (clone $settlement)->count(),
                    'settlement_base' => round((float) (clone $settlement)->sum('settlement_base'), 2),
                    'platform_revenue' => round((float) (clone $settlement)->sum('platform_fee'), 2),
                ],
            ],
            'by_payment_method' => $byMethod,
            'by_order_status' => $this->orderStatusFunnel($byOrderStatus),
        ], 'POS & SALES dashboard retrieved.');
    }

    /**
     * GET /admin/pos/sales/summary
     *
     * Quick header KPIs across today / this week / this month with the
     * all-time gross and the pending (awaiting-payment) snapshot.
     */
    public function summary(): JsonResponse
    {
        $todayStart = now()->startOfDay();
        $weekStart = now()->startOfWeek();
        $monthStart = now()->startOfMonth();

        return $this->successResponse([
            'today' => $this->windowMetrics($todayStart, now()->endOfDay()),
            'this_week' => $this->windowMetrics($weekStart, now()->endOfDay()),
            'this_month' => $this->windowMetrics($monthStart, now()->endOfDay()),
            'all_time' => $this->windowMetrics(null, null),
            'pending_amount' => round($this->pendingAmount(), 2),
        ], 'POS & SALES summary retrieved.');
    }

    /**
     * GET /admin/pos/sales/transactions
     *
     * Paginated paid-order ledger with search and payment/status/date filters.
     */
    public function transactions(Request $request): JsonResponse
    {
        [$start, $end] = $this->resolvePeriod($request);
        $query = $this->paidOrders($start, $end, $request->get('payment_method'));

        if ($request->filled('status')) {
            $query->where('orders.status', $request->get('status'));
        }

        $search = $request->get('search');
        if ($search) {
            $query->where(function ($q) use ($search) {
                $q->where('orders.order_number', 'like', "%{$search}%")
                    ->orWhere('orders.customer_name', 'like', "%{$search}%");
            });
        }

        $rows = $query
            ->leftJoin('businesses', 'businesses.id', '=', 'orders.business_id')
            ->select([
                'orders.*',
                'businesses.business_name',
                DB::raw($this->paidAtExpr().' as paid_at'),
            ])
            ->orderBy('paid_at', 'desc')
            ->paginate(min(100, max(1, (int) $request->get('perPage', 20))));

        $formatted = $rows->getCollection()->map(fn ($order) => [
            'id' => $order->id,
            'order_number' => $order->order_number,
            'customer_name' => $order->customer_name,
            'business' => [
                'id' => $order->business_id,
                'business_name' => $order->business_name,
            ],
            'order_type' => $order->order_type,
            'payment_method' => $this->classifyMethod($order->payment_method),
            'subtotal' => (float) $order->subtotal,
            'delivery_fee' => (float) $order->delivery_fee,
            'rider_tip' => (float) $order->rider_tip,
            'system_fee' => (float) $order->system_fee,
            'total' => (float) $order->total,
            'paid_amount' => (float) ($order->paid_amount ?? $order->total),
            'status' => $order->status,
            'paid_at' => $order->paid_at ? Carbon::parse($order->paid_at)->toIso8601String() : null,
            'created_at' => $order->created_at?->toIso8601String(),
            'group_order_id' => $order->group_order_id,
            'is_group' => $order->group_order_id !== null,
        ]);

        return $this->paginatedResponse(
            $rows->setCollection($formatted),
            'POS & SALES transactions retrieved.'
        );
    }

    /**
     * GET /admin/pos/sales/by-business
     *
     * Per-business sales totals for the period (read-only top-sellers view).
     */
    public function byBusiness(Request $request): JsonResponse
    {
        [$start, $end] = $this->resolvePeriod($request);
        $query = $this->paidOrders($start, $end, $request->get('payment_method'));

        $methodExpr = $this->methodExpr();
        $rows = $query
            ->leftJoin('businesses', 'businesses.id', '=', 'orders.business_id')
            ->select([
                'orders.business_id',
                'businesses.business_name',
                DB::raw('count(*) as transactions'),
                DB::raw('COALESCE(SUM(orders.total), 0) as revenue'),
                DB::raw("COALESCE(SUM(CASE WHEN {$methodExpr} = 'cod' THEN orders.total ELSE 0 END), 0) as cod_revenue"),
                DB::raw("SUM(CASE WHEN {$methodExpr} = 'cod' THEN 1 ELSE 0 END) as cod_transactions"),
            ])
            ->groupBy('orders.business_id', 'businesses.business_name')
            ->orderByDesc('revenue')
            ->limit(100)
            ->get();

        $businesses = $rows->map(fn ($row) => [
            'business_id' => (int) $row->business_id,
            'business_name' => $row->business_name ?? 'Unknown business',
            'transactions' => (int) $row->transactions,
            'revenue' => round((float) $row->revenue, 2),
            'cod_revenue' => round((float) $row->cod_revenue, 2),
            'cod_transactions' => (int) ($row->cod_transactions ?? 0),
            'online_revenue' => round((float) $row->revenue - (float) $row->cod_revenue, 2),
            'online_transactions' => (int) $row->transactions - (int) ($row->cod_transactions ?? 0),
        ])->values();

        return $this->successResponse([
            'businesses' => $businesses,
            'total_revenue' => round($businesses->sum('revenue'), 2),
            'total_transactions' => $businesses->sum('transactions'),
        ], 'POS & SALES per-business breakdown retrieved.');
    }

    /**
     * GET /admin/pos/sales/trend
     *
     * Daily gross-sales series across the period (last 14 days by default).
     */
    public function trend(Request $request): JsonResponse
    {
        [$start, $end] = $this->resolvePeriod($request);

        if (! $request->filled('from') && ! $request->filled('to') && ! $request->filled('period')) {
            $start = now()->subDays(13)->startOfDay();
        }
        $end = $end ?? now()->endOfDay();

        $rows = $this->paidOrders($start, $end)
            ->select(['orders.id', 'orders.total', DB::raw($this->paidAtExpr().' as paid_at')])
            ->get();

        $dayTotals = [];
        foreach ($rows as $row) {
            if (! $row->paid_at) {
                continue;
            }
            $day = Carbon::parse($row->paid_at)->format('Y-m-d');
            $dayTotals[$day] = [
                'sales' => ($dayTotals[$day]['sales'] ?? 0) + (float) $row->total,
                'transactions' => ($dayTotals[$day]['transactions'] ?? 0) + 1,
            ];
        }

        if (! $start) {
            $start = array_keys($dayTotals) ? Carbon::parse(min(array_keys($dayTotals)))->startOfDay() : Carbon::today();
        }

        $days = [];
        for ($cursor = $start->copy()->startOfDay(); $cursor->lte($end); $cursor->addDay()) {
            $date = $cursor->format('Y-m-d');
            $days[] = [
                'date' => $date,
                'sales' => round($dayTotals[$date]['sales'] ?? 0, 2),
                'transactions' => $dayTotals[$date]['transactions'] ?? 0,
            ];
        }

        return $this->successResponse(['days' => $days], 'POS & SALES trend retrieved.');
    }

    /**
     * Base paid-order query for an optional period, optional payment method.
     */
    private function paidOrders(?Carbon $start, ?Carbon $end, ?string $method = null)
    {
        $query = Order::query()
            ->where('orders.payment_status', 'paid')
            ->whereNotIn('orders.status', self::NON_SALE_STATUSES);

        if ($start) {
            $query->whereRaw("({$this->paidAtExpr()}) >= ?", [$start->toDateTimeString()]);
        }
        if ($end) {
            $query->whereRaw("({$this->paidAtExpr()}) <= ?", [$end->toDateTimeString()]);
        }
        if ($method) {
            $query->whereRaw($this->methodExpr().' = ?', [$method]);
        }

        return $query;
    }

    /**
     * Metrics (revenue / transactions / method split) for a money window.
     */
    private function windowMetrics(?Carbon $start, ?Carbon $end): array
    {
        $query = $this->paidOrders($start, $end);
        $revenue = (float) (clone $query)->sum('total');
        $transactions = (clone $query)->count();

        $byMethod = collect((clone $query)
            ->select(DB::raw($this->methodExpr().' as payment_method'),
                DB::raw('count(*) as transactions'),
                DB::raw('COALESCE(SUM(total), 0) as revenue'))
            ->groupBy('payment_method')
            ->get())
            ->keyBy('payment_method');

        $cod = $byMethod->get('cod');

        return [
            'revenue' => round($revenue, 2),
            'transactions' => $transactions,
            'cod_revenue' => round((float) ($cod->revenue ?? 0), 2),
            'cod_transactions' => (int) ($cod->transactions ?? 0),
            'online_revenue' => round($revenue - (float) ($cod->revenue ?? 0), 2),
            'online_transactions' => $transactions - (int) ($cod->transactions ?? 0),
        ];
    }

    /**
     * Orders still awaiting payment (snapshot — not a money mutation).
     */
    private function pendingAmount(): float
    {
        return (float) Order::query()
            ->where('orders.payment_status', '!=', 'paid')
            ->whereNotIn('orders.status', self::NON_SALE_STATUSES)
            ->sum('total');
    }

    /**
     * Render the paid-order status funnel in canonical pipeline order.
     */
    private function orderStatusFunnel(array $counts): array
    {
        $pipeline = [
            'waiting_restaurant', 'accepted', 'preparing', 'ready',
            'picked_up', 'in_transit', 'arrived_destination', 'delivered', 'completed',
        ];

        $funnel = [];
        foreach ($pipeline as $status) {
            if (! empty($counts[$status])) {
                $funnel[$status] = (int) $counts[$status];
            }
        }
        foreach ($counts as $status => $count) {
            if (! array_key_exists($status, $funnel)) {
                $funnel[$status] = (int) $count;
            }
        }

        return $funnel;
    }

    /**
     * Normalized payment-method bucket: cash/cod → cod, gcash → gcash,
     * empty → unmarked, anything else keeps its lowercase label.
     */
    private function classifyMethod(?string $method): string
    {
        $method = strtolower(trim((string) $method));

        return match ($method) {
            'cash', 'cod' => 'cod',
            '' => 'unmarked',
            default => $method,
        };
    }

    /**
     * SQL expression resolving the moment an order became "paid" for sales
     * dating: the earliest authoritative paid payment (GCash webhook / COD cash
     * row) with the order's own completion/acceptance timestamps as fallbacks.
     */
    private function paidAtExpr(): string
    {
        $orderType = DB::getPdo()->quote(Order::class);

        return "COALESCE(
            (SELECT MAX(p.paid_at) FROM payments p
                WHERE p.payable_type = {$orderType}
                  AND p.payable_id = orders.id
                  AND p.status = 'paid'),
            orders.completed_at, orders.acceptance_started_at, orders.updated_at)";
    }

    /**
     * SQL expression classifying orders.payment_method into the canonical
     * COD / online (GCash et al.) buckets used by the sales groupings.
     */
    private function methodExpr(): string
    {
        return "CASE
            WHEN COALESCE(LOWER(TRIM(orders.payment_method)), '') IN ('cash', 'cod') THEN 'cod'
            WHEN COALESCE(LOWER(TRIM(orders.payment_method)), '') = 'gcash' THEN 'gcash'
            WHEN COALESCE(LOWER(TRIM(orders.payment_method)), '') = '' THEN 'unmarked'
            ELSE LOWER(TRIM(orders.payment_method)) END";
    }

    /**
     * Resolve the report window from period/from/to request inputs.
     *
     * @return array{0: ?Carbon, 1: ?Carbon}
     */
    private function resolvePeriod(Request $request): array
    {
        $start = null;
        $end = null;

        switch ($request->get('period', 'today')) {
            case 'yesterday':
                $start = now()->subDay()->startOfDay();
                $end = now()->subDay()->endOfDay();
                break;
            case 'weekly':
                $start = now()->startOfWeek();
                $end = now()->endOfWeek();
                break;
            case 'monthly':
                $start = now()->startOfMonth();
                $end = now()->endOfMonth();
                break;
            case 'yearly':
                $start = now()->startOfYear();
                $end = now()->endOfYear();
                break;
            case 'all':
                $start = null;
                $end = null;
                break;
            case 'today':
            default:
                $start = now()->startOfDay();
                $end = now()->endOfDay();
        }

        if ($request->filled('from')) {
            $start = Carbon::parse($request->get('from'))->startOfDay();
        }
        if ($request->filled('to')) {
            $end = Carbon::parse($request->get('to'))->endOfDay();
        }

        return [$start, $end];
    }
}