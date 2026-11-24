<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\Expense;
use App\Models\Offering;
use App\Models\Order;
use App\Models\OrderItem;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Reports & Analytics overview for a business owner (or finance staff): one
 * date range (Manila calendar days) compared with the period of the same
 * length just before it.
 *
 * Money is counted per restaurant from its own order items, so in a group
 * checkout each restaurant sees only its own dishes (delivery fees belong to
 * the rider and are not sales). Earnings = sales − expenses recorded for the
 * same days; there is no per-restaurant fee to subtract yet.
 */
class OwnerReportOverview
{
    private const TZ = 'Asia/Manila';

    /** Donut groups (Orders by status). */
    public const STATUS_GROUPS = [
        'completed' => ['completed', 'delivered'],
        'in_progress' => ['accepted', 'preparing', 'ready', 'picked_up', 'in_transit', 'out_for_delivery', 'en_route_destination', 'arrived_destination'],
        'pending' => ['pending_payment', 'pending', 'waiting_restaurant'],
        'cancelled' => ['cancelled', 'cancelled_by_tourist', 'rejected', 'refunded'],
    ];

    private const CANCELLED_ITEMS = ['cancelled', 'rejected', 'refunded'];

    /**
     * @param  list<int>  $businessIds
     */
    public function build(array $businessIds, string $from, string $to): array
    {
        $start = Carbon::createFromFormat('Y-m-d', $from, self::TZ)->startOfDay();
        $end = Carbon::createFromFormat('Y-m-d', $to, self::TZ)->startOfDay();
        $days = (int) $start->diffInDays($end) + 1;
        $prevEnd = $start->copy()->subDay();
        $prevStart = $prevEnd->copy()->subDays($days - 1);

        $currentDays = $this->dayList($start, $days);
        $previousDays = $this->dayList($prevStart, $days);

        $sales = $this->dailySales($businessIds, $prevStart, $end);
        $expenses = $this->dailyExpenses($businessIds, $prevStart, $end);

        $daily = fn (array $dayList) => collect($dayList)->map(function (string $day) use ($sales, $expenses) {
            $revenue = round((float) ($sales[$day]['revenue'] ?? 0), 2);
            $orders = count($sales[$day]['orders'] ?? []);

            return ['date' => $day, 'orders' => $orders, 'revenue' => $revenue, 'earnings' => round($revenue - (float) ($expenses[$day] ?? 0), 2)];
        })->all();

        $current = $daily($currentDays);
        $previous = $daily($previousDays);
        $totals = fn (array $rows) => [
            'orders' => array_sum(array_column($rows, 'orders')),
            'revenue' => round(array_sum(array_column($rows, 'revenue')), 2),
            'earnings' => round(array_sum(array_column($rows, 'earnings')), 2),
        ];
        $now = $totals($current);
        $before = $totals($previous);

        return [
            'range' => ['from' => $from, 'to' => $to, 'days' => $days, 'previous_from' => $prevStart->toDateString(), 'previous_to' => $prevEnd->toDateString()],
            'kpis' => [
                'orders' => ['value' => $now['orders'], 'previous' => $before['orders'], 'change' => $this->change($now['orders'], $before['orders'])],
                'revenue' => ['value' => $now['revenue'], 'previous' => $before['revenue'], 'change' => $this->change($now['revenue'], $before['revenue'])],
                'earnings' => [
                    'value' => $now['earnings'], 'previous' => $before['earnings'], 'change' => $this->change($now['earnings'], $before['earnings']),
                    'expenses' => round($now['revenue'] - $now['earnings'], 2),
                ],
                'rating' => $this->rating($businessIds, $start, $end),
            ],
            'series' => $this->series($current, $previous),
            'breakdown' => $this->buckets($current, $previous),
            'top_items' => $this->topItems($businessIds, $start, $end),
            'orders_by_status' => $this->ordersByStatus($businessIds, $start, $end),
            'bookings' => $this->bookings($businessIds, $start, $end),
        ];
    }

