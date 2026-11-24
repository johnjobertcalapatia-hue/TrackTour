<?php

namespace App\Services;

use App\Mail\StaffInvitationMail;
use App\Models\Business;
use App\Models\Staff;
use App\Models\StaffActivityLog;
use App\Models\StaffInvitation;
use App\Models\StaffRole;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * Staff Management Stage 1 (docs/staff-management-plan.md): the staff account
 * lifecycle — invite, resend, activate, suspend/deactivate/reactivate, change
 * role, send a password reset link, remove. Every step writes a staff
 * activity record. Passwords are never generated for, shown to or stored by
 * the owner: the staff member sets their own through the invitation link.
 */
class StaffAccountService
{
    public function __construct(private StaffAccess $access) {}

    /**
     * Create a pending staff account for a NEW user (a staff account belongs
     * to exactly one business) and send the invitation.
     *
     * @return array{staff: Staff, mail_sent: bool, activation_url: ?string}
     */
    public function invite(Business $business, array $data, User $owner): array
    {
        [$staff, $token] = DB::transaction(function () use ($business, $data, $owner) {
            $user = User::create([
                'email' => $data['email'],
                // Unusable until the staff member sets their own password.
                'password' => Hash::make(Str::random(64)),
                'role' => 'staff',
                'account_status' => User::ACCOUNT_STATUS_APPROVED,
            ]);
            $user->profile()->create([
                'first_name' => $data['first_name'],
                'middle_name' => $data['middle_name'] ?? null,
                'last_name' => $data['last_name'],
                'suffix' => $data['suffix'] ?? null,
                'sex' => $data['gender'] ?? null,
                'date_of_birth' => $data['date_of_birth'] ?? null,
                'mobile_number' => $data['mobile_number'] ?? null,
                'house_no_street' => $data['address'] ?? null,
            ]);

            $roleIds = array_values(array_unique(array_map('intval', $data['staff_role_ids'] ?? [$data['staff_role_id']])));
            $staff = $business->staff()->create([
                'user_id' => $user->id,
                // First role = primary (compatibility); all roles in staff_role_assignments.
                'staff_role_id' => $roleIds[0],
                'status' => Staff::STATUS_PENDING,
                'date_hired' => $data['date_hired'] ?? now()->toDateString(),
                'salary_type' => $data['salary_type'] ?? null,
                'employment_status' => $data['employment_status'] ?? 'full_time',
                'address' => $data['address'] ?? null,
                'profile_picture' => $data['profile_picture'] ?? null,
                'mobile_number' => $data['mobile_number'] ?? null,
                'gender' => $data['gender'] ?? null,
                'date_of_birth' => $data['date_of_birth'] ?? null,
                'middle_name' => $data['middle_name'] ?? null,
                'suffix' => $data['suffix'] ?? null,
            ]);
            $staff->setRelation('user', $user);
            $staff->roles()->sync($roleIds);

            $roles = implode(', ', $staff->roleNames());
            StaffActivityLog::record($staff, 'staff.created', "Staff account created for {$staff->full_name} as {$roles}.", [
                'roles' => $staff->roleNames(),
                'permissions' => $staff->grantedPermissions(),
            ], $owner);

            [$invitation, $token] = StaffInvitation::issue($staff, $owner);

            return [$staff, $token];
        });

        return ['staff' => $staff] + $this->deliver($staff, $token, $owner, 'staff.invited', 'Invitation sent');
    }

    /**
     * Revoke any open invitation and send a new one (pending staff only).
     *
     * @return array{mail_sent: bool, activation_url: ?string}
     */
    public function resendInvitation(Staff $staff, User $owner): array
    {
        if ($staff->status !== Staff::STATUS_PENDING) {
            throw new \InvalidArgumentException('Only staff who have not activated their account can be sent a new invitation.');
        }

        $token = DB::transaction(function () use ($staff, $owner) {
            $staff->invitations()->open()->update(['revoked_at' => now()]);
            [, $token] = StaffInvitation::issue($staff, $owner);

            return $token;
        });

        return $this->deliver($staff, $token, $owner, 'staff.invitation_resent', 'New invitation sent');
    }

