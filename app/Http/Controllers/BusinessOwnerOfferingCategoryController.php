<?php

namespace App\Http\Controllers;

use App\Models\OfferingCategory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BusinessOwnerOfferingCategoryController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');

        $query = OfferingCategory::query()->whereIn('business_id', $businessIds);

        if ($request->filled('business_id')) {
            $query->where('business_id', $request->integer('business_id'));
        }

        if ($request->filled('search')) {
            $query->where('name', 'like', '%' . $request->input('search') . '%');
        }

        if ($request->filled('status')) {
            $query->where('is_available', $request->input('status') === 'active');
        }

        $sort = $request->input('sort', 'newest');
        match ($sort) {
            'name_asc' => $query->orderBy('name'),
            'name_desc' => $query->orderByDesc('name'),
            'most_items' => $query->withCount('offerings')->orderByDesc('offerings_count'),
            'least_items' => $query->withCount('offerings')->orderBy('offerings_count'),
            'oldest' => $query->orderBy('created_at'),
            default => $query->orderByDesc('created_at'),
        };

        $categories = $query->withCount('offerings')->orderBy('sort_order')->get();

        $activeCount = OfferingCategory::whereIn('business_id', $businessIds)->where('is_available', true)->count();
        $hiddenCount = OfferingCategory::whereIn('business_id', $businessIds)->where('is_available', false)->count();
        $menuItems = OfferingCategory::whereIn('business_id', $businessIds)->get()->sum(fn ($c) => $c->offerings()->count());

        return $this->successResponse($categories, 'Categories retrieved.', 200, [
            'stats' => [
                'total' => $categories->count(),
                'active' => $activeCount,
                'hidden' => $hiddenCount,
                'menu_items' => $menuItems,
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');

        $validated = $request->validate([
            'business_id' => 'sometimes|integer|exists:businesses,id',
            'name' => 'required|string|max:255',
            'icon' => 'nullable|string|max:64',
            'description' => 'nullable|string|max:1000',
            'is_available' => 'sometimes|boolean',
        ]);

        $businessId = $validated['business_id'] ?? $request->user()->active_business_id ?? $businessIds->first();

        if (! $businessId || ! $businessIds->contains($businessId)) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $category = OfferingCategory::create([
            'business_id' => $businessId,
            'name' => $validated['name'],
            'icon' => $validated['icon'] ?? null,
            'description' => $validated['description'] ?? null,
            'is_available' => $validated['is_available'] ?? true,
        ]);

        return $this->createdResponse($category);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');
        $category = OfferingCategory::findOrFail($id);

        if (! $businessIds->contains($category->business_id)) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'icon' => 'nullable|string|max:64',
            'description' => 'nullable|string|max:1000',
            'is_available' => 'sometimes|boolean',
        ]);

        $data = array_filter($validated, fn ($value) => $value !== null);
        $category->update($data);

        return $this->successResponse($category->fresh()->loadCount('offerings'));
    }

    public function destroy(int $id): JsonResponse
    {
        $category = OfferingCategory::withCount('offerings')->findOrFail($id);

        if ($category->offerings_count > 0) {
            return $this->errorResponse('Cannot delete. Category still contains menu items.', 422);
        }

        $category->delete();
        return $this->noContentResponse('Category deleted.');
    }
}