    private function dayList(Carbon $start, int $days): array
    {
        return collect(range(0, $days - 1))->map(fn ($i) => $start->copy()->addDays($i)->toDateString())->all();
    }

    private function utc(Carbon $manilaDay, bool $endOfDay = false): Carbon
    {
        return ($endOfDay ? $manilaDay->copy()->endOfDay() : $manilaDay->copy()->startOfDay())->utc();
    }

    /** This owner's items in orders completed on each Manila day: revenue and distinct orders. */
    private function dailySales(array $businessIds, Carbon $from, Carbon $to): array
    {
        $rows = OrderItem::query()
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->where('orders.status', 'completed')
            ->whereBetween('orders.completed_at', [$this->utc($from), $this->utc($to, true)])
            ->whereNotIn(DB::raw("COALESCE(order_items.status, '')"), self::CANCELLED_ITEMS)
            ->whereIn(DB::raw('COALESCE(order_items.business_id, orders.business_id)'), $businessIds)
            ->get(['order_items.order_id', 'order_items.subtotal', 'orders.completed_at']);

        $byDay = [];
        foreach ($rows as $row) {
            $day = Carbon::parse($row->completed_at, 'UTC')->timezone(self::TZ)->toDateString();
            $byDay[$day]['revenue'] = ($byDay[$day]['revenue'] ?? 0) + (float) $row->subtotal;
            $byDay[$day]['orders'][$row->order_id] = true;
        }

        return $byDay;
    }

    private function dailyExpenses(array $businessIds, Carbon $from, Carbon $to): array
    {
        return Expense::whereIn('business_id', $businessIds)
            ->whereDate('expense_date', '>=', $from->toDateString())
            ->whereDate('expense_date', '<=', $to->toDateString())
            ->get(['expense_date', 'amount'])
            ->groupBy(fn ($e) => Carbon::parse($e->expense_date)->toDateString())
            ->map(fn (Collection $rows) => (float) $rows->sum('amount'))
            ->all();
    }

    private function change(float $now, float $before): ?float
    {
        if ($before == 0.0) {
            return null;
        }

        return round((($now - $before) / abs($before)) * 100, 1);
    }

    /** Daily points (up to 92 days), otherwise weekly totals, for the line chart. */
    private function series(array $current, array $previous): array
    {
        $size = count($current) > 92 ? 7 : 1;
        $points = [];
        foreach (array_chunk($current, $size) as $i => $chunk) {
            $prev = array_slice($previous, $i * $size, $size);
            $points[] = [
                'date' => $chunk[0]['date'],
                'label_to' => $size > 1 ? end($chunk)['date'] : null,
                'orders' => array_sum(array_column($chunk, 'orders')),
                'revenue' => round(array_sum(array_column($chunk, 'revenue')), 2),
                'earnings' => round(array_sum(array_column($chunk, 'earnings')), 2),
                'previous_orders' => array_sum(array_column($prev, 'orders')),
                'previous_revenue' => round(array_sum(array_column($prev, 'revenue')), 2),
                'previous_earnings' => round(array_sum(array_column($prev, 'earnings')), 2),
            ];
        }

        return $points;
    }

    /** Revenue per week (Week 1, 2, …), or per 30 days for long ranges, this period vs the previous. */
    private function buckets(array $current, array $previous): array
    {
        $long = count($current) > 70;
        $size = $long ? 30 : 7;
        $out = [];
        foreach (array_chunk($current, $size) as $i => $chunk) {
            $prev = array_slice($previous, $i * $size, $size);
            $out[] = [
                'label' => $long ? Carbon::parse($chunk[0]['date'])->format('M j') : 'Week '.($i + 1),
                'from' => $chunk[0]['date'],
                'to' => end($chunk)['date'],
                'revenue' => round(array_sum(array_column($chunk, 'revenue')), 2),
                'previous_revenue' => round(array_sum(array_column($prev, 'revenue')), 2),
            ];
        }

        return $out;
    }

