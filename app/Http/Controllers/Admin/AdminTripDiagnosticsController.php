<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Delivery;
use App\Services\TripPathDiagnostics;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;

/**
 * Tourism Office trip diagnostics (2026-11-12). Shows a delivery's canonical
 * path (every step done / current / to do), applies the same safe FIXES the
 * rider can, and — Tourism Office only — RESETS a recorded step so it must be
 * done again, with a written reason. Nothing marks a step done that was not.
 */
class AdminTripDiagnosticsController extends Controller
{
    public function __construct(private TripPathDiagnostics $diagnostics) {}

    public function show(Delivery $delivery): JsonResponse
    {
        return $this->successResponse($this->diagnostics->diagnose($delivery));
    }

    public function fix(Request $request, Delivery $delivery): JsonResponse
    {
        $result = $this->diagnostics->diagnose($delivery, true, $request->user());

        return $this->successResponse($result, $result['repaired'] === []
            ? 'Nothing needed fixing.'
            : 'Fixed '.count($result['repaired']).' problem(s).');
    }

    public function reset(Request $request, Delivery $delivery): JsonResponse
    {
        $data = $request->validate([
            'action' => ['required', 'string', 'in:'.TripPathDiagnostics::RESET_PICKUP_ARRIVAL.','.TripPathDiagnostics::RESET_DROPOFF_ARRIVAL],
            'business_id' => ['nullable', 'integer', 'required_if:action,'.TripPathDiagnostics::RESET_PICKUP_ARRIVAL],
            'reason' => ['required', 'string', 'min:10', 'max:500'],
        ]);

        try {
            $result = $this->diagnostics->reset($delivery, $data['action'], $data['business_id'] ?? null, $data['reason'], $request->user());
        } catch (InvalidArgumentException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }

        return $this->successResponse($result, $result['reset']);
    }
}
