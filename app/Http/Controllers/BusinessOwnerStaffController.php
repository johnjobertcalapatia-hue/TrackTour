<?php

namespace App\Http\Controllers;

use App\Http\Resources\StaffResource;
use App\Models\Business;
use App\Models\Staff;
use App\Models\StaffActivityLog;
use App\Models\StaffInvitation;
use App\Models\StaffRole;
use App\Models\User;
use App\Services\StaffAccountService;
use App\Services\StaffService;
use App\Support\StaffPermissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Business owner — Staff Management (Stage 1, docs/staff-management-plan.md).
 * The owner invites staff (they set their own password), changes their role,
 * suspends / deactivates / reactivates / removes them, and sees their account
 * activity. The owner never sets or sees a staff password.
 */
class BusinessOwnerStaffController extends Controller
{
    public function __construct(
        private StaffService $staffService,
        private StaffAccountService $accounts,
    ) {}

    /** GET /business-owner/staff/overview — counts and recent activity. */
    public function overview(Request $request): JsonResponse
    {
        $businessIds = $request->user()->businesses()->pluck('id');
        $counts = Staff::whereIn('business_id', $businessIds)
            ->selectRaw('status, count(*) as count')->groupBy('status')->pluck('count', 'status');

        $recent = StaffActivityLog::whereIn('business_id', $businessIds)
            ->with('staff.user.profile', 'actor.profile')
            ->latest('created_at')->limit(10)->get()
            ->map(fn (StaffActivityLog $log) => $this->activityRow($log));

        return $this->successResponse([
            'counts' => [
                'total' => (int) $counts->sum(),
                'active' => (int) ($counts['active'] ?? 0),
                'pending' => (int) ($counts['pending'] ?? 0),
                'suspended' => (int) ($counts['suspended'] ?? 0),
                'inactive' => (int) ($counts['inactive'] ?? 0),
            ],
            'recent_activity' => $recent,
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $query = Staff::with('user.profile', 'staffRole', 'business')
            ->whereIn('business_id', $user->businesses()->pluck('id'));

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
        if ($request->filled('business_id')) {
            $query->where('business_id', $request->business_id);
        }

        $staff = $query->orderBy('created_at', 'desc')->get();

        $statusCounts = Staff::whereIn('business_id', $user->businesses()->pluck('id'))
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

        $staff->load('user.profile', 'staffRole', 'business');
        $invitation = $staff->invitations()->latest()->first();
        $granted = $staff->grantedPermissions();

        return $this->successResponse(StaffResource::make($staff)->additional([])->toArray($request) + [
            'granted_permissions' => collect(StaffPermissions::CATALOGUE)->only($granted)
                ->map(fn ($meta, $key) => ['key' => $key, 'module' => $meta[0], 'label' => $meta[1]])->values(),
            'invitation' => $invitation ? [
                'state' => $invitation->state(),
                'sent_at' => $invitation->created_at,
                'expires_at' => $invitation->expires_at,
                'accepted_at' => $invitation->accepted_at,
            ] : null,
            'activity' => $staff->activityLogs()->with('actor.profile')->latest('created_at')->limit(50)->get()
                ->map(fn (StaffActivityLog $log) => $this->activityRow($log)),
        ]);
    }

    /** POST /business-owner/staff — invite a new staff member (no password: they set their own). */
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
            // A new account only: a staff account belongs to exactly one business.
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            // One or more roles (Staff Management section 5); staff_role_id still accepted.
            'staff_role_ids' => ['required_without:staff_role_id', 'array', 'min:1', 'max:10'],
            'staff_role_ids.*' => ['integer', 'distinct', 'exists:staff_roles,id'],
            'staff_role_id' => ['required_without:staff_role_ids', 'integer', 'exists:staff_roles,id'],
            'date_hired' => ['nullable', 'date'],
            'salary_type' => ['nullable', 'in:hourly,daily,monthly'],
            'employment_status' => ['nullable', 'in:full_time,part_time,contractual'],
            'address' => ['nullable', 'string', 'max:500'],
            'profile_picture' => ['nullable', 'file', 'mimes:jpg,jpeg,png', 'max:2048'],
        ], [
            'email.unique' => 'This email already has a TrackTour account. Staff need their own new account for your business.',
        ]);