    public function revokeInvitation(StaffInvitation $invitation, User $owner): void
    {
        if ($invitation->state() !== 'pending') {
            throw new \InvalidArgumentException('This invitation is no longer pending.');
        }
        $invitation->update(['revoked_at' => now()]);
        StaffActivityLog::record($invitation->staff, 'staff.invitation_revoked', "Invitation to {$invitation->email} revoked.", [], $owner);
    }

    /**
     * Accept an invitation: the staff member sets their own password and the
     * account becomes active. Single use, expires after 72 hours.
     */
    public function accept(string $token, string $password): Staff
    {
        return DB::transaction(function () use ($token, $password) {
            $invitation = StaffInvitation::where('token_hash', StaffInvitation::hashToken($token))->lockForUpdate()->first();
            if (! $invitation) {
                throw new \InvalidArgumentException('This invitation link is not valid.');
            }
            match ($invitation->state()) {
                'accepted' => throw new \InvalidArgumentException('This invitation has already been used. Sign in with your email and password.'),
                'revoked' => throw new \InvalidArgumentException('This invitation was cancelled. Ask the business owner for a new one.'),
                'expired' => throw new \InvalidArgumentException('This invitation has expired. Ask the business owner for a new one.'),
                default => null,
            };

            $staff = Staff::whereKey($invitation->staff_id)->lockForUpdate()->first();
            if (! $staff || $staff->status !== Staff::STATUS_PENDING) {
                throw new \InvalidArgumentException('This staff account can no longer be activated. Ask the business owner for help.');
            }

            $user = $staff->user;
            $user->forceFill([
                'password' => Hash::make($password),
                // Opening the emailed link proves the address.
                'email_verified_at' => $user->email_verified_at ?? now(),
            ])->save();
            $staff->update(['status' => Staff::STATUS_ACTIVE]);
            $invitation->update(['accepted_at' => now()]);
            // Any other open invitation for this account is now pointless.
            $staff->invitations()->open()->whereKeyNot($invitation->id)->update(['revoked_at' => now()]);

            StaffActivityLog::record($staff, 'staff.activated', "{$staff->full_name} activated their account.", [], $user);

            return $staff;
        });
    }

    /**
     * Owner sets active / inactive / suspended. Leaving "active" signs the
     * staff member out everywhere at once.
     */
    public function setStatus(Staff $staff, string $status, User $owner, ?string $reason = null): Staff
    {
        if ($staff->status === Staff::STATUS_PENDING) {
            throw new \InvalidArgumentException('This staff member has not activated their account yet. Resend or cancel the invitation instead.');
        }
        if ($staff->status === $status) {
            return $staff;
        }

        $previous = $staff->status;
        $staff->update(['status' => $status]);
        $revoked = $status === Staff::STATUS_ACTIVE ? 0 : $this->access->revokeTokens($staff->user);

        [$action, $verb] = match ($status) {
            Staff::STATUS_SUSPENDED => ['staff.suspended', 'suspended'],
            Staff::STATUS_INACTIVE => ['staff.deactivated', 'deactivated'],
            default => ['staff.reactivated', 'reactivated'],
        };
        StaffActivityLog::record($staff, $action, "{$staff->full_name}'s account was {$verb}.", array_filter([
            'from' => $previous,
            'to' => $status,
            'reason' => $reason,
            'sessions_ended' => $revoked ?: null,
        ]), $owner);

        return $staff;
    }

