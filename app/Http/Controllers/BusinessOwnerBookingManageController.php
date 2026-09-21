<?php

namespace App\Http\Controllers;

use App\Models\Booking;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BusinessOwnerBookingManageController extends Controller
{
    public function updateStatus(Request $request, int $id): JsonResponse
    {
        $booking = Booking::where('business_id', $request->user()->businesses()->pluck('id'))->findOrFail($id);
        $validated = $request->validate([
            'status' => 'required|string|in:confirmed,completed,cancelled',
            'remarks' => 'nullable|string|max:500',
        ]);
        $booking->update(['status' => $validated['status']]);
        return $this->successResponse($booking->fresh());
    }
}
