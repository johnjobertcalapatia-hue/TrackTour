<?php

namespace App\Http\Controllers;

use App\Http\Requests\BusinessOwner\UpdateBookingStatusRequest;
use App\Http\Resources\BookingResource;
use App\Models\Booking;
use App\Services\BookingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BusinessOwnerBookingController extends Controller
{
    public function __construct(
        private BookingService $bookingService
    ) {}

    public function index(Request $request): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');
        $filters = $request->only(['status', 'business_id', 'type', 'perPage']);
        $perPage = $filters['perPage'] ?? 20;

        $bookings = Booking::whereIn('business_id', $businessIds)
            ->with('business', 'items')
            ->when($filters['status'] ?? null, fn ($q, $s) => $q->where('status', $s))
            ->when($filters['business_id'] ?? null, fn ($q, $id) => $q->where('business_id', $id))
            ->when($filters['type'] ?? null, fn ($q, $t) => $q->where('booking_type', $t))
            ->latest()
            ->paginate($perPage);

        return $this->paginatedResponse(
            $bookings->through(fn ($b) => BookingResource::make($b))
        );
    }

    public function show(Request $request, Booking $booking): JsonResponse
    {
        if ($booking->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $booking->load('items', 'business');

        return $this->successResponse(BookingResource::make($booking));
    }

    public function updateStatus(UpdateBookingStatusRequest $request, Booking $booking): JsonResponse
    {
        if ($booking->business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $validated = $request->validated();

        $booking->update([
            'status' => $validated['status'],
            'cancellation_reason' => $validated['cancellation_reason'] ?? $validated['reason'] ?? null,
            'cancelled_at' => in_array($validated['status'], ['cancelled', 'rejected']) ? now() : null,
            'completed_at' => $validated['status'] === 'completed' ? now() : null,
        ]);

        $message = in_array($validated['status'], ['cancelled', 'rejected'])
            ? "Booking {$validated['status']}."
            : "Booking {$validated['status']} successfully.";

        return $this->successResponse(
            BookingResource::make($booking->fresh()->load('business', 'items')),
            $message
        );
    }

    public function calendar(Request $request): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');
        $businessId = $request->get('business_id');

        $bookings = Booking::whereIn('business_id', $businessIds)
            ->whereIn('status', ['pending', 'confirmed', 'in_progress'])
            ->when($businessId, fn ($q) => $q->where('business_id', $businessId))
            ->with('business')
            ->get(['id', 'business_id', 'customer_name', 'booking_type', 'status', 'check_in_date', 'check_out_date', 'guests']);

        return $this->successResponse($bookings, 'Calendar data retrieved.');
    }
}
