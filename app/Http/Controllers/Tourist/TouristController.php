<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Promotion;
use App\Models\Review;
use App\Models\TourismEvent;
use App\Services\TouristService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;

class TouristController extends Controller
{
    public function __construct(private TouristService $touristService) {}

    public function dashboard(Request $request)
    {
        $user = Auth::user();
        $email = $user->email;

        $touristLat = $request->query('lat') ?: session('tourist_lat');
        $touristLng = $request->query('lng') ?: session('tourist_lng');

        if ($request->query('lat') && $request->query('lng')) {
            session([
                'tourist_lat' => $touristLat,
                'tourist_lng' => $touristLng,
                'tourist_address' => $request->query('address', session('tourist_address', 'Current Location')),
            ]);
        }

        $category = $request->query('category');
        $search = $request->query('search');

        $categoryId = null;
        if ($category && $category !== 'all') {
            $categoryId = is_numeric($category)
                ? (int) $category
                : BusinessCategory::where('name', $category)->value('id');
        }

        $hasFilters = $categoryId || ($search !== null && trim($search) !== '');

        $categories = BusinessCategory::withCount(['businesses' => function ($q) {
            $q->where('status', 'approved');
        }])->get();

        $featured = $hasFilters
            ? $this->filteredBusinesses($categoryId, $search)->whereNotNull('cover_photo')->inRandomOrder()->take(8)->get()
            : Cache::remember('dashboard_featured', 3600, function () {
                return Business::where('status', 'approved')
                    ->whereNotNull('cover_photo')
                    ->inRandomOrder()
                    ->with('category', 'municipality')
                    ->take(8)
                    ->get();
            });

        if ($featured->isEmpty() && ! $hasFilters) {
            $featured = Business::where('status', 'approved')
                ->inRandomOrder()
                ->with('category', 'municipality')
                ->take(8)
                ->get();
        }

        $featured->load('promotions');
        $featured = $this->loadOpenStatus($featured);
        $featured = $this->loadAvgRating($featured);

        $trending = $this->filteredBusinesses($categoryId, $search)
            ->whereHas('reviews', fn ($q) => $q->where('status', 'approved'))
            ->with('category', 'municipality')
            ->withCount(['reviews' => fn ($q) => $q->where('status', 'approved')])
            ->withAvg(['reviews' => fn ($q) => $q->where('status', 'approved')], 'rating')
            ->orderByDesc('reviews_count')
            ->orderByDesc('reviews_avg_rating')
            ->take(10)
            ->get();

        $trending = $this->loadOpenStatus($trending);
        $trending = $this->loadAvgRating($trending);

        $municipalities = Municipality::withCount(['businesses' => function ($q) {
            $q->where('status', 'approved');
        }])->get();

        $upcomingEvents = Cache::remember('dashboard_events', 1800, function () {
            return TourismEvent::where(function ($q) {
                $q->where('start_date', '>=', now())
                    ->orWhere('end_date', '>=', now());
            })
                ->with('municipality')
                ->orderBy('start_date')
                ->take(8)
                ->get();
        });

        $recentlyViewedIds = session('recently_viewed', []);
        $recentlyViewed = Business::whereIn('id', $recentlyViewedIds)
            ->where('status', 'approved')
            ->with('category', 'municipality')
            ->take(6)
            ->get();
        $recentlyViewed = $this->loadOpenStatus($recentlyViewed);

        $savedIds = $user->favorites()
            ->where('favoritable_type', Business::class)
            ->pluck('favoritable_id')
            ->toArray();

        $recommended = collect();
        if (! empty($savedIds)) {
            $savedCategories = Business::whereIn('id', $savedIds)
                ->pluck('business_category_id');
            $recommended = $this->filteredBusinesses($categoryId, $search)
                ->whereIn('business_category_id', $savedCategories)
                ->whereNotIn('id', $savedIds)
                ->with('category', 'municipality')
                ->inRandomOrder()
                ->take(4)
                ->get();
        }
        if ($recommended->isEmpty()) {
            $recommended = $this->filteredBusinesses($categoryId, $search)
                ->with('category', 'municipality')
                ->inRandomOrder()
                ->take(4)
                ->get();
        }
        $recommended = $this->loadOpenStatus($recommended);

        $nearbyBusinesses = collect();
        if ($touristLat && $touristLng) {
            $haversine = '(6371 * acos(cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude))))';
            $nearbyBusinesses = $this->filteredBusinesses($categoryId, $search)
                ->whereNotNull('latitude')
                ->whereNotNull('longitude')
                ->select('businesses.*')
                ->selectRaw("{$haversine} AS distance_km", [$touristLat, $touristLng, $touristLat])
                ->with('category', 'municipality')
                ->orderBy('distance_km')
                ->take(8)
                ->get();
            $nearbyBusinesses = $this->loadOpenStatus($nearbyBusinesses);
        } else {
            $nearbyBusinesses = $this->filteredBusinesses($categoryId, $search)
                ->with('category', 'municipality')
                ->inRandomOrder()
                ->take(8)
                ->get();
            $nearbyBusinesses = $this->loadOpenStatus($nearbyBusinesses);
        }

        $promotions = Promotion::active()
            ->whereHas('business', fn ($q) => $q->where('status', 'approved'))
            ->with('business')
            ->latest()
            ->take(5)
            ->get();

        $foodCategoryIds = BusinessCategory::where(function ($q) {
            $q->where('name', 'like', '%restaurant%')
                ->orWhere('name', 'like', '%food%')
                ->orWhere('name', 'like', '%cafe%')
                ->orWhere('name', 'like', '%food hub%');
        })->pluck('id')->toArray();

        $popularRestaurants = $this->getNearestBusinesses($touristLat, $touristLng, $foodCategoryIds, 8, [], $categoryId, $search);
        $popularResorts = $this->getNearestBusinesses($touristLat, $touristLng, [], 8, $foodCategoryIds, $categoryId, $search);

        $transportCategoryIds = BusinessCategory::where(function ($q) {
            $q->where('name', 'like', '%transport%')
                ->orWhere('name', 'like', '%tricycle%')
                ->orWhere('name', 'like', '%van%')
                ->orWhere('name', 'like', '%bus%');
        })->pluck('id')->toArray();
        $transportServices = $this->getNearestBusinesses($touristLat, $touristLng, $transportCategoryIds, 6, [], $categoryId, $search);

        $topAttractions = $this->filteredBusinesses($categoryId, $search)
            ->whereHas('category', fn ($q) => $q->where('name', 'like', '%attraction%'))
            ->with('category', 'municipality')
            ->inRandomOrder()
            ->take(8)
            ->get();
        $topAttractions = $this->loadOpenStatus($topAttractions);
        $topAttractions = $this->loadAvgRating($topAttractions);

        $travelInspiration = $this->filteredBusinesses($categoryId, $search)
            ->whereNotNull('cover_photo')
            ->with('category', 'municipality')
            ->inRandomOrder()
            ->take(6)
            ->get();
        $travelInspiration = $this->loadOpenStatus($travelInspiration);
        $travelInspiration = $this->loadAvgRating($travelInspiration);

        $municipalityShowcase = Municipality::withCount(['businesses' => function ($q) {
            $q->where('status', 'approved');
        }])->having('businesses_count', '>', 0)
            ->orderByDesc('businesses_count')
            ->take(6)
            ->get();

        $seasonalRecs = $this->getSeasonalRecommendations();

        $weather = '28°C';
        $userMunicipality = $user->municipality?->name ?? $user->profile?->municipality?->name ?? session('municipality', 'Bansud, Oriental Mindoro');

        $data = [
            'categories' => $categories,
            'featured' => $featured,
            'trending' => $trending,
            'municipalities' => $municipalities,
            'upcomingEvents' => $upcomingEvents,
            'recentlyViewed' => $recentlyViewed,
            'savedIds' => $savedIds,
            'recommended' => $recommended,
            'nearbyBusinesses' => $nearbyBusinesses,
            'promotions' => $promotions,
            'popularRestaurants' => $popularRestaurants,
            'popularResorts' => $popularResorts,
            'transportServices' => $transportServices,
            'topAttractions' => $topAttractions,
            'travelInspiration' => $travelInspiration,
            'municipalityShowcase' => $municipalityShowcase,
            'seasonalRecs' => $seasonalRecs,
            'weather' => $weather,
            'userMunicipality' => $userMunicipality,
        ];

        if ($request->expectsJson()) {
            return $this->successResponse($data);
        }

        return response()->json(array_merge($data, compact('user', 'touristLat', 'touristLng')));
    }

