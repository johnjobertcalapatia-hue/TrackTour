<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\Booking;
use App\Models\Business;
use App\Models\BusinessEngagementEvent;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\PlatformExpense;
use App\Models\RiderCashFundTransaction;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Bansud Tourism Office business-intelligence figures.
 *
 * Every number comes from database records (no samples). Money is kept in
 * separate, non-overlapping buckets so order totals are never reported as
 * TrackTour income:
 *
 *   gross transaction value  completed orders + completed bookings (customer money)
 *   platform revenue         order_settlements.platform_amount (the canonical ledger)
 *   business-owner earnings  order_settlements.restaurant_amount
 *   rider earnings           rider_earnings.total_earning
 *   refunds                  refunds that the provider confirmed (succeeded)
 *   operating expenses       platform_expenses recorded by the Tourism Office
 *   net income               platform revenue − operating expenses
 *
 * Periods are Philippine (Asia/Manila) calendar periods; every period is
 * compared with the previous equivalent period. Grouping by local day is done
 * in PHP so results are identical on MySQL and SQLite. Read-only.
 */
class AdminAnalyticsService
{
    public const TZ = 'Asia/Manila';

    public const PERIODS = ['today', 'yesterday', 'this_week', 'this_month', 'this_year', 'custom'];

    private const DONE_ORDER = ['delivered', 'completed'];

    private const TERMINAL_ORDER = ['delivered', 'completed', 'cancelled', 'cancelled_by_tourist', 'rejected', 'refunded'];

    private const OPEN_PAYOUT = ['pending', 'under_review', 'approved'];

    /** Popularity weights: real engagement signals, not bookings alone. */
    private const WEIGHTS = ['views' => 1.0, 'offering_views' => 0.5, 'favorites' => 3.0, 'inquiries' => 4.0, 'bookings' => 5.0, 'transactions' => 5.0, 'reviews' => 3.0];

    private ?int $municipalityId = null;

    /**
     * @return array{key:string,label:string,from:CarbonImmutable,to:CarbonImmutable,prev_from:CarbonImmutable,prev_to:CarbonImmutable}
     */
    public function period(string $key, ?string $from = null, ?string $to = null): array
    {
        $now = CarbonImmutable::now(self::TZ);
        $today = $now->startOfDay();

        [$start, $end, $prevStart, $prevEnd, $label] = match ($key) {
            'today' => [$today, $now, $today->subDay(), $now->subDay(), 'Today'],
            'yesterday' => [$today->subDay(), $today->subSecond(), $today->subDays(2), $today->subDay()->subSecond(), 'Yesterday'],
            'this_week' => [$now->startOfWeek(), $now, $now->startOfWeek()->subWeek(), $now->subWeek(), 'This week'],
            'this_year' => [$now->startOfYear(), $now, $now->startOfYear()->subYear(), $now->subYear(), 'This year'],
            'custom' => $this->custom($from, $to),
            default => [$now->startOfMonth(), $now, $now->startOfMonth()->subMonthNoOverflow(), $now->subMonthNoOverflow(), 'This month'],
        };

        return ['key' => in_array($key, self::PERIODS, true) ? $key : 'this_month', 'label' => $label, 'from' => $start, 'to' => $end, 'prev_from' => $prevStart, 'prev_to' => $prevEnd];
    }

    private function custom(?string $from, ?string $to): array
    {
        $start = CarbonImmutable::parse($from ?: 'today', self::TZ)->startOfDay();
        $end = CarbonImmutable::parse($to ?: $start->toDateString(), self::TZ)->endOfDay();
        if ($end->lt($start)) {
            [$start, $end] = [$end->startOfDay(), $start->endOfDay()];
        }
        $days = (int) $start->diffInDays($end) + 1;
        $label = $start->format('M j').' – '.$end->format('M j, Y');

        return [$start, $end, $start->subDays($days), $start->subSecond(), $label];
    }

    public function build(string $periodKey, ?string $from, ?string $to, ?int $municipalityId): array
    {
        $this->municipalityId = $municipalityId;
        $p = $this->period($periodKey, $from, $to);

        return [
            'period' => $this->periodPayload($p),
            'municipality' => $municipalityId ? Municipality::find($municipalityId, ['id', 'name']) : null,
            'overview' => $this->overview($p),
            'live' => $this->live(),
            'operations' => $this->operations($p),
            'financial' => $this->financial($p),
            'trend' => $this->trend($p),
            'popularity' => $popularity = $this->popularity($p),
            'opportunities' => $this->opportunities($popularity['businesses']),
            'municipalities' => $this->municipalities($p),
            'alerts' => $this->alerts(),
            'system' => $this->system(),
            'activity' => $this->activity(),
        ];
    }

