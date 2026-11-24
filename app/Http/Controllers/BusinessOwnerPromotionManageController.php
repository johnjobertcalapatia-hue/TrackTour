<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ActsForBusiness;
use App\Models\Promotion;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BusinessOwnerPromotionManageController extends Controller
{
    use ActsForBusiness;

    public function show(Request $request, int $id): JsonResponse
    {
        $promo = Promotion::whereIn('business_id', $this->actingBusinessIds($request))->findOrFail($id);
        // The resource gives the page title / discount_type / dates (the raw model did not).
        return $this->successResponse(\App\Http\Resources\PromotionResource::make($promo->load('business')));
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $promo = Promotion::whereIn('business_id', $this->actingBusinessIds($request))->findOrFail($id);
        $validated = $request->validate([
            'title' => 'sometimes|string|max:255',
            'description' => 'sometimes|string',
            'discount_type' => 'sometimes|string',
            'discount_value' => 'sometimes|numeric',
            'start_date' => 'sometimes|date',
            'end_date' => 'sometimes|date',
            'is_featured' => 'sometimes|boolean',
        ]);
        $promo->update($validated);
        return $this->successResponse($promo->fresh());
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $promo = Promotion::whereIn('business_id', $this->actingBusinessIds($request))->findOrFail($id);
        $promo->delete();
        return $this->noContentResponse('Promotion deleted.');
    }
}
