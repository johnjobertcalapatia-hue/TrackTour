<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckBusinessOwnerApproval
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user && $user->role === User::ROLE_BUSINESS_OWNER && $user->account_status !== User::ACCOUNT_STATUS_APPROVED) {
            return response()->json([
                'success' => false,
                'message' => 'Your account is pending review. Please wait for admin approval.',
                'account_status' => $user->account_status,
            ], 403);
        }

        return $next($request);
    }
}
