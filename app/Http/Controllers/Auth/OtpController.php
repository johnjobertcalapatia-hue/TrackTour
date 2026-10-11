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

        // Non-consuming pre-check: registration performs the single-use
        // verification via OtpService::verifyAndConsume().
        if (! $this->otpService->verify($request->mobile_number, $request->otp_code)) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid or expired OTP.',
            ], 422);
        }

        return response()->json([
            'success' => true,
            'message' => 'OTP verified successfully.',
        ]);
    }
}
