<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\ActivityLog;
use App\Models\RiderReview;
use App\Models\User;
use App\Notifications\RiderAccountStatusChanged;
use App\Services\DeliveryFareSettings;
use App\Services\UserService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class AdminRiderController extends Controller
{
    public function __construct(
        private UserService $userService,
        private DeliveryFareSettings $fareSettings
    ) {}

    public function fareSettings(): JsonResponse
    {
        return $this->successResponse($this->fareSettings->all());
    }

    public function updateFareSettings(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'base_fare' => ['required', 'numeric', 'min:0', 'max:100000'],
            'included_kilometers' => ['required', 'numeric', 'min:0', 'max:1000'],
            'per_kilometer' => ['required', 'numeric', 'min:0', 'max:100000'],
            'minimum_fee' => ['required', 'numeric', 'min:0', 'max:100000'],
            'service_adjustment' => ['required', 'numeric', 'min:0', 'max:100000'],
            'surge_multiplier' => ['required', 'numeric', 'min:0', 'max:100'],
        ]);

        $before = $this->fareSettings->all();
        $after = $this->fareSettings->save($validated);

        $changes = [];
        foreach ($after as $key => $value) {
            if ((float) $value !== (float) ($before[$key] ?? 0)) {
                $changes[] = sprintf(
                    '%s: %s → %s',
                    $key,
                    number_format((float) ($before[$key] ?? 0), 2),
                    number_format((float) $value, 2)
                );
            }
        }

        ActivityLog::create([
            'user_id' => Auth::id(),
            'action' => 'rider_fare_settings.updated',
            'description' => $changes !== []
                ? 'Delivery fare settings updated (' . implode(', ', $changes) . ').'
                : 'Delivery fare settings updated (values unchanged).',
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        return $this->successResponse($after, 'Delivery fare settings updated successfully.');
    }

    public function index(Request $request): JsonResponse
    {
        $query = User::where('role', User::ROLE_RIDER)
            ->with('profile.municipality', 'profile.barangay');

        if ($search = $request->search) {
            $query->where(function ($q) use ($search) {
                $q->where('email', 'like', "%{$search}%")
                    ->orWhere('name', 'like', "%{$search}%")
                    ->orWhereHas('profile', function ($p) use ($search) {
                        $p->where('mobile_number', 'like', "%{$search}%")
                            ->orWhere('first_name', 'like', "%{$search}%")
                            ->orWhere('last_name', 'like', "%{$search}%");
                    });
            });
        }

        if ($status = $request->status) {
            $query->where('account_status', $status);
        }

        if ($vehicle = $request->vehicle) {
            $query->whereHas('riderDetail', function ($q) use ($vehicle) {
                $q->where('vehicle_type', $vehicle);
            });
        }

        $riders = $query->latest()->paginate(15)->withQueryString();

        $stats = [
            'total' => User::where('role', User::ROLE_RIDER)->count(),
            'pending' => User::where('role', User::ROLE_RIDER)->where('account_status', User::ACCOUNT_STATUS_PENDING)->count(),
            'approved' => User::where('role', User::ROLE_RIDER)->where('account_status', User::ACCOUNT_STATUS_APPROVED)->count(),
            'rejected' => User::where('role', User::ROLE_RIDER)->where('account_status', User::ACCOUNT_STATUS_REJECTED)->count(),
            'suspended' => User::where('role', User::ROLE_RIDER)->where('account_status', User::ACCOUNT_STATUS_SUSPENDED)->count(),
        ];

        $paginated = $riders->through(fn ($rider) => UserResource::make($rider));

        return $this->successResponse($paginated->items(), 'Riders retrieved successfully.', 200, [
            'current_page' => $paginated->currentPage(),
            'last_page' => $paginated->lastPage(),
            'per_page' => $paginated->perPage(),
            'total' => $paginated->total(),
            'stats' => $stats,
        ]);
    }

    public function show(User $rider): JsonResponse
    {
        if ($rider->role !== User::ROLE_RIDER) {
            return $this->notFoundResponse('Rider not found.');
        }

        $rider->load('profile.municipality', 'profile.barangay', 'riderDetail', 'riderReviews.admin');

        return $this->successResponse(UserResource::make($rider));
    }

    public function approve(Request $request, User $rider): JsonResponse
    {
        if ($rider->role !== User::ROLE_RIDER) {
            return $this->notFoundResponse('Rider not found.');
        }

        $rider->update(['account_status' => User::ACCOUNT_STATUS_APPROVED]);

        RiderReview::create([
            'rider_id' => $rider->id,
            'admin_id' => Auth::id(),
            'decision' => 'approved',
            'remarks' => $request->remarks,
        ]);

        try {
            $rider->notify(new RiderAccountStatusChanged('approved'));
        } catch (\Exception $e) {
            // Queue failure is non-blocking
        }

        return $this->successResponse(
            UserResource::make($rider->fresh()),
            'Rider application has been approved successfully.'
        );
    }

    public function reject(Request $request, User $rider): JsonResponse
    {
        if ($rider->role !== User::ROLE_RIDER) {
            return $this->notFoundResponse('Rider not found.');
        }

        $request->validate([
            'remarks' => ['required', 'string', 'max:1000'],
        ]);

        $rider->update(['account_status' => User::ACCOUNT_STATUS_REJECTED]);

        RiderReview::create([
            'rider_id' => $rider->id,
            'admin_id' => Auth::id(),
            'decision' => 'rejected',
            'remarks' => $request->remarks,
        ]);

        try {
            $rider->notify(new RiderAccountStatusChanged('rejected', $request->remarks));
        } catch (\Exception $e) {
            // Queue failure is non-blocking
        }

        return $this->successResponse(
            UserResource::make($rider->fresh()),
            'Rider application has been rejected.'
        );
    }

    public function suspend(Request $request, User $rider): JsonResponse
    {
        if ($rider->role !== User::ROLE_RIDER) {
            return $this->notFoundResponse('Rider not found.');
        }

        $request->validate([
            'remarks' => ['required', 'string', 'max:1000'],
        ]);

        $rider->update(['account_status' => User::ACCOUNT_STATUS_SUSPENDED]);

        RiderReview::create([
            'rider_id' => $rider->id,
            'admin_id' => Auth::id(),
            'decision' => 'suspended',
            'remarks' => $request->remarks,
        ]);

        try {
            $rider->notify(new RiderAccountStatusChanged('suspended', $request->remarks));
        } catch (\Exception $e) {
            // Queue failure is non-blocking
        }

        return $this->successResponse(
            UserResource::make($rider->fresh()),
            'Rider has been suspended.'
        );
    }

    public function activate(Request $request, User $rider): JsonResponse
    {
        if ($rider->role !== User::ROLE_RIDER) {
            return $this->notFoundResponse('Rider not found.');
        }

        $rider->update(['account_status' => User::ACCOUNT_STATUS_APPROVED]);

        RiderReview::create([
            'rider_id' => $rider->id,
            'admin_id' => Auth::id(),
            'decision' => 'reactivated',
            'remarks' => $request->remarks,
        ]);

        try {
            $rider->notify(new RiderAccountStatusChanged('reactivated'));
        } catch (\Exception $e) {
            // Queue failure is non-blocking
        }

        return $this->successResponse(
            UserResource::make($rider->fresh()),
            'Rider has been reactivated.'
        );
    }
}