    /**
     * Replace a staff member's roles (one or more). The first is the primary
     * role. Records the change with the permissions before and after.
     *
     * @param  list<int>  $roleIds
     */
    public function setRoles(Staff $staff, array $roleIds, User $owner): bool
    {
        $roleIds = array_values(array_unique(array_map('intval', $roleIds)));
        $beforeNames = $staff->roleNames();
        $beforePermissions = $staff->grantedPermissions();

        $staff->forceFill(['staff_role_id' => $roleIds[0]])->save();
        $staff->roles()->sync($roleIds);
        $staff->unsetRelation('staffRole');

        $afterNames = $staff->roleNames();
        $same = $beforeNames;
        sort($same);
        $now = $afterNames;
        sort($now);
        if ($same === $now) {
            return false;
        }

        StaffActivityLog::record($staff, 'staff.role_changed', "{$staff->full_name}'s roles changed from ".(implode(', ', $beforeNames) ?: 'none').' to '.implode(', ', $afterNames).'.', [
            'from' => $beforeNames,
            'to' => $afterNames,
            'permissions_before' => $beforePermissions,
            'permissions_after' => $staff->grantedPermissions(),
        ], $owner);

        return true;
    }

    /**
     * Email the staff member a password reset link (the existing reset flow).
     * The owner never sees or sets the password.
     */
    public function sendPasswordReset(Staff $staff, User $owner): bool
    {
        if ($staff->status !== Staff::STATUS_ACTIVE) {
            throw new \InvalidArgumentException('Only active staff can be sent a password reset link.');
        }

        $user = $staff->user;
        $token = Str::random(64);
        DB::table('password_resets')->updateOrInsert(['email' => $user->email], ['token' => Hash::make($token), 'created_at' => now()]);
        $url = rtrim((string) (config('app.frontend_url') ?: 'http://localhost:3000'), '/')
            .'/reset-password?token='.$token.'&email='.urlencode($user->email);

        $sent = true;
        try {
            Mail::to($user->email)->send(new \App\Mail\ResetPasswordMail($staff->full_name, $url));
        } catch (\Throwable $e) {
            $sent = false;
            Log::warning('Staff password reset email failed', ['staff_id' => $staff->id, 'error' => $e->getMessage()]);
        }

        StaffActivityLog::record($staff, 'staff.password_reset_sent', $sent
            ? "Password reset link sent to {$staff->full_name}."
            : "Password reset link for {$staff->full_name} could not be emailed.", ['mail_sent' => $sent], $owner);

        return $sent;
    }

    /** Remove (archive) a staff member: signed out, invitations revoked, record kept. */
    public function remove(Staff $staff, User $owner): void
    {
        DB::transaction(function () use ($staff, $owner) {
            $previous = $staff->status;
            $staff->invitations()->open()->update(['revoked_at' => now()]);
            $staff->update(['status' => Staff::STATUS_ARCHIVED]);
            StaffActivityLog::record($staff, 'staff.removed', "{$staff->full_name} was removed from the team.", ['from' => $previous], $owner);
            $staff->delete();
        });
        $this->access->revokeTokens($staff->user);
    }

    /**
     * Email the invitation. If it cannot be sent, the owner gets the link to
     * share themselves (it is never logged).
     *
     * @return array{mail_sent: bool, activation_url: ?string}
     */
    private function deliver(Staff $staff, string $token, User $owner, string $action, string $verb): array
    {
        $url = StaffInvitation::activationUrl($token);
        $staff->loadMissing('business', 'staffRole', 'user');

        $sent = true;
        try {
            Mail::to($staff->user->email)->send(new StaffInvitationMail(
                $staff->full_name,
                $staff->business->business_name,
                $staff->staffRole?->name ?? 'Staff',
                $url,
                now()->addHours(StaffInvitation::TTL_HOURS)->timezone('Asia/Manila')->format('M j, Y g:i A'),
            ));
        } catch (\Throwable $e) {
            $sent = false;
            Log::warning('Staff invitation email failed', ['staff_id' => $staff->id, 'error' => $e->getMessage()]);
        }

        StaffActivityLog::record($staff, $action, $sent
            ? "{$verb} to {$staff->user->email}."
            : "Invitation for {$staff->user->email} could not be emailed; the owner was given the link to share.", ['mail_sent' => $sent], $owner);

        return ['mail_sent' => $sent, 'activation_url' => $sent ? null : $url];
    }
}
