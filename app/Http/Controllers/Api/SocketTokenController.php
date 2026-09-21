<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SocketChannelAuthorizer;
use App\Services\TripTokenService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * P11.5 — Mint Zero-DB socket tokens for business (`business:{id}`) and user
 * (`user:{id}`) rooms. The socket engine has no database, so Laravel vouches
 * for room ownership with the shared-secret HMAC tokens it verifies.
 */
class SocketTokenController extends Controller
{
    public function userToken(Request $request): JsonResponse
    {
        $user = $request->user();

        $token = app(TripTokenService::class)->issueUserToken((int) $user->id);

        return $this->successResponse([
            'userId' => $user->id,
            'room' => 'user:'.$user->id,
            'token' => $token,
            'role' => 'user',
        ]);
    }

    public function businessToken(Request $request): JsonResponse
    {
        $user = $request->user();
        $businessId = (int) $request->query('business_id');

        if ($businessId <= 0) {
            return $this->errorResponse('business_id is required.', 422);
        }

        if (! app(SocketChannelAuthorizer::class)->canAccessBusiness($user, $businessId)) {
            return $this->forbiddenResponse('You do not have access to this business channel.');
        }

        $token = app(TripTokenService::class)->issueBusinessToken($businessId, (int) $user->id);

        return $this->successResponse([
            'businessId' => $businessId,
            'room' => 'business:'.$businessId,
            'token' => $token,
            'role' => 'merchant',
        ]);
    }
}