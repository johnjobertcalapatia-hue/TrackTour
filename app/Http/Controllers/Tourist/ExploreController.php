<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Favorite;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\OfferingCategory;
use App\Models\Promotion;
use App\Models\Review;
use App\Models\TourismEvent;
use App\Services\TouristService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;

class ExploreController extends Controller
{
    public function __construct(private TouristService $touristService) {}

    /**
     * Convert a stored media path (raw or already /storage/-prefixed) into a URL.
     */
    private static function resolveMediaUrl(?string $path): ?string
    {
        if (! $path) {
            return null;
        }

        $clean = ltrim($path, '/');
        if (str_starts_with($clean, 'storage/')) {
            $clean = substr($clean, strlen('storage/'));
        }

        return Storage::url($clean);
    }

    /**
     * Resolve the tourist's coordinates from the request or session.
     */
    private function touristCoords(Request $request): ?array
    {
        $lat = session('tourist_lat', $request->input('lat'));
        $lng = session('tourist_lng', $request->input('lng'));

        if ($lat === null || $lng === null || $lat === '' || $lng === '') {
            return null;
        }

        return [(float) $lat, (float) $lng];
    }

    /**
     * Apply the proximity scope to a Business query (computes distance but
     * does not filter by it, so all businesses remain visible). Callers are
     * responsible for guarding with hasValidCoords() / hasLocation().
     */
    private function proximityScope($query, float $lat, float $lng)
    {
        $haversine = '(6371 * acos(cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude))))';

        return $query
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->select('businesses.*')
            ->selectRaw("{$haversine} AS distance_km", [$lat, $lng, $lat]);
    }

