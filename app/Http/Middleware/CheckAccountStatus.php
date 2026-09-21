<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckAccountStatus
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user && $user->role === User::ROLE_BUSINESS_OWNER && $user->account_status !== User::ACCOUNT_STATUS_APPROVED) {
            // Allow access to profile edit, password update, and logout
            $allowedRoutes = [
                'profile.edit',
                'profile.update',
                'profile.destroy',
                'business-owner.profile',
                'business-owner.profile.edit',
                'business-owner.profile.update',
                'business-owner.account-status',
                'password.edit',
                'password.update',
                'logout',
            ];

            $currentRoute = $request->route()?->getName();

            if (! in_array($currentRoute, $allowedRoutes)) {
                return redirect()->route('business-owner.account-status', ['status' => $user->account_status]);
            }
        }

        return $next($request);
    }
}
