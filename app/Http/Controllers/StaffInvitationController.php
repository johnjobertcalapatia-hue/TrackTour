<?php

namespace App\Http\Controllers;

use App\Models\StaffInvitation;
use App\Services\StaffAccountService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rules\Password;

/**
 * Public staff activation (Staff Management Stage 1): the invited staff member
 * opens the emailed link and sets their own password. Throttled; the token is
 * single-use and expires after 72 hours.
 */
class StaffInvitationController extends Controller
{
    public function __construct(private StaffAccountService $accounts) {}

    /** GET /staff-invitations/{token} — who invited them, for the activation page. */
    public function show(string $token): JsonResponse
    {
        $invitation = StaffInvitation::findByToken($token);
        if (! $invitation) {
            return $this->errorResponse('This invitation link is not valid.', 404);
        }

        $state = $invitation->state();
        $staff = $invitation->staff()->with('user.profile', 'staffRole', 'business')->first();

        return $this->successResponse([
            'state' => $state,
            'email' => $invitation->email,
            'name' => $staff?->full_name,
            'business' => $staff?->business?->business_name,
            'role' => $staff?->staffRole?->name,
            'expires_at' => $invitation->expires_at,
        ]);
    }

    /** POST /staff-invitations/{token}/accept {password, password_confirmation} */
    public function accept(Request $request, string $token): JsonResponse
    {
        $validated = $request->validate([
            'password' => ['required', 'confirmed', Password::defaults()],
        ]);

        try {
            $staff = $this->accounts->accept($token, $validated['password']);
        } catch (\InvalidArgumentException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }

        return $this->successResponse([
            'email' => $staff->user->email,
        ], 'Your account is active. Sign in with your email and new password.');
    }
}
