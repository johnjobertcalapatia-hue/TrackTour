<?php

namespace App\Http\Controllers;

use App\Http\Resources\StaffResource;
use App\Models\Business;
use App\Models\Staff;
use App\Models\StaffRole;
use App\Models\User;
use App\Services\StaffService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class BusinessOwnerStaffController extends Controller
{
    public function __construct(
        private StaffService $staffService
    ) {}

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $query = Staff::with('user.profile', 'staffRole', 'business')
            ->whereIn('business_id', $user->businesses()->pluck('id'))
            ->whereNull('deleted_at');

        if ($request->filled('search')) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('employee_id', 'like', "%{$search}%")
                    ->orWhereHas('user', function ($q2) use ($search) {
                        $q2->where('email', 'like', "%{$search}%")
                            ->orWhereHas('profile', function ($q3) use ($search) {
                                $q3->where('first_name', 'like', "%{$search}%")
                                    ->orWhere('last_name', 'like', "%{$search}%");
                            });
                    });
            });
        }

        if ($request->filled('status') && $request->status !== 'all') {
            $query->where('status', $request->status);
        }

        $staff = $query->orderBy('created_at', 'desc')->get();

        $statusCounts = Staff::whereIn('business_id', $user->businesses()->pluck('id'))
            ->whereNull('deleted_at')
            ->selectRaw('status, count(*) as count')
            ->groupBy('status')
            ->pluck('count', 'status');

        return $this->successResponse([
            'staff' => StaffResource::collection($staff),
            'status_counts' => $statusCounts,
        ]);
    }

    public function show(Request $request, Staff $staff): JsonResponse
    {
        $this->authorizeStaff($request->user(), $staff);

        $staff->load('user.profile', 'staffRole.permissions', 'business');

        return $this->successResponse(StaffResource::make($staff));
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'business_id' => ['required', 'integer', 'exists:businesses,id'],
            'first_name' => ['required', 'string', 'max:255'],
            'middle_name' => ['nullable', 'string', 'max:255'],
            'last_name' => ['required', 'string', 'max:255'],
            'suffix' => ['nullable', 'string', 'max:50'],
            'gender' => ['nullable', 'in:male,female,other'],
            'date_of_birth' => ['nullable', 'date'],
            'mobile_number' => ['nullable', 'string', 'max:20'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
            'staff_role_id' => ['required', 'integer', 'exists:staff_roles,id'],
            'date_hired' => ['nullable', 'date'],
            'salary_type' => ['nullable', 'in:hourly,daily,monthly'],
            'employment_status' => ['nullable', 'in:full_time,part_time,contractual'],
            'address' => ['nullable', 'string', 'max:500'],
            'profile_picture' => ['nullable', 'file', 'mimes:jpg,jpeg,png', 'max:2048'],
        ]);

        $business = Business::findOrFail($validated['business_id']);
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        try {
            DB::beginTransaction();

            $staffUser = User::create([
                'email' => $validated['email'],
                'password' => Hash::make($validated['password']),
                'role' => 'staff',
                'account_status' => User::ACCOUNT_STATUS_APPROVED,
            ]);

            $staffUser->profile()->create([
                'first_name' => $validated['first_name'],
                'middle_name' => $validated['middle_name'] ?? null,
                'last_name' => $validated['last_name'],
                'suffix' => $validated['suffix'] ?? null,
                'sex' => $validated['gender'] ?? null,
                'date_of_birth' => $validated['date_of_birth'] ?? null,
                'mobile_number' => $validated['mobile_number'] ?? null,
                'house_no_street' => $validated['address'] ?? null,
            ]);

            $profilePicturePath = null;
            if ($request->hasFile('profile_picture')) {
                $profilePicturePath = $request->file('profile_picture')->store('staff/profile-pictures', 'public');
            }

            $staff = $business->staff()->create([
                'user_id' => $staffUser->id,
                'staff_role_id' => $validated['staff_role_id'],
                'status' => 'active',
                'date_hired' => $validated['date_hired'] ?? now()->toDateString(),
                'salary_type' => $validated['salary_type'] ?? null,
                'employment_status' => $validated['employment_status'] ?? 'full_time',
                'address' => $validated['address'] ?? null,
                'profile_picture' => $profilePicturePath,
                'mobile_number' => $validated['mobile_number'] ?? null,
                'gender' => $validated['gender'] ?? null,
                'date_of_birth' => $validated['date_of_birth'] ?? null,
                'middle_name' => $validated['middle_name'] ?? null,
                'suffix' => $validated['suffix'] ?? null,
            ]);

            DB::commit();

            return $this->createdResponse(
                StaffResource::make($staff->load('user.profile', 'staffRole', 'business')),
                "Staff account created successfully. Employee ID: {$staff->employee_id}"
            );
        } catch (\Exception $e) {
            DB::rollBack();

            return $this->errorResponse('Failed to create staff account. Please try again.', 500);
        }
    }

    public function update(Request $request, Staff $staff): JsonResponse
    {
        $this->authorizeStaff($request->user(), $staff);

        $validated = $request->validate([
            'first_name' => ['required', 'string', 'max:255'],
            'middle_name' => ['nullable', 'string', 'max:255'],
            'last_name' => ['required', 'string', 'max:255'],
            'suffix' => ['nullable', 'string', 'max:50'],
            'gender' => ['nullable', 'in:male,female,other'],
            'date_of_birth' => ['nullable', 'date'],
            'mobile_number' => ['nullable', 'string', 'max:20'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email,' . $staff->user_id],
            'staff_role_id' => ['required', 'integer', 'exists:staff_roles,id'],
            'date_hired' => ['nullable', 'date'],
            'salary_type' => ['nullable', 'in:hourly,daily,monthly'],
            'employment_status' => ['nullable', 'in:full_time,part_time,contractual'],
            'address' => ['nullable', 'string', 'max:500'],
            'profile_picture' => ['nullable', 'file', 'mimes:jpg,jpeg,png', 'max:2048'],
            'password' => ['nullable', 'string', 'min:8'],
        ]);

        $staffUser = $staff->user;
        $staffUser->update(['email' => $validated['email']]);

        if ($staffUser->profile) {
            $staffUser->profile->update([
                'first_name' => $validated['first_name'],
                'middle_name' => $validated['middle_name'] ?? null,
                'last_name' => $validated['last_name'],
                'suffix' => $validated['suffix'] ?? null,
                'sex' => $validated['gender'] ?? null,
                'date_of_birth' => $validated['date_of_birth'] ?? null,
                'mobile_number' => $validated['mobile_number'] ?? null,
                'house_no_street' => $validated['address'] ?? null,
            ]);
        }

        if (! empty($validated['password'])) {
            $staffUser->update(['password' => Hash::make($validated['password'])]);
        }

        $profilePicturePath = $staff->profile_picture;
        if ($request->hasFile('profile_picture')) {
            $profilePicturePath = $request->file('profile_picture')->store('staff/profile-pictures', 'public');
        }

        $staff->update([
            'staff_role_id' => $validated['staff_role_id'],
            'date_hired' => $validated['date_hired'] ?? $staff->date_hired,
            'salary_type' => $validated['salary_type'] ?? null,
            'employment_status' => $validated['employment_status'] ?? $staff->employment_status,
            'address' => $validated['address'] ?? null,
            'profile_picture' => $profilePicturePath,
            'mobile_number' => $validated['mobile_number'] ?? null,
            'gender' => $validated['gender'] ?? null,
            'date_of_birth' => $validated['date_of_birth'] ?? null,
            'middle_name' => $validated['middle_name'] ?? null,
            'suffix' => $validated['suffix'] ?? null,
        ]);

        return $this->successResponse(
            StaffResource::make($staff->fresh()->load('user.profile', 'staffRole', 'business')),
            'Staff account updated successfully.'
        );
    }

    public function updateStatus(Request $request, Staff $staff): JsonResponse
    {
        $this->authorizeStaff($request->user(), $staff);

        $validated = $request->validate([
            'status' => ['required', 'in:active,inactive,suspended'],
        ]);

        $staff->update(['status' => $validated['status']]);

        $label = match ($validated['status']) {
            'active' => 'activated',
            'inactive' => 'deactivated',
            'suspended' => 'suspended',
        };

        return $this->successResponse(
            StaffResource::make($staff->fresh()->load('user.profile', 'staffRole')),
            "Staff account {$label} successfully."
        );
    }

    public function resetPassword(Request $request, Staff $staff): JsonResponse
    {
        $this->authorizeStaff($request->user(), $staff);

        $newPassword = Str::random(12);
        $staff->user->update(['password' => Hash::make($newPassword)]);

        return $this->successResponse([
            'password' => $newPassword,
        ], 'Password reset successfully.');
    }

    public function destroy(Request $request, Staff $staff): JsonResponse
    {
        $this->authorizeStaff($request->user(), $staff);

        $staff->update(['status' => 'archived']);
        $staff->delete();

        return $this->noContentResponse('Staff account archived successfully.');
    }

    public function getRiders(Request $request, Business $business): JsonResponse
    {
        if ($business->owner_id !== $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        $riders = $business->staff()
            ->where('status', 'active')
            ->whereHas('staffRole', fn ($q) => $q->where('name', 'Delivery Rider'))
            ->with('user.profile')
            ->get()
            ->map(fn ($s) => [
                'id' => $s->user_id,
                'name' => $s->full_name,
            ]);

        return $this->successResponse($riders);
    }

    private function authorizeStaff(User $user, Staff $staff): void
    {
        abort_if($staff->business->owner_id !== $user->id, 403);
    }
}
