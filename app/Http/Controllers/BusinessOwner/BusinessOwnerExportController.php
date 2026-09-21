<?php

namespace App\Http\Controllers\BusinessOwner;

use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Models\Order;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

class BusinessOwnerExportController extends Controller
{
    private function resolveBusinessIds(Request $request): array
    {
        $query = $request->user()->businesses();

        if ($businessId = $request->get('business_id')) {
            $query->where('id', $businessId);
        }
        if ($businessType = $request->get('business_type')) {
            $query->whereHas('category', fn($q) => $q->where('name', $businessType));
        }

        return $query->pluck('id')->toArray();
    }

    public function pdf(Request $request): Response
    {
        $businessIds = $this->resolveBusinessIds($request);
        $type = $request->get('type', 'sales');
        $period = $request->get('period', 'monthly');
        $dates = $this->getDateRange($period);

        $user = $request->user();

        if ($type === 'sales') {
            $data = Order::whereIn('business_id', $businessIds)
                ->where('status', 'completed')
                ->whereBetween('completed_at', [$dates['start'], $dates['end']])
                ->select(DB::raw('DATE(completed_at) as date'), DB::raw('COUNT(*) as total_orders'), DB::raw('SUM(total) as total_revenue'))
                ->groupBy('date')->orderBy('date')->get();

            $summary = [
                'revenue' => $data->sum('total_revenue'),
                'orders' => $data->sum('total_orders'),
            ];

            $html = view('exports.sales', compact('data', 'summary', 'period', 'user'))->render();
        } elseif ($type === 'orders') {
            $data = Order::whereIn('business_id', $businessIds)
                ->select('status', DB::raw('COUNT(*) as count'), DB::raw('SUM(total) as revenue'))
                ->groupBy('status')->get();

            $html = view('exports.orders', compact('data', 'user'))->render();
        } elseif ($type === 'bookings') {
            $data = Booking::whereIn('business_id', $businessIds)
                ->select('status', DB::raw('COUNT(*) as count'), DB::raw('SUM(total_amount) as revenue'))
                ->groupBy('status')->get();

            $html = view('exports.bookings', compact('data', 'user'))->render();
        } else {
            abort(404);
        }

        $pdf = Pdf::loadHTML($html);
        return $pdf->download("report-{$type}-{$period}.pdf");
    }

    public function csv(Request $request): Response
    {
        $businessIds = $this->resolveBusinessIds($request);
        $type = $request->get('type', 'sales');
        $period = $request->get('period', 'monthly');
        $dates = $this->getDateRange($period);

        $filename = "report-{$type}-{$period}.csv";
        $handle = fopen('php://temp', 'r+');

        if ($type === 'sales') {
            fputcsv($handle, ['Date', 'Total Orders', 'Total Revenue']);
            $rows = Order::whereIn('business_id', $businessIds)
                ->where('status', 'completed')
                ->whereBetween('completed_at', [$dates['start'], $dates['end']])
                ->select(DB::raw('DATE(completed_at) as date'), DB::raw('COUNT(*) as total_orders'), DB::raw('SUM(total) as total_revenue'))
                ->groupBy('date')->orderBy('date')->get();
            foreach ($rows as $row) {
                fputcsv($handle, [$row->date, $row->total_orders, $row->total_revenue]);
            }
        } elseif ($type === 'orders') {
            fputcsv($handle, ['Status', 'Count', 'Revenue']);
            $rows = Order::whereIn('business_id', $businessIds)
                ->select('status', DB::raw('COUNT(*) as count'), DB::raw('SUM(total) as revenue'))
                ->groupBy('status')->get();
            foreach ($rows as $row) {
                fputcsv($handle, [$row->status, $row->count, $row->revenue]);
            }
        } elseif ($type === 'bookings') {
            fputcsv($handle, ['Status', 'Count', 'Revenue']);
            $rows = Booking::whereIn('business_id', $businessIds)
                ->select('status', DB::raw('COUNT(*) as count'), DB::raw('SUM(total_amount) as revenue'))
                ->groupBy('status')->get();
            foreach ($rows as $row) {
                fputcsv($handle, [$row->status, $row->count, $row->revenue]);
            }
        } else {
            abort(404);
        }

        rewind($handle);
        $content = stream_get_contents($handle);
        fclose($handle);

        return response($content, 200, [
            'Content-Type' => 'text/csv',
            'Content-Disposition' => "attachment; filename={$filename}",
        ]);
    }

    public function excel(Request $request): Response
    {
        $businessIds = $this->resolveBusinessIds($request);
        $type = $request->get('type', 'sales');
        $period = $request->get('period', 'monthly');
        $dates = $this->getDateRange($period);

        $user = $request->user();

        if ($type === 'sales') {
            $data = Order::whereIn('business_id', $businessIds)
                ->where('status', 'completed')
                ->whereBetween('completed_at', [$dates['start'], $dates['end']])
                ->select(DB::raw('DATE(completed_at) as date'), DB::raw('COUNT(*) as total_orders'), DB::raw('SUM(total) as total_revenue'))
                ->groupBy('date')->orderBy('date')->get();
        } elseif ($type === 'orders') {
            $data = Order::whereIn('business_id', $businessIds)
                ->select('status', DB::raw('COUNT(*) as count'), DB::raw('SUM(total) as revenue'))
                ->groupBy('status')->get();
        } elseif ($type === 'bookings') {
            $data = Booking::whereIn('business_id', $businessIds)
                ->select('status', DB::raw('COUNT(*) as count'), DB::raw('SUM(total_amount) as revenue'))
                ->groupBy('status')->get();
        } else {
            abort(404);
        }

        $html = view('exports.excel', compact('data', 'type', 'user'))->render();

        return response($html, 200, [
            'Content-Type' => 'application/vnd.ms-excel',
            'Content-Disposition' => "attachment; filename=report-{$type}-{$period}.xls",
        ]);
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
