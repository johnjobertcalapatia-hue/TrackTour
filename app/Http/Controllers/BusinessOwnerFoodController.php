<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BusinessOwnerFoodController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'business_id' => 'required|exists:businesses,id',
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
            'price' => 'required|numeric|min:0',
            'preparation_time' => 'nullable|integer|min:0|max:240',
            'offering_category_id' => 'nullable|integer|exists:offering_categories,id',
            'is_available' => 'boolean',
        ]);

        $validated['offering_type'] = 'food';
        $validated['status'] = 'active';
        $offering = $request->user()->businesses()->find($validated['business_id'])?->offerings()->create($validated);
        if (!$offering) {
            return $this->errorResponse('Business not found.', 404);
        }
        return $this->createdResponse($offering);
    }
}
