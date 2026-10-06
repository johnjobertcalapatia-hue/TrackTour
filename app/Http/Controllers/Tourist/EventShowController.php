<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Models\TourismEvent;
use Illuminate\Http\JsonResponse;

class EventShowController extends Controller
{
    public function __invoke(int $id): JsonResponse
    {
        $event = TourismEvent::with('municipality')->findOrFail($id);

        return $this->successResponse($event);
    }
}
