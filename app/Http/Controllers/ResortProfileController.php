<?php

namespace App\Http\Controllers;

use App\Models\Business;
use App\Models\ResortFacility;
use App\Models\ResortType;
use App\Services\ResortClassificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Resort classification (dynamic resort system, Stage 1):
 *   GET  /api/resort-catalogue                                     public: all types + facilities
 *   GET  /api/business-owner/businesses/{business}/resort-profile  owner: this resort's selections
 *   PUT  /api/business-owner/businesses/{business}/resort-profile  owner: set types (≥1), facilities, custom facilities
 * Resort-category businesses only (scope decision).
 */
class ResortProfileController extends Controller
{
    public function catalogue(): JsonResponse
    {
        return $this->successResponse([
            'types' => ResortType::orderBy('sort_order')->get(['id', 'slug', 'name', 'description']),
            'facilities' => ResortFacility::orderBy('sort_order')->get(['id', 'slug', 'name']),
        ]);
    }

    public function show(Request $request, Business $business): JsonResponse
    {
        $this->authorizeResort($request, $business);

        return $this->successResponse(self::present($business));
    }

    public function update(Request $request, Business $business): JsonResponse
    {
        $this->authorizeResort($request, $business);

        $validated = $request->validate([
            'resort_type_ids' => ['required', 'array', 'min:1'],
            'resort_type_ids.*' => ['integer', 'distinct', 'exists:resort_types,id'],
            'facility_ids' => ['nullable', 'array'],
            'facility_ids.*' => ['integer', 'distinct', 'exists:resort_facilities,id'],
            'custom_facilities' => ['nullable', 'array', 'max:20'],
            'custom_facilities.*' => ['string', 'max:100'],
        ]);

        DB::transaction(function () use ($business, $validated) {
            $business->resortTypes()->sync($validated['resort_type_ids']);
            $business->resortFacilities()->sync($validated['facility_ids'] ?? []);

            $names = collect($validated['custom_facilities'] ?? [])
                ->map(fn ($n) => trim(preg_replace('/\s+/', ' ', $n)))
                ->filter()
                ->unique(fn ($n) => mb_strtolower($n))
                ->values();
            $business->resortCustomFacilities()->whereNotIn('name', $names)->delete();
            foreach ($names as $name) {
                $business->resortCustomFacilities()->firstOrCreate(['name' => $name]);
            }
        });

        return $this->successResponse(self::present($business->fresh()), 'Resort details saved.');
    }

    /** Shape shared by the owner API and the tourist place page. */
    public static function present(Business $business): array
    {
        $business->loadMissing('resortTypes', 'resortFacilities', 'resortCustomFacilities');

        return [
            'types' => $business->resortTypes->map(fn ($t) => ['id' => $t->id, 'slug' => $t->slug, 'name' => $t->name])->values(),
            'facilities' => $business->resortFacilities->map(fn ($f) => ['id' => $f->id, 'slug' => $f->slug, 'name' => $f->name])->values(),
            'custom_facilities' => $business->resortCustomFacilities->pluck('name')->values(),
        ];
    }

    private function authorizeResort(Request $request, Business $business): void
    {
        if ((int) $business->owner_id !== (int) $request->user()->id) {
            abort(403);
        }
        $business->loadMissing('category');
        if (! ResortClassificationService::isResort($business)) {
            abort(response()->json(['success' => false, 'message' => 'Resort details are only for Resort businesses.'], 422));
        }
    }
}
