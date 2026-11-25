<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Staff\StaffUpdateBookingStatusRequest;
use App\Http\Resources\BookingResource;
use App\Http\Resources\OrderResource;
use App\Models\Booking;
use App\Models\Order;
use App\Services\StaffAccess;
use App\Services\StaffService;
use App\Support\StaffPermissions;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class StaffDashboardApiController extends Controller
{
    public function __construct(private StaffService $staffService) {}

    /**
     * The active staff record set by the staff.active middleware (Staff
     * Management Stage 1); never a pending, suspended or removed one.
     */
    private function context(Request $request): ?array
    {
        $staff = $request->attributes->get('staff') ?? app(StaffAccess::class)->activeStaff($request->user());

        return $staff ? ['staff' => $staff, 'business' => $staff->business] : null;
    }

    /**
     * Orders containing the business's items: a group checkout's canonical
     * order is included for every participating restaurant (AGENTS.md 4.1).
     */
    private function ordersFor(int $businessId): Builder
    {
        return Order::where(fn ($q) => $q->where('business_id', $businessId)
            ->orWhereHas('items', fn ($items) => $items->where('business_id', $businessId)));
    }

    /** GET /staff/me: who the staff member is and what they may do (drives the staff menu). */
    public function me(Request $request): JsonResponse
    {
        $ctx = $this->context($request);
        $staff = $ctx['staff'];
        $granted = $staff->grantedPermissions();

        return $this->successResponse([
            'staff' => [
                'id' => $staff->id,
                'full_name' => $staff->full_name,
                'employee_id' => $staff->employee_id,
                'role' => $staff->staffRole?->name ?? 'Staff',
                'profile_picture' => $staff->profile_picture,
            ],
            'business' => [
                'id' => $ctx['business']->id,
                'name' => $ctx['business']->business_name,
                'category' => $ctx['business']->category?->name,
                'logo' => $ctx['business']->logo,
            ],
            'permissions' => $granted,
            'permission_labels' => collect(StaffPermissions::CATALOGUE)->only($granted)->map(fn ($meta) => $meta[1]),
        ]);
    }

    public function dashboard(Request $request): JsonResponse
    {
        $ctx = $this->context($request);
        if (! $ctx) {
            return $this->notFoundResponse('No staff profile found.');
        }

        $staff = $ctx['staff'];
        $business = $ctx['business'];

        // Each section only with its permission (Staff Stage 1).
        $granted = $staff->grantedPermissions();
        $canOrders = in_array(StaffPermissions::ORDERS_VIEW, $granted, true);
        $canBookings = in_array(StaffPermissions::BOOKINGS_VIEW, $granted, true);

        $todaySummary = array_merge(
            $canOrders ? $this->getOrderSummary($business->id) : [],
            $canBookings ? $this->getBookingSummary($business->id) : []
        );

        $recentOrders = $canOrders
            ? $this->ordersFor($business->id)->with('items')->latest()->take(10)->get()
            : collect();

        $recentBookings = $canBookings
            ? Booking::where('business_id', $business->id)->latest()->take(10)
                ->get(['id', 'booking_number', 'customer_name', 'booking_type', 'status', 'check_in_date', 'check_out_date', 'total_amount', 'created_at'])
            : collect();

        $dashboardType = 'generic';
        if (method_exists($business, 'isRestaurant') && $business->isRestaurant()) {
            $dashboardType = 'orders';
        } elseif (method_exists($business, 'isAccommodation') && $business->isAccommodation()) {
            $dashboardType = 'bookings';
        }

        return $this->successResponse([
            'staff' => [
                'id' => $staff->id,
                'full_name' => $staff->full_name,
                'employee_id' => $staff->employee_id,
                'status' => $staff->status,
                'role' => $staff->staffRole?->name ?? 'Staff',
                'profile_picture' => $staff->profile_picture,
            ],
            'business' => [
                'id' => $business->id,
                'name' => $business->business_name,
                'category' => $business->category?->name ?? 'Business',
                'status' => $business->status,
            ],
            'dashboard_type' => $dashboardType,
            'permissions' => $granted,
            'today_summary' => $todaySummary,
            'recent_orders' => OrderResource::collection($recentOrders),
            'recent_bookings' => BookingResource::collection($recentBookings),
        ]);
    }

    public function bookings(Request $request): JsonResponse
    {
        $ctx = $this->context($request);
        if (! $ctx) {
            return $this->notFoundResponse('No staff profile found.');
        }

        $business = $ctx['business'];
        $status = $request->get('status', 'all');
        $type = $request->get('type');
        $search = $request->get('search');

        // Stage 8: unpaid GCash holds are not reservations for staff yet.
        $query = Booking::where('business_id', $business->id)->where('payment_status', '!=', 'awaiting_payment')->with('items');

        if ($status && $status !== 'all') {
            $query->where('status', $status);
        }
        if ($type) {
            $query->where('booking_type', $type);
        }
        if ($search) {
            $query->where(function ($q) use ($search) {
                $q->where('booking_number', 'like', "%{$search}%")
                    ->orWhere('customer_name', 'like', "%{$search}%");
            });
        }

        $bookings = $query->latest()->paginate(20)->withQueryString();

        $statusCounts = Booking::where('business_id', $business->id)
            ->selectRaw('status, count(*) as count')
            ->groupBy('status')
            ->pluck('count', 'status');

        $todaySummary = $this->getBookingSummary($business->id);

        return $this->successResponse([
            'bookings' => BookingResource::collection($bookings),
            'status_counts' => $statusCounts,
            'today_summary' => $todaySummary,
            'pagination' => [
                'current_page' => $bookings->currentPage(),
                'last_page' => $bookings->lastPage(),
                'per_page' => $bookings->perPage(),
                'total' => $bookings->total(),
            ],
        ], 'Bookings retrieved.');
    }

    public function updateBookingStatus(StaffUpdateBookingStatusRequest $request, Booking $booking): JsonResponse
    {
        $ctx = $this->context($request);
        if (! $ctx || (int) $booking->business_id !== (int) $ctx['business']->id) {
            return $this->forbiddenResponse('Unauthorized.');
        }

        // Resort reservations (Stage 7): the same rules as the owner (units released, logged, tourist told).
        if ($booking->isResortReservation()) {
            $service = app(\App\Services\ResortReservationService::class);
            $reason = (string) ($request->cancellation_reason ?? '');
            $user = $request->user();
            try {
                match ($request->status) {
                    'confirmed' => $service->confirm($booking, $user, 'staff'),
                    'rejected' => $service->reject($booking, $user, 'staff', $reason),
                    'cancelled' => $service->cancelByOwner($booking, $user, 'staff', $reason),
                    'completed' => $service->complete($booking, $user, 'staff'),
                    'no_show' => $service->noShow($booking, $user, 'staff'),
                    default => throw new \DomainException('That status is not used for resort reservations.'),
                };
            } catch (\DomainException $e) {
                return $this->errorResponse($e->getMessage(), 422);
            }

            return $this->successResponse(null, "Reservation status updated to {$request->status}.");
        }

        $booking->update([
            'status' => $request->status,
            'cancellation_reason' => $request->cancellation_reason ?? null,
            'cancelled_at' => in_array($request->status, ['cancelled', 'rejected']) ? now() : null,
            'completed_at' => $request->status === 'completed' ? now() : null,
        ]);

        return $this->successResponse(null, "Booking status updated to {$request->status}.");
    }

    private function getOrderSummary(int $businessId): array
    {
        $today = now()->today();
        $startOfDay = $today->copy()->startOfDay();
        $endOfDay = $today->copy()->endOfDay();

        $base = $this->ordersFor($businessId);

        return [
            'pending' => (clone $base)->whereIn('status', ['pending_payment', 'waiting_restaurant'])->count(),
            'confirmed' => (clone $base)->whereIn('status', ['accepted', 'preparing', 'ready'])->count(),
            'in_progress' => (clone $base)->whereIn('status', ['preparing', 'ready'])->count(),
            'completed_today' => (clone $base)->where('status', 'completed')
                ->whereBetween('completed_at', [$startOfDay, $endOfDay])->count(),
            'cancelled_today' => (clone $base)->whereIn('status', ['cancelled', 'rejected'])
                ->whereBetween('cancelled_at', [$startOfDay, $endOfDay])->count(),
        ];
    }

    private function getBookingSummary(int $businessId): array
    {
        $today = now()->today();
        $startOfDay = $today->copy()->startOfDay();
        $endOfDay = $today->copy()->endOfDay();

        $base = Booking::where('business_id', $businessId);

        return [
            'pending' => (clone $base)->where('status', 'pending')->count(),
            'confirmed' => (clone $base)->where('status', 'confirmed')->count(),
            'in_progress' => (clone $base)->where('status', 'in_progress')->count(),
            'completed_today' => (clone $base)->where('status', 'completed')
                ->whereBetween('completed_at', [$startOfDay, $endOfDay])->count(),
            'cancelled_today' => (clone $base)->whereIn('status', ['cancelled', 'rejected'])
                ->whereBetween('cancelled_at', [$startOfDay, $endOfDay])->count(),
        ];
    }
}
