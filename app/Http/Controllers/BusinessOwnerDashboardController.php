<?php

namespace App\Http\Controllers;

use App\Models\Booking;
use App\Models\Business;
use App\Models\BusinessEngagementEvent;
use App\Models\Favorite;
use App\Models\Review;
use App\Models\Offering;
use App\Models\Order;
use App\Models\Promotion;
use App\Models\BusinessPost;
use App\Models\ResortBlockedDate;
use App\Models\ResortOffering;
use App\Services\ResortAvailabilityService;
use App\Services\ResortClassificationService;
use Carbon\CarbonImmutable;
use App\Services\BusinessService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BusinessOwnerDashboardController extends Controller
{
    public function __construct(
        private BusinessService $businessService
    ) {}

    /**
     * GET /business-owner/dashboard/attraction/{business} (2026-11-24): the
     * tourist attraction owner's dashboard. Attractions take no orders and
     * sell nothing in the app, so this is about being found and visited:
     * profile views, saves, reviews, the gallery and how complete the
     * visitor information is.
     */
    public function attraction(Request $request, Business $business): JsonResponse
    {
        if ((int) $business->owner_id !== (int) $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }
        $business->loadMissing('category', 'details', 'municipality', 'barangay');
        $details = $business->details->mapWithKeys(fn ($d) => [$d->field_name => $d->field_value]);

        $views = $this->pageViews($business);

        $since = now()->subDays(30);
        $favorites = Favorite::where('favoritable_type', Business::class)->where('favoritable_id', $business->id);
        // Attractions use gallery media only (no logo or cover photo).
        $media = $business->media()->where('type', '!=', 'Logo')->where('status', 'published')->get(['file_path', 'featured', 'sort_order']);
        $isVideo = fn ($m) => (bool) preg_match('/\.(mp4|mov|webm)$/i', (string) $m->file_path);
        $photos = $media->reject($isVideo)->count();
        $hero = $media->reject($isVideo)->sortBy([['featured', 'desc'], ['sort_order', 'asc']])->first()?->file_path;

        $filled = fn ($v) => trim((string) $v) !== '';
        $checklist = [
            ['key' => 'photos', 'label' => 'At least 5 gallery photos', 'done' => $photos >= 5, 'hint' => min($photos, 5).' of 5'],
            ['key' => 'description', 'label' => 'About & history', 'done' => mb_strlen(trim((string) $business->business_description)) >= 60, 'hint' => 'A few sentences visitors read first'],
            ['key' => 'attraction_type', 'label' => 'Attraction type', 'done' => $filled($details['attraction_type'] ?? null), 'hint' => 'Beach, waterfall, viewpoint…'],
            ['key' => 'entrance_fee', 'label' => 'Entrance fee', 'done' => $filled($details['entrance_fee'] ?? null), 'hint' => '0 if it is free'],
            ['key' => 'activities', 'label' => 'Activities & highlights', 'done' => $filled($details['activities'] ?? null), 'hint' => 'Swimming, hiking, picnics…'],
            ['key' => 'best_time_to_visit', 'label' => 'Best time to visit', 'done' => $filled($details['best_time_to_visit'] ?? null), 'hint' => 'Season or time of day'],
            ['key' => 'location', 'label' => 'Map pin', 'done' => $business->latitude !== null && $business->longitude !== null, 'hint' => 'Needed for TrackTour directions'],
            ['key' => 'contact', 'label' => 'Contact number', 'done' => $filled($business->contact_number), 'hint' => 'For visitor questions'],
        ];

        return $this->successResponse([
            'business' => [
                'id' => $business->id,
                'name' => $business->business_name,
                'category' => $business->category?->name,
                'address' => $business->address ?: collect([$business->barangay?->name, $business->municipality?->name])->filter()->implode(', '),
                'photo' => $hero,
                'open_status' => $business->openStatusLabel(),
                'attraction_type' => $details['attraction_type'] ?? null,
                'entrance_fee' => $details['entrance_fee'] ?? null,
            ],
            'views' => $views,
            'saves' => ['total' => (clone $favorites)->count(), 'last_30_days' => (clone $favorites)->where('created_at', '>=', $since)->count()],
            'reviews' => $this->reviewsBlock($business, $since, 4),
            'gallery' => ['photos' => $photos, 'videos' => $media->filter($isVideo)->count()],
            'checklist' => $checklist,
        ]);
    }

    /**
     * GET /business-owner/dashboard/resort/{business} (2026-11-24): the resort
     * owner's dashboard — today at the resort (units free per offering, from the
     * Stage 6 availability engine), reservations, offerings, closures, how
     * tourists find and rate the resort, and a setup checklist.
     */
    public function resort(Request $request, Business $business, ResortAvailabilityService $availability): JsonResponse
    {
        if ((int) $business->owner_id !== (int) $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }
        $business->loadMissing('category', 'municipality', 'barangay', 'resortTypes', 'resortFacilities', 'resortCustomFacilities');
        if (! ResortClassificationService::isResort($business)) {
            return $this->errorResponse('This dashboard is for Resort businesses.', 422);
        }

        $today = $availability->today();
        $offerings = $business->resortOfferings()->with('images')->get();
        $published = $offerings->where('is_published', true)->values();
        $calendar = $availability->calendar($business, $published, $today, $today);
        $todayRows = collect($calendar['offerings'])->map(fn (array $o) => [
            'id' => $o['id'],
            'name' => $o['name'],
            'booking_mode' => $o['booking_mode'],
            'capacity' => $o['capacity'],
            'available' => $o['dates'][0]['available'],
            'blocked' => $o['dates'][0]['blocked'],
            'closed' => $o['dates'][0]['closed'],
        ])->values();

        // Stage 8: unpaid GCash holds are not reservations for the owner yet.
        $bookings = Booking::where('business_id', $business->id)->where('payment_status', '!=', 'awaiting_payment');
        $monthStart = now('Asia/Manila')->startOfMonth()->toDateString();
        $next = (clone $bookings)->whereIn('status', ['pending', 'confirmed'])->whereDate('check_in_date', '>=', $today)
            ->orderBy('check_in_date')->limit(5)
            ->get(['id', 'booking_number', 'customer_name', 'status', 'check_in_date', 'check_out_date', 'guests', 'total_amount']);

        $closures = ResortBlockedDate::where('business_id', $business->id)
            ->where('end_date', '>=', $today)
            ->where('start_date', '<=', CarbonImmutable::parse($today)->addDays(30)->toDateString())
            ->with('offering:id,name')->orderBy('start_date')->limit(5)->get()
            ->map(fn (ResortBlockedDate $b) => [
                'id' => $b->id,
                'start_date' => $b->start_date->toDateString(),
                'end_date' => $b->end_date->toDateString(),
                'offering' => $b->offering?->name,
                'reason' => $b->reason,
            ])->values();

        $media = $business->media()->where('type', '!=', 'Logo')->where('status', 'published')->get(['file_path', 'featured', 'sort_order']);
        $isVideo = fn ($m) => (bool) preg_match('/\.(mp4|mov|webm)$/i', (string) $m->file_path);
        $photos = $media->reject($isVideo)->count();
        $hero = $business->cover_photo ?: $media->reject($isVideo)->sortBy([['featured', 'desc'], ['sort_order', 'asc']])->first()?->file_path;
        $since = now()->subDays(30);
        $favorites = Favorite::where('favoritable_type', Business::class)->where('favoritable_id', $business->id);
        $prices = $published->pluck('price')->map(fn ($p) => (float) $p)->filter(fn ($p) => $p > 0);
        $filled = fn ($v) => trim((string) $v) !== '';

        $checklist = [
            ['key' => 'cover', 'label' => 'Cover photo', 'done' => $filled($business->cover_photo), 'hint' => 'The first thing tourists see'],
            ['key' => 'types', 'label' => 'Resort type & facilities', 'done' => $business->resortTypes->isNotEmpty() && ($business->resortFacilities->isNotEmpty() || $business->resortCustomFacilities->isNotEmpty()), 'hint' => 'Beach, pool, cottages, parking…'],
            ['key' => 'offerings', 'label' => 'At least 3 offerings published', 'done' => $published->count() >= 3, 'hint' => min($published->count(), 3).' of 3'],
            ['key' => 'offering_photos', 'label' => 'Photos on every published offering', 'done' => $published->isNotEmpty() && $published->every(fn ($o) => $o->images->isNotEmpty()), 'hint' => 'Cottages and rooms with photos get chosen more'],
            ['key' => 'photos', 'label' => 'At least 5 gallery photos', 'done' => $photos >= 5, 'hint' => min($photos, 5).' of 5'],
            ['key' => 'description', 'label' => 'About the resort', 'done' => mb_strlen(trim((string) $business->business_description)) >= 60, 'hint' => 'A few sentences guests read first'],
            ['key' => 'location', 'label' => 'Map pin', 'done' => $business->latitude !== null && $business->longitude !== null, 'hint' => 'Needed for TrackTour directions'],
            ['key' => 'contact', 'label' => 'Contact number', 'done' => $filled($business->contact_number), 'hint' => 'For guest questions'],
        ];

        return $this->successResponse([
            'business' => [
                'id' => $business->id,
                'name' => $business->business_name,
                'address' => $business->address ?: collect([$business->barangay?->name, $business->municipality?->name])->filter()->implode(', '),
                'photo' => $hero,
                'open_status' => $business->openStatusLabel(),
                'types' => $business->resortTypes->pluck('name')->values(),
                'facilities' => $business->resortFacilities->pluck('name')->merge($business->resortCustomFacilities->pluck('name'))->values(),
            ],
            'today' => ['date' => $today, 'closed' => in_array($today, $calendar['closed_dates'], true), 'offerings' => $todayRows],
            'reservations' => [
                'pending' => (clone $bookings)->where('status', 'pending')->count(),
                'upcoming' => (clone $bookings)->whereIn('status', ['pending', 'confirmed'])->whereDate('check_in_date', '>=', $today)->count(),
                'this_month' => (clone $bookings)->whereNotIn('status', ['cancelled', 'rejected'])->whereDate('created_at', '>=', $monthStart)->count(),
                'next' => $next,
            ],
            'offerings' => [
                'total' => $offerings->count(),
                'published' => $published->count(),
                'from_price' => $prices->isEmpty() ? null : $prices->min(),
                'by_category' => $published->groupBy('category')
                    ->map(fn ($group, $category) => ['category' => $category, 'label' => ResortOffering::CATEGORIES[$category] ?? $category, 'count' => $group->count()])
                    ->values(),
            ],
            'closures' => $closures,
            'deals' => [
                'active' => Promotion::where('business_id', $business->id)->active()->count(),
                'posts' => BusinessPost::where('business_id', $business->id)->where('status', 'published')->count(),
            ],
            'views' => $this->pageViews($business),
            'saves' => ['total' => (clone $favorites)->count(), 'last_30_days' => (clone $favorites)->where('created_at', '>=', $since)->count()],
            'reviews' => $this->reviewsBlock($business, $since, 3),
            'checklist' => $checklist,
        ]);
    }

    /**
     * Unique daily viewers of the public page (BusinessEngagementRecorder), Manila days:
     * the last 30 days per day, and the 30 days before in total.
     *
     * @return array{last_30_days: int, previous_30_days: int, daily: list<array{date: string, views: int}>}
     */
    private function pageViews(Business $business): array
    {
        $today = now('Asia/Manila')->startOfDay();
        $perDay = BusinessEngagementEvent::where('business_id', $business->id)
            ->where('type', BusinessEngagementEvent::TYPE_PROFILE_VIEW)
            ->where('viewed_on', '>=', $today->copy()->subDays(59)->toDateString())
            ->selectRaw('viewed_on, COUNT(*) as n')
            ->groupBy('viewed_on')
            ->pluck('n', 'viewed_on')
            ->mapWithKeys(fn ($n, $day) => [substr((string) $day, 0, 10) => (int) $n]);
        $daily = [];
        for ($i = 29; $i >= 0; $i--) {
            $day = $today->copy()->subDays($i)->toDateString();
            $daily[] = ['date' => $day, 'views' => (int) ($perDay[$day] ?? 0)];
        }
        $previous30 = 0;
        for ($i = 59; $i >= 30; $i--) {
            $previous30 += (int) ($perDay[$today->copy()->subDays($i)->toDateString()] ?? 0);
        }

        return ['last_30_days' => array_sum(array_column($daily, 'views')), 'previous_30_days' => $previous30, 'daily' => $daily];
    }

    private function reviewsBlock(Business $business, \DateTimeInterface $since, int $latest): array
    {
        $summary = Review::approvedSummaryFor($business->id);

        return [
            'average' => $summary['average'],
            'count' => $summary['count'],
            'breakdown' => $summary['breakdown'],
            'last_30_days' => Review::where('business_id', $business->id)->whereIn('status', Review::PUBLIC_STATUSES)->where('created_at', '>=', $since)->count(),
            'latest' => Review::publicFor($business->id, $latest)->map->publicCard()->values(),
        ];
    }

    public function index(Request $request)
    {
        $userId = $request->user()->id;
        $businesses = $this->businessService->getByOwner($userId);

        $selectedBusinessId = $request->input('business_id');
        if ($selectedBusinessId) {
            $filteredBusiness = $businesses->firstWhere('id', $selectedBusinessId);
            if ($filteredBusiness) {
                $businessIds = collect([$filteredBusiness->id]);
                $activeBusiness = $filteredBusiness;
            } else {
                $businessIds = $businesses->pluck('id');
                $activeBusiness = $businesses->first();
            }
        } else {
            $businessIds = $businesses->pluck('id');
            $activeBusiness = $businesses->first();
        }

        $totalOrders = 0;
        $totalRevenue = 0;
        $activeBookings = 0;
        $pendingOrders = 0;
        $totalMenuItems = 0;
        $activePromotions = 0;

        if ($businessIds->isNotEmpty()) {
            $orderStats = Order::whereIn('business_id', $businessIds)
                ->selectRaw('COUNT(*) as total_orders, COALESCE(SUM(CASE WHEN status = ? THEN total ELSE 0 END), 0) as total_revenue, COALESCE(SUM(CASE WHEN status IN (?, ?) THEN 1 ELSE 0 END), 0) as pending_orders', ['completed', 'pending_payment', 'waiting_restaurant'])
                ->first();
            $totalOrders = $orderStats->total_orders;
            $totalRevenue = $orderStats->total_revenue;
            $pendingOrders = $orderStats->pending_orders;

            $activeBookings = Booking::whereIn('business_id', $businessIds)
                ->whereIn('status', ['pending', 'confirmed', 'in_progress'])->count();
            $totalMenuItems = Offering::whereIn('business_id', $businessIds)->count();
            $activePromotions = Promotion::whereIn('business_id', $businessIds)
                ->where('is_active', true)->count();
        }

        $recentOrders = Order::whereIn('business_id', $businessIds)
            ->latest()->take(5)
            ->get(['id', 'order_number', 'customer_name', 'status', 'total', 'created_at']);

        $recentBookings = Booking::whereIn('business_id', $businessIds)
            ->latest()->take(5)
            ->get(['id', 'booking_number', 'customer_name', 'status', 'check_in_date', 'check_out_date', 'total_amount', 'created_at']);

        $allBusinesses = $businesses->map(fn ($b) => [
            'id' => $b->id,
            'name' => $b->business_name,
            'category' => $b->category?->name ?? 'Business',
            'status' => $b->status,
            'logo' => $b->logo,
            'module_codes' => $b->module_codes,
        ]);

        $data = [
            'businesses' => $allBusinesses,
            'selected_business_id' => $selectedBusinessId ? (int) $selectedBusinessId : null,
            'business' => $activeBusiness ? [
                'name' => $activeBusiness->business_name,
                'category' => $activeBusiness->category?->name ?? 'Business',
            ] : null,
            'stats' => [
                'total_orders' => $totalOrders,
                'total_revenue' => (float) $totalRevenue,
                'active_bookings' => $activeBookings,
                'pending_orders' => $pendingOrders,
                'total_menu_items' => $totalMenuItems,
                'active_promotions' => $activePromotions,
            ],
            'recent_orders' => $recentOrders,
            'recent_bookings' => $recentBookings,
        ];

        return $this->successResponse($data);
    }
}