    /**
     * The same business-intelligence figures for ONE municipality's Tourism
     * Office. Always scoped to that municipality, and limited to what belongs
     * to it: platform-only figures (TrackTour revenue, Bansud operating
     * expenses and net income, rider cashouts and cash advances, the
     * all-municipality comparison, system health, Bansud alerts and the
     * platform-wide activity feed) are left out.
     */
    public function buildForMunicipalOffice(string $periodKey, ?string $from, ?string $to, int $municipalityId): array
    {
        $this->municipalityId = $municipalityId;
        $p = $this->period($periodKey, $from, $to);
        $financial = $this->financial($p);
        $popularity = $this->popularity($p);
        $overview = $this->overview($p);
        unset($overview['cashouts']);
        $trend = $this->trend($p);

        return [
            'period' => $this->periodPayload($p),
            'municipality' => Municipality::find($municipalityId, ['id', 'name']),
            'overview' => $overview,
            'live' => $this->live(),
            'operations' => $this->operations($p),
            // Local tourism economy: customer money and what local businesses
            // and riders earned — never TrackTour's own revenue.
            'economy' => array_intersect_key($financial, array_flip([
                'gross_transaction_value', 'business_owner_earnings', 'rider_earnings', 'refunds', 'cod_collections', 'gateway', 'pending_settlements',
            ])),
            'trend' => [
                'granularity' => $trend['granularity'],
                'points' => array_map(fn (array $pt) => ['date' => $pt['date'], 'gross_value' => $pt['gross_value'], 'transactions' => $pt['transactions']], $trend['points']),
            ],
            'popularity' => ['summary' => $popularity['summary'], 'top' => $popularity['top'], 'needs_help' => $popularity['needs_help']],
            'opportunities' => array_map(
                fn (array $o) => array_merge($o, ['link' => $o['link'] ? str_replace('/admin/businesses/', '/municipal/businesses/', $o['link']) : null]),
                $this->opportunities($popularity['businesses'])
            ),
        ];
    }

    private function periodPayload(array $p): array
    {
        return [
            'key' => $p['key'], 'label' => $p['label'],
            'from' => $p['from']->toDateString(), 'to' => $p['to']->toDateString(),
            'previous_from' => $p['prev_from']->toDateString(), 'previous_to' => $p['prev_to']->toDateString(),
            'generated_at' => now()->toIso8601String(),
        ];
    }

    // ------------------------------------------------------------------
    // Sections
    // ------------------------------------------------------------------

    private function overview(array $p): array
    {
        $biz = fn () => $this->scopeBusinesses(Business::query());
        $users = fn () => $this->scopeUsers(User::query());
        $todayStart = CarbonImmutable::now(self::TZ)->startOfDay();

        return [
            'businesses' => [
                'total' => $biz()->count(),
                'active' => $biz()->where('status', 'approved')->count(),
                'pending' => $biz()->where('status', 'pending')->count(),
                'suspended' => $biz()->whereIn('status', ['suspended', 'inactive', 'rejected'])->count(),
                'new' => $this->compare($biz(), 'created_at', $p),
            ],
            'users' => [
                'total' => $users()->count(),
                'online_now' => $this->onlineUsers(),
                'new' => $this->compare($users(), 'created_at', $p),
                'new_today' => $users()->where('created_at', '>=', $todayStart->utc())->count(),
            ],
            'deliveries' => $this->compare($this->scopeDeliveries(Delivery::query()), 'delivered_at', $p),
            'ride_hailing' => $this->compare($this->scopeOrders(Order::query())->where('order_type', 'transport'), 'created_at', $p),
            'bookings' => $this->compare($this->scopeBookings(Booking::query()), 'created_at', $p),
            'cashouts' => [
                'requested' => $this->compareSum($this->scopeRiders(DB::table('rider_payouts'), 'rider_payouts.rider_id'), 'requested_at', 'amount', $p),
                'open_count' => $this->scopeRiders(DB::table('rider_payouts'), 'rider_payouts.rider_id')->whereIn('status', self::OPEN_PAYOUT)->count(),
            ],
            'riders' => [
                'active' => $this->scopeUsers(User::query())->where('role', User::ROLE_RIDER)->where('account_status', User::ACCOUNT_STATUS_APPROVED)->count(),
                'online_now' => $this->scopeRiders(DB::table('rider_details'), 'rider_details.user_id')
                    ->whereIn('rider_status', [User::RIDER_STATUS_ONLINE, User::RIDER_STATUS_AVAILABLE, User::RIDER_STATUS_BUSY])->count(),
            ],
            'business_owners' => [
                'active' => $users()->where('role', User::ROLE_BUSINESS_OWNER)->where('account_status', User::ACCOUNT_STATUS_APPROVED)->count(),
            ],
            'pending_approvals' => [
                'businesses' => $biz()->where('status', 'pending')->count(),
                'business_owners' => $users()->where('role', User::ROLE_BUSINESS_OWNER)->where('account_status', User::ACCOUNT_STATUS_PENDING)->count(),
                'riders' => $users()->where('role', User::ROLE_RIDER)->where('account_status', User::ACCOUNT_STATUS_PENDING)->count(),
            ],
        ];
    }