        $business = Business::findOrFail($validated['business_id']);
        if ((int) $business->owner_id !== (int) $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }
        $validated['staff_role_ids'] = $this->roleIds($validated);
        if ($error = $this->rolesError($business, $validated['staff_role_ids'])) {
            return $this->errorResponse($error, 422);
        }

        if ($request->hasFile('profile_picture')) {
            $validated['profile_picture'] = $request->file('profile_picture')->store('staff/profile-pictures', 'public');
        }

        try {
            $result = $this->accounts->invite($business, $validated, $request->user());
        } catch (\Throwable $e) {
            report($e);

            return $this->errorResponse('Failed to create the staff account. Please try again.', 500);
        }

        $staff = $result['staff'];

        return $this->createdResponse([
            'staff' => StaffResource::make($staff->fresh()->load('user.profile', 'staffRole', 'business')),
            'mail_sent' => $result['mail_sent'],
            // Only when the email could not be sent, so the owner can pass it on.
            'activation_url' => $result['activation_url'],
        ], $result['mail_sent']
            ? "Invitation sent to {$staff->user->email}. Employee ID: {$staff->employee_id}"
            : 'Staff account created, but the invitation email could not be sent. Share the activation link with them.');
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
            'email' => ['required', 'email', 'max:255', 'unique:users,email,'.$staff->user_id],
            // One or more roles (Staff Management section 5); staff_role_id still accepted.
            'staff_role_ids' => ['required_without:staff_role_id', 'array', 'min:1', 'max:10'],
            'staff_role_ids.*' => ['integer', 'distinct', 'exists:staff_roles,id'],
            'staff_role_id' => ['required_without:staff_role_ids', 'integer', 'exists:staff_roles,id'],
            'date_hired' => ['nullable', 'date'],
            'salary_type' => ['nullable', 'in:hourly,daily,monthly'],
            'employment_status' => ['nullable', 'in:full_time,part_time,contractual'],
            'address' => ['nullable', 'string', 'max:500'],
            'profile_picture' => ['nullable', 'file', 'mimes:jpg,jpeg,png', 'max:2048'],
        ]);

        $roleIds = $this->roleIds($validated);
        $current = $staff->roles()->pluck('staff_roles.id')->push($staff->staff_role_id)->filter()->map(fn ($id) => (int) $id)->all();
        if ($error = $this->rolesError($staff->business, array_values(array_diff($roleIds, $current)))) {
            return $this->errorResponse($error, 422);
        }

        $staffUser = $staff->user;
        $emailChanged = $staffUser->email !== $validated['email'];
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

        $profilePicturePath = $staff->profile_picture;
        if ($request->hasFile('profile_picture')) {
            $profilePicturePath = $request->file('profile_picture')->store('staff/profile-pictures', 'public');
        }

        $staff->update([
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

        $this->accounts->setRoles($staff, $roleIds, $request->user());
        $staff->refresh();
        StaffActivityLog::record($staff, 'staff.profile_updated', "{$staff->full_name}'s details were updated.", $emailChanged ? ['email_changed' => true] : [], $request->user());

        return $this->successResponse(
            StaffResource::make($staff->load('user.profile', 'staffRole', 'business')),
            'Staff account updated successfully.'
        );
    }

    /** PATCH /business-owner/staff/{staff}/status — suspend, deactivate or reactivate (takes effect at once). */
    public function updateStatus(Request $request, Staff $staff): JsonResponse
    {
        $this->authorizeStaff($request->user(), $staff);

        $validated = $request->validate([
            'status' => ['required', 'in:active,inactive,suspended'],
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        try {
            $this->accounts->setStatus($staff, $validated['status'], $request->user(), $validated['reason'] ?? null);
        } catch (\InvalidArgumentException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }

        $label = match ($validated['status']) {
            'active' => 'reactivated',
            'inactive' => 'deactivated',
            'suspended' => 'suspended',
        };

        return $this->successResponse(
            StaffResource::make($staff->fresh()->load('user.profile', 'staffRole')),
            "Staff account {$label}.".($validated['status'] === 'active' ? '' : ' They have been signed out.')
        );
    }

    /** POST /business-owner/staff/{staff}/resend-invitation */
    public function resendInvitation(Request $request, Staff $staff): JsonResponse
    {
        $this->authorizeStaff($request->user(), $staff);

        try {
            $result = $this->accounts->resendInvitation($staff, $request->user());
        } catch (\InvalidArgumentException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }

        return $this->successResponse($result, $result['mail_sent']
            ? 'A new invitation was sent. The previous link no longer works.'
            : 'A new invitation was created, but the email could not be sent. Share the activation link with them.');
    }

    /** POST /business-owner/staff/{staff}/send-password-reset — replaces the old plain-text password reset. */
    public function sendPasswordReset(Request $request, Staff $staff): JsonResponse
    {
        $this->authorizeStaff($request->user(), $staff);

        try {
            $sent = $this->accounts->sendPasswordReset($staff, $request->user());
        } catch (\InvalidArgumentException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }

        return $sent
            ? $this->successResponse(['mail_sent' => true], 'A password reset link was emailed to the staff member.')
            : $this->errorResponse('The password reset email could not be sent. Please try again later.', 502);
    }

    /** GET /business-owner/staff/invitations — invitations of the owner's businesses. */
    public function invitations(Request $request): JsonResponse
    {
        $invitations = StaffInvitation::whereIn('business_id', $request->user()->businesses()->pluck('id'))
            ->with('staff.user.profile', 'staff.staffRole', 'business')
            ->latest()->limit(100)->get()
            ->map(fn (StaffInvitation $i) => [
                'id' => $i->id,
                'staff_id' => $i->staff_id,
                'name' => $i->staff?->full_name,
                'email' => $i->email,
                'role' => $i->staff?->staffRole?->name,
                'business' => $i->business?->business_name,
                'state' => $i->state(),
                'sent_at' => $i->created_at,
                'expires_at' => $i->expires_at,
                'accepted_at' => $i->accepted_at,
            ]);

        return $this->successResponse(['invitations' => $invitations]);
    }

    /** DELETE /business-owner/staff/invitations/{invitation} — cancel a pending invitation. */
    public function revokeInvitation(Request $request, StaffInvitation $invitation): JsonResponse
    {
        if ((int) $invitation->business?->owner_id !== (int) $request->user()->id) {
            return $this->forbiddenResponse('You do not own this business.');
        }

        try {
            $this->accounts->revokeInvitation($invitation, $request->user());
        } catch (\InvalidArgumentException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }

        return $this->successResponse(null, 'Invitation cancelled. The link no longer works.');
    }

    public function destroy(Request $request, Staff $staff): JsonResponse
    {
        $this->authorizeStaff($request->user(), $staff);

        $this->accounts->remove($staff, $request->user());

        return $this->noContentResponse('Staff member removed. They have been signed out.');
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
        abort_if((int) $staff->business?->owner_id !== (int) $user->id, 403);
    }

    /** @return list<int> the requested roles, first = primary */
    private function roleIds(array $validated): array
    {
        return array_values(array_unique(array_map('intval', $validated['staff_role_ids'] ?? [$validated['staff_role_id']])));
    }

    /**
     * Every role must be offered to this business: a built-in role (template)
     * offered for its category (any built-in role when the category has none),
     * or one of this business's own custom roles (Staff Management §6).
     *
     * @param  list<int>  $roleIds
     */
    private function rolesError(Business $business, array $roleIds): ?string
    {
        $allowed = $business->category?->staffRoles()->pluck('staff_roles.id')->map(fn ($id) => (int) $id);
        foreach ($roleIds as $roleId) {
            $role = StaffRole::find($roleId);
            if (! $role) {
                return 'Unknown role.';
            }
            if ($role->isCustom()) {
                if ((int) $role->business_id !== (int) $business->id) {
                    return 'That role is not available for this business.';
                }

                continue;
            }
            if ($allowed && $allowed->isNotEmpty() && ! $allowed->contains($roleId)) {
                return 'That role is not available for this type of business.';
            }
        }

        return null;
    }

    private function activityRow(StaffActivityLog $log): array
    {
        return [
            'id' => $log->id,
            'action' => $log->action,
            'description' => $log->description,
            'actor_type' => $log->actor_type,
            'actor_name' => $log->actor?->full_name,
            'staff_id' => $log->staff_id,
            'staff_name' => $log->staff?->full_name,
            'properties' => $log->properties,
            'created_at' => $log->created_at,
        ];
    }
}
