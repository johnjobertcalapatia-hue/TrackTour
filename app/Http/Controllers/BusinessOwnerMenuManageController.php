<?php

namespace App\Http\Controllers;

use App\Models\Offering;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class BusinessOwnerMenuManageController extends Controller
{
    public function show(Request $request, int $id): JsonResponse
    {
        $offering = Offering::whereIn('business_id', $request->user()->businesses()->pluck('id'))->findOrFail($id);
        $offering->image = $this->resolveImageUrl($offering->image);
        return $this->successResponse($offering);
    }

    private function resolveImageUrl(?string $image): ?string
    {
        if (!$image) return null;
        if (str_starts_with($image, 'http://') || str_starts_with($image, 'https://')) {
            return $image;
        }
        return Storage::url($image);
    }

    public function store(Request $request): JsonResponse
    {
        $rules = [
            'business_id' => 'required|exists:businesses,id',
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
            'price' => 'required|numeric|min:0',
            'compare_price' => 'nullable|numeric|min:0',
            'offering_category_id' => 'nullable|integer|exists:offering_categories,id',
            'new_category' => 'nullable|string|max:255',
            'is_available' => 'boolean',
            'is_featured' => 'boolean',
            'stock' => 'nullable|integer|min:0',
            'unit' => 'nullable|string|max:50',
        ];

        if ($request->hasFile('image')) {
            $rules['image'] = 'nullable|file|mimes:jpg,jpeg,png,webp,gif,mp4,mov,avi|max:10240';
        } else {
            $rules['image'] = 'nullable|string|max:500';
        }

        $validated = $request->validate($rules);

        $business = $request->user()->businesses()->find($validated['business_id']);
        if (! $business) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        if (! empty($validated['new_category'])) {
            $cat = $business->offeringCategories()->create(['name' => $validated['new_category']]);
            $validated['offering_category_id'] = $cat->id;
        }
        unset($validated['new_category']);

        if ($request->hasFile('image')) {
            $validated['image'] = $request->file('image')->store('menu-items', 'public');
        }

        $validated['offering_type'] = 'menu';
        $validated['status'] = 'available';
        $validated['bestseller'] = $request->boolean('is_featured');
        unset($validated['is_featured']);
        $offering = Offering::create($validated);
        $offering->image = $this->resolveImageUrl($offering->image);

        return $this->createdResponse($offering);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $offering = Offering::whereIn('business_id', $request->user()->businesses()->pluck('id'))->findOrFail($id);

        $data = $request->only(['name', 'description', 'price', 'compare_price', 'offering_category_id', 'is_available', 'stock', 'unit']);
        $data = array_filter($data, fn ($value) => $value !== null);

        if ($request->has('new_category') && ! empty($request->input('new_category'))) {
            $cat = $offering->business->offeringCategories()->create(['name' => $request->input('new_category')]);
            $data['offering_category_id'] = $cat->id;
        }

        if ($request->has('is_featured')) {
            $data['bestseller'] = $request->boolean('is_featured');
        }

        if ($request->hasFile('image')) {
            $request->validate(['image' => 'nullable|file|mimes:jpg,jpeg,png,webp,gif,mp4,mov,avi|max:10240']);
            if ($offering->image) {
                Storage::disk('public')->delete($offering->image);
            }
            $data['image'] = $request->file('image')->store('menu-items', 'public');
        } elseif ($request->has('image')) {
            $data['image'] = $request->input('image');
        }

        if (! empty($data)) {
            $offering->update($data);
        }
        $offering = $offering->fresh();
        $offering->image = $this->resolveImageUrl($offering->image);

        return $this->successResponse($offering);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $offering = Offering::whereIn('business_id', $request->user()->businesses()->pluck('id'))->findOrFail($id);
        if ($offering->image) {
            Storage::disk('public')->delete($offering->image);
        }
        $offering->delete();
        return $this->noContentResponse('Menu item deleted.');
    }
}
