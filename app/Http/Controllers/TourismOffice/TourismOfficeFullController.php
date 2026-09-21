<?php

namespace App\Http\Controllers\TourismOffice;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\Business;
use App\Models\Booking;
use App\Models\Order;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TourismOfficeFullController extends Controller
{
    public function dashboard(Request $request): JsonResponse
    {
        return $this->successResponse([
            'stats' => [
                'total_business_owners' => User::where('role', 'business_owner')->count(),
                'approved_owners' => User::where('role', 'business_owner')->where('account_status', 'approved')->count(),
                'pending_owners' => User::where('role', 'business_owner')->where('account_status', 'pending')->count(),
            ],
            'tourism' => [
                'total_destinations' => \App\Models\TouristDestination::count(),
                'active_destinations' => \App\Models\TouristDestination::where('status', 'active')->count(),
                'total_events' => \App\Models\TourismEvent::count(),
                'upcoming_events' => \App\Models\TourismEvent::where('start_date', '>=', now())->count(),
                'total_announcements' => \App\Models\TourismAnnouncement::count(),
                'published_announcements' => \App\Models\TourismAnnouncement::where('status', 'published')->count(),
            ],
            'recent_businesses' => [],
            'top_municipalities' => [],
        ]);
    }

    public function showBusinessOwner(int $id): JsonResponse
    {
        $user = User::with('businesses')->findOrFail($id);

        return $this->successResponse(UserResource::make($user));
    }

    public function updateBusinessOwnerStatus(Request $request, int $id): JsonResponse
    {
        $user = User::findOrFail($id);

        $validated = $request->validate([
            'status' => 'required|string|in:approved,rejected,suspended',
            'remarks' => 'nullable|string|max:500',
        ]);

        $user->update(['account_status' => $validated['status']]);

        return $this->successResponse(UserResource::make($user->fresh()), 'Status updated.');
    }

    public function reports(Request $request): JsonResponse
    {
        return $this->successResponse([
            'total_tourists' => User::where('role', 'tourist')->count(),
            'total_businesses' => Business::count(),
            'approved_businesses' => Business::where('status', 'approved')->count(),
            'total_orders' => Order::count(),
            'total_bookings' => Booking::count(),
        ]);
    }
}
