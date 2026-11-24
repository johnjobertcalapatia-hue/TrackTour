<?php

namespace App\Http\Middleware;

use App\Services\StaffAccess;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * `staff.can:<permission>` — the staff member's role must grant the
 * permission (App\Support\StaffPermissions). Runs after `staff.active`.
 *
 * `staff.can:<permission>,<field>=<value>` applies only when the request's
 * field has that value, e.g. `staff.can:orders.reject,status=cancelled`.
 */
class StaffPermissionMiddleware
{
    public function __construct(private StaffAccess $access) {}

    public function handle(Request $request, Closure $next, string $permission, ?string $when = null): Response
    {
        if ($when !== null) {
            [$field, $value] = array_pad(explode('=', $when, 2), 2, null);
            if ((string) $request->input($field) !== (string) $value) {
                return $next($request);
            }
        }

        if (! $this->access->can($request->user(), $permission)) {
            return response()->json([
                'success' => false,
                'message' => 'Your role does not allow this action. Ask the business owner for access.',
                'code' => 'staff_permission_denied',
                'permission' => $permission,
            ], 403);
        }

        return $next($request);
    }
}
