<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Http\Requests\Tourist\CreateBookingRequest;
use App\Models\Booking;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Services\BookingService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class BookingController extends Controller
{
    public function __construct(private BookingService $bookingService) {}

    public function index(Request $request)
    {
        $accommodationCategories = BusinessCategory::whereIn('name', [
            'hotel', 'resort', 'inn', 'homestay',
        ])->orWhere(function ($q) {
            $q->where('name', 'like', '%hotel%')
                ->orWhere('name', 'like', '%resort%')
                ->orWhere('name', 'like', '%inn%')
                ->orWhere('name', 'like', '%homestay%');
        })->pluck('id');

        $rentalCategories = BusinessCategory::whereIn('name', [
            'rental', 'vehicle_rental', 'motorcycle_rental',
            'bicycle_rental', 'boat_rental', 'equipment_rental', 'cottage_rental',
        ])->orWhere(function ($q) {
            $q->where('name', 'like', '%rental%');
        })->pluck('id');

        $accommodations = Business::where('status', 'approved')
            ->whereIn('business_category_id', $accommodationCategories)
            ->with('category', 'municipality')
            ->paginate(12);

        $rentals = Business::where('status', 'approved')
            ->whereIn('business_category_id', $rentalCategories)
            ->with('category', 'municipality')
            ->paginate(12);

        if ($request->expectsJson()) {
            return $this->successResponse(compact('accommodations', 'rentals'));
        }

        return response()->json(compact('accommodations', 'rentals'));
    }

    public function show(Business $business, Request $request)
    {
        $offerings = $business->offerings()->with('category')->get();

        if ($request->expectsJson()) {
            return $this->successResponse(compact('business', 'offerings'));
        }

        return response()->json(compact('business', 'offerings'));
    }

    public function store(CreateBookingRequest $request, Business $business)
    {
        $validated = $request->validated();

        $booking = Booking::create([
            'booking_number' => 'BK-'.strtoupper(uniqid()),
            'business_id' => $business->id,
            'customer_name' => $validated['customer_name'],
            'customer_email' => Auth::user()->email,
            'customer_phone' => $validated['customer_phone'],
            'booking_type' => $validated['booking_type'],
            'status' => 'pending',
            'check_in_date' => $validated['check_in_date'],
            'check_out_date' => $validated['check_out_date'],
            'guests' => $validated['guests'],
            'notes' => $validated['notes'],
        ]);

        if ($request->expectsJson()) {
            return $this->createdResponse([
                'booking' => $booking,
            ], 'Booking request submitted! Your booking number is '.$booking->booking_number);
        }

        return redirect()->route('tourist.booking.index')
            ->with('success', 'Booking request submitted! Your booking number is '.$booking->booking_number);
    }

    public function cancel(Request $request, int $id)
    {
        $booking = Booking::where('customer_email', Auth::user()->email)->findOrFail($id);

        $cancellableStatuses = ['pending', 'confirmed'];

        if (! in_array($booking->status, $cancellableStatuses)) {
            if ($request->expectsJson()) {
                return $this->errorResponse('This booking can no longer be cancelled.', 422);
            }
            return back()->withErrors(['booking' => 'This booking can no longer be cancelled.']);
        }

        $validated = $request->validate([
            'reason' => 'nullable|string|max:500',
        ]);

        $booking->update([
            'status' => 'cancelled',
            'cancelled_by' => Auth::id(),
            'cancellation_reason' => $validated['reason'] ?? null,
            'cancelled_at' => now(),
        ]);

        if ($request->expectsJson()) {
            return $this->successResponse(null, 'Booking cancelled.');
        }

        return back()->with('success', 'Booking cancelled successfully.');
    }
}