    private function filteredBusinesses(?int $categoryId, ?string $search)
    {
        return Business::query()
            ->where('status', 'approved')
            ->with('category', 'municipality')
            ->when($categoryId, fn ($q) => $q->where('business_category_id', $categoryId))
            ->when($search, fn ($q) => $q->where('business_name', 'like', '%'.$search.'%'));
    }

    private function getNearestBusinesses($lat, $lng, array $categoryIds, int $limit, array $excludeIds = [], ?int $categoryId = null, ?string $search = null): mixed
    {
        $query = Business::where('status', 'approved')
            ->with(['category', 'municipality']);

        if (! empty($categoryIds)) {
            $query->whereIn('business_category_id', $categoryIds);
        }

        if (! empty($excludeIds)) {
            $query->whereNotIn('business_category_id', $excludeIds);
        }

        if ($categoryId) {
            $query->where('business_category_id', $categoryId);
        }

        if ($search) {
            $query->where('business_name', 'like', '%'.$search.'%');
        }

        if ($lat && $lng) {
            $haversine = '(6371 * acos(cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude))))';
            $query->whereNotNull('latitude')->whereNotNull('longitude')
                ->selectRaw("*, {$haversine} AS distance_km", [$lat, $lng, $lat])
                ->orderBy('distance_km');
        } else {
            $query->inRandomOrder();
        }

        return $query->take($limit)
            ->get()
            ->map(function ($business) use ($lat, $lng) {
                $business->is_open = $this->isBusinessOpen($business);
                $business->avg_rating = Review::where('business_id', $business->id)
                    ->where('status', 'approved')
                    ->avg('rating') ?? 0;
                if ($lat && $lng && $business->latitude && $business->longitude && ! isset($business->distance_km)) {
                    $business->distance_km = $this->calculateDistance($lat, $lng, (float) $business->latitude, (float) $business->longitude);
                }

                return $business;
            });
    }

