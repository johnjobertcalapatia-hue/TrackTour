<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class OtpController extends Controller
{
    public function sendOtp(Request $request): JsonResponse
    {
        $request->validate([
            'mobile_number' => ['required', 'string', 'regex:/^(\+63|0)9\d{9}$/'],
            'email' => ['required', 'email', 'max:255'],
        ]);

        $mobile = $request->mobile_number;
        $email = $request->email;
        $otp = str_pad(random_int(100000, 999999), 6, '0', STR_PAD_LEFT);

        // Store OTP with 5-minute expiry
        Cache::put("otp:{$mobile}", $otp, now()->addMinutes(5));

        Mail::raw(
            "Your TrackTour rider registration code is {$otp}. This code expires in 5 minutes.",
            function ($message) use ($email) {
                $message->to($email)->subject('TrackTour rider registration code');
            }
        );

        // SMS delivery requires a configured provider; retain the mobile target in logs for local integration.
        Log::info("Rider OTP generated for mobile {$mobile} and email {$email}");

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
        $otp = $request->otp_code;

        $storedOtp = Cache::get("otp:{$mobile}");

        if (! $storedOtp || $storedOtp !== $otp) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid or expired OTP.',
            ], 422);
        }

        // OTP verified, remove from cache
        Cache::forget("otp:{$mobile}");

        return response()->json([
            'success' => true,
            'message' => 'OTP verified successfully.',
        ]);
    }
}