    /** Real-time snapshot (independent of the selected period). */
    private function live(): array
    {
        $orders = fn () => $this->scopeOrders(Order::query());
        $activeOrder = fn (Builder $q) => $q->whereNotIn('status', [...self::TERMINAL_ORDER, 'pending_payment']);
        $todayStart = CarbonImmutable::now(self::TZ)->startOfDay()->utc();

        return [
            'users_online' => $this->onlineUsers(),
            'tourists_online' => $this->onlineUsers(User::ROLE_TOURIST),
            'riders_available' => $this->scopeRiders(DB::table('rider_details'), 'rider_details.user_id')
                ->whereIn('rider_status', [User::RIDER_STATUS_ONLINE, User::RIDER_STATUS_AVAILABLE])->count(),
            'riders_on_delivery' => $activeOrder($orders()->where('order_type', 'delivery'))->whereHas('delivery', fn ($d) => $d->whereNotNull('rider_id'))->count(),
            'drivers_on_rides' => $activeOrder($orders()->where('order_type', 'transport'))->whereHas('delivery', fn ($d) => $d->whereNotNull('rider_id'))->count(),
            'active_food_orders' => $activeOrder($orders()->where('order_type', 'delivery'))->count(),
            'ongoing_rides' => $activeOrder($orders()->where('order_type', 'transport'))->count(),
            'pending_deliveries' => $this->scopeDeliveries(Delivery::query())->whereNull('rider_id')->whereNotIn('status', ['delivered', 'completed', 'cancelled'])->count(),
            'cancelled_today' => $orders()->where('cancelled_at', '>=', $todayStart)->count(),
        ];
    }

    private function operations(array $p): array
    {
        [$from, $to] = [$p['from']->utc(), $p['to']->utc()];
        $orders = fn () => $this->scopeOrders(Order::query());

        return [
            'food_orders' => $this->compare($orders()->where('order_type', 'delivery'), 'created_at', $p),
            'deliveries' => $this->compare($this->scopeDeliveries(Delivery::query()), 'delivered_at', $p),
            'ride_hailing' => $this->compare($orders()->where('order_type', 'transport'), 'created_at', $p),
            'accommodation' => $this->compare($this->scopeBookings(Booking::query()), 'created_at', $p),
            'cancelled' => $orders()->whereBetween('cancelled_at', [$from, $to])->count()
                + $this->scopeBookings(Booking::query())->whereBetween('cancelled_at', [$from, $to])->count(),
        ];
    }

