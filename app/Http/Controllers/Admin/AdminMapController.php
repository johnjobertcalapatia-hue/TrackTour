<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Business;
use Illuminate\Http\JsonResponse;

class AdminMapController extends Controller
{
    public function index(): JsonResponse
    {
        $businesses = Business::query()
            ->select(['id', 'business_name', 'municipality_id', 'latitude', 'longitude', 'address', 'status'])
            ->with(['category:id,name', 'municipality:id,name'])
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->get()
            ->map(fn ($b) => [
                'id' => $b->id,
                'name' => $b->business_name,
                'lat' => (float) $b->latitude,
                'lng' => (float) $b->longitude,
                'address' => $b->address,
                'category' => $b->category?->name,
                'status' => $b->status,
                'municipality' => $b->municipality?->name,
            ]);

        return response()->json([
            'success' => true,
            'data' => [
                'businesses' => $businesses,
            ],
        ]);
    }
}
