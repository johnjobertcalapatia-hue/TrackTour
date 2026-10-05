<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Delivery;
use Illuminate\Http\JsonResponse;

class AdminLiveController extends Controller
{
    public function deliveries(): JsonResponse
    {
        $deliveries = Delivery::with(['order', 'rider', 'codPurchases.business'])
            ->whereIn('status', ['assigned', 'arrived_pickup', 'picked_up', 'in_transit', 'arrived_destination'])
            ->get();

        return $this->successResponse($deliveries);
    }

    public function tours(): JsonResponse
    {
        return $this->successResponse([]);
    }

    public function sos(): JsonResponse
    {
        return $this->successResponse([]);
    }

    public function acknowledgeSos(string $id): JsonResponse
    {
        return $this->successResponse(null, 'SOS acknowledged.');
    }

    public function respondSos(string $id): JsonResponse
    {
        return $this->successResponse(null, 'Response dispatched.');
    }

    public function resolveSos(string $id): JsonResponse
    {
        return $this->successResponse(null, 'SOS resolved.');
    }
}
