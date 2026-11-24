<?php

namespace App\Http\Controllers\Concerns;

use App\Models\Business;
use App\Services\StaffAccess;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * The businesses the signed-in user may act for (Staff Management,
 * docs/staff-management-plan.md §5): a business owner's own businesses
 * (unchanged behaviour), or an active staff member's one restaurant. Owner
 * controllers reused by the /staff portal scope with this instead of
 * `$request->user()->businesses()` / `owner_id === user id`.
 */
trait ActsForBusiness
{
    /** @return Collection<int, int> */
    protected function actingBusinessIds(Request $request): Collection
    {
        return app(StaffAccess::class)->actingBusinessIds($request->user());
    }

    protected function actingBusinesses(Request $request): Builder
    {
        return Business::query()->whereIn('id', $this->actingBusinessIds($request));
    }

    protected function actsFor(Request $request, ?Business $business): bool
    {
        return $business !== null && $this->actingBusinessIds($request)->contains((int) $business->id);
    }
}
