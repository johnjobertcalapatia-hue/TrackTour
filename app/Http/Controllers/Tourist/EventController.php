<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Models\TourismEvent;
use Illuminate\Http\Request;

class EventController extends Controller
{
    public function index(Request $request)
    {
        $events = TourismEvent::where(function ($q) {
            $q->where('start_date', '>=', now())
                ->orWhere('end_date', '>=', now());
        })->with('municipality')->orderBy('start_date')->get();

        if ($request->expectsJson()) {
            return $this->successResponse(compact('events'));
        }

        return response()->json($events);
    }
}
