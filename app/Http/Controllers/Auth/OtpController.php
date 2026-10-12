<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Services\OtpService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OtpController extends Controller
{
    public function __construct(private OtpService $otpService) {}

    public function sendOtp(Request $request): JsonResponse
    {
        $request->validate([
            'mobile_number' => ['required', 'string', 'regex:/^(\+63|0)9\d{9}$/'],
            'email' => ['required', 'email', 'max:255'],
        ]);

        $mobile = $request->mobile_number;
        $email = $request->email;

        if ($this->otpService->isLockedOut($mobile)) {
            return $this->lockedOutResponse($mobile);
        }

        $otp = $this->otpService->send($mobile, $email);

        return response()->json([
            'success' => true,
            'message' => 'OTP sent successfully.',
            // Remove this in production - only for development
            'otp' => config('app.env') === 'local' ? $otp : null,
        ]);
    }

    public function verifyOtp(Request $request): JsonResponse
    {
        $request->validate([
            'mobile_number' => ['required', 'string', 'regex:/^(\+63|0)9\d{9}$/'],
            'otp_code' => ['required', 'string', 'size:6'],
        ]);

        $mobile = $request->mobile_number;

        if ($this->otpService->isLockedOut($mobile)) {
            return $this->lockedOutResponse($mobile);
        }

        // Non-consuming pre-check: registration performs the single-use
        // verification via OtpService::verifyAndConsume().
        if (! $this->otpService->verify($mobile, $request->otp_code)) {
            // The failed attempt may have just crossed the lockout threshold.
            if ($this->otpService->isLockedOut($mobile)) {
                return $this->lockedOutResponse($mobile);
            }

            $remaining = $this->otpService->remainingAttempts($mobile);

            return response()->json([
                'success' => false,
                'message' => "Invalid or expired OTP. {$remaining} attempt(s) remaining.",
                'attempts_remaining' => $remaining,
            ], 422);
        }

        return response()->json([
            'success' => true,
            'message' => 'OTP verified successfully.',
        ]);
    }

    /**
     * Uniform 429 body for both OTP endpoints while a mobile is locked out.
     */
    private function lockedOutResponse(string $mobile): JsonResponse
    {
        $seconds = $this->otpService->lockoutSecondsRemaining($mobile);
        $minutes = (int) max(1, ceil($seconds / 60));

        return response()->json([
            'success' => false,
            'message' => "Too many failed attempts. Please try again in {$minutes} minute(s).",
            'retry_after' => $seconds,
        ], 429);
    }
}