    private function calculateDistance(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthRadius = 6371;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) * sin($dLat / 2) +
             cos(deg2rad($lat1)) * cos(deg2rad($lat2)) *
             sin($dLng / 2) * sin($dLng / 2);
        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));

        return $earthRadius * $c;
    }

    private function isBusinessOpen(Business $business): bool
    {
        if ($business->force_closed) {
            return false;
        }

        if (! empty($business->business_hours) || ! empty($business->opening_time)) {
            return $business->isOpenNow();
        }

        return true;
    }

    protected function loadOpenStatus($businesses)
    {
        return $businesses->map(function ($business) {
            $business->is_open = $this->isBusinessOpen($business);

            return $business;
        });
    }

    protected function loadAvgRating($businesses)
    {
        return $businesses->map(function ($business) {
            if (isset($business->reviews_avg_rating)) {
                $business->avg_rating = $business->reviews_avg_rating ?? 0;
            } else {
                $business->avg_rating = Review::where('business_id', $business->id)
                    ->where('status', 'approved')
                    ->avg('rating') ?? 0;
            }
            if (! isset($business->reviews_count)) {
                $business->reviews_count = Review::where('business_id', $business->id)
                    ->where('status', 'approved')
                    ->count();
            }

            return $business;
        });
    }

    private function getSeasonalRecommendations(): array
    {
        $month = now()->month;
        $season = match (true) {
            $month >= 3 && $month <= 5 => 'Summer',
            $month >= 6 && $month <= 11 => 'Rainy Season',
            $month === 12 || $month === 1 => 'Christmas',
            default => 'Holy Week',
        };

        $recommendations = [
            'Summer' => [
                'title' => 'Summer Escapes',
                'icon' => '<svg class="w-6 h-6 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>',
                'businesses' => Business::where('status', 'approved')
                    ->whereHas('category', fn ($q) => $q->where('name', 'like', '%resort%')->orWhere('name', 'like', '%beach%'))
                    ->with('category', 'municipality')
                    ->inRandomOrder()
                    ->take(4)
                    ->get(),
            ],
            'Rainy Season' => [
                'title' => 'Cozy Indoors',
                'icon' => '<svg class="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"/></svg>',
                'businesses' => Business::where('status', 'approved')
                    ->whereHas('category', fn ($q) => $q->where('name', 'like', '%cafe%')->orWhere('name', 'like', '%restaurant%'))
                    ->with('category', 'municipality')
                    ->inRandomOrder()
                    ->take(4)
                    ->get(),
            ],
            'Christmas' => [
                'title' => 'Holiday Getaways',
                'icon' => '<svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/></svg>',
                'businesses' => Business::where('status', 'approved')
                    ->whereHas('category', fn ($q) => $q->where('name', 'like', '%resort%')->orWhere('name', 'like', '%hotel%'))
                    ->with('category', 'municipality')
                    ->inRandomOrder()
                    ->take(4)
                    ->get(),
            ],
            'Holy Week' => [
                'title' => 'Holy Week Retreats',
                'icon' => '<svg class="w-6 h-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 21a9 9 0 009-9 9 9 0 00-9-9 9 9 0 00-9 9 9 9 0 009 9zM12 9a3 3 0 000 6 3 3 0 000-6z"/></svg>',
                'businesses' => Business::where('status', 'approved')
                    ->whereHas('category', fn ($q) => $q->where('name', 'like', '%resort%')->orWhere('name', 'like', '%hotel%'))
                    ->with('category', 'municipality')
                    ->inRandomOrder()
                    ->take(4)
                    ->get(),
            ],
        ];

        $rec = $recommendations[$season] ?? $recommendations['Summer'];
        $rec['businesses'] = $this->loadOpenStatus($rec['businesses']);

        return $rec;
    }
}
