<?php

namespace App\Http\Controllers\Tourist;

use App\Enums\DiscoveryGroup;
use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Promotion;
use App\Models\ResortFacility;
use App\Models\ResortType;
use App\Models\Review;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /tourist/stays — the tourist "Stays & Deals" browse page.
 *
 * Unlike GET /tourist/booking (the bookable list, which by design only
 * contains businesses that accept reservations), this lists every approved
 * accommodation for browsing and flags `accepts_reservation` so the UI can
 * offer booking only where it is enabled. It also returns the currently
 * active promotions of accommodations and tourist attractions.
 *
 * Read-only: no booking, payment or reservation state is touched here.
 *
 * Dynamic resort system, Stage 2: cards carry the resort's types and
 * facilities (Stage 1 data) and the list can be filtered by resort type (any
 * of), facilities (all of, catalogue and owner-added), location and minimum
 * rating. `filters` returns the options with real counts so the page builds
 * its filters from data. Cottage count and starting price stay null until
 * real inventory / published offering prices exist (later stages): nothing
 * is invented.
 */
class StaysController extends Controller
{
    private const PER_PAGE = 12;

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'type' => ['nullable', 'string', 'max:100'],
            'sort' => ['nullable', 'in:popular,rating,name'],
            'municipality_id' => ['nullable', 'integer'],
            'resort_types' => ['nullable', 'array'],
            'resort_types.*' => ['string', 'exists:resort_types,slug'],
            'facilities' => ['nullable', 'array'],
            'facilities.*' => ['string', 'exists:resort_facilities,slug'],
            'custom_facilities' => ['nullable', 'array'],
            'custom_facilities.*' => ['string', 'max:100'],
            'min_rating' => ['nullable', 'numeric', 'between:1,5'],
        ]);

        $accommodationCategoryIds = BusinessCategory::inDiscoveryGroup(DiscoveryGroup::Accommodation)->pluck('id');
        $spotCategoryIds = BusinessCategory::inDiscoveryGroup(DiscoveryGroup::Spot)->pluck('id');

        $query = Business::query()
            ->where('status', 'approved')
            ->whereIn('business_category_id', $accommodationCategoryIds)
            ->with(['category', 'municipality', 'resortTypes', 'resortFacilities', 'resortCustomFacilities',
                'resortOfferings' => fn ($q) => $q->where('is_published', true)])
            ->withAvg(['reviews' => fn ($q) => $q->where('status', 'approved')], 'rating')
            ->withCount(['reviews' => fn ($q) => $q->where('status', 'approved')]);

        if (filled($validated['search'] ?? null)) {
            $term = '%'.$validated['search'].'%';
            $query->where(function ($q) use ($term) {
                $q->where('business_name', 'like', $term)
                    ->orWhere('address', 'like', $term)
                    ->orWhereHas('municipality', fn ($m) => $m->where('name', 'like', $term));
            });
        }

        if (filled($validated['municipality_id'] ?? null)) {
            $query->where('municipality_id', (int) $validated['municipality_id']);
        }

        if (filled($validated['type'] ?? null) && $validated['type'] !== 'all') {
            $query->whereHas('category', fn ($c) => $c->where('name', $validated['type']));
        }

        // Resort type: any of the selected types.
        if (! empty($validated['resort_types'])) {
            $query->whereHas('resortTypes', fn ($t) => $t->whereIn('slug', $validated['resort_types']));
        }
        // Facilities: the stay must have every selected facility.
        foreach (array_unique($validated['facilities'] ?? []) as $slug) {
            $query->whereHas('resortFacilities', fn ($q) => $q->where('slug', $slug));
        }
        foreach (array_unique($validated['custom_facilities'] ?? []) as $name) {
            $query->whereHas('resortCustomFacilities', fn ($q) => $q->where('name', $name));
        }
        // Minimum rating from approved reviews only (unrated stays never match).
        if (filled($validated['min_rating'] ?? null)) {
            $query->whereRaw(
                "(select avg(rating) from reviews where reviews.business_id = businesses.id and reviews.status = 'approved') >= (? + 0.0)",
                [(float) $validated['min_rating']],
            );
        }

        match ($validated['sort'] ?? 'popular') {
            'rating' => $query->orderByDesc('reviews_avg_rating')->orderByDesc('reviews_count'),
            'name' => $query->orderBy('business_name'),
            default => $query->orderByDesc('reviews_count')->orderByDesc('reviews_avg_rating')->orderBy('business_name'),
        };

        $page = $query->paginate(self::PER_PAGE);

        $accommodations = collect($page->items())->map(fn (Business $b) => [
            'id' => $b->id,
            'name' => $b->name,
            'cover_photo' => $b->cover_photo,
            'logo' => $b->logo,
            'category' => $b->category?->name,
            'municipality' => $b->municipality?->name,
            'address' => $b->address,
            'price_range' => $b->price_range,
            // Never surface a fabricated 0.0: null when there are no approved reviews.
            'rating' => $b->reviews_count > 0 ? round((float) $b->reviews_avg_rating, 1) : null,
            'reviews_count' => (int) $b->reviews_count,
            'accepts_reservation' => (bool) $b->accepts_reservation,
            'is_open' => $b->isOpenNow(),
            'resort_types' => $b->resortTypes->map(fn ($t) => ['slug' => $t->slug, 'name' => $t->name])->values(),
            'facilities' => $b->resortFacilities->map(fn ($x) => ['slug' => $x->slug, 'name' => $x->name])
                ->concat($b->resortCustomFacilities->map(fn ($x) => ['slug' => null, 'name' => $x->name]))
                ->values(),
            // From published offerings only (Stage 4); null when there are none.
            ...self::offeringSummary($b),
        ])->values();

        // Chips: real accommodation category names that have at least one listing.
        $types = BusinessCategory::query()
            ->whereIn('id', $accommodationCategoryIds)
            ->whereHas('businesses', fn ($q) => $q->where('status', 'approved'))
            ->orderBy('name')
            ->pluck('name')
            ->values();

        $promotions = Promotion::active()
            ->whereHas('business', fn ($q) => $q
                ->where('status', 'approved')
                ->whereIn('business_category_id', $accommodationCategoryIds->merge($spotCategoryIds)))
            ->with(['business.category', 'business.municipality'])
            ->orderByRaw('end_date IS NULL')
            ->orderBy('end_date')
            ->latest('id')
            ->take(12)
            ->get()
            ->map(fn (Promotion $p) => [
                'id' => $p->id,
                'name' => $p->name,
                'description' => $p->description,
                'type' => $p->type,
                'value' => $p->value !== null ? (float) $p->value : null,
                'min_order' => $p->min_order !== null ? (float) $p->min_order : null,
                'code' => $p->code,
                'end_date' => $p->end_date?->toIso8601String(),
                'business' => [
                    'id' => $p->business->id,
                    'name' => $p->business->name,
                    'cover_photo' => $p->business->cover_photo,
                    'category' => $p->business->category?->name,
                    'municipality' => $p->business->municipality?->name,
                    'kind' => $spotCategoryIds->contains($p->business->business_category_id) ? 'attraction' : 'stay',
                ],
            ])
            ->values();

        return $this->successResponse([
            'accommodations' => $accommodations,
            'types' => $types,
            'filters' => $this->filterOptions($accommodationCategoryIds),
            'promotions' => $promotions,
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
                'total' => $page->total(),
            ],
        ]);
    }

    /**
     * Filter options with counts over approved stays, so the page only builds
     * filters from real data. Resort types always list the full catalogue.
     *
     * @param  \Illuminate\Support\Collection<int, int>  $categoryIds
     */
    private function filterOptions($categoryIds): array
    {
        $listed = fn ($q) => $q->where('status', 'approved')->whereIn('business_category_id', $categoryIds);

        $customFacilities = DB::table('business_resort_custom_facilities as c')
            ->join('businesses as b', 'b.id', '=', 'c.business_id')
            ->where('b.status', 'approved')
            ->whereIn('b.business_category_id', $categoryIds)
            ->whereNull('b.deleted_at')
            ->select('c.name', DB::raw('count(*) as count'))
            ->groupBy('c.name')
            ->orderBy('c.name')
            ->get()
            ->map(fn ($r) => ['name' => $r->name, 'count' => (int) $r->count]);

        return [
            'resort_types' => ResortType::query()->orderBy('sort_order')
                ->withCount(['businesses' => $listed])
                ->get()
                ->map(fn ($t) => ['slug' => $t->slug, 'name' => $t->name, 'count' => (int) $t->businesses_count])
                ->values(),
            'facilities' => ResortFacility::query()->orderBy('sort_order')
                ->withCount(['businesses' => $listed])
                ->get()
                ->filter(fn ($f) => $f->businesses_count > 0)
                ->map(fn ($f) => ['slug' => $f->slug, 'name' => $f->name, 'count' => (int) $f->businesses_count])
                ->values(),
            'custom_facilities' => $customFacilities->values(),
            'municipalities' => Municipality::query()->orderBy('name')
                ->withCount(['businesses' => $listed])
                ->get()
                ->filter(fn ($m) => $m->businesses_count > 0)
                ->map(fn ($m) => ['id' => $m->id, 'name' => $m->name, 'count' => (int) $m->businesses_count])
                ->values(),
            'rating_available' => Review::query()
                ->where('status', 'approved')
                ->whereHas('business', $listed)
                ->exists(),
        ];
    }

    /**
     * Card facts from published offerings: cottage count (units of published
     * cottages) and the lowest published price with its pricing basis.
     */
    private static function offeringSummary(Business $b): array
    {
        $published = $b->resortOfferings;
        $cottageUnits = $published->where('category', 'cottage')->where('inventory_mode', 'units')->sum('inventory_quantity');
        $cheapest = $published->sortBy(fn ($o) => (float) $o->price)->first();

        return [
            'cottage_count' => $cottageUnits > 0 ? (int) $cottageUnits : null,
            'starting_price' => $cheapest ? (float) $cheapest->price : null,
            'starting_price_basis' => $cheapest?->pricing_basis,
        ];
    }
}
