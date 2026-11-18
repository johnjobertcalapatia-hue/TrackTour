<?php

namespace App\Http\Middleware;

use App\Models\User;
use App\Services\MunicipalScopeService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gate for the Municipality Tourism Admin surface (/api/municipal/*).
 *
 * The account must be an approved `tourism_office` user assigned to an active
 * (non-deleted) municipality. The resolved municipality is shared with the
 * controllers as the `municipality` request attribute; controllers never read
 * a municipality id from the client.
 */
class EnsureMunicipalScope
{
    public function __construct(private MunicipalScopeService $scope) {}

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user || $user->role !== User::ROLE_TOURISM_OFFICE) {
            return $this->deny('Unauthorized access.');
        }

        if ($user->account_status !== User::ACCOUNT_STATUS_APPROVED) {
            return $this->deny('This municipal Tourism Office account is not active. Contact the Bansud Tourism Office.');
        }

        $municipality = $this->scope->municipality($user);
        if ($municipality === null) {
            return $this->deny('This Tourism Office account is not assigned to an active municipality. Contact the Bansud Tourism Office.');
        }

        $request->attributes->set('municipality', $municipality);

        return $next($request);
    }

    private function deny(string $message): Response
    {
        return response()->json(['success' => false, 'message' => $message], 403);
    }
}
