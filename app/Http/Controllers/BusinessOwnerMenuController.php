<?php

namespace App\Http\Controllers;

use App\Http\Resources\OfferingResource;
use App\Models\Business;
use App\Models\Offering;
use App\Models\OfferingVariation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BusinessOwnerMenuController extends Controller
{
    private function getActiveBusiness(Request $request): ?Business
    {
        return $request->user()->businesses()->first();
    }

    public function index(Request $request): JsonResponse
    {
        $businessId = $request->get('business_id');
        $business = $businessId
            ? $request->user()->businesses()->find($businessId)
            : $this->getActiveBusiness($request);

        if (! $business) {
            return $this->successResponse([
                'offerings' => [],
                'categories' => [],
                'stats' => [],
            ]);
        }

        $query = $business->offerings()->with('category');

        if ($s = $request->get('search')) {
            $query->where(function ($q) use ($s) {
                $q->where('name', 'like', "%{$s}%")
                    ->orWhere('description', 'like', "%{$s}%")
                    ->orWhereHas('category', fn ($cq) => $cq->where('name', 'like', "%{$s}%"));
            });
        }

        if ($cat = $request->get('category')) {
            if (str_starts_with($cat, 'cat:')) {
                $query->whereHas('category', fn ($cq) => $cq->where('name', substr($cat, 4)));
            } else {
                $query->where('offering_category_id', $cat);
            }
        }

        if ($st = $request->get('status')) {
            match ($st) {
                'available' => $query->where('is_available', true),
                'unavailable' => $query->where('is_available', false),
                'featured' => $query->where('bestseller', true),
                'out_of_stock' => $query->where('stock', '<=', 0)->where('is_available', true),
                'archived' => $query->where('status', 'archived'),
                default => $query->where('status', $st),
            };
        } else {
            $query->where('status', '!=', 'archived');
        }

        $sort = $request->get('sort', 'newest');
        match ($sort) {
            'oldest' => $query->orderBy('created_at'),
            'price_asc' => $query->orderBy('price'),
            'price_desc' => $query->orderBy('price', 'desc'),
            'name_asc' => $query->orderBy('name'),
            'name_desc' => $query->orderBy('name', 'desc'),
            'featured' => $query->orderBy('bestseller', 'desc')->orderBy('sort_order')->orderBy('name'),
            default => $query->orderBy('created_at', 'desc'),
        };

        $menuItems = $query->paginate($request->get('per_page', 24))->withQueryString();

        $categoryModels = $business->offeringCategories()->orderBy('sort_order')->get(['id', 'name']);
        $categories = $categoryModels
            ->map(fn ($c) => ['id' => (string) $c->id, 'name' => $c->name])
            ->values();

        $allOfferingIds = $business->offerings()->pluck('id');
        $baseStats = $business->offerings()->where('status', '!=', 'archived');
        $stats = [
            'total' => $baseStats->count(),
            'available' => (clone $baseStats)->where('is_available', true)->count(),
            'unavailable' => (clone $baseStats)->where('is_available', false)->count(),
            'hidden' => (clone $baseStats)->where('status', 'hidden')->count(),
            'archived' => $business->offerings()->where('status', 'archived')->count(),
            'featured' => (clone $baseStats)->where('bestseller', true)->count(),
        ];

        $orderCounts = DB::table('order_items')
            ->whereIn('offering_id', $allOfferingIds)
            ->select('offering_id', DB::raw('COUNT(*) as total_orders'))
            ->groupBy('offering_id')
            ->pluck('total_orders', 'offering_id');

        $items = $menuItems->through(function ($item) use ($orderCounts) {
            $resource = OfferingResource::make($item);
            $itemData = $resource->resolve();
            $itemData['sales_count'] = (int) ($orderCounts[$item->id] ?? 0);
            return $itemData;
        });

        return $this->successResponse(
            $items->values()->all(),
            'Menu items retrieved.',
            200,
            [
                'current_page' => $menuItems->currentPage(),
                'last_page' => $menuItems->lastPage(),
                'per_page' => $menuItems->perPage(),
                'total' => $menuItems->total(),
                'stats' => $stats,
                'categories' => $categories,
            ]
        );
    }

    public function store(Request $request): JsonResponse
    {
        $business = $this->getActiveBusiness($request);
        if (! $business) {
            return $this->notFoundResponse('No active business found.');
        }
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $validated = $request->validate([
            'offering_category_id' => ['nullable', 'integer', 'exists:offering_categories,id'],
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:5000'],
            'price' => ['required', 'numeric', 'min:0'],
            'compare_price' => ['nullable', 'numeric', 'min:0'],
            'status' => ['required', 'string', 'in:available,unavailable,hidden'],
            'image' => ['nullable', 'file', 'mimes:jpg,jpeg,png,webp', 'max:2048'],
            'images' => ['nullable', 'array'],
            'images.*' => ['file', 'mimes:jpg,jpeg,png,webp', 'max:2048'],
            'new_category' => ['nullable', 'string', 'max:255'],
            'bestseller' => ['nullable', 'boolean'],
            'unit' => ['nullable', 'string', 'max:50'],
            'stock' => ['nullable', 'integer', 'min:0'],
        ]);

        if (! empty($validated['new_category'])) {
            $cat = $business->offeringCategories()->create(['name' => $validated['new_category']]);
            $validated['offering_category_id'] = $cat->id;
        }
        unset($validated['new_category']);

        if ($request->hasFile('image')) {
            $validated['image'] = $request->file('image')->store('offerings', 'public');
        }

        if ($request->hasFile('images')) {
            $paths = [];
            foreach ($request->file('images') as $img) {
                $paths[] = $img->store('offerings', 'public');
            }
            $validated['images'] = $paths;
        }

        $validated['is_available'] = ($validated['status'] ?? 'available') === 'available';
        $validated['bestseller'] = $request->boolean('bestseller');
        $validated['type'] = 'product';
        $validated['has_variations'] = $request->boolean('has_variations');

        $offering = $business->offerings()->create($validated);

        $this->syncVariations($offering, $request);

        return $this->createdResponse(
            OfferingResource::make($offering->load('category', 'variations')),
            'Menu item added successfully.'
        );
    }

    public function update(Request $request, Offering $offering): JsonResponse
    {
        if ($offering->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $validated = $request->validate([
            'offering_category_id' => ['nullable', 'integer', 'exists:offering_categories,id'],
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:5000'],
            'price' => ['required', 'numeric', 'min:0'],
            'compare_price' => ['nullable', 'numeric', 'min:0'],
            'status' => ['required', 'string', 'in:available,unavailable,hidden,archived'],
            'image' => ['nullable', 'file', 'mimes:jpg,jpeg,png,webp', 'max:2048'],
            'images' => ['nullable', 'array'],
            'images.*' => ['file', 'mimes:jpg,jpeg,png,webp', 'max:2048'],
            'new_category' => ['nullable', 'string', 'max:255'],
            'bestseller' => ['nullable', 'boolean'],
            'unit' => ['nullable', 'string', 'max:50'],
            'stock' => ['nullable', 'integer', 'min:0'],
            'remove_image' => ['nullable', 'boolean'],
        ]);

        if (! empty($validated['new_category'])) {
            $cat = $offering->business->offeringCategories()->create(['name' => $validated['new_category']]);
            $validated['offering_category_id'] = $cat->id;
        }
        unset($validated['new_category']);

        if ($request->boolean('remove_image') && $offering->image) {
            \Illuminate\Support\Facades\Storage::disk('public')->delete($offering->image);
            $validated['image'] = null;
        }

        if ($request->hasFile('image')) {
            if ($offering->image) {
                \Illuminate\Support\Facades\Storage::disk('public')->delete($offering->image);
            }
            $validated['image'] = $request->file('image')->store('offerings', 'public');
        }

        if ($request->hasFile('images')) {
            $paths = [];
            foreach ($request->file('images') as $img) {
                $paths[] = $img->store('offerings', 'public');
            }
            $validated['images'] = $paths;
        }

        $validated['is_available'] = ($validated['status'] ?? 'available') === 'available';
        $validated['bestseller'] = $request->boolean('bestseller');
        $validated['has_variations'] = $request->boolean('has_variations');

        $offering->update($validated);

        $this->syncVariations($offering, $request);

        return $this->successResponse(
            OfferingResource::make($offering->fresh()->load('category', 'variations')),
            'Menu item updated successfully.'
        );
    }

    public function destroy(Request $request, Offering $offering): JsonResponse
    {
        if ($offering->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $offering->update(['status' => 'archived', 'is_available' => false]);

        return $this->noContentResponse('Menu item archived successfully.');
    }

    public function restore(Request $request, Offering $offering): JsonResponse
    {
        if ($offering->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $offering->update(['status' => 'available', 'is_available' => true]);

        return $this->successResponse(
            OfferingResource::make($offering->fresh()->load('category')),
            'Menu item restored successfully.'
        );
    }

    public function toggleStatus(Request $request, Offering $offering): JsonResponse
    {
        if ($offering->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $cycle = ['available' => 'unavailable', 'unavailable' => 'hidden', 'hidden' => 'available'];
        $new = $cycle[$offering->status] ?? 'available';

        $offering->update([
            'status' => $new,
            'is_available' => $new === 'available',
        ]);

        return $this->successResponse([
            'status' => $new,
        ], 'Status toggled successfully.');
    }

    public function toggleFeatured(Request $request, Offering $offering): JsonResponse
    {
        if ($offering->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $offering->update(['bestseller' => ! $offering->bestseller]);

        return $this->successResponse([
            'featured' => $offering->bestseller,
        ], 'Featured status updated.');
    }

    private function syncVariations(Offering $offering, Request $request): void
    {
        if (! $request->boolean('has_variations')) {
            $offering->variations()->delete();
            return;
        }

        $submittedIds = [];
        $variations = $request->input('variations', []);

        foreach ($variations as $index => $v) {
            $variationData = [
                'name' => $v['name'] ?? '',
                'price' => $v['price'] ?? 0,
                'compare_price' => $v['compare_price'] ?? null,
                'is_available' => $v['is_available'] ?? true,
                'sort_order' => $index,
            ];

            if (! empty($v['id'])) {
                $variation = $offering->variations()->find($v['id']);
                if ($variation) {
                    $variation->update($variationData);
                    $submittedIds[] = $variation->id;
                }
            } else {
                $variation = $offering->variations()->create($variationData);
                $submittedIds[] = $variation->id;
            }

            if ($request->hasFile("variations.{$index}.image")) {
                if ($variation->image) {
                    \Illuminate\Support\Facades\Storage::disk('public')->delete($variation->image);
                }
                $variation->update(['image' => $request->file("variations.{$index}.image")->store('offerings', 'public')]);
            }
        }

        if (! empty($submittedIds)) {
            $offering->variations()->whereNotIn('id', $submittedIds)->delete();
        } else {
            $offering->variations()->delete();
        }
    }
}
