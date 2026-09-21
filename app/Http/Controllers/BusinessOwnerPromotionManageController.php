<?php

namespace App\Http\Controllers;

use App\Models\Promotion;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BusinessOwnerPromotionManageController extends Controller
{
    public function show(Request $request, int $id): JsonResponse
    {
        $promo = Promotion::where('business_id', $request->user()->businesses()->pluck('id'))->findOrFail($id);
        return $this->successResponse($promo);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $promo = Promotion::where('business_id', $request->user()->businesses()->pluck('id'))->findOrFail($id);
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
        $promo = Promotion::where('business_id', $request->user()->businesses()->pluck('id'))->findOrFail($id);
        $promo->delete();
        return $this->noContentResponse('Promotion deleted.');
    }
}
