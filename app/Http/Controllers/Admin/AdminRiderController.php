<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\ActivityLog;
use App\Models\User;
use App\Services\AccountModerationService;
use App\Services\DeliveryFareSettings;
use App\Services\RideFareSettings;
use App\Services\RiderRecordsService;
use App\Services\UserService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class AdminRiderController extends Controller
{
    public function __construct(
        private UserService $userService,
        private DeliveryFareSettings $fareSettings,
        private RideFareSettings $rideFareSettings,
        private AccountModerationService $moderation
    ) {}

    /** Ride-hailing fares per vehicle type (separate from the food delivery fee). */
    public function rideFareSettings(): JsonResponse
    {
        return $this->successResponse($this->rideFareSettings->all());
    }

    public function updateRideFareSettings(Request $request): JsonResponse
    {
        $rules = [];
        foreach (array_keys(RideFareSettings::DEFAULTS) as $vehicle) {
            $rules[$vehicle] = ['required', 'array'];
            $rules["{$vehicle}.base_fare"] = ['required', 'numeric', 'min:0', 'max:100000'];
            $rules["{$vehicle}.per_km"] = ['required', 'numeric', 'min:0', 'max:100000'];
        }
        $validated = $request->validate($rules);

        $before = $this->rideFareSettings->all();
        $after = $this->rideFareSettings->save($validated);

        $changes = [];
        foreach ($after as $vehicle => $fields) {
            foreach ($fields as $field => $value) {
                $old = (float) ($before[$vehicle][$field] ?? 0);
                if ((float) $value !== $old) {
                    $changes[] = sprintf('%s %s: %s → %s', $vehicle, $field, number_format($old, 2), number_format((float) $value, 2));
                }
            }
        }

        ActivityLog::record(
            'ride_fare_settings.updated',
            $changes !== []
                ? 'Ride hailing fares updated (' . implode(', ', $changes) . ').'
                : 'Ride hailing fares updated (values unchanged).',
            null,
            ActivityLog::TYPE_SETTINGS
        );

        return $this->successResponse($after, 'Ride hailing fares updated successfully.');
    }

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

        ActivityLog::record(
            'rider_fare_settings.updated',
            $changes !== []
                ? 'Delivery fare settings updated (' . implode(', ', $changes) . ').'
                : 'Delivery fare settings updated (values unchanged).',
            null,
            ActivityLog::TYPE_SETTINGS
        );

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

        $rider->load('municipality', 'profile.municipality', 'profile.barangay', 'riderDetail', 'riderReviews.admin');

        return $this->successResponse(UserResource::make($rider));
    }

    /**
     * Read-only rider record: status, deliveries (COD vs online), earnings,
     * cash out online, and the day's COD cash from the daily receipt.
     */
    public function records(Request $request, User $rider, RiderRecordsService $records): JsonResponse
    {
        if ($rider->role !== User::ROLE_RIDER) {
            return $this->notFoundResponse('Rider not found.');
        }

        $validated = $request->validate([
            'date' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:'.now('Asia/Manila')->toDateString()],
        ]);

        $rider->load('riderDetail', 'municipality');

        return $this->successResponse(
            $records->summary(Auth::user(), $rider, $validated['date'] ?? now('Asia/Manila')->toDateString())
        );
    }

    /**
     * Set the rider's municipality. It decides which Tourism Office sees the
     * rider on the COD cash advance list and may issue them cash.
     */
    public function updateMunicipality(Request $request, User $rider): JsonResponse
    {
        if ($rider->role !== User::ROLE_RIDER) {
            return $this->notFoundResponse('Rider not found.');
        }

        $validated = $request->validate([
            'municipality_id' => ['required', 'integer', 'exists:municipalities,id'],
        ]);

        // An applicant trains where they registered; moving them mid-onboarding
        // would leave a training appointment in another municipality.
        if ((int) $validated['municipality_id'] !== (int) $rider->municipality_id
            && $rider->account_status === User::ACCOUNT_STATUS_PENDING
            && $rider->riderDetail?->application_submitted_at !== null) {
            return $this->errorResponse('This rider is in onboarding with their registered municipality. Their municipality cannot be changed until onboarding ends.', 422);
        }

        $before = $rider->municipality?->name;
        $rider->update(['municipality_id' => (int) $validated['municipality_id']]);
        // A barangay belongs to one municipality: moving the rider clears a
        // barangay that is not in the new municipality.
        $newMunicipality = (int) $validated['municipality_id'];
        $barangayId = $rider->profile?->barangay_id;
        $keepBarangay = $barangayId && \App\Models\Barangay::whereKey($barangayId)->where('municipality_id', $newMunicipality)->exists();
        $rider->profile?->update(['municipality_id' => $newMunicipality, 'barangay_id' => $keepBarangay ? $barangayId : null]);
        $rider->load('municipality');

        ActivityLog::record(
            'rider.municipality_updated',
            sprintf('Rider municipality changed (%s): %s → %s.', $rider->email, $before ?? 'none', $rider->municipality?->name),
            $rider
        );

        $rider->load('profile.municipality', 'profile.barangay', 'riderDetail', 'riderReviews.admin');

        return $this->successResponse(UserResource::make($rider), 'Rider municipality updated.');
    }

    /**
     * Record the rider's registered vehicle (verified by the Tourism Office).
     * The vehicle decides ride-hailing: only motor vehicles carry passengers,
     * so a rider moved to a bicycle leaves the ride-hailing service.
     */
    public function updateVehicle(Request $request, User $rider): JsonResponse
    {
        if ($rider->role !== User::ROLE_RIDER) {
            return $this->notFoundResponse('Rider not found.');
        }

        $bicycle = $request->input('vehicle_type') === 'bicycle';
        $v = $request->validate([
            'vehicle_type' => ['required', \Illuminate\Validation\Rule::in(\App\Services\RideVehicles::RIDER_VEHICLES)],
            'vehicle_plate_number' => [$bicycle ? 'nullable' : 'required', 'string', 'max:20', 'regex:/^[A-Za-z0-9\- ]+$/'],
            'vehicle_make' => ['nullable', 'string', 'max:50'],
            'vehicle_model' => ['nullable', 'string', 'max:50'],
            'vehicle_year' => ['nullable', 'integer', 'between:1980,'.(now()->year + 1)],
        ]);

        $detail = $rider->riderDetail ?? $rider->riderDetail()->create([]);
        if ($detail->rider_status === User::RIDER_STATUS_BUSY) {
            return $this->errorResponse('This rider is on a trip. Change the vehicle after the trip ends.', 422);
        }

        $before = $detail->vehicle_type;
        $updates = [
            'vehicle_type' => $v['vehicle_type'],
            'vehicle_plate_number' => isset($v['vehicle_plate_number']) ? strtoupper(trim($v['vehicle_plate_number'])) : null,
            'vehicle_make' => $v['vehicle_make'] ?? null,
            'vehicle_model' => $v['vehicle_model'] ?? null,
            'vehicle_year' => $v['vehicle_year'] ?? null,
        ];
        $leftRideHailing = false;
        if (! \App\Services\RideVehicles::canRideHail($v['vehicle_type']) && $detail->current_service === User::SERVICE_TRANSPORT) {
            $updates['current_service'] = User::SERVICE_FOOD;
            $updates['rider_status'] = User::RIDER_STATUS_OFFLINE;
            $leftRideHailing = true;
        }
        $detail->update($updates);

        ActivityLog::record(
            'rider.vehicle_updated',
            sprintf('Rider vehicle updated (%s): %s → %s%s.', $rider->email, $before ?? 'none', $v['vehicle_type'], $leftRideHailing ? '; moved to food delivery' : ''),
            $rider
        );

        $rider->load('profile.municipality', 'profile.barangay', 'riderDetail', 'riderReviews.admin');

        return $this->successResponse(
            UserResource::make($rider),
            $leftRideHailing ? 'Vehicle updated. A bicycle cannot do ride-hailing, so the rider was moved to food delivery.' : 'Vehicle updated.'
        );
    }

    public function approve(Request $request, User $rider): JsonResponse
    {
        if ($rider->role !== User::ROLE_RIDER) {
            return $this->notFoundResponse('Rider not found.');
        }
        if ($denied = $this->otherMunicipalityApplicant($rider)) {
            return $denied;
        }

        $rider = $this->moderation->moderateRider($rider, $request->user(), 'approved', $request->remarks);

        return $this->successResponse(
            UserResource::make($rider),
            'Rider application has been approved successfully.'
        );
    }

    public function reject(Request $request, User $rider): JsonResponse
    {
        if ($rider->role !== User::ROLE_RIDER) {
            return $this->notFoundResponse('Rider not found.');
        }
        if ($denied = $this->otherMunicipalityApplicant($rider)) {
            return $denied;
        }

        $request->validate([
            'remarks' => ['required', 'string', 'max:1000'],
        ]);

        $rider = $this->moderation->moderateRider($rider, $request->user(), 'rejected', $request->remarks);

        return $this->successResponse(
            UserResource::make($rider),
            'Rider application has been rejected.'
        );
    }

    /**
     * Applicants (pending riders) are decided only by their own municipality's
     * Tourism Office through onboarding. The Bansud admin decides Bansud's.
     */
    private function otherMunicipalityApplicant(User $rider): ?JsonResponse
    {
        $municipality = $rider->municipality;
        if ($rider->account_status === User::ACCOUNT_STATUS_PENDING && $municipality && ! $municipality->isHome()) {
            return $this->errorResponse("This applicant is onboarding with the {$municipality->name} Tourism Office. Only that office can approve or reject them.", 403);
        }

        return null;
    }

    public function suspend(Request $request, User $rider): JsonResponse
    {
        if ($rider->role !== User::ROLE_RIDER) {
            return $this->notFoundResponse('Rider not found.');
        }

        $request->validate([
            'remarks' => ['required', 'string', 'max:1000'],
        ]);

        $rider = $this->moderation->moderateRider($rider, $request->user(), 'suspended', $request->remarks);

        return $this->successResponse(
            UserResource::make($rider),
            'Rider has been suspended.'
        );
    }

    public function activate(Request $request, User $rider): JsonResponse
    {
        if ($rider->role !== User::ROLE_RIDER) {
            return $this->notFoundResponse('Rider not found.');
        }

        $rider = $this->moderation->moderateRider($rider, $request->user(), 'reactivated', $request->remarks);

        return $this->successResponse(
            UserResource::make($rider),
            'Rider has been reactivated.'
        );
    }
}