    public function index(Request $request)
    {
        $coords = $this->touristCoords($request);
        $hasLocation = $coords !== null;
        $touristLat = $coords[0] ?? null;
        $touristLng = $coords[1] ?? null;

        if ($request->has('lat') && $request->has('lng')) {
            session(['tourist_lat' => $touristLat, 'tourist_lng' => $touristLng]);
        }

        $promotions = Promotion::active()
            ->whereHas('business', fn ($q) => $q->where('status', 'approved')->whereNotNull('latitude')->whereNotNull('longitude'))
            ->with('business')
            ->get()
            ->filter(function ($promotion) {
                return $promotion->business;
            })
            ->take(4)
            ->values();

        $categories = BusinessCategory::withCount(['businesses' => function ($q) {
            $q->where('status', 'approved');
        }])->get();

        $featured = Business::where('status', 'approved')
            ->whereNotNull('cover_photo')
            ->when($hasLocation, fn ($q) => $this->proximityScope($q, $touristLat, $touristLng))
            ->with('category', 'municipality')
            ->inRandomOrder()
            ->take(10)
            ->get();

        if ($featured->isEmpty()) {
            $featured = Business::where('status', 'approved')
                ->when($hasLocation, fn ($q) => $this->proximityScope($q, $touristLat, $touristLng))
                ->with('category', 'municipality')
                ->inRandomOrder()
                ->take(10)
                ->get();
        }

        $featured->load('promotions');
        $featured = $this->loadOpenStatus($featured);
        $featured = $this->loadAvgRating($featured);

        $trending = Business::where('status', 'approved')
            ->whereHas('reviews', fn ($q) => $q->where('status', 'approved'))
            ->when($hasLocation, fn ($q) => $this->proximityScope($q, $touristLat, $touristLng))
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

        $upcomingEvents = Cache::remember('explore_events', 1800, function () {
            return TourismEvent::where(function ($q) {
                $q->where('start_date', '>=', now())
                    ->orWhere('end_date', '>=', now());
            })
                ->with([
                    'municipality',
                    'media' => fn ($q) => $q
                        ->whereIn('type', ['Logo', 'Gallery'])
                        ->orderBy('sort_order'),
                ])
                ->orderBy('start_date')
                ->take(6)
                ->get();
        });

        $recentlyViewedIds = session('recently_viewed', []);
        $recentlyViewed = ! empty($recentlyViewedIds)
            ? Business::whereIn('id', $recentlyViewedIds)
                ->where('status', 'approved')
                ->when($hasLocation, fn ($q) => $this->proximityScope($q, $touristLat, $touristLng))
                ->with('category', 'municipality')
                ->get()
            : collect();
        $recentlyViewed = $this->loadOpenStatus($recentlyViewed);

        $savedIds = Auth::check()
            ? Favorite::where('user_id', Auth::id())
                ->where('favoritable_type', Business::class)
                ->pluck('favoritable_id')
                ->toArray()
            : [];

        $savedBusinessIds = Auth::check()
            ? Favorite::where('user_id', Auth::id())
                ->where('favoritable_type', Business::class)
                ->pluck('favoritable_id')
            : collect();

        $recommended = collect();
        if ($savedBusinessIds->isNotEmpty() && $hasLocation) {
            $savedCategories = Business::whereIn('id', $savedBusinessIds)
                ->pluck('business_category_id');
            $recommended = Business::where('status', 'approved')
                ->whereIn('business_category_id', $savedCategories)
                ->whereNotIn('id', $savedBusinessIds)
                ->when($hasLocation, fn ($q) => $this->proximityScope($q, $touristLat, $touristLng))
                ->with('category', 'municipality')
                ->inRandomOrder()
                ->take(4)
                ->get();
        }
        if ($recommended->isEmpty() && $hasLocation) {
            $recommended = Business::where('status', 'approved')
                ->when(true, fn ($q) => $this->proximityScope($q, $touristLat, $touristLng))
                ->with('category', 'municipality')
                ->inRandomOrder()
                ->take(4)
                ->get();
        }
        $recommended = $this->loadOpenStatus($recommended);

        $nearbyBusinesses = collect();
        if ($hasLocation) {
            $nearbyBusinesses = $this->proximityScope(Business::where('status', 'approved'), $touristLat, $touristLng)
                ->with('category', 'municipality')
                ->orderBy('distance_km')
                ->take(6)
                ->get();
            $nearbyBusinesses = $this->loadOpenStatus($nearbyBusinesses);
        } else {
            $nearbyBusinesses = Business::where('status', 'approved')
                ->with('category', 'municipality')
                ->inRandomOrder()
                ->take(6)
                ->get();
            $nearbyBusinesses = $this->loadOpenStatus($nearbyBusinesses);
        }

        $categoryEmojis = [
            'Restaurants' => '🍔',
            'Hotels' => '🏨',
            'Resorts' => '🏖️',
            'Transportation' => '🚐',
            'Attractions' => '🗺️',
            'Events' => '🎉',
            'Souvenir Shops' => '🛍️',
            'Tour Packages' => '🧳',
        ];

        $weather = '28°C';
        $userMunicipality = Auth::user()?->municipality?->name ?? session('municipality', 'Bansud, Oriental Mindoro');

        $places = Business::where('status', 'approved')
            ->when($hasLocation, fn ($q) => $this->proximityScope($q, $touristLat, $touristLng))
            ->whereHas('category', function ($q) {
                $q->where(function ($qq) {
                    $qq->where('name', 'like', '%attraction%')
                        ->orWhere('name', 'like', '%tourism%')
                        ->orWhere('name', 'like', '%adventure%')
                        ->orWhere('name', 'like', '%park%')
                        ->orWhere('name', 'like', '%beach%')
                        ->orWhere('name', 'like', '%museum%');
                });
            })
            ->with('municipality')
            ->withAvg(['reviews' => fn ($q) => $q->where('status', 'approved')], 'rating')
            ->when($hasLocation, fn ($q) => $q->orderBy('distance_km'))
            ->take(20)
            ->get()
            ->map(fn ($b) => [
                'id' => $b->id,
                'name' => $b->name,
                'cover_photo' => self::resolveMediaUrl($b->cover_photo)
                    ?? self::resolveMediaUrl($b->media->first()?->file_path),
                'rating' => $b->reviews_avg_rating ?? $b->average_rating ?? null,
                'municipality' => $b->municipality?->name ?? '',
                'type' => 'place',
            ]);

        $foodBusinesses = Business::where('status', 'approved')
            ->when($hasLocation, fn ($q) => $this->proximityScope($q, $touristLat, $touristLng))
            ->whereHas('category', function ($q) {
                $q->where(function ($qq) {
                    $qq->where('name', 'like', '%restaurant%')
                        ->orWhere('name', 'like', '%food%')
                        ->orWhere('name', 'like', '%cafe%')
                        ->orWhere('name', 'like', '%food hub%');
                });
            })
            ->whereHas('offerings', fn ($q) => $q->where('is_available', true)->where('status', 'active'))
            ->with('municipality')
            ->withAvg(['reviews' => fn ($q) => $q->where('status', 'approved')], 'rating')
            ->when($hasLocation, fn ($q) => $q->orderBy('distance_km'))
            ->take(20)
            ->get();

        $foodItems = $foodBusinesses->map(function ($b) {
            $cover = $b->cover_photo;
            $firstOffering = $b->offerings()
                ->where('is_available', true)
                ->where('status', 'active')
                ->first();
            if (! $cover && $firstOffering) {
                $cover = $firstOffering->image;
            }

            return [
                'id' => $b->id,
                'name' => $b->name,
                'cover_photo' => $cover,
                'logo' => $b->logo,
                'rating' => $b->reviews_avg_rating ?? $b->average_rating ?? null,
                'municipality' => $b->municipality?->name ?? '',
                'type' => 'food',
            ];
        })->values();

        $stays = Business::where('status', 'approved')
            ->when($hasLocation, fn ($q) => $this->proximityScope($q, $touristLat, $touristLng))
            ->whereHas('category', function ($q) {
                $q->where(function ($qq) {
                    $qq->where('name', 'like', '%hotel%')
                        ->orWhere('name', 'like', '%resort%')
                        ->orWhere('name', 'like', '%homestay%')
                        ->orWhere('name', 'like', '%lodging%')
                        ->orWhere('name', 'like', '%inn%');
                });
            })
            ->with('municipality')
            ->withAvg(['reviews' => fn ($q) => $q->where('status', 'approved')], 'rating')
            ->when($hasLocation, fn ($q) => $q->orderBy('distance_km'))
            ->take(20)
            ->get()
            ->map(fn ($b) => [
                'id' => $b->id,
                'name' => $b->name,
                'cover_photo' => $b->cover_photo,
                'rating' => $b->reviews_avg_rating ?? $b->average_rating ?? null,
                'municipality' => $b->municipality?->name ?? '',
                'type' => 'stay',
            ]);

        $counts = [
            'places' => Business::where('status', 'approved')
                ->whereHas('category', function ($q) {
                    $q->where(function ($qq) {
                        $qq->where('name', 'like', '%attraction%')
                            ->orWhere('name', 'like', '%tourism%')
                            ->orWhere('name', 'like', '%adventure%')
                            ->orWhere('name', 'like', '%park%')
                            ->orWhere('name', 'like', '%beach%')
                            ->orWhere('name', 'like', '%museum%');
                    });
                })
                ->count(),
            'food' => Business::where('status', 'approved')
                ->whereHas('category', function ($q) {
                    $q->where(function ($qq) {
                        $qq->where('name', 'like', '%restaurant%')
                            ->orWhere('name', 'like', '%food%')
                            ->orWhere('name', 'like', '%cafe%')
                            ->orWhere('name', 'like', '%food hub%');
                    });
                })
                ->whereHas('offerings', fn ($q) => $q->where('is_available', true)->where('status', 'active'))
                ->count(),
            'stays' => Business::where('status', 'approved')
                ->whereHas('category', function ($q) {
                    $q->where(function ($qq) {
                        $qq->where('name', 'like', '%hotel%')
                            ->orWhere('name', 'like', '%resort%')
                            ->orWhere('name', 'like', '%homestay%')
                            ->orWhere('name', 'like', '%lodging%')
                            ->orWhere('name', 'like', '%inn%');
                    });
                })
                ->count(),
        ];

        $data = compact(
            'categories',
            'featured',
            'trending',
            'municipalities',
            'upcomingEvents',
            'recentlyViewed',
            'savedIds',
            'recommended',
            'nearbyBusinesses',
            'touristLat',
            'touristLng',
            'categoryEmojis',
            'promotions',
            'userMunicipality',
            'weather',
            'places',
            'stays',
            'counts',
        );
        $data['food'] = $foodItems;

        if ($request->expectsJson()) {
            return $this->successResponse($data);
        }

        return response()->json($data);
    }

