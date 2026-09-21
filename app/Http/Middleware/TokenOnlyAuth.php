<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

class TokenOnlyAuth
{
    public function handle(Request $request, Closure $next): Response
    {
        // Clear any session state that EnsureFrontendRequestsAreStateful may have set.
        // This middleware must ONLY authenticate via Bearer token — never via session.
        if ($request->hasSession()) {
            $request->session()->forget('_token');
        }

        $token = $request->bearerToken();

        if (! $token) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $accessToken = PersonalAccessToken::findToken($token);

        if (! $accessToken) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if ($accessToken->expires_at && $accessToken->expires_at->isPast()) {
            return response()->json(['message' => 'Token has expired.'], 401);
        }

        $user = $accessToken->tokenable;

        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $user->withAccessToken($accessToken);

        // Force this user as the authenticated user on both the request and the Auth guard.
        $request->setUserResolver(fn () => $user);
        \Auth::setUser($user);

        return $next($request);
    }
}
