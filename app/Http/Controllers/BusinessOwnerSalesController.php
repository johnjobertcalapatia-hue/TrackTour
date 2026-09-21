<?php

namespace App\Http\Controllers;

use App\Models\Payment;
use App\Services\PaymongoService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BusinessOwnerSalesController extends Controller
{
    public function __construct(
        private PaymongoService $paymongo
    ) {}

    /**
     * GET /business-owner/sales
     *
     * Combined sales data: local payments table + PayMongo API reconciliation.
     */
    public function index(Request $request): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');
        $period = $request->get('period', 'today');
        $dates = $this->getDateRange($period);

        // Local data from payments table
        $localPayments = Payment::whereHas('payable', function ($q) use ($businessIds) {
            $q->whereIn('business_id', $businessIds);
        })
            ->where('status', 'paid')
            ->whereBetween('paid_at', [$dates['start'], $dates['end']])
            ->orderBy('paid_at', 'desc')
            ->get();

        $localSummary = [
            'total_revenue' => (float) $localPayments->sum('amount'),
            'total_transactions' => $localPayments->count(),
            'average_order_value' => $localPayments->isNotEmpty()
                ? round($localPayments->avg('amount'), 2)
                : 0,
        ];

        // PayMongo API data (reconciliation)
        $paymongoData = $this->fetchPaymongoPayments($dates);

        // Processing fees breakdown
        $feeBreakdown = $this->calculateFees($localPayments);

        // Payment method breakdown
        $methodBreakdown = $localPayments->groupBy('method')->map(fn ($payments) => [
            'count' => $payments->count(),
            'revenue' => round($payments->sum('amount'), 2),
        ])->toArray();

        return $this->successResponse([
            'summary' => $localSummary,
            'paymongo_reconciliation' => $paymongoData,
            'fee_breakdown' => $feeBreakdown,
            'payment_methods' => $methodBreakdown,
            'period' => $period,
        ]);
    }

    /**
     * GET /business-owner/sales/payments
     *
     * Individual payment records with pagination.
     */
    public function payments(Request $request): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');
        $page = $request->get('page', 1);
        $perPage = $request->get('perPage', 20);
        $status = $request->get('status');
        $dateFrom = $request->get('date_from');
        $dateTo = $request->get('date_to');

        $query = Payment::whereHas('payable', function ($q) use ($businessIds) {
            $q->whereIn('business_id', $businessIds);
        })
            ->with('payable:id,order_number,business_id')
            ->orderBy('created_at', 'desc');

        if ($status) {
            $query->where('status', $status);
        }
        if ($dateFrom) {
            $query->where('created_at', '>=', $dateFrom);
        }
        if ($dateTo) {
            $query->where('created_at', '<=', $dateTo.' 23:59:59');
        }

        $payments = $query->paginate($perPage);

        $formatted = $payments->getCollection()->map(fn ($payment) => [
            'id' => $payment->id,
            'payment_number' => $payment->payment_number,
            'amount' => $payment->amount,
            'method' => $payment->method,
            'status' => $payment->status,
            'paid_at' => $payment->paid_at,
            'created_at' => $payment->created_at,
            'order_number' => $payment->payable?->order_number,
            'provider_payment_id' => $payment->provider_payment_id,
        ]);

        return $this->paginatedResponse(
            $payments->setCollection($formatted)
        );
    }

    /**
     * GET /business-owner/sales/summary
     *
     * Quick summary metrics for the dashboard header cards.
     */
    public function summary(Request $request): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');

        $todayStart = now()->startOfDay();
        $weekStart = now()->startOfWeek();
        $monthStart = now()->startOfMonth();

        $baseQuery = Payment::whereHas('payable', function ($q) use ($businessIds) {
            $q->whereIn('business_id', $businessIds);
        })->where('status', 'paid');

        $todayRevenue = (clone $baseQuery)
            ->where('paid_at', '>=', $todayStart)
            ->sum('amount');

        $todayTransactions = (clone $baseQuery)
            ->where('paid_at', '>=', $todayStart)
            ->count();

        $weekRevenue = (clone $baseQuery)
            ->where('paid_at', '>=', $weekStart)
            ->sum('amount');

        $monthRevenue = (clone $baseQuery)
            ->where('paid_at', '>=', $monthStart)
            ->sum('amount');

        $monthTransactions = (clone $baseQuery)
            ->where('paid_at', '>=', $monthStart)
            ->count();

        // Pending payments (orders waiting for payment)
        $pendingAmount = \App\Models\Order::whereIn('business_id', $businessIds)
            ->whereIn('status', ['pending_payment', 'waiting_restaurant'])
            ->sum('total');

        return $this->successResponse([
            'today' => [
                'revenue' => round($todayRevenue, 2),
                'transactions' => $todayTransactions,
            ],
            'this_week' => [
                'revenue' => round($weekRevenue, 2),
            ],
            'this_month' => [
                'revenue' => round($monthRevenue, 2),
                'transactions' => $monthTransactions,
            ],
            'pending_amount' => round($pendingAmount, 2),
        ]);
    }

    /**
     * Fetch and summarize PayMongo API payments for reconciliation.
     */
    private function fetchPaymongoPayments(array $dates): array
    {
        if (! $this->paymongo->isConfigured()) {
            return [
                'available' => false,
                'message' => 'PayMongo API not configured.',
            ];
        }

        $paymongoPayments = $this->paymongo->fetchPayments(100);

        if (! $paymongoPayments) {
            return [
                'available' => false,
                'message' => 'Failed to fetch PayMongo data.',
            ];
        }

        $paidPayments = collect($paymongoPayments)->filter(
            fn ($p) => ($p['attributes']['status'] ?? '') === 'paid'
        );

        $totalFromApi = $paidPayments->sum(fn ($p) => ($p['attributes']['amount'] ?? 0) / 100);
        $countFromApi = $paidPayments->count();

        return [
            'available' => true,
            'total_from_api' => round($totalFromApi, 2),
            'transactions_from_api' => $countFromApi,
            'fetched_at' => now()->toIso8601String(),
        ];
    }

    /**
     * Calculate processing fees based on PayMongo fee schedule.
     */
    private function calculateFees($payments): array
    {
        $fees = [
            'gcash' => ['rate' => 0.025, 'fixed' => 0],
            'maya' => ['rate' => 0.025, 'fixed' => 0],
            'grab_pay' => ['rate' => 0.025, 'fixed' => 0],
            'qr_ph' => ['rate' => 0.015, 'fixed' => 0],
            'card' => ['rate' => 0.035, 'fixed' => 15],
        ];

        $totalFees = 0;
        $feeByMethod = [];

        foreach ($payments as $payment) {
            $method = strtolower($payment->method);
            $feeConfig = $fees[$method] ?? ['rate' => 0.025, 'fixed' => 0];

            $fee = ($payment->amount * $feeConfig['rate']) + $feeConfig['fixed'];
            $totalFees += $fee;

            if (! isset($feeByMethod[$method])) {
                $feeByMethod[$method] = ['total_fee' => 0, 'count' => 0, 'revenue' => 0];
            }
            $feeByMethod[$method]['total_fee'] += $fee;
            $feeByMethod[$method]['count']++;
            $feeByMethod[$method]['revenue'] += $payment->amount;
        }

        return [
            'total_estimated_fees' => round($totalFees, 2),
            'by_method' => collect($feeByMethod)->map(fn ($data) => [
                'total_fee' => round($data['total_fee'], 2),
                'count' => $data['count'],
                'revenue' => round($data['revenue'], 2),
            ])->toArray(),
        ];
    }

    private function getDateRange(string $period): array
    {
        return match ($period) {
            'today' => ['start' => now()->startOfDay(), 'end' => now()->endOfDay()],
            'yesterday' => ['start' => now()->subDay()->startOfDay(), 'end' => now()->subDay()->endOfDay()],
            'weekly' => ['start' => now()->startOfWeek(), 'end' => now()->endOfWeek()],
            'monthly' => ['start' => now()->startOfMonth(), 'end' => now()->endOfMonth()],
            'yearly' => ['start' => now()->startOfYear(), 'end' => now()->endOfYear()],
            default => ['start' => now()->startOfDay(), 'end' => now()->endOfDay()],
        };
    }
}