    private function financial(array $p): array
    {
        $now = CarbonImmutable::now(self::TZ);
        $month = ['from' => $now->startOfMonth(), 'to' => $now];
        $today = ['from' => $now->startOfDay(), 'to' => $now];
        $settlements = fn () => $this->scopeBusinessRows(DB::table('order_settlements'), 'order_settlements.business_id')->where('order_settlements.status', 'settled');
        $payouts = fn () => $this->scopeRiders(DB::table('rider_payouts'), 'rider_payouts.rider_id');

        $platform = $this->compareSum($settlements(), 'settled_at', 'platform_amount', $p);
        $expenses = $this->expenses($p);

        $pendingSettlement = $this->scopeOrders(Order::query())
            ->whereIn('status', self::DONE_ORDER)
            ->whereNotNull('business_id')
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))->from('order_settlements')->whereColumn('order_settlements.order_id', 'orders.id'));

        return [
            'gross_transaction_value' => $this->gtv($p),
            'platform_revenue' => $platform,
            'business_owner_earnings' => $this->compareSum($settlements(), 'settled_at', 'restaurant_amount', $p),
            'rider_earnings' => $this->compareSum($this->scopeRiders(DB::table('rider_earnings'), 'rider_earnings.rider_id')->where('status', '!=', 'reversed'), 'earned_at', 'total_earning', $p),
            'refunds' => $this->compareSum($this->scopeRefunds(DB::table('refunds'))->where('refunds.status', 'succeeded'), 'refunded_at', 'amount', $p),
            'operating_expenses' => $expenses,
            'net_income' => [
                'value' => round($platform['value'] - $expenses['value'], 2),
                'previous' => round($platform['previous'] - $expenses['previous'], 2),
            ],
            'earnings_today' => $this->sumBetween($settlements(), 'settled_at', 'platform_amount', $today['from'], $today['to']),
            'earnings_this_month' => $this->sumBetween($settlements(), 'settled_at', 'platform_amount', $month['from'], $month['to']),
            'cashouts' => [
                'requested' => $this->compareSum($payouts(), 'requested_at', 'amount', $p),
                'approved' => $this->compareSum($payouts(), 'approved_at', 'amount', $p),
                'completed' => $this->compareSum($payouts()->where('status', 'paid'), 'paid_at', 'paid_amount', $p),
                'liability' => round((float) $payouts()->whereIn('status', self::OPEN_PAYOUT)->sum('amount'), 2),
            ],
            'pending_settlements' => ['count' => (clone $pendingSettlement)->count(), 'amount' => round((float) (clone $pendingSettlement)->sum('total'), 2)],
            'cod_collections' => $this->compareSum($this->scopeBusinessRows(DB::table('cod_settlements'), 'cod_settlements.business_id'), 'settled_at', 'settlement_base', $p),
            'cod_remitted' => $this->compareSum($this->scopeMunicipalityColumn(DB::table('rider_daily_reconciliations')->whereNotNull('verified_at'), 'rider_daily_reconciliations.municipality_id'), 'verified_at', 'verified_cod_received', $p),
            'rider_cash_advances' => $this->compareSum(
                $this->scopeRiders(DB::table('rider_cash_fund_transactions')
                    ->join('rider_cash_funds', 'rider_cash_funds.id', '=', 'rider_cash_fund_transactions.rider_cash_fund_id')
                    ->whereIn('rider_cash_fund_transactions.type', [RiderCashFundTransaction::TYPE_CASH_ISSUED, RiderCashFundTransaction::TYPE_ADDITIONAL_CASH_ISSUED]), 'rider_cash_funds.rider_id'),
                'rider_cash_fund_transactions.occurred_at', 'rider_cash_fund_transactions.amount', $p
            ),
            'gateway' => $this->compareSum($this->scopePayments(DB::table('payments'))->where('payments.status', 'paid')->where('payments.provider', 'paymongo'), 'paid_at', 'amount', $p, true),
        ];
    }

    /** Daily (or monthly for long ranges) platform revenue, expenses, GTV and transactions. */
    private function trend(array $p): array
    {
        $from = $p['from']->startOfDay();
        $to = $p['to'];
        $monthly = $from->diffInDays($to) > 62;
        $bucket = fn ($at) => $at ? CarbonImmutable::parse($at)->timezone(self::TZ)->format($monthly ? 'Y-m' : 'Y-m-d') : null;
        [$fu, $tu] = [$from->utc(), $to->utc()];

        $revenue = $this->scopeBusinessRows(DB::table('order_settlements'), 'order_settlements.business_id')
            ->where('status', 'settled')->whereBetween('settled_at', [$fu, $tu])->get(['settled_at', 'platform_amount'])
            ->groupBy(fn ($r) => $bucket($r->settled_at))->map(fn ($g) => (float) $g->sum('platform_amount'));
        $expenses = $this->scopeExpenses(PlatformExpense::query())
            ->whereBetween('expense_date', [$from->toDateString(), $to->toDateString()])->get(['expense_date', 'amount'])
            ->groupBy(fn ($e) => $monthly ? $e->expense_date->format('Y-m') : $e->expense_date->toDateString())->map(fn ($g) => (float) $g->sum('amount'));
        $orders = $this->scopeOrders(Order::query())->whereIn('status', self::DONE_ORDER)->whereBetween('completed_at', [$fu, $tu])->get(['completed_at', 'total'])
            ->groupBy(fn ($o) => $bucket($o->completed_at));
        $bookings = $this->scopeBookings(Booking::query())->whereNotNull('completed_at')->whereBetween('completed_at', [$fu, $tu])->get(['completed_at', 'total_amount'])
            ->groupBy(fn ($b) => $bucket($b->completed_at));

        $points = [];
        for ($d = $monthly ? $from->startOfMonth() : $from; $d->lte($to); $d = $monthly ? $d->addMonthNoOverflow() : $d->addDay()) {
            $k = $d->format($monthly ? 'Y-m' : 'Y-m-d');
            $o = $orders->get($k, collect());
            $b = $bookings->get($k, collect());
            $points[] = [
                'date' => $k,
                'platform_revenue' => round((float) ($revenue[$k] ?? 0), 2),
                'expenses' => round((float) ($expenses[$k] ?? 0), 2),
                'gross_value' => round((float) $o->sum('total') + (float) $b->sum('total_amount'), 2),
                'transactions' => $o->count() + $b->count(),
            ];
        }

        return ['granularity' => $monthly ? 'month' : 'day', 'points' => $points];
    }

    /**
     * Per-business engagement for the period and the previous period, a
     * weighted score and a classification. Views come from real
     * business_engagement_events; popularity is never bookings alone.
     */
    private function popularity(array $p): array
    {
        $businesses = $this->scopeBusinesses(Business::query())->where('status', 'approved')
            ->with('municipality:id,name', 'category:id,name')
            ->get(['id', 'business_name', 'municipality_id', 'business_category_id', 'logo', 'updated_at']);
        if ($businesses->isEmpty()) {
            return ['summary' => array_fill_keys(['high', 'growing', 'average', 'low', 'declining'], 0), 'top' => [], 'needs_help' => [], 'businesses' => collect()];
        }
        $ids = $businesses->pluck('id')->all();

        $current = $this->engagement($ids, $p['from'], $p['to']);
        $previous = $this->engagement($ids, $p['prev_from'], $p['prev_to']);
        $ratings = DB::table('reviews')->whereIn('business_id', $ids)->groupBy('business_id')
            ->selectRaw('business_id, AVG(rating) as avg_rating, COUNT(*) as total')->get()->keyBy('business_id');

        $score = fn (array $m) => array_sum(array_map(fn ($k) => ($m[$k] ?? 0) * self::WEIGHTS[$k], array_keys(self::WEIGHTS)));
        $rows = $businesses->map(function (Business $b) use ($current, $previous, $ratings, $score) {
            $cur = $current[$b->id];
            $prev = $previous[$b->id];
            $s = round($score($cur), 1);
            $ps = round($score($prev), 1);

            return [
                'id' => $b->id,
                'name' => $b->business_name,
                'logo' => $b->logo,
                'municipality' => $b->municipality?->name,
                'category' => $b->category?->name,
                'metrics' => $cur,
                'score' => $s,
                'previous_score' => $ps,
                'growth' => $ps > 0 ? round(($s - $ps) / $ps * 100, 1) : ($s > 0 ? 100.0 : 0.0),
                'conversion' => $cur['views'] > 0 ? round(($cur['bookings'] + $cur['transactions']) / $cur['views'] * 100, 1) : null,
                'rating' => isset($ratings[$b->id]) ? round((float) $ratings[$b->id]->avg_rating, 1) : null,
                'review_total' => (int) ($ratings[$b->id]->total ?? 0),
                'updated_at' => $b->updated_at?->toIso8601String(),
            ];
        });

        $positive = $rows->pluck('score')->filter(fn ($s) => $s > 0)->sort()->values();
        $p80 = $this->percentile($positive, 0.8);
        $p25 = $this->percentile($rows->pluck('score')->sort()->values(), 0.25);

        $rows = $rows->map(function (array $r) use ($p80, $p25) {
            $r['class'] = match (true) {
                $r['previous_score'] > 0 && $r['growth'] <= -25 => 'declining',
                $r['score'] > 0 && $r['score'] >= $p80 => 'high',
                $r['score'] > 0 && $r['growth'] >= 25 => 'growing',
                $r['score'] == 0 || $r['score'] <= $p25 || $r['metrics']['views'] === 0 => 'low',
                default => 'average',
            };

            return $r;
        });

        $summary = array_merge(array_fill_keys(['high', 'growing', 'average', 'low', 'declining'], 0), $rows->countBy('class')->all());

        return [
            'summary' => $summary,
            'top' => $rows->sortByDesc('score')->take(8)->values(),
            'needs_help' => $rows->filter(fn ($r) => in_array($r['class'], ['declining', 'low'], true))
                ->sortBy(fn ($r) => [$r['class'] === 'declining' ? 0 : 1, $r['score']])->take(6)->values(),
            'businesses' => $rows->values(),
        ];
    }

    /** @return array<int, array<string, int>> keyed by business id */
    private function engagement(array $ids, CarbonImmutable $from, CarbonImmutable $to): array
    {
        [$fu, $tu] = [$from->utc(), $to->utc()];
        $views = DB::table('business_engagement_events')->whereIn('business_id', $ids)
            ->whereBetween('viewed_on', [$from->toDateString(), $to->toDateString()])
            ->groupBy('business_id', 'type')->selectRaw('business_id, type, COUNT(*) as total')->get();
        $count = fn ($q, string $column = 'business_id') => $q->groupBy($column)->selectRaw("{$column} as business_id, COUNT(*) as total")->pluck('total', 'business_id');

        $favorites = $count(DB::table('favorites')->where('favoritable_type', Business::class)->whereIn('favoritable_id', $ids)->whereNull('deleted_at')->whereBetween('created_at', [$fu, $tu]), 'favoritable_id');
        $inquiries = $count(DB::table('chat_rooms')->whereIn('business_id', $ids)->whereBetween('created_at', [$fu, $tu]));
        $bookings = $count(DB::table('bookings')->whereIn('business_id', $ids)->whereNull('deleted_at')->whereBetween('created_at', [$fu, $tu]));
        $reviews = $count(DB::table('reviews')->whereIn('business_id', $ids)->whereBetween('created_at', [$fu, $tu]));
        // Multi-restaurant orders carry the restaurant on each item.
        $transactions = DB::table('orders')
            ->join('order_items', 'order_items.order_id', '=', 'orders.id')
            ->whereIn('orders.status', self::DONE_ORDER)->whereBetween('orders.completed_at', [$fu, $tu])
            ->whereIn(DB::raw('COALESCE(order_items.business_id, orders.business_id)'), $ids)
            ->groupBy(DB::raw('COALESCE(order_items.business_id, orders.business_id)'))
            ->selectRaw('COALESCE(order_items.business_id, orders.business_id) as business_id, COUNT(DISTINCT orders.id) as total')
            ->pluck('total', 'business_id');

        $out = [];
        foreach ($ids as $id) {
            $out[$id] = [
                'views' => (int) ($views->first(fn ($v) => (int) $v->business_id === $id && $v->type === BusinessEngagementEvent::TYPE_PROFILE_VIEW)?->total ?? 0),
                'offering_views' => (int) ($views->first(fn ($v) => (int) $v->business_id === $id && $v->type === BusinessEngagementEvent::TYPE_OFFERING_VIEW)?->total ?? 0),
                'favorites' => (int) ($favorites[$id] ?? 0),
                'inquiries' => (int) ($inquiries[$id] ?? 0),
                'bookings' => (int) ($bookings[$id] ?? 0),
                'transactions' => (int) ($transactions[$id] ?? 0),
                'reviews' => (int) ($reviews[$id] ?? 0),
            ];
        }

        return $out;
    }

    /** Tourism Growth Opportunities derived from the popularity rows and events. */
    private function opportunities(Collection $rows): array
    {
        $items = [];
        foreach ($rows as $r) {
            $link = "/admin/businesses/{$r['id']}";
            if ($r['class'] === 'declining') {
                $items[] = ['kind' => 'declining', 'priority' => 1, 'business' => $r['name'], 'title' => "{$r['name']}: engagement down ".abs($r['growth']).'%', 'action' => 'Recommend a promotional campaign', 'link' => $link];
            }
            if ($r['metrics']['views'] >= 20 && ($r['conversion'] ?? 0) < 2) {
                $items[] = ['kind' => 'low_conversion', 'priority' => 2, 'business' => $r['name'], 'title' => "{$r['name']}: {$r['metrics']['views']} views but few bookings", 'action' => 'Review pricing and business information', 'link' => $link];
            }
            if ($r['class'] === 'low') {
                $items[] = ['kind' => 'low_views', 'priority' => 3, 'business' => $r['name'], 'title' => "{$r['name']}: low profile views", 'action' => 'Feature the business on the homepage', 'link' => $link];
            }
            if (($r['rating'] ?? 0) >= 4.5 && $r['review_total'] >= 3) {
                $items[] = ['kind' => 'top_rated', 'priority' => 4, 'business' => $r['name'], 'title' => "{$r['name']}: rated {$r['rating']} from {$r['review_total']} reviews", 'action' => 'Feature as a recommended business', 'link' => $link];
            }
            if ($r['updated_at'] && CarbonImmutable::parse($r['updated_at'])->lt(now()->subDays(90))) {
                $items[] = ['kind' => 'stale', 'priority' => 5, 'business' => $r['name'], 'title' => "{$r['name']}: no updates in 90+ days", 'action' => 'Notify the owner to update photos and offerings', 'link' => $link];
            }
        }

        $today = CarbonImmutable::now(self::TZ)->toDateString();
        $events = DB::table('tourism_events')
            ->when($this->municipalityId, fn ($q) => $q->where('municipality_id', $this->municipalityId))
            ->whereBetween('start_date', [$today, CarbonImmutable::now(self::TZ)->addDays(30)->toDateString()])
            ->orderBy('start_date')->limit(3)->get(['id', 'name', 'start_date', 'end_date']);
        foreach ($events as $e) {
            $items[] = ['kind' => 'event', 'priority' => 0, 'business' => null, 'title' => "Upcoming event: {$e->name} (".CarbonImmutable::parse($e->start_date)->format('M j').')', 'action' => 'Promote the event and invite businesses to join', 'link' => null];
        }

        usort($items, fn ($a, $b) => $a['priority'] <=> $b['priority']);

        return array_slice($items, 0, 8);
    }

    private function municipalities(array $p): array
    {
        [$fu, $tu] = [$p['from']->utc(), $p['to']->utc()];
        $rows = DB::table('orders')
            ->join('order_items', 'order_items.order_id', '=', 'orders.id')
            ->join('businesses', 'businesses.id', '=', DB::raw('COALESCE(order_items.business_id, orders.business_id)'))
            ->whereIn('orders.status', self::DONE_ORDER)->whereBetween('orders.completed_at', [$fu, $tu])
            ->groupBy('businesses.municipality_id')
            ->selectRaw('businesses.municipality_id as municipality_id, COUNT(DISTINCT orders.id) as transactions, SUM(order_items.subtotal) as value')
            ->get()->keyBy('municipality_id');
        $totalValue = max(0.0, (float) $rows->sum('value'));

        $list = Municipality::query()
            ->withCount(['businesses as businesses_count' => fn ($q) => $q->where('status', 'approved'), 'riders', 'tourismOfficers as office_accounts_count' => fn ($q) => $q->where('account_status', User::ACCOUNT_STATUS_APPROVED)])
            ->orderBy('name')->get()
            ->map(function (Municipality $m) use ($rows, $totalValue) {
                $r = $rows->get($m->id);
                $value = round((float) ($r->value ?? 0), 2);

                return [
                    'id' => $m->id, 'name' => $m->name, 'logo' => $m->logo, 'is_home' => $m->isHome(),
                    'businesses' => $m->businesses_count, 'riders' => $m->riders_count,
                    'transactions' => (int) ($r->transactions ?? 0), 'value' => $value,
                    'share' => $totalValue > 0 ? round($value / $totalValue * 100, 1) : 0.0,
                    'has_office' => $m->isHome() || $m->office_accounts_count > 0,
                ];
            })
            ->sortByDesc(fn ($m) => [$m['is_home'], $m['value'], $m['businesses']])->values();

        return $list->all();
    }

    private function alerts(): array
    {
        $users = fn () => $this->scopeUsers(User::query());
        $list = [
            ['key' => 'businesses', 'label' => 'Business registrations to review', 'count' => $this->scopeBusinesses(Business::query())->where('status', 'pending')->count(), 'link' => '/admin/businesses?status=pending'],
            ['key' => 'business_owners', 'label' => 'Business owners to verify', 'count' => $users()->where('role', User::ROLE_BUSINESS_OWNER)->where('account_status', User::ACCOUNT_STATUS_PENDING)->count(), 'link' => '/admin/users?role=business_owner'],
            ['key' => 'rider_applicants', 'label' => 'Bansud rider applicants', 'count' => User::where('role', User::ROLE_RIDER)->where('account_status', User::ACCOUNT_STATUS_PENDING)
                ->whereHas('municipality', fn ($m) => $m->whereRaw('LOWER(name) = ?', [strtolower(Municipality::HOME_MUNICIPALITY)]))->count(), 'link' => '/admin/rider-onboarding'],
            ['key' => 'cashouts', 'label' => 'Cashout requests to process', 'count' => $this->scopeRiders(DB::table('rider_payouts'), 'rider_payouts.rider_id')->whereIn('status', ['pending', 'under_review'])->count(), 'link' => '/admin/cashouts'],
            ['key' => 'settlements', 'label' => 'Completed orders awaiting settlement', 'count' => $this->scopeOrders(Order::query())->whereIn('status', self::DONE_ORDER)->whereNotNull('business_id')
                ->whereNotExists(fn ($q) => $q->select(DB::raw(1))->from('order_settlements')->whereColumn('order_settlements.order_id', 'orders.id'))->count(), 'link' => '/admin/reports'],
            ['key' => 'offices', 'label' => 'Municipalities without an office account', 'count' => Municipality::whereRaw('LOWER(name) != ?', [strtolower(Municipality::HOME_MUNICIPALITY)])
                ->whereDoesntHave('tourismOfficers', fn ($q) => $q->where('account_status', User::ACCOUNT_STATUS_APPROVED))->count(), 'link' => '/admin/municipalities/accounts'],
        ];

        return $list;
    }

    /** Health of the services the dashboard depends on, from real signals. */
    private function system(): array
    {
        $start = microtime(true);
        try {
            DB::select('select 1');
            $db = ['status' => 'ok', 'detail' => round((microtime(true) - $start) * 1000).' ms'];
        } catch (\Throwable) {
            $db = ['status' => 'down', 'detail' => 'Not reachable'];
        }

        $lastPaid = DB::table('payments')->where('status', 'paid')->max('paid_at');
        $configured = filled(config('services.paymongo.secret_key'));
        $lastFix = DB::table('rider_locations')->max('recorded_at');
        $fixAge = $lastFix ? (int) CarbonImmutable::parse($lastFix)->diffInMinutes(now()) : null;
        $failed = Schema::hasTable('failed_jobs') ? DB::table('failed_jobs')->where('failed_at', '>=', now()->subDay())->count() : 0;

        return [
            ['key' => 'database', 'label' => 'Database', 'status' => $db['status'], 'detail' => $db['detail']],
            ['key' => 'payments', 'label' => 'Payments', 'status' => $configured ? 'ok' : 'warning',
                'detail' => $configured ? ($lastPaid ? 'Last paid '.CarbonImmutable::parse($lastPaid)->diffForHumans() : 'Configured') : 'PayMongo key missing'],
            ['key' => 'tracking', 'label' => 'Live tracking', 'status' => $fixAge !== null && $fixAge <= 10 ? 'ok' : 'idle',
                'detail' => $fixAge === null ? 'No GPS fixes yet' : ($fixAge <= 10 ? 'Receiving GPS' : 'Last fix '.CarbonImmutable::parse($lastFix)->diffForHumans())],
            ['key' => 'jobs', 'label' => 'Background jobs', 'status' => $failed > 0 ? 'warning' : 'ok', 'detail' => $failed > 0 ? "{$failed} failed in 24 h" : 'No failures in 24 h'],
        ];
    }

    private function activity(): array
    {
        return ActivityLog::with('user:id,name')->latest('id')->take(6)->get()
            ->map(fn (ActivityLog $log) => [
                'id' => $log->id,
                'description' => $log->description ?: str_replace(['.', '_'], ' ', (string) $log->action),
                'by' => $log->user?->name,
                'at' => $log->created_at?->toIso8601String(),
            ])->all();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /** Count in the period vs the previous equivalent period. */
    private function compare($query, string $column, array $p): array
    {
        $current = (clone $query)->whereBetween($column, [$p['from']->utc(), $p['to']->utc()])->count();
        $previous = (clone $query)->whereBetween($column, [$p['prev_from']->utc(), $p['prev_to']->utc()])->count();

        return ['value' => $current, 'previous' => $previous];
    }

    /** Sum in the period vs the previous equivalent period (optionally with counts). */
    private function compareSum($query, string $column, string $sum, array $p, bool $withCount = false): array
    {
        $current = $this->sumBetween(clone $query, $column, $sum, $p['from'], $p['to']);
        $previous = $this->sumBetween(clone $query, $column, $sum, $p['prev_from'], $p['prev_to']);
        $out = ['value' => $current, 'previous' => $previous];
        if ($withCount) {
            $out['count'] = (clone $query)->whereBetween($column, [$p['from']->utc(), $p['to']->utc()])->count();
        }

        return $out;
    }

    private function sumBetween($query, string $column, string $sum, CarbonImmutable $from, CarbonImmutable $to): float
    {
        return round((float) (clone $query)->whereBetween($column, [$from->utc(), $to->utc()])->sum($sum), 2);
    }

    private function gtv(array $p): array
    {
        $calc = function (CarbonImmutable $from, CarbonImmutable $to): float {
            $orders = (float) $this->scopeOrders(Order::query())->whereIn('status', self::DONE_ORDER)->whereBetween('completed_at', [$from->utc(), $to->utc()])->sum('total');
            $bookings = (float) $this->scopeBookings(Booking::query())->whereNotNull('completed_at')->whereBetween('completed_at', [$from->utc(), $to->utc()])->sum('total_amount');

            return round($orders + $bookings, 2);
        };

        return ['value' => $calc($p['from'], $p['to']), 'previous' => $calc($p['prev_from'], $p['prev_to'])];
    }

    private function expenses(array $p): array
    {
        $sum = fn (CarbonImmutable $from, CarbonImmutable $to) => round((float) $this->scopeExpenses(PlatformExpense::query())
            ->whereBetween('expense_date', [$from->toDateString(), $to->toDateString()])->sum('amount'), 2);

        return ['value' => $sum($p['from'], $p['to']), 'previous' => $sum($p['prev_from'], $p['prev_to'])];
    }

    /** Users whose API token was used in the last 5 minutes (a real, recent request). */
    private function onlineUsers(?string $role = null): int
    {
        return DB::table('personal_access_tokens')
            ->join('users', 'users.id', '=', 'personal_access_tokens.tokenable_id')
            ->where('personal_access_tokens.tokenable_type', User::class)
            ->where('personal_access_tokens.last_used_at', '>=', now()->subMinutes(5))
            ->when($role, fn ($q) => $q->where('users.role', $role))
            ->when($this->municipalityId, fn ($q) => $q->where('users.municipality_id', $this->municipalityId))
            ->distinct()->count('personal_access_tokens.tokenable_id');
    }

    private function percentile(Collection $sorted, float $q): float
    {
        if ($sorted->isEmpty()) {
            return 0.0;
        }
        $index = (int) floor(($sorted->count() - 1) * $q);

        return (float) $sorted[$index];
    }

    // Municipality scoping (null = all municipalities, the Bansud default).

    private function scopeBusinesses($q)
    {
        return $q->when($this->municipalityId, fn ($q) => $q->where('municipality_id', $this->municipalityId));
    }

    private function scopeUsers($q)
    {
        return $q->when($this->municipalityId, fn ($q) => $q->where('municipality_id', $this->municipalityId));
    }

    private function scopeOrders($q)
    {
        return $q->when($this->municipalityId, fn ($q) => $q->where(fn ($w) => $w
            ->whereIn('business_id', Business::select('id')->where('municipality_id', $this->municipalityId))
            ->orWhere(fn ($t) => $t->whereNull('business_id')->whereIn('user_id', User::select('id')->where('municipality_id', $this->municipalityId)))));
    }

    private function scopeDeliveries($q)
    {
        return $q->when($this->municipalityId, fn ($q) => $q->whereIn('order_id', $this->scopeOrders(Order::query())->select('id')));
    }

    private function scopeBookings($q)
    {
        return $q->when($this->municipalityId, fn ($q) => $q->whereIn('business_id', Business::select('id')->where('municipality_id', $this->municipalityId)));
    }

    private function scopeExpenses($q)
    {
        return $q->when($this->municipalityId, fn ($q) => $q->where('municipality_id', $this->municipalityId));
    }

    private function scopeRefunds($q)
    {
        return $q->when($this->municipalityId, fn ($q) => $q->whereIn('order_id', $this->scopeOrders(Order::query())->select('id')));
    }

    private function scopePayments($q)
    {
        return $q->when($this->municipalityId, fn ($q) => $q->where('payable_type', Order::class)->whereIn('payable_id', $this->scopeOrders(Order::query())->select('id')));
    }

    private function scopeBusinessRows($q, string $column)
    {
        return $q->when($this->municipalityId, fn ($q) => $q->whereIn($column, Business::select('id')->where('municipality_id', $this->municipalityId)));
    }

    private function scopeRiders($q, string $column)
    {
        return $q->when($this->municipalityId, fn ($q) => $q->whereIn($column, User::select('id')->where('role', User::ROLE_RIDER)->where('municipality_id', $this->municipalityId)));
    }

    private function scopeMunicipalityColumn($q, string $column)
    {
        return $q->when($this->municipalityId, fn ($q) => $q->where($column, $this->municipalityId));
    }
}