    public function searchSuggestions(Request $request)
    {
        $query = trim((string) $request->input('q'));
        $coords = $this->touristCoords($request);
        $hasLocation = $coords !== null;

        $empty = ['businesses' => [], 'foods' => [], 'municipalities' => [], 'events' => []];

        if (strlen($query) < 2) {
            return $this->successResponse($empty);
        }

        $lat = $coords[0] ?? null;
        $lng = $coords[1] ?? null;

        $businesses = Business::where('status', 'approved')
            ->where('business_name', 'like', "%{$query}%")
            ->when($hasLocation, fn ($q) => $this->proximityScope($q, $lat, $lng))
            ->with('municipality')
            ->take(5)
            ->get()
            ->map(fn ($b) => [
                'id' => $b->id,
                'name' => $b->name,
                'type' => 'Business',
                'subtitle' => $b->municipality?->name,
                'distance_km' => $b->distance_km ?? null,
                'url' => "/tourist/explore/{$b->id}",
            ])->values();

        $foodsQuery = Offering::query()
            ->where('is_available', true)
            ->where('status', 'active')
            ->whereHas('business', fn ($qb) => $qb->where('status', 'approved')->whereNotNull('latitude')->whereNotNull('longitude'))
            ->whereHas('business.category', function ($qb) {
                $qb->where(function ($qq) {
                    $qq->where('name', 'like', '%restaurant%')
                        ->orWhere('name', 'like', '%food%')
                        ->orWhere('name', 'like', '%cafe%')
                        ->orWhere('name', 'like', '%food hub%');
                });
            })
            ->where(function ($qb) use ($query) {
                $qb->where('name', 'like', "%{$query}%")
                    ->orWhereHas('business', fn ($b) => $b->where('business_name', 'like', "%{$query}%"));
            })
            ->with('business.category')
            ->get();

        if ($hasLocation) {
            $foodsQuery = $foodsQuery->sortBy(fn ($food) => $this->distanceTo((string) $lat, (string) $lng, $food->business) ?? PHP_FLOAT_MAX);
        }

        $foods = $foodsQuery
            ->take(5)
            ->values()
            ->map(fn ($food) => [
                'id' => $food->id,
                'business_id' => $food->business_id,
                'name' => $food->name,
                'type' => 'Food',
                'subtitle' => $food->business->name,
                'distance_km' => $hasLocation ? $this->distanceTo((string) $lat, (string) $lng, $food->business) : null,
                'price' => (float) $food->price,
                'url' => "/tourist/food/{$food->business_id}",
            ])
            ->values();

        $municipalities = Municipality::where('name', 'like', "%{$query}%")
            ->take(3)
            ->get()
            ->map(fn ($m) => [
                'id' => $m->id,
                'name' => $m->name,
                'type' => 'Municipality',
                'subtitle' => $m->businesses()->where('status', 'approved')->count().' businesses',
                'url' => "/tourist/municipality/{$m->id}",
            ])->values();

        $events = TourismEvent::where(function ($q) {
            $q->where('start_date', '>=', now())
                ->orWhere('end_date', '>=', now());
        })
            ->where('name', 'like', "%{$query}%")
            ->take(3)
            ->get()
            ->map(fn ($e) => [
            'id' => $e->id,
            'name' => $e->name,
            'type' => 'Event',
            'subtitle' => $e->start_date?->format('M d, Y'),
            'url' => "/tourist/events/{$e->id}",
        ])->values();

        return $this->successResponse([
            'businesses' => $businesses,
            'foods' => $foods,
            'municipalities' => $municipalities,
            'events' => $events,
        ]);
    }

