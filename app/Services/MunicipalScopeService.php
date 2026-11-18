<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\Business;
use App\Models\Municipality;
use App\Models\RiderDetail;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * Municipality data scoping for the Municipality Tourism Admin
 * (`tourism_office`). Resolves docs/PHASE2-ROLES-PERMISSIONS.md F-3 / F-7:
 *
 * - The officer's scope is `users.municipality_id` (the column the rider
 *   cash-fund scoping, rider registration and dispatch already treat as
 *   authoritative). `user_profiles.municipality_id` is only a fallback for
 *   business owners, whose registration writes the profile column.
 * - Businesses belong to `businesses.municipality_id`.
 * - Business owners belong to a municipality when their account, their
 *   profile, or any of their businesses is in it.
 * - Riders belong to `users.municipality_id`.
 * - Tourists have no home municipality; a tourist is "in" a municipality when
 *   they have ordered from, or booked with, one of its businesses.
 *
 * The District Super Admin (`bansud_tourism_office`) is never scoped here — it
 * uses the district-wide /admin surface.
 */
class MunicipalScopeService
{
    public const PENDING_BUSINESS_STATUSES = ['pending', 'under_review'];

    public const ACTIVE_RIDER_STATUSES = [
        User::RIDER_STATUS_ONLINE,
        User::RIDER_STATUS_AVAILABLE,
        User::RIDER_STATUS_BUSY,
    ];

    /** The officer's municipality, or null when the account is not a scoped municipal admin. */
    public function municipalityId(User $officer): ?int
    {
        if ($officer->role !== User::ROLE_TOURISM_OFFICE || $officer->municipality_id === null) {
            return null;
        }

        return (int) $officer->municipality_id;
    }

    /** The officer's (non-deleted) municipality, or null. */
    public function municipality(User $officer): ?Municipality
    {
        $id = $this->municipalityId($officer);

        return $id === null ? null : Municipality::find($id);
    }

    public function businesses(int $municipalityId): Builder
    {
        return Business::query()->where('businesses.municipality_id', $municipalityId);
    }

    public function businessOwners(int $municipalityId): Builder
    {
        return User::query()
            ->where('users.role', User::ROLE_BUSINESS_OWNER)
            ->where(function (Builder $q) use ($municipalityId) {
                $q->where('users.municipality_id', $municipalityId)
                    ->orWhereHas('profile', fn (Builder $p) => $p->where('municipality_id', $municipalityId))
                    ->orWhereHas('businesses', fn (Builder $b) => $b->where('municipality_id', $municipalityId));
            });
    }

    public function riders(int $municipalityId): Builder
    {
        return User::query()
            ->where('users.role', User::ROLE_RIDER)
            ->where('users.municipality_id', $municipalityId);
    }

    public function tourists(int $municipalityId): Builder
    {
        return User::query()
            ->where('users.role', User::ROLE_TOURIST)
            ->where(function (Builder $q) use ($municipalityId) {
                $q->whereExists(fn (QueryBuilder $s) => $this->ordersInMunicipality($s, $municipalityId))
                    ->orWhereExists(fn (QueryBuilder $s) => $this->orderItemsInMunicipality($s, $municipalityId))
                    ->orWhereExists(fn (QueryBuilder $s) => $this->bookingsInMunicipality($s, $municipalityId));
            });
    }

    /** Orders (single or group checkout) that involve a business in the municipality. */
    public function orderIds(int $municipalityId): QueryBuilder
    {
        $direct = \DB::table('orders')
            ->join('businesses', 'businesses.id', '=', 'orders.business_id')
            ->where('businesses.municipality_id', $municipalityId)
            ->select('orders.id');

        $viaItems = \DB::table('order_items')
            ->join('businesses', 'businesses.id', '=', 'order_items.business_id')
            ->where('businesses.municipality_id', $municipalityId)
            ->select('order_items.order_id');

        return $direct->union($viaItems);
    }

    /** Whether the officer's municipality covers the given business. */
    public function coversBusiness(User $officer, Business $business): bool
    {
        $id = $this->municipalityId($officer);

        return $id !== null && (int) $business->municipality_id === $id;
    }

    /** Whether the officer's municipality covers the given account (owner, rider or tourist). */
    public function coversUser(User $officer, User $subject): bool
    {
        $id = $this->municipalityId($officer);
        if ($id === null) {
            return false;
        }

        return match ($subject->role) {
            User::ROLE_BUSINESS_OWNER => $this->businessOwners($id)->whereKey($subject->id)->exists(),
            User::ROLE_RIDER => (int) $subject->municipality_id === $id,
            User::ROLE_TOURIST => $this->tourists($id)->whereKey($subject->id)->exists(),
            default => false,
        };
    }

    /** Whether the officer's municipality covers the given rider-detail record. */
    public function coversRiderDetail(User $officer, RiderDetail $riderDetail): bool
    {
        $rider = $riderDetail->user;

        return $rider !== null && $this->coversUser($officer, $rider);
    }

    /**
     * Administrative activity of a municipality's Tourism Office: entries by its
     * current office accounts, plus entries carrying its audit prefix (so the
     * history survives when an office account is later removed).
     */
    public function activityLogs(int $municipalityId): Builder
    {
        $name = Municipality::withTrashed()->whereKey($municipalityId)->value('name');
        $officerIds = User::query()
            ->where('role', User::ROLE_TOURISM_OFFICE)
            ->where('municipality_id', $municipalityId)
            ->select('id');

        return ActivityLog::query()->where(function (Builder $q) use ($officerIds, $name) {
            $q->whereIn('user_id', $officerIds);
            if ($name) {
                $q->orWhere('description', 'like', '['.$name.' Tourism Office]%');
            }
        });
    }

    /** Short audit prefix so district-wide audit logs show which municipality acted. */
    public function auditPrefix(User $actor): string
    {
        if ($actor->role !== User::ROLE_TOURISM_OFFICE) {
            return '';
        }

        $name = $this->municipality($actor)?->name;

        return $name ? "[{$name} Tourism Office] " : '[Municipal Tourism Office] ';
    }

    private function ordersInMunicipality(QueryBuilder $s, int $municipalityId): void
    {
        $s->selectRaw('1')
            ->from('orders')
            ->join('businesses', 'businesses.id', '=', 'orders.business_id')
            ->whereColumn('orders.user_id', 'users.id')
            ->where('businesses.municipality_id', $municipalityId);
    }

    private function orderItemsInMunicipality(QueryBuilder $s, int $municipalityId): void
    {
        $s->selectRaw('1')
            ->from('order_items')
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->join('businesses', 'businesses.id', '=', 'order_items.business_id')
            ->whereColumn('orders.user_id', 'users.id')
            ->where('businesses.municipality_id', $municipalityId);
    }

    private function bookingsInMunicipality(QueryBuilder $s, int $municipalityId): void
    {
        $s->selectRaw('1')
            ->from('bookings')
            ->join('businesses', 'businesses.id', '=', 'bookings.business_id')
            ->whereColumn('bookings.user_id', 'users.id')
            ->where('businesses.municipality_id', $municipalityId);
    }
}
