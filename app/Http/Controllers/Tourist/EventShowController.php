<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Models\Event;
use Illuminate\Http\JsonResponse;

class EventShowController extends Controller
{
    public function __invoke(int $id): JsonResponse
    {
        $event = Event::with('municipality')->findOrFail($id);

        return $this->successResponse($event);
    }
}
