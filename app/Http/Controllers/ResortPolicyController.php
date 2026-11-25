<?php

namespace App\Http\Controllers;

use App\Models\Business;
use App\Models\ResortSetting;
use App\Services\ResortClassificationService;
use App\Support\ResortCancellationPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * A resort's cancellation policy (reservations Stage 7): free cancellation until
 * N days before check-in, then a penalty %, each inside the Tourism Office's
 * limits. New reservations keep the policy in force when they were made.
 */
class ResortPolicyController extends Controller
{
    /** GET /business-owner/businesses/{business}/resort-policy */
    public function show(Request $request, Business $business): JsonResponse
    {
        $this->authorizeResort($request, $business);

        return $this->successResponse($this->present($business));
    }

    /** PUT /business-owner/businesses/{business}/resort-policy */
    public function update(Request $request, Business $business): JsonResponse
    {
        $this->authorizeResort($request, $business);
        $limits = ResortCancellationPolicy::limits();
        $data = $request->validate([
            'free_days' => ['required', 'integer', 'min:'.$limits['free_days']['min'], 'max:'.$limits['free_days']['max']],
            'penalty_percent' => ['required', 'integer', 'min:'.$limits['penalty_percent']['min'], 'max:'.$limits['penalty_percent']['max']],
        ], [
            'free_days.min' => "Allowed: {$limits['free_days']['min']}–{$limits['free_days']['max']} days.",
            'free_days.max' => "Allowed: {$limits['free_days']['min']}–{$limits['free_days']['max']} days.",
            'penalty_percent.min' => "Allowed: {$limits['penalty_percent']['min']}–{$limits['penalty_percent']['max']}%.",
            'penalty_percent.max' => "Allowed: {$limits['penalty_percent']['min']}–{$limits['penalty_percent']['max']}%.",
        ]);

        ResortSetting::updateOrCreate(
            ['business_id' => $business->id],
            ['cancellation_free_days' => $data['free_days'], 'cancellation_penalty_percent' => $data['penalty_percent']]
        );

        return $this->successResponse($this->present($business->fresh()), 'Cancellation policy saved. It applies to new reservations.');
    }

    private function present(Business $business): array
    {
        $policy = ResortCancellationPolicy::forBusiness($business);

        return $policy + ['summary' => ResortCancellationPolicy::describe($policy), 'limits' => ResortCancellationPolicy::limits()];
    }

    private function authorizeResort(Request $request, Business $business): void
    {
        if ((int) $business->owner_id !== (int) $request->user()->id) {
            abort(403);
        }
        $business->loadMissing('category');
        if (! ResortClassificationService::isResort($business)) {
            abort(response()->json(['success' => false, 'message' => 'Cancellation policies are for Resort businesses.'], 422));
        }
    }
}
