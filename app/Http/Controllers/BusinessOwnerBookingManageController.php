<?php

namespace App\Http\Controllers;

use App\Http\Resources\BookingResource;
use App\Models\Booking;
use App\Services\ResortReservationService;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BusinessOwnerBookingManageController extends Controller
{
    public function __construct(private ResortReservationService $reservations) {}

    /**
     * PATCH /business-owner/bookings/{id}/status
     *
     * Resort reservations (Stage 7) go through ResortReservationService: confirm,
     * reject (reason), cancel (reason), complete or no-show, with the units released
     * on reject / cancel / no-show, a status log and a notice to the tourist.
     * Other bookings keep the simple status update.
     */
    public function updateStatus(Request $request, int $id): JsonResponse
    {
        // whereIn: an owner may have several businesses (was where(..., collection)).
        $booking = Booking::whereIn('business_id', $request->user()->businesses()->pluck('id'))->findOrFail($id);

        if ($booking->isResortReservation()) {
            $validated = $request->validate([
                'status' => 'required|string|in:confirmed,rejected,cancelled,completed,no_show',
                'reason' => 'nullable|string|max:500',
                'remarks' => 'nullable|string|max:500',
            ]);
            $reason = (string) ($validated['reason'] ?? $validated['remarks'] ?? '');
            $user = $request->user();

            try {
                $updated = match ($validated['status']) {
                    'confirmed' => $this->reservations->confirm($booking, $user, 'owner'),
                    'rejected' => $this->reservations->reject($booking, $user, 'owner', $reason),
                    'cancelled' => $this->reservations->cancelByOwner($booking, $user, 'owner', $reason),
                    'completed' => $this->reservations->complete($booking, $user, 'owner'),
                    'no_show' => $this->reservations->noShow($booking, $user, 'owner'),
                };
            } catch (DomainException $e) {
                return $this->errorResponse($e->getMessage(), 422);
            }

            return $this->successResponse(
                BookingResource::make($updated->load('business'))->resolve() + ['actions' => $this->reservations->ownerActions($updated), 'refund' => $this->reservations->refundInfo($updated)],
                'Reservation updated.'
            );
        }

        $validated = $request->validate([
            'status' => 'required|string|in:confirmed,completed,cancelled',
            'remarks' => 'nullable|string|max:500',
        ]);
        $booking->update(['status' => $validated['status']]);

        return $this->successResponse($booking->fresh());
    }
}
