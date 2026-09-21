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
}
