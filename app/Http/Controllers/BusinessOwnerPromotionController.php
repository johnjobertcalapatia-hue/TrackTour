<?php

namespace App\Http\Controllers;

use App\Http\Requests\BusinessOwner\StorePromotionRequest;
use App\Http\Requests\BusinessOwner\UpdatePromotionRequest;
use App\Http\Resources\PromotionResource;
use App\Models\Business;
use App\Models\Offering;
use App\Models\Promotion;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BusinessOwnerPromotionController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');

        $promotions = Promotion::whereIn('business_id', $businessIds)
            ->with('business')
            ->latest()
            ->paginate(20);

        return $this->paginatedResponse(
            $promotions->through(fn ($p) => PromotionResource::make($p))
        );
    }

    public function store(StorePromotionRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $business = Business::findOrFail($validated['business_id']);

        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $promotion = $business->promotions()->create([
            'name' => $validated['title'],
            'description' => $validated['description'] ?? null,
            'type' => 'percentage',
            'value' => $validated['discount_percentage'],
            'start_date' => $validated['valid_from'],
            'end_date' => $validated['valid_until'],
            'is_active' => true,
        ]);

        return $this->createdResponse(
            PromotionResource::make($promotion->load('business')),
            'Promotion created successfully.'
        );
    }

    public function update(UpdatePromotionRequest $request, Promotion $promotion): JsonResponse
    {
        if ($promotion->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $validated = $request->validated();

        $data = [
            'name' => $validated['title'] ?? $promotion->name,
            'description' => $validated['description'] ?? $promotion->description,
            'value' => $validated['discount_percentage'],
            'start_date' => $validated['valid_from'],
            'end_date' => $validated['valid_until'],
        ];

        $promotion->update($data);

        return $this->successResponse(
            PromotionResource::make($promotion->fresh()->load('business')),
            'Promotion updated successfully.'
        );
    }

    public function toggleStatus(Request $request, Promotion $promotion): JsonResponse
    {
        if ($promotion->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $promotion->update(['is_active' => ! $promotion->is_active]);

        return $this->successResponse(
            PromotionResource::make($promotion->fresh()),
            'Promotion status updated.'
        );
    }

    public function destroy(Request $request, Promotion $promotion): JsonResponse
    {
        if ($promotion->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $promotion->update(['is_active' => false]);
        $promotion->delete();

        return $this->noContentResponse('Promotion archived successfully.');
    }

    public function featured(Request $request): JsonResponse
    {
        $businesses = $request->user()->businesses()->with('offerings', 'offerings.category')->get();

        return $this->successResponse($businesses->map(fn ($b) => [
            'id' => $b->id,
            'name' => $b->business_name,
            'offerings' => $b->offerings->map(fn ($o) => [
                'id' => $o->id,
                'name' => $o->name,
                'sort_order' => $o->sort_order,
                'category' => $o->category?->name,
            ]),
        ]));
    }

    public function updateFeatured(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'business_id' => ['required', 'integer', 'exists:businesses,id'],
            'offering_ids' => ['nullable', 'array'],
            'offering_ids.*' => ['integer', 'exists:offerings,id'],
        ]);

        $business = Business::findOrFail($validated['business_id']);

        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $business->offerings()->update(['sort_order' => 0]);

        if (! empty($validated['offering_ids'])) {
            Offering::whereIn('id', $validated['offering_ids'])
                ->where('business_id', $business->id)
                ->update(['sort_order' => 1]);
        }

        return $this->successResponse(null, 'Featured offerings updated successfully.');
    }
}
