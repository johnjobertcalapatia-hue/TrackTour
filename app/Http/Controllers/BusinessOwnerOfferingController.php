<?php

namespace App\Http\Controllers;

use App\Http\Resources\OfferingResource;
use App\Models\Business;
use App\Models\Offering;
use App\Models\OfferingCategory;
use App\Models\OrderItem;
use App\Models\Promotion;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class BusinessOwnerOfferingController extends Controller
{
    private function getActiveBusiness(Request $request): ?Business
    {
        return $request->user()->businesses()->first();
    }

    public function index(Request $request): JsonResponse
    {
        $business = $this->getActiveBusiness($request);

        if (! $business) {
            return $this->successResponse([
                'offerings' => [],
                'categories' => [],
                'stats' => [],
            ]);
        }

        $query = $business->offerings()->with(['category', 'business']);

        if ($s = $request->get('search')) {
            $query->where(function ($q) use ($s) {
                $q->where('name', 'like', "%{$s}%")
                    ->orWhere('description', 'like', "%{$s}%")
                    ->orWhereHas('category', fn ($cq) => $cq->where('name', 'like', "%{$s}%"));
            });
        }

        if ($cat = $request->get('category')) {
            $query->where('offering_category_id', $cat);
        }

        if ($st = $request->get('status')) {
            if ($st === 'visible') {
                $query->whereIn('status', ['available', 'unavailable']);
            } else {
                $query->where('status', $st);
            }
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

        $offerings = $query->paginate(24)->withQueryString();
        $categories = $business->offeringCategories()->orderBy('sort_order')->get();

        $activePromotionsCount = Promotion::where('business_id', $business->id)->active()->count();

        $stats = [
            'total' => $business->offerings()->count(),
            'available' => $business->offerings()->available()->count(),
            'unavailable' => $business->offerings()->unavailable()->count(),
            'hidden' => $business->offerings()->hidden()->count(),
            'active_promotions' => $activePromotionsCount,
            'featured' => $business->offerings()->featured()->count(),
        ];

        $offeringIds = $business->offerings()->pluck('id');
        $orderCounts = OrderItem::whereIn('offering_id', $offeringIds)
            ->select('offering_id', DB::raw('COUNT(*) as total_orders'), DB::raw('SUM(subtotal) as total_revenue'))
            ->groupBy('offering_id')
            ->pluck('total_orders', 'offering_id');

        return $this->paginatedResponse(
            $offerings->through(fn ($o) => OfferingResource::make($o)),
            'Offerings retrieved.'
        );
    }

    public function show(Request $request, Offering $offering): JsonResponse
    {
        if ($offering->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        return $this->successResponse(
            OfferingResource::make($offering->load('category')),
            'Offering details retrieved.'
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
            $category = $business->offeringCategories()->create(['name' => $validated['new_category']]);
            $validated['offering_category_id'] = $category->id;
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

        $validated['is_available'] = $validated['status'] === 'available';
        $validated['bestseller'] = $request->boolean('bestseller');

        $offering = $business->offerings()->create($validated);

        return $this->createdResponse(
            OfferingResource::make($offering->load('category')),
            'Offering added successfully.'
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
            $category = $offering->business->offeringCategories()->create(['name' => $validated['new_category']]);
            $validated['offering_category_id'] = $category->id;
        }
        unset($validated['new_category']);

        if ($request->hasFile('image')) {
            if ($offering->image) {
                Storage::disk('public')->delete($offering->image);
            }
            $validated['image'] = $request->file('image')->store('offerings', 'public');
        }

        if ($request->hasFile('images')) {
            $paths = $offering->images ?? [];
            foreach ($request->file('images') as $img) {
                $paths[] = $img->store('offerings', 'public');
            }
            $validated['images'] = $paths;
        }

        $validated['is_available'] = $validated['status'] === 'available';
        $validated['bestseller'] = $request->boolean('bestseller');

        $offering->update($validated);

        return $this->successResponse(
            OfferingResource::make($offering->fresh()->load('category')),
            'Offering updated successfully.'
        );
    }

    public function toggleStatus(Request $request, Offering $offering): JsonResponse
    {
        if ($offering->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $statuses = ['available', 'unavailable', 'hidden'];
        $currentIndex = array_search($offering->status, $statuses);
        $newStatus = $statuses[($currentIndex + 1) % 3];
        $offering->update(['status' => $newStatus, 'is_available' => $newStatus === 'available']);

        return $this->successResponse(['status' => $newStatus], 'Status toggled successfully.');
    }

    public function duplicate(Request $request, Offering $offering): JsonResponse
    {
        if ($offering->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $replica = $offering->replicate();
        $replica->name = $offering->name . ' (Copy)';
        $replica->save();

        return $this->createdResponse(
            OfferingResource::make($replica->load('category')),
            'Offering duplicated successfully.'
        );
    }

    public function bulkAction(Request $request): JsonResponse
    {
        $businessId = $request->get('business_id');
        $business = $businessId
            ? $request->user()->businesses()->find($businessId)
            : $this->getActiveBusiness($request);

        if (! $business) {
            return $this->notFoundResponse('No active business found.');
        }

        $validated = $request->validate([
            'action' => ['required', 'string', 'in:available,unavailable,hidden,featured,unfeatured,archive,delete'],
            'offering_ids' => ['required', 'array'],
            'offering_ids.*' => ['integer', 'exists:offerings,id'],
        ]);

        $offerings = $business->offerings()->whereIn('id', $validated['offering_ids']);

        match ($validated['action']) {
            'available' => $offerings->update(['status' => 'available', 'is_available' => true]),
            'unavailable' => $offerings->update(['status' => 'unavailable', 'is_available' => false]),
            'hidden' => $offerings->update(['status' => 'hidden', 'is_available' => false]),
            'featured' => $offerings->update(['bestseller' => true]),
            'unfeatured' => $offerings->update(['bestseller' => false]),
            'archive' => $offerings->update(['status' => 'archived', 'is_available' => false]),
            'delete' => $offerings->delete(),
        };

        return $this->successResponse(null, 'Bulk action completed successfully.');
    }

    public function setFeatured(Request $request, Offering $offering): JsonResponse
    {
        if ($offering->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $new = ! $offering->bestseller;
        $offering->update(['bestseller' => $new]);

        return $this->successResponse(['featured' => $new], 'Featured status updated.');
    }

    public function analytics(Request $request, Offering $offering): JsonResponse
    {
        if ($offering->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $orderStats = OrderItem::where('offering_id', $offering->id)
            ->selectRaw('COUNT(*) as total_orders')
            ->selectRaw('COALESCE(SUM(subtotal), 0) as total_revenue')
            ->first();

        return $this->successResponse([
            'orders' => (int) $orderStats->total_orders,
            'revenue' => (float) $orderStats->total_revenue,
        ]);
    }

    public function destroy(Request $request, Offering $offering): JsonResponse
    {
        if ($offering->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $offering->update(['status' => 'archived', 'is_available' => false]);
        $offering->delete();

        return $this->noContentResponse('Offering archived successfully.');
    }

    public function categories(Request $request): JsonResponse
    {
        $businesses = $request->user()->businesses()->with(['offeringCategories' => function ($q) {
            $q->withCount('offerings')->orderBy('sort_order');
        }])->get();

        return $this->successResponse($businesses->map(fn ($b) => [
            'id' => $b->id,
            'name' => $b->business_name,
            'categories' => $b->offeringCategories,
        ]));
    }

    public function getCategories(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        return $this->successResponse(
            $business->offeringCategories()->orderBy('sort_order')->get(['id', 'name'])
        );
    }

    public function storeCategory(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'business_id' => ['required', 'integer', 'exists:businesses,id'],
            'name' => ['required', 'string', 'max:255'],
            'icon' => ['nullable', 'string', 'max:64'],
            'description' => ['nullable', 'string', 'max:1000'],
        ]);

        $business = $request->user()->businesses()->findOrFail($validated['business_id']);
        $category = $business->offeringCategories()->create([
            'name' => $validated['name'],
            'icon' => $validated['icon'] ?? null,
            'description' => $validated['description'] ?? null,
        ]);

        return $this->createdResponse($category, 'Category created successfully.');
    }

    public function destroyCategory(Request $request, OfferingCategory $offeringCategory): JsonResponse
    {
        if ($offeringCategory->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $offeringCategory->delete();

        return $this->noContentResponse('Category deleted successfully.');
    }
}
