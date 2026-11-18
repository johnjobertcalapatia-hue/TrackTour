<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\RiderReview;
use App\Models\User;
use App\Notifications\RiderAccountStatusChanged;
use InvalidArgumentException;

/**
 * Canonical account moderation for business owners and riders, shared by the
 * District Super Admin and the Municipality Tourism Admin. Callers handle
 * authorization and municipality scoping.
 *
 * Decisions: approved | rejected | suspended | reactivated.
 */
class AccountModerationService
{
    public const DECISIONS = ['approved', 'rejected', 'suspended', 'reactivated'];

    public function __construct(private MunicipalScopeService $scope) {}

    public function moderateRider(User $rider, User $actor, string $decision, ?string $remarks = null): User
    {
        $this->assertRole($rider, User::ROLE_RIDER);
        $rider->update(['account_status' => $this->accountStatusFor($decision)]);

        RiderReview::create([
            'rider_id' => $rider->id,
            'admin_id' => $actor->id,
            'decision' => $decision,
            'remarks' => $remarks,
        ]);

        $description = match ($decision) {
            'approved' => sprintf('Approved rider account (%s).', $rider->email),
            'rejected' => sprintf('Rejected rider account (%s). Remarks: %s', $rider->email, $remarks),
            'suspended' => sprintf('Suspended rider account (%s). Remarks: %s', $rider->email, $remarks),
            'reactivated' => sprintf('Reactivated rider account (%s).', $rider->email),
        };

        ActivityLog::record('rider.'.$decision, $this->scope->auditPrefix($actor).$description, $rider);

        try {
            $rider->notify(new RiderAccountStatusChanged(
                $decision,
                in_array($decision, ['rejected', 'suspended'], true) ? $remarks : null
            ));
        } catch (\Exception $e) {
            // Queue failure is non-blocking
        }

        return $rider->fresh();
    }

    public function moderateBusinessOwner(User $owner, User $actor, string $decision, ?string $remarks = null): User
    {
        $this->assertRole($owner, User::ROLE_BUSINESS_OWNER);
        $owner->update(['account_status' => $this->accountStatusFor($decision)]);

        $owner->approvalRequests()->create([
            'reference_type' => User::class,
            'reference_id' => $owner->id,
            'status' => $decision,
            'remarks' => $remarks ?? ($decision === 'approved' ? 'Account approved by Tourism Office' : null),
            'reviewed_by' => $actor->id,
            'reviewed_at' => now(),
        ]);

        $verb = ucfirst($decision);
        $description = in_array($decision, ['rejected', 'suspended'], true)
            ? sprintf('%s business owner account (%s). Remarks: %s', $verb, $owner->email, $remarks)
            : sprintf('%s business owner account (%s).', $verb, $owner->email);

        ActivityLog::record('business_owner.'.$decision, $this->scope->auditPrefix($actor).$description, $owner);

        return $owner->fresh();
    }

    private function accountStatusFor(string $decision): string
    {
        return match ($decision) {
            'approved', 'reactivated' => User::ACCOUNT_STATUS_APPROVED,
            'rejected' => User::ACCOUNT_STATUS_REJECTED,
            'suspended' => User::ACCOUNT_STATUS_SUSPENDED,
            default => throw new InvalidArgumentException("Unknown moderation decision [{$decision}]."),
        };
    }

    private function assertRole(User $user, string $role): void
    {
        if ($user->role !== $role) {
            throw new InvalidArgumentException("Account {$user->id} is not a {$role}.");
        }
    }
}