    /**
     * Distance (km) from a tourist location to a business, or null if unknown.
     */
    private function distanceTo(?string $lat, ?string $lng, Business $business): ?float
    {
        if ($lat === null || $lng === null || $business->latitude === null || $business->longitude === null) {
            return null;
        }
        $earth = 6371;
        $dLat = deg2rad((float) $business->latitude - (float) $lat);
        $dLng = deg2rad((float) $business->longitude - (float) $lng);
        $a = sin($dLat / 2) ** 2
            + cos(deg2rad((float) $lat)) * cos(deg2rad((float) $business->latitude))
            * sin($dLng / 2) ** 2;
        return round($earth * 2 * atan2(sqrt($a), sqrt(1 - $a)), 2);
    }

    /**
     * "For You" suggestions driven by the tourist's nearest business.
     * If the closest business serves food, we suggest food; if it's a hotel/
     * resort/homestay, we suggest places to stay.
     */
    public function forYou(Request $request)
    {
        $coords = $this->touristCoords($request);

        if ($coords === null) {
            return $this->successResponse([
                'kind' => 'stay',
                'title' => 'For You',
                'has_location' => false,
                'items' => [],
            ]);
        }

        [$lat, $lng] = $coords;

        $haversine = '(6371 * acos(cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude))))';

        // Find the nearest approved business so we can tailor suggestions.
        $nearest = null;
        if ($lat !== null && $lng !== null) {
            $nearest = Business::where('status', 'approved')
                ->whereNotNull('latitude')->whereNotNull('longitude')
                ->select('businesses.*')
                ->selectRaw("{$haversine} AS distance_km", [$lat, $lng, $lat])
                ->with('category', 'municipality')
                ->orderBy('distance_km')
                ->first();
        }

        $anchor = $nearest;

        if (! $anchor) {
            return $this->successResponse([
                'kind' => 'stay',
                'title' => 'For You',
                'has_location' => true,
                'items' => [],
            ]);
        }

        $isFood = (bool) ($anchor->category && (
            preg_match('/restaurant|food|cafe/i', (string) $anchor->category->name)
        ));

        $kind = $isFood ? 'food' : 'stay';
        $title = $isFood ? 'For You · Nearby Eats' : 'For You · Places to Stay Near You';

        if ($isFood) {
            $items = Offering::query()
                ->where('is_available', true)
                ->where('status', 'active')
                ->whereHas('business', fn ($qb) => $qb->where('status', 'approved')->whereNotNull('latitude')->whereNotNull('longitude'))
                ->whereHas('business.category', function ($qb) {
                    $qb->where(function ($qq) {
                        $qq->where('name', 'like', '%restaurant%')
                            ->orWhere('name', 'like', '%food%')
                            ->orWhere('name', 'like', '%cafe%')
                            ->orWhere('name', 'like', '%food hub%');
                    });
                })
                ->with('business.category', 'category')
                ->get()
                ->filter(fn ($food) => $food->business)
                ->sortBy(fn ($food) => $this->distanceTo((string) $lat, (string) $lng, $food->business) ?? PHP_FLOAT_MAX)
                ->take(8)
                ->values()
                ->map(function ($food) use ($lat, $lng) {
                    return [
                        'kind' => 'food',
                        'id' => $food->id,
                        'business_id' => $food->business_id,
                        'name' => $food->name,
                        'subtitle' => $food->business->name,
                        'image' => $food->image,
                        'price' => (float) $food->price,
                        'category' => $food->business->category->name ?? 'Food',
                        'distance_km' => $this->distanceTo((string) $lat, (string) $lng, $food->business),
                        'url' => "/tourist/food/{$food->business_id}",
                    ];
                });
        } else {
            $items = Business::where('status', 'approved')
                ->whereNotNull('latitude')->whereNotNull('longitude')
                ->whereHas('category', function ($qb) {
                    $qb->where(function ($qq) {
                        $qq->where('name', 'like', '%hotel%')
                            ->orWhere('name', 'like', '%resort%')
                            ->orWhere('name', 'like', '%homestay%')
                            ->orWhere('name', 'like', '%camping%');
                    });
                })
                ->with('category', 'municipality')
                ->get()
                ->filter(fn ($b) => $b->latitude && $b->longitude)
                ->sortBy(function ($b) use ($lat, $lng) {
                    return $this->distanceTo((string) $lat, (string) $lng, $b) ?? PHP_FLOAT_MAX;
                })
                ->take(8)
                ->values()
                ->map(function ($b) use ($lat, $lng) {
                    return [
                        'kind' => 'stay',
                        'id' => $b->id,
                        'name' => $b->name,
                        'subtitle' => $b->municipality?->name,
                        'image' => $b->cover_photo,
                        'price' => null,
                        'category' => $b->category?->name,
                        'distance_km' => $this->distanceTo((string) $lat, (string) $lng, $b),
                        'url' => "/tourist/explore/{$b->id}",
                    ];
                });
        }

        return $this->successResponse([
            'kind' => $kind,
            'title' => $title,
            'has_location' => true,
            'items' => $items,
        ]);
    }

