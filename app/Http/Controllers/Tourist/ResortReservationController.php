<?php

namespace App\Http\Controllers\Tourist;

use App\Exceptions\ResortUnavailableException;
use App\Http\Controllers\Controller;
use App\Http\Resources\BookingResource;
use App\Models\Booking;
use App\Models\Business;
use App\Services\ResortReservationService;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Tourist resort reservations (Stage 7, docs/resort-reservation-architecture.md §11):
 * price a stay, reserve it (pay at the resort), see it and cancel it before check-in.
 */
class ResortReservationController extends Controller
{
    public function __construct(private ResortReservationService $reservations) {}

    /** POST /tourist/resorts/{business}/quote — public, read-only. */
    public function quote(Request $request, Business $business): JsonResponse
    {
        $input = $this->validateStay($request);

        return $this->run(fn () => $this->successResponse($this->reservations->quote($business, $input)));
    }

    /** POST /tourist/resorts/{business}/reservations */
    public function store(Request $request, Business $business): JsonResponse
    {
        $input = $this->validateStay($request) + $request->validate([
            'customer_name' => ['required', 'string', 'min:2', 'max:255'],
            'customer_phone' => ['required', 'string', 'max:20'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'payment_option' => ['nullable', 'in:pay_at_resort,gcash'],
            'client_reference' => ['nullable', 'string', 'max:64'],
        ]);
        return $this->run(function () use ($request, $business, $input) {
            $booking = $this->reservations->create($request->user(), $business, $input);

            return $this->createdResponse(
                $this->present($booking->load('business')),
                $booking->payment_option === 'gcash'
                    ? 'Reservation held for '.ResortReservationService::HOLD_MINUTES.' minutes. Pay with GCash to send it to the resort.'
                    : "Reservation sent. {$booking->business->business_name} will confirm it soon."
            );
        });
    }

    /** GET /tourist/reservations/{booking} */
    public function show(Request $request, Booking $booking): JsonResponse
    {
        if ((int) $booking->user_id !== (int) $request->user()->id || ! $booking->isResortReservation()) {
            return $this->notFoundResponse('Reservation not found.');
        }

        return $this->successResponse($this->present($booking->load('business', 'items', 'statusLogs')));
    }

    /** POST /tourist/reservations/{booking}/cancel — any time before the check-in date. */
    public function cancel(Request $request, Booking $booking): JsonResponse
    {
        if ((int) $booking->user_id !== (int) $request->user()->id || ! $booking->isResortReservation()) {
            return $this->notFoundResponse('Reservation not found.');
        }
        $reason = $request->validate(['reason' => ['nullable', 'string', 'max:500']])['reason'] ?? null;

        return $this->run(fn () => $this->successResponse(
            $this->present($this->reservations->cancelByTourist($booking, $request->user(), $reason)->load('business')),
            'Reservation cancelled.'
        ));
    }

    private function present(Booking $booking): array
    {
        return BookingResource::make($booking)->resolve() + [
            'can_cancel' => $this->reservations->touristCanCancel($booking),
            // Stage 8: GCash hold, what cancelling now would give back, and refunds.
            'payment_due_at' => $booking->payment_due_at,
            'awaiting_payment' => $this->reservations->awaitingPayment($booking) && $booking->status === Booking::STATUS_PENDING,
            'cancel_refund' => $this->reservations->cancelRefundPreview($booking),
            'refund' => $this->reservations->refundInfo($booking),
        ];
    }

    /** @return array{check_in: string, check_out: ?string, guests: int, lines: list<array>} */
    private function validateStay(Request $request): array
    {
        return $request->validate([
            'check_in' => ['required', 'date_format:Y-m-d'],
            'check_out' => ['nullable', 'date_format:Y-m-d'],
            'guests' => ['required', 'integer', 'min:1', 'max:'.ResortReservationService::MAX_GUESTS],
            'lines' => ['required', 'array', 'min:1', 'max:30'],
            'lines.*.offering_id' => ['required', 'integer'],
            'lines.*.quantity' => ['required', 'integer', 'min:1', 'max:1000'],
            'lines.*.guests' => ['nullable', 'integer', 'min:1', 'max:1000'],
            'lines.*.slot' => ['nullable', 'date_format:H:i'],
        ]);
    }

    private function run(callable $action): JsonResponse
    {
        try {
            return $action();
        } catch (ResortUnavailableException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage(), 'problems' => $e->problems], 422);
        } catch (DomainException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }
    }
}
