<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

class StaffMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = Auth::user();

        if (! $user) {
            return redirect()->route('login');
        }

        // Check if user has an active staff record
        $staff = $user->staff()
            ->where('status', 'active')
            ->with('business.category', 'staffRole')
            ->first();

        if (! $staff) {
            abort(403, 'You do not have an active staff account.');
        }

        // Attach staff to request for easy access in controllers
        $request->merge(['staff' => $staff]);

        return $next($request);
    }
}
