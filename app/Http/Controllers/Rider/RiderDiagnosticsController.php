<?php

namespace App\Http\Controllers\Rider;

use App\Http\Controllers\Controller;
use App\Services\RiderDiagnosticsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Rider self-diagnostics (2026-11-10): GET runs the checks read-only;
 * POST /repair fixes what is safe to fix so the rider can repeat the step.
 */
class RiderDiagnosticsController extends Controller
{
    public function __construct(private RiderDiagnosticsService $diagnostics) {}

    public function show(Request $request): JsonResponse
    {
        return $this->successResponse($this->diagnostics->run($request->user()));
    }

    public function repair(Request $request): JsonResponse
    {
        $data = $request->validate([
            'latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude'],
            'accuracy' => ['nullable', 'numeric', 'min:0'],
        ]);

        $fix = isset($data['latitude'], $data['longitude'])
            ? ['latitude' => (float) $data['latitude'], 'longitude' => (float) $data['longitude'], 'accuracy' => isset($data['accuracy']) ? (float) $data['accuracy'] : null]
            : null;

        $result = $this->diagnostics->run($request->user(), true, $fix);

        return $this->successResponse($result, $result['repaired'] === []
            ? 'Nothing needed fixing.'
            : 'Fixed '.count($result['repaired']).' problem(s). You can try the step again.');
    }
}