    public function categories()
    {
        $categories = BusinessCategory::withCount(['businesses' => fn ($q) => $q->where('status', 'approved')])->orderBy('name')->get();

        return $this->successResponse($categories);
    }

    public function featured()
    {
        $businesses = Cache::remember('directory_featured_businesses', 900, function () {
            return Business::where('status', 'approved')->with(['category', 'municipality', 'promotions' => fn ($q) => $q->active()])
                ->withCount(['reviews' => fn ($q) => $q->where('status', 'approved')])
                ->withAvg(['reviews' => fn ($q) => $q->where('status', 'approved')], 'rating')
                ->where(fn ($q) => $q->whereHas('promotions', fn ($promotion) => $promotion->active())->orWhereNotNull('cover_photo'))
                ->orderByDesc('reviews_count')->take(8)->get();
        });
        $this->loadOpenStatus($businesses);

        return $this->successResponse(compact('businesses'));
    }

    public function directory(Request $request)
    {
        $categories = BusinessCategory::withCount(['businesses' => fn ($q) => $q->where('status', 'approved')])->orderBy('name')->get();
        $municipalities = Municipality::orderBy('name')->get(['id', 'name']);
        $query = $request->input('s');
        $quickFilter = $request->input('filter');
        $sort = $request->input('sort', 'popular');
        $coords = $this->touristCoords($request);
        $hasLocation = $coords !== null;
        $touristLat = $coords[0] ?? null;
        $touristLng = $coords[1] ?? null;

        // Businesses are always visible regardless of the tourist's distance.
        $businessesQuery = Business::where('status', 'approved')
            ->when($hasLocation, fn ($q) => $this->proximityScope($q, $touristLat, $touristLng))
            ->with([
                'category',
                'municipality',
                'barangay',
                'promotions' => fn ($q) => $q->active(),
            ])
            ->withCount(['reviews' => fn ($q) => $q->where('status', 'approved')])
            ->withAvg(['reviews' => fn ($q) => $q->where('status', 'approved')], 'rating');

        if ($query) {
            $businessesQuery->where(function ($q) use ($query) {
                $q->where('business_name', 'like', "%{$query}%")
                    ->orWhere('business_description', 'like', "%{$query}%")
                    ->orWhere('address', 'like', "%{$query}%")
                    ->orWhereHas('category', fn ($category) => $category->where('name', 'like', "%{$query}%"))
                    ->orWhereHas('municipality', fn ($municipality) => $municipality->where('name', 'like', "%{$query}%"))
                    ->orWhereHas('barangay', fn ($barangay) => $barangay->where('name', 'like', "%{$query}%"))
                    ->orWhereHas('offerings', fn ($offering) => $offering->where('name', 'like', "%{$query}%"));
            });
        }
        if ($request->filled('category')) {
            $businessesQuery->where('business_category_id', $request->integer('category'));
        }
        if ($request->filled('municipality')) {
            $businessesQuery->where('municipality_id', $request->integer('municipality'));
        }
        if ($quickFilter === 'open') {
            $now = now()->format('H:i:s');
            $businessesQuery->where(function ($q) use ($now) {
                $q->whereNull('opening_time')->orWhereNull('closing_time')->orWhere(function ($hours) use ($now) {
                    $hours->whereColumn('closing_time', '>=', 'opening_time')->where('opening_time', '<=', $now)->where('closing_time', '>=', $now);
                })->orWhere(function ($overnight) use ($now) {
                    $overnight->whereColumn('closing_time', '<', 'opening_time')->where(function ($time) use ($now) {
                        $time->where('opening_time', '<=', $now)->orWhere('closing_time', '>=', $now);
                    });
                });
            });
        }
        if ($quickFilter === 'rated') {
            $businessesQuery->having('reviews_avg_rating', '>=', 4);
        }
        if ($quickFilter === 'promotions') {
            $businessesQuery->whereHas('promotions', fn ($promotion) => $promotion->active());
        }
        if ($quickFilter === 'new') {
            $businessesQuery->where('created_at', '>=', now()->subDays(30));
        }

        if (($quickFilter === 'nearest' || $sort === 'nearest') && $touristLat && $touristLng) {
            $businessesQuery->whereNotNull('latitude')->whereNotNull('longitude')->orderBy('distance_km');
        } elseif ($sort === 'rating' || $quickFilter === 'rated') {
            $businessesQuery->orderByDesc('reviews_avg_rating')->orderByDesc('reviews_count');
        } elseif ($sort === 'newest' || $quickFilter === 'new') {
            $businessesQuery->latest();
        } elseif ($sort === 'alphabetical') {
            $businessesQuery->orderBy('business_name');
        } elseif ($sort === 'reviews') {
            $businessesQuery->orderByDesc('reviews_count');
        } else {
            $businessesQuery->orderByDesc('reviews_count')->orderByDesc('reviews_avg_rating');
        }

        $businesses = $businessesQuery->paginate(12);
        $this->loadOpenStatus($businesses->getCollection());

        return $this->successResponse([
            'businesses' => $businesses->items(),
            'totalCount' => $businesses->total(),
            'totalPages' => $businesses->lastPage(),
            'currentPage' => $businesses->currentPage(),
            'categories' => $categories,
            'municipalities' => $municipalities,
            'query' => $query,
            'quickFilter' => $quickFilter,
            'sort' => $sort,
            'touristLat' => $touristLat,
            'touristLng' => $touristLng,
        ]);
    }

