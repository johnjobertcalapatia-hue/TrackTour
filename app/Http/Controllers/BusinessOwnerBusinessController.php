<?php

namespace App\Http\Controllers;

use App\Http\Resources\BusinessResource;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BusinessOwnerBusinessController extends Controller
{
    use \App\Http\Controllers\Concerns\ActsForBusiness;

    public function index(Request $request): JsonResponse
    {
        // Owner: their businesses; active staff: their one restaurant (Staff Management section 5).
        $businesses = $this->actingBusinesses($request)
            ->with('category', 'municipality', 'barangay')
            ->get();

        return $this->successResponse(
            BusinessResource::collection($businesses)
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
