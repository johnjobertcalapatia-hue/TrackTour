<?php

namespace App\Http\Middleware;

use App\Services\StaffAccess;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * `staff.active` (alias `staff`): every staff API request requires an ACTIVE
 * staff record whose business still exists (Staff Management Stage 1). A
 * pending, suspended, deactivated or removed staff member is refused even if
 * they still hold a token. Exposes the staff record and its business id to
 * the request (OrderResource uses the id to hide other restaurants' items).
 */
class StaffMiddleware
{
    public function __construct(private StaffAccess $access) {}

    public function handle(Request $request, Closure $next): Response
    {
        $staff = $this->access->activeStaff($request->user());

        if (! $staff) {
            return response()->json([
                'success' => false,
                'message' => 'Your staff account is not active. Please contact the business owner.',
                'code' => 'staff_inactive',
            ], 403);
        }

        $request->attributes->set('staff', $staff);
        $request->attributes->set('staff_business_id', (int) $staff->business_id);

        return $next($request);
    }
}