    public function municipality(Municipality $municipality, Request $request)
    {
        $coords = $this->touristCoords($request);
        $hasLocation = $coords !== null;

        $businesses = Business::where('municipality_id', $municipality->id)
            ->where('status', 'approved')
            ->when($hasLocation, fn ($q) => $this->proximityScope($q, $coords[0], $coords[1]))
            ->with('category')
            ->paginate(12);

        $businesses->getCollection()->each(function ($b) {
            $b->is_open = $this->isBusinessOpen($b);
        });

        if ($request->expectsJson()) {
            return $this->successResponse(compact('municipality', 'businesses'));
        }

        return response()->json(compact('municipality', 'businesses'));
    }

    /**
     * Public endpoint for the landing page map. Returns all approved
     * businesses that have coordinates, so they can be plotted as markers.
     */
    public function landingMap(Request $request)
    {
        $businesses = Business::where('status', 'approved')
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->with([
                'category',
                'municipality',
                'media' => fn ($q) => $q->where('type', 'gallery')->orderBy('sort_order'),
            ])
            ->get(['id', 'business_name', 'latitude', 'longitude', 'cover_photo', 'business_category_id', 'municipality_id', 'price_range', 'average_rating', 'review_count', 'popularity_score', 'services', 'facilities', 'opening_time', 'closing_time', 'business_hours', 'force_closed', 'created_at']);

        $menuByBusiness = Offering::whereIn('business_id', $businesses->pluck('id'))
            ->where('is_available', true)
            ->with(['category'])
            ->orderByDesc('bestseller')
            ->orderBy('sort_order')
            ->get(['id', 'business_id', 'name', 'description', 'price', 'image', 'is_available', 'bestseller'])
            ->groupBy('business_id')
            ->map(fn ($items) => $items->values()->map(fn ($o) => [
                'id' => $o->id,
                'name' => $o->name,
                'description' => $o->description,
                'price' => (float) $o->price,
                'image' => $o->image,
                'bestseller' => (bool) $o->bestseller,
                'category' => $o->category?->name,
            ]));

        return $this->successResponse(
            $businesses->map(fn ($b) => [
                'id' => $b->id,
                'name' => $b->name,
                'latitude' => (float) $b->latitude,
                'longitude' => (float) $b->longitude,
                'cover_photo' => $b->cover_photo,
                'images' => $b->media->pluck('file_path')->filter()->values(),
                'category' => $b->category?->name,
                'municipality' => $b->municipality?->name,
                'price_range' => $b->price_range,
                'average_rating' => (float) ($b->average_rating ?? 0),
                'review_count' => (int) ($b->review_count ?? 0),
                'popularity_score' => (int) ($b->popularity_score ?? 0),
                'is_open' => $this->isBusinessOpen($b),
                'is_accepting_orders' => (bool) $b->is_accepting_orders,
                'availability_status' => $b->availability_status,
                'module_codes' => $b->module_codes,
                'services' => $b->services,
                'facilities' => $b->facilities,
                'created_at' => $b->created_at?->toIso8601String(),
                'menu_items' => $menuByBusiness->get($b->id, collect())->all(),
            ])
                ->values()
        );
    }

