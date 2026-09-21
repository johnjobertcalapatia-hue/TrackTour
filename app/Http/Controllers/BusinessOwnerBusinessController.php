<?php

namespace App\Http\Controllers;

use App\Http\Resources\BusinessResource;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BusinessOwnerBusinessController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user()->load('businesses.category', 'businesses.municipality', 'businesses.barangay');

        return $this->successResponse(
            BusinessResource::collection($user->businesses)
        );
    }

    public function switcher(Request $request): JsonResponse
    {
        $businesses = $request->user()->businesses()
            ->with('category')
            ->latest()
            ->get()
            ->map(fn ($b) => [
                'id' => $b->id,
                'name' => $b->business_name,
                'category' => $b->category?->name ?? 'Business',
                'status' => $b->status,
                'logo' => $b->logo,
                'module_codes' => $b->module_codes,
            ]);

        return $this->successResponse([
            'businesses' => $businesses,
            'selected_business_id' => null,
        ]);
    }

    public function create(): JsonResponse
    {
        $categories = BusinessCategory::select('id', 'name')->get();
        $municipalities = Municipality::with('barangays:id,name,municipality_id')->select('id', 'name')->get();

        return $this->successResponse(compact('categories', 'municipalities'));
    }
}
