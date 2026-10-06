<?php

namespace App\Http\Controllers;

use App\Models\Business;
use App\Models\Offering;
use App\Models\RestaurantSetting;
use App\Services\PreparationPredictionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BusinessOwnerPreparationController extends Controller
{
    /**
     * GET /business-owner/restaurants/{restaurant}/preparation-prediction/status
     */
    public function predictionStatus(Request $request, Business $restaurant): JsonResponse
    {
        if ($restaurant->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $service = app(PreparationPredictionService::class);
        $status = $service->getPredictionStatus($restaurant->id);

        return $this->successResponse($status);
    }

    /**
     * PATCH /business-owner/restaurants/{restaurant}/settings/preparation-prediction
     */
    public function togglePrediction(Request $request, Business $restaurant): JsonResponse
    {
        if ($restaurant->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $validated = $request->validate([
            'enabled' => 'required|boolean',
        ]);

        if ($validated['enabled']) {
            $service = app(PreparationPredictionService::class);
            if (! $service->hasEligibleItems($restaurant->id)) {
                return $this->errorResponse(
                    'Cannot enable prediction: no menu items meet the minimum 5-record requirement.',
                    422
                );
            }
        }

        $setting = $restaurant->getOrCreateRestaurantSetting();
        $setting->update(['auto_preparation_prediction_enabled' => $validated['enabled']]);

        return $this->successResponse(
            ['enabled' => $validated['enabled']],
            $validated['enabled']
                ? 'Auto preparation prediction enabled.'
                : 'Auto preparation prediction disabled.'
        );
    }

    /**
     * GET /business-owner/restaurants/{restaurant}/preparation-settings
     *
     * The restaurant-defined countdown configuration: optional priority-tip
     * preparation reductions (spec §12). Disabled by default — a tip's
     * primary effect is delivery/rider priority.
     */
    public function preparationSettings(Request $request, Business $restaurant): JsonResponse
    {
        if ($restaurant->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        return $this->successResponse($this->preparationSettingsPayload($restaurant));
    }

    /**
     * PATCH /business-owner/restaurants/{restaurant}/settings/preparation
     */
    public function updatePreparationSettings(Request $request, Business $restaurant): JsonResponse
    {
        if ($restaurant->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $validated = $request->validate([
            'priority_preparation_reduction_enabled' => 'required|boolean',
            'priority_reduction_minutes_25' => 'nullable|integer|min:0|max:60',
            'priority_reduction_minutes_50' => 'nullable|integer|min:0|max:60',
            'priority_reduction_minutes_100' => 'nullable|integer|min:0|max:60',
        ]);

        $restaurant->getOrCreateRestaurantSetting()->update($validated);

        return $this->successResponse(
            $this->preparationSettingsPayload($restaurant),
            'Preparation settings updated.'
        );
    }

    private function preparationSettingsPayload(Business $restaurant): array
    {
        $setting = $restaurant->getOrCreateRestaurantSetting();

        return [
            'priority_preparation_reduction_enabled' => (bool) $setting->priority_preparation_reduction_enabled,
            'priority_reduction_minutes_25' => (int) $setting->priority_reduction_minutes_25,
            'priority_reduction_minutes_50' => (int) $setting->priority_reduction_minutes_50,
            'priority_reduction_minutes_100' => (int) $setting->priority_reduction_minutes_100,
        ];
    }
}