    public function map(Request $request)
    {
        $coords = $this->touristCoords($request);
        $hasLocation = $coords !== null;

        $businesses = Business::where('status', 'approved')
            ->when($hasLocation, fn ($q) => $this->proximityScope($q, $coords[0], $coords[1]))
            ->with([
                'category',
                'municipality',
                'barangay',
                'media' => fn ($q) => $q
                    ->whereIn('type', ['Logo', 'Gallery', 'logo', 'gallery'])
                    ->orderBy('sort_order'),
                'promotions' => fn ($q) => $q->active(),
            ])
            ->withCount(['reviews' => fn ($q) => $q->where('status', 'approved')])
            ->withAvg(['reviews' => fn ($q) => $q->where('status', 'approved')], 'rating')
            ->get()
            ->map(function ($b) {
                $b->is_open = $this->isBusinessOpen($b);

                $mediaImages = $b->media
                    ->pluck('file_path')
                    ->filter()
                    ->values();

                $b->images = $mediaImages;

                return $b;
            });

        $categories = BusinessCategory::all();

        $municipalities = Municipality::whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->get(['id', 'name', 'latitude', 'longitude']);

        $selectedMunicipality = null;
        if ($request->filled('municipality_id')) {
            $selectedMunicipality = Municipality::find($request->integer('municipality_id'));
        }

        $focusLat = $request->float('lat');
        $focusLng = $request->float('lng');
        $focusBusinessId = $request->integer('business_id');

        return response()->json(compact('businesses', 'categories', 'municipalities', 'selectedMunicipality', 'focusLat', 'focusLng', 'focusBusinessId'));
    }