    private function topItems(array $businessIds, Carbon $from, Carbon $to): array
    {
        $rows = OrderItem::query()
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->where('orders.status', 'completed')
            ->whereBetween('orders.completed_at', [$this->utc($from), $this->utc($to, true)])
            ->whereNotIn(DB::raw("COALESCE(order_items.status, '')"), self::CANCELLED_ITEMS)
            ->whereIn(DB::raw('COALESCE(order_items.business_id, orders.business_id)'), $businessIds)
            ->selectRaw('order_items.offering_id, MAX(order_items.product_name) as name, SUM(order_items.quantity) as quantity, COUNT(DISTINCT order_items.order_id) as orders, SUM(order_items.subtotal) as revenue')
            ->groupBy('order_items.offering_id')
            ->orderByDesc('quantity')
            ->orderByDesc('revenue')
            ->limit(5)
            ->get();

        $images = Offering::whereIn('id', $rows->pluck('offering_id')->filter())->get(['id', 'image', 'images'])->keyBy('id');

        return $rows->map(function ($row) use ($images) {
            $offering = $row->offering_id ? $images->get($row->offering_id) : null;
            $path = $offering?->image ?: (is_array($offering?->images) ? ($offering->images[0] ?? null) : null);

            return [
                'offering_id' => $row->offering_id ? (int) $row->offering_id : null,
                'name' => $row->name,
                'quantity' => (int) $row->quantity,
                'orders' => (int) $row->orders,
                'revenue' => round((float) $row->revenue, 2),
                // Storage path; the frontend resolves it (toAssetUrl) like other menu photos.
                'image' => $path ?: null,
            ];
        })->values()->all();
    }

    /** Orders placed in the range that include this owner's items, by status group. */
    private function ordersByStatus(array $businessIds, Carbon $from, Carbon $to): array
    {
        $counts = Order::query()
            ->whereBetween('created_at', [$this->utc($from), $this->utc($to, true)])
            ->where('order_type', '!=', 'transport')
            ->where(fn ($q) => $q->whereIn('business_id', $businessIds)
                ->orWhereHas('items', fn ($i) => $i->whereIn('business_id', $businessIds)))
            ->selectRaw('status, COUNT(*) as aggregate')
            ->groupBy('status')
            ->pluck('aggregate', 'status');

        $groups = [];
        foreach (self::STATUS_GROUPS as $key => $statuses) {
            $groups[] = ['key' => $key, 'count' => (int) $counts->only($statuses)->sum()];
        }

        return ['total' => (int) $counts->sum(), 'groups' => $groups];
    }

    private function rating(array $businessIds, Carbon $from, Carbon $to): array
    {
        $restaurant = DB::table('reviews')->whereIn('business_id', $businessIds)->where('status', '!=', 'rejected');
        $dishes = DB::table('order_item_reviews')->whereIn('business_id', $businessIds);

        $count = (clone $restaurant)->count() + (clone $dishes)->count();
        $sum = (float) (clone $restaurant)->sum('rating') + (float) (clone $dishes)->sum('rating');
        $window = [$this->utc($from), $this->utc($to, true)];
        $new = (clone $restaurant)->whereBetween('created_at', $window)->count() + (clone $dishes)->whereBetween('created_at', $window)->count();

        return ['value' => $count ? round($sum / $count, 1) : null, 'count' => $count, 'new_in_range' => $new];
    }

    private function bookings(array $businessIds, Carbon $from, Carbon $to): array
    {
        $rows = Booking::whereIn('business_id', $businessIds)
            ->whereBetween('created_at', [$this->utc($from), $this->utc($to, true)])
            ->selectRaw('status, COUNT(*) as count, SUM(total_amount) as revenue')
            ->groupBy('status')
            ->get();

        return [
            'total' => (int) $rows->sum('count'),
            'revenue' => round((float) $rows->sum('revenue'), 2),
            'by_status' => $rows->map(fn ($r) => ['status' => $r->status, 'count' => (int) $r->count, 'revenue' => round((float) $r->revenue, 2)])->values()->all(),
        ];
    }
}
