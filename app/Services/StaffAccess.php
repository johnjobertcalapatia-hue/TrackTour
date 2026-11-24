<?php

namespace App\Services;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * Staff Management Stage 1 (docs/staff-management-plan.md): the one place that
 * decides what a staff account may do.
 *
 *  - activeStaff(): a staff member counts only while their staff record is
 *    active (not pending, suspended, inactive or removed).
 *  - actingBusinessIds(): the businesses a user may act for — an owner's own
 *    businesses, or the active staff member's single business. Order and
 *    order-item ownership checks use it, so owners are unaffected and staff
 *    are limited to their own restaurant.
 *  - can(): the staff member's role grants (StaffPermissions).
 */
class StaffAccess
{
    /** The user's staff record, only while it is active and its business exists. Never cached. */
    public function activeStaff(?User $user): ?Staff
    {
        if (! $user || $user->role !== 'staff') {
            return null;
        }

        return Staff::where('user_id', $user->id)
            ->where('status', Staff::STATUS_ACTIVE)
            ->whereHas('business')
            ->with(['business', 'staffRole'])
            ->first();
    }

    /** @return Collection<int, int> */
    public function actingBusinessIds(User $user): Collection
    {
        if ($user->role === 'staff') {
            $staff = $this->activeStaff($user);

            return collect($staff ? [(int) $staff->business_id] : []);
        }

        return $user->businesses()->pluck('id')->map(fn ($id) => (int) $id);
    }

    public function can(?User $user, string $permission): bool
    {
        $staff = $this->activeStaff($user);

        return $staff !== null && in_array($permission, $staff->grantedPermissions(), true);
    }

    /** The order contains at least one item (or is the order) of the staff member's business. */
    public function staffSharesOrder(User $user, Order $order): bool
    {
        $businessId = $this->activeStaff($user)?->business_id;
        if (! $businessId) {
            return false;
        }

        return (int) $order->business_id === (int) $businessId
            || $order->items()->where('business_id', $businessId)->exists();
    }

    /**
     * Every item of the order is the staff member's business: whole-order
     * actions then touch only their own items (a group checkout's other
     * restaurants are never affected).
     */
    public function staffOwnsWholeOrder(User $user, Order $order): bool
    {
        $businessId = $this->activeStaff($user)?->business_id;
        if (! $businessId || (int) $order->business_id !== (int) $businessId) {
            return false;
        }

        return ! $order->items()->where(fn ($q) => $q->whereNull('business_id')->orWhere('business_id', '!=', $businessId))->exists();
    }

    /** The item belongs to the staff member's business (never another restaurant's item). */
    public function staffOwnsItem(User $user, OrderItem $item): bool
    {
        $businessId = $this->activeStaff($user)?->business_id;

        return $businessId !== null && (int) $item->business_id === (int) $businessId;
    }

    /** Why a user may not sign in, or null. Only staff accounts are checked. */
    public function loginBlockReason(User $user): ?string
    {
        if ($user->role !== 'staff') {
            return null;
        }
        $staff = Staff::withTrashed()->where('user_id', $user->id)->first();

        return match (true) {
            $staff === null || $staff->trashed() => 'This staff account has been removed. Please contact the business owner.',
            $staff->status === Staff::STATUS_PENDING => 'This staff account is not activated yet. Use the invitation link sent to your email.',
            $staff->status === Staff::STATUS_SUSPENDED => 'This staff account is suspended. Please contact the business owner.',
            $staff->status !== Staff::STATUS_ACTIVE => 'This staff account is deactivated. Please contact the business owner.',
            ! $staff->business()->exists() => 'This staff account\'s business is no longer available.',
            default => null,
        };
    }

    /** Sign the staff member out everywhere, immediately. */
    public function revokeTokens(User $user): int
    {
        return $user->tokens()->delete();
    }
}