    public function show(Business $business, Request $request)
    {
        if ($business->status !== 'approved') {
            abort(404);
        }

        $business->load(['category', 'municipality', 'barangay', 'media' => function ($q) {
            $q->where('type', 'gallery')->orderBy('sort_order');
        }]);

        $reviews = Review::where('business_id', $business->id)
            ->where('status', 'approved')
            ->with('user')
            ->latest()
            ->take(10)
            ->get();
        $avgRating = $reviews->avg('rating') ?? 0;
        $reviewsCount = Review::where('business_id', $business->id)->where('status', 'approved')->count();

        $promotions = Promotion::where('business_id', $business->id)->active()->latest()->get();

        $offerings = Offering::where('business_id', $business->id)
            ->where('is_available', true)
            ->with(['category', 'variations'])
            ->orderByDesc('bestseller')
            ->orderBy('sort_order')
            ->get();

        $menuItems = $offerings->map(fn ($o) => [
            'id' => $o->id,
            'name' => $o->name,
            'description' => $o->description,
            'price' => (float) $o->price,
            'image' => $o->image,
            'is_available' => (bool) $o->is_available,
            'category' => $o->category?->name,
            'bestseller' => (bool) $o->bestseller,
            'variations' => $o->variations,
        ])->values();

        $offeringCategories = OfferingCategory::where('business_id', $business->id)
            ->with(['offerings' => fn ($q) => $q->where('is_available', true)->orderByDesc('bestseller')->orderBy('sort_order')])
            ->orderBy('sort_order')
            ->get();

        $gallery = $business->media;

        $isFavorited = Auth::check() && Favorite::where('user_id', Auth::id())
            ->where('favoritable_type', Business::class)
            ->where('favoritable_id', $business->id)
            ->exists();

        $isOpen = $this->isBusinessOpen($business);

        $business->menu_items = $menuItems;
        $business->is_accepting_orders = $business->isAcceptingOrders();
        $business->availability = $business->availability();
        $business->open_status = $business->openStatusLabel();
        $business->schedule_summary = $business->scheduleSummary();

        $recentlyViewed = session('recently_viewed', []);
        $recentlyViewed = array_unique(array_merge([$business->id], $recentlyViewed));
        $recentlyViewed = array_slice($recentlyViewed, 0, 10);
        session(['recently_viewed' => $recentlyViewed]);

        $business->menu_items = $menuItems;

        $data = compact(
            'business',
            'reviews',
            'avgRating',
            'reviewsCount',
            'promotions',
            'offerings',
            'offeringCategories',
            'gallery',
            'isFavorited',
            'isOpen',
        );
        $data['menu_items'] = $menuItems;

        if ($request->expectsJson()) {
            return $this->successResponse($data);
        }

        return response()->json($data);
    }

    protected function isBusinessOpen(Business $business): bool
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
}
