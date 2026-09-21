<?php

namespace App\Http\Controllers\Staff;

use App\Http\Controllers\Controller;
use App\Models\Offering;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class StaffMenuController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $offerings = Offering::where('business_id', $request->user()->staff?->business_id)
            ->with('category')
            ->orderBy('sort_order')
            ->latest()
            ->get();

        $data = $offerings->map(fn ($o) => array_merge($o->toArray(), [
            'category' => $o->category?->name ?? '',
        ]));

        return $this->successResponse($data);
    }

    public function categories(Request $request): JsonResponse
    {
        $categories = \App\Models\OfferingCategory::where('business_id', $request->user()->staff?->business_id)
            ->where('is_available', true)
            ->orderBy('sort_order')
            ->get(['id', 'name', 'icon']);

        return $this->successResponse($categories);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $offering = Offering::where('business_id', $request->user()->staff?->business_id)->findOrFail($id);

        return $this->successResponse($offering);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
            'price' => 'required|numeric|min:0',
            'offering_category_id' => 'nullable|integer|exists:offering_categories,id',
            'image' => 'nullable|string',
            'is_available' => 'boolean',
        ]);

        $validated['business_id'] = $request->user()->staff?->business_id;
        $validated['offering_type'] = 'menu';
        $validated['status'] = 'active';

        $offering = Offering::create($validated);

        return $this->createdResponse($offering);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $offering = Offering::where('business_id', $request->user()->staff?->business_id)->findOrFail($id);
        $offering->update($request->only(['name', 'description', 'price', 'offering_category_id', 'image', 'is_available']));

        return $this->successResponse($offering->fresh());
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $offering = Offering::where('business_id', $request->user()->staff?->business_id)->findOrFail($id);
        $offering->delete();

        return $this->noContentResponse('Menu item deleted.');
    }
}
