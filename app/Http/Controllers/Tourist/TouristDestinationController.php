<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\TouristDestination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\Storage;

class TouristDestinationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $search = $request->input('search');
        $category = $request->input('category');
        $municipality = $request->input('municipality');

        $query = TouristDestination::query()
            ->where('status', 'active')
            ->with('category', 'municipality');

        if ($search) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('description', 'like', "%{$search}%")
                    ->orWhere('address', 'like', "%{$search}%");
            });
        }

        if ($category) {
            $query->whereHas('category', fn ($q) => $q->where('slug', $category));
        }

        if ($municipality) {
            $query->whereHas('municipality', fn ($q) => $q->where('id', $municipality));
        }

        $legacyDestinations = $query->get()->map(function (TouristDestination $destination) {
            $destination->images = collect($destination->images ?? [])
                ->map(fn ($image) => Storage::url($image))
                ->all();

            return $destination;
        });

        $attractions = Business::query()
            ->where('status', 'approved')
            ->where('business_category_id', 7)
            ->with(['category', 'municipality', 'details', 'media'])
            ->when($search, function ($q) use ($search) {
                $q->where(function ($query) use ($search) {
                    $query->where('business_name', 'like', "%{$search}%")
                        ->orWhere('business_description', 'like', "%{$search}%")
                        ->orWhere('address', 'like', "%{$search}%");
                });
            })
            ->when($category, function ($q) use ($category) {
                $q->whereHas('details', fn ($details) => $details
                    ->where('field_name', 'attraction_type')
                    ->where('field_value', $category));
            })
            ->get()
            ->map(function (Business $attraction) {
                $details = $attraction->details->mapWithKeys(
                    fn ($detail) => [$detail->field_name => $detail->field_value]
                );

                return [
                    'id' => $attraction->id,
                    'name' => $attraction->business_name,
                    'description' => $attraction->business_description,
                    'address' => $attraction->address,
                    'latitude' => $attraction->latitude,
                    'longitude' => $attraction->longitude,
                    'entrance_fee' => (float) ($details['entrance_fee'] ?? 0),
                    'images' => $attraction->media
                        ->whereIn('type', ['Logo', 'Gallery'])
                        ->sortBy('sort_order')
                        ->map(fn ($media) => Storage::url($media->file_path))
                        ->values()
                        ->all(),
                    'amenities' => ! empty($details['activities']) ? [$details['activities']] : [],
                    'rating' => (float) ($attraction->average_rating ?? 0),
                    'category' => [
                        'id' => $attraction->category?->id,
                        'name' => $details['attraction_type'] ?: ($attraction->category?->name ?? 'Tourist Attraction'),
                        'slug' => strtolower(str_replace(' ', '-', $details['attraction_type'] ?: 'tourist-attraction')),
                    ],
                    'municipality' => [
                        'id' => $attraction->municipality?->id,
                        'name' => $attraction->municipality?->name,
                    ],
                ];
            });

        $items = $legacyDestinations
            ->concat($attractions)
            ->sortBy('name')
            ->values();
        $perPage = 12;
        $page = LengthAwarePaginator::resolveCurrentPage();
        $destinations = new LengthAwarePaginator(
            $items->forPage($page, $perPage)->values(),
            $items->count(),
            $perPage,
            $page,
            ['path' => $request->url(), 'query' => $request->query()]
        );

        return $this->successResponse($destinations);
    }

    public function show(Request $request, int $destination): JsonResponse
    {
        $legacyDestination = TouristDestination::with('category', 'municipality')->find($destination);

        if ($legacyDestination) {
            return $this->successResponse($legacyDestination);
        }

        $attraction = Business::query()
            ->whereKey($destination)
            ->where('business_category_id', 7)
            ->where('status', 'approved')
            ->with(['category', 'municipality', 'barangay', 'details', 'media'])
            ->first();

        if (! $attraction) {
            return $this->errorResponse('Destination not found.', 404);
        }

        $details = $attraction->details->mapWithKeys(
            fn ($detail) => [$detail->field_name => $detail->field_value]
        );
        $images = $attraction->media
            ->whereIn('type', ['Logo', 'Gallery'])
            ->sortBy('sort_order')
            ->map(fn ($media) => Storage::url($media->file_path))
            ->values()
            ->all();

        return $this->successResponse([
            'id' => $attraction->id,
            'favoritable_type' => Business::class,
            'name' => $attraction->business_name,
            'description' => $attraction->business_description,
            'address' => $attraction->address,
            'latitude' => $attraction->latitude,
            'longitude' => $attraction->longitude,
            'opening_hours' => $attraction->opening_time && $attraction->closing_time
                ? substr((string) $attraction->opening_time, 0, 5) . ' - ' . substr((string) $attraction->closing_time, 0, 5)
                : null,
            'entrance_fee' => (float) ($details['entrance_fee'] ?? 0),
            'contact_number' => $attraction->contact_number,
            'images' => $images,
            'amenities' => $details['activities'] ? [$details['activities']] : [],
            'rating' => (float) ($attraction->average_rating ?? 0),
            'category' => [
                'id' => $attraction->category?->id,
                'name' => $details['attraction_type'] ?: ($attraction->category?->name ?? 'Tourist Attraction'),
            ],
            'municipality' => [
                'id' => $attraction->municipality?->id,
                'name' => $attraction->municipality?->name,
            ],
        ]);
    }

    public function categories(): JsonResponse
    {
        $categories = \App\Models\TourismCategory::orderBy('name')->get();

        return $this->successResponse($categories);
    }
}
