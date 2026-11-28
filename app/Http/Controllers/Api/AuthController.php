<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\RegisterRequest;
use App\Http\Resources\UserResource;
use App\Exceptions\OtpDeliveryException;
use App\Models\Barangay;
use App\Models\User;
use App\Services\DeliveryService;
use App\Services\EmailVerificationOtpService;
use App\Services\OtpService;
use App\Services\UserService;
use Illuminate\Auth\Events\Registered;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function __construct(
        private UserService $userService,
        private DeliveryService $deliveryService,
        private OtpService $otpService,
        private EmailVerificationOtpService $emailVerificationOtpService,
    ) {}

    public function register(RegisterRequest $request): JsonResponse
    {
        // Rider registration requires a single-use code, delivered to the
        // applicant's email. This is the authoritative consume point: the
        // account cannot be created with a missing, wrong, expired or
        // already-used code, and a code bound to another email is refused.
        if ($request->role === User::ROLE_RIDER) {
            if ($this->otpService->isLockedOut($request->mobile_number)) {
                $seconds = $this->otpService->lockoutSecondsRemaining($request->mobile_number);

                return response()->json([
                    'success' => false,
                    'message' => 'Too many failed attempts. Please try again in '.(int) max(1, ceil($seconds / 60)).' minute(s).',
                    'retry_after' => $seconds,
                ], 429);
            }

            // The code was emailed; it proves the email only if it is used with
            // the same address it was sent to.
            $boundEmail = $this->otpService->boundEmail($request->mobile_number);
            if ($boundEmail !== null && $boundEmail !== OtpService::normalizeEmail((string) $request->email)) {
                throw ValidationException::withMessages([
                    'email' => ['Use the email address the verification code was sent to, or request a new code.'],
                ]);
            }

            if (! $this->otpService->verifyAndConsume($request->mobile_number, (string) $request->otp_code)) {
                throw ValidationException::withMessages([
                    'otp_code' => ['The OTP is invalid or has expired. Please request a new code.'],
                ]);
            }
        }

        $userData = [
            'email' => $request->email,
            'password' => Hash::make($request->password),
            'role' => $request->role,
            // Business owners await document approval; riders complete the
            // Tourism Office onboarding (appointment, interview, training,
            // assessment) before activation.
            'account_status' => in_array($request->role, [User::ROLE_BUSINESS_OWNER, User::ROLE_RIDER], true)
                ? User::ACCOUNT_STATUS_PENDING
                : User::ACCOUNT_STATUS_APPROVED,
        ];

        if ($request->role === User::ROLE_BUSINESS_OWNER) {
            $userData['name'] = trim($request->first_name.' '.$request->last_name);

            $user = User::create($userData);
            $barangay = Barangay::where('municipality_id', $request->municipality_id)
                ->where('name', $request->barangay)
                ->first();

            $user->profile()->create([
                'first_name' => $request->first_name,
                'middle_name' => $request->middle_name,
                'last_name' => $request->last_name,
                'suffix' => $request->suffix,
                'date_of_birth' => $request->date_of_birth,
                'sex' => $request->sex,
                'nationality' => $request->nationality,
                'mobile_number' => $request->mobile_number,
                'municipality_id' => $request->municipality_id,
                'barangay_id' => $barangay?->id,
                'house_no_street' => $request->house_no_street,
                'zip_code' => $request->zip_code,
            ]);

            $validIdFrontPath = $request->file('valid_id_front')?->store('ids', 'local');
            $validIdBackPath = $request->file('valid_id_back')?->store('ids', 'local');
            $selfiePath = $request->file('selfie_holding_id')?->store('ids', 'local');

            $user->kyc()->create([
                'government_id_type' => $request->government_id_type,
                'government_id_number' => $request->government_id_number,
                'valid_id_front' => $validIdFrontPath,
                'valid_id_back' => $validIdBackPath,
                'selfie_holding_id' => $selfiePath,
                'tin' => $request->tin,
                'verification_status' => 'pending',
            ]);
        } else {
            if (in_array($request->role, [User::ROLE_TOURIST, User::ROLE_TOURISM_OFFICE])) {
                $userData['name'] = trim($request->first_name.' '.$request->last_name);
            } elseif ($request->role === User::ROLE_RIDER) {
                $userData['name'] = trim($request->first_name.' '.$request->last_name);
                $userData['municipality_id'] = (int) $request->municipality_id;
                // The registration code was emailed to this address, so a
                // successful code is the email verification.
                if (isset($boundEmail) && $boundEmail !== null) {
                    $userData['email_verified_at'] = now();
                }
            } else {
                $userData['name'] = $request->name;
            }

            $user = User::create($userData);

            if ($request->role === User::ROLE_RIDER) {
                $user->profile()->create([
                    'first_name' => $request->first_name,
                    'middle_name' => $request->middle_name,
                    'last_name' => $request->last_name,
                    'suffix' => $request->suffix,
                    'date_of_birth' => $request->date_of_birth,
                    'mobile_number' => $request->mobile_number,
                    'municipality_id' => (int) $request->municipality_id,
                    'barangay_id' => (int) $request->barangay_id,
                ]);

                $user->riderDetail()->create([
                    'referral_code' => $request->referral_code,
                    'current_service' => User::SERVICE_FOOD,
                ]);
            }

            if (in_array($request->role, [User::ROLE_TOURIST, User::ROLE_TOURISM_OFFICE])) {
                $user->profile()->create([
                    'first_name' => $request->first_name,
                    'middle_name' => $request->middle_name,
                    'last_name' => $request->last_name,
                    'date_of_birth' => $request->date_of_birth,
                    'mobile_number' => $request->mobile_number,
                ]);

                $user->tourist()->create([
                    'first_name' => $request->first_name,
                    'last_name' => $request->last_name,
                    'dob' => $request->date_of_birth,
                    'nationality' => $request->nationality ?? null,
                    'bio' => $request->bio ?? null,
                    'preferences' => $request->preferences ?? null,
                ]);
            }
        }

        event(new Registered($user));

        $token = $user->createToken('api-token')->plainTextToken;

        return $this->createdResponse([
            'user' => UserResource::make($user->load('profile', 'municipality', 'kyc', 'businesses', 'riderDetail')),
            'token' => $token,
        ], 'Registration successful.');
    }

    /**
     * Lightweight, unauthenticated email availability probe used by the
     * registration forms to warn on-type before submit. The authoritative
     * uniqueness check still happens on register (RegisterRequest + DB unique);
     * this endpoint never mutates anything.
     */
    public function checkEmail(Request $request): JsonResponse
    {
        $request->validate([
            'email' => ['required', 'string', 'email', 'max:255'],
        ]);

        // Emails are stored lowercased (RegisterRequest `lowercase` rule).
        $email = Str::lower(trim($request->email));
        $available = ! User::where('email', $email)->exists();

        return response()->json([
            'success' => true,
            'message' => $available ? 'Email is available.' : 'Email is already registered.',
            'data' => [
                'email' => $email,
                'available' => $available,
            ],
        ]);
    }

    public function login(LoginRequest $request): JsonResponse
    {
        $request->authenticate();

        $user = User::where('email', $request->email)->first();

        if (! $user) {
            return $this->unauthorizedResponse('The provided credentials are incorrect.');
        }

        // Staff Management Stage 1: a pending, suspended, deactivated or
        // removed staff account gets no token, even with the right password.
        $staffAccess = app(\App\Services\StaffAccess::class);
        if ($reason = $staffAccess->loginBlockReason($user)) {
            return $this->forbiddenResponse($reason);
        }
        if ($staff = $staffAccess->activeStaff($user)) {
            $staff->forceFill(['last_login_at' => now(), 'last_login_ip' => $request->ip()])->save();
        }

        $token = $user->createToken('api-token')->plainTextToken;

        return $this->successResponse([
            'user' => UserResource::make($user->load('profile', 'municipality', 'kyc', 'businesses', 'riderDetail')),
            'token' => $token,
        ], 'Login successful.');
    }

    public function logout(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user) {
            if ($user->role === User::ROLE_RIDER) {
                // A mid-trip rider must stay online for the WHOLE trip (the
                // toggle's own guard already enforces this). Logging out must
                // never clobber that state: a rider dropped to 'offline' while
                // still bound to a live delivery then logs back in to a grey
                // "Go Online" button whose tap is rejected by the trip guard.
                if (! $this->deliveryService->riderHasActiveTrip($user)) {
                    $user->riderDetail()->updateOrCreate(
                        ['user_id' => $user->id],
                        [
                            'rider_status' => User::RIDER_STATUS_OFFLINE,
                            'rider_status_updated_at' => now(),
                        ]
                    );
                }
            }

            $token = $user->currentAccessToken();
            if ($token) {
                $token->delete();
            } elseif ($request->bearerToken()) {
                \Laravel\Sanctum\PersonalAccessToken::where('token', hash('sha256', $request->bearerToken()))->delete();
            }
        }

        return $this->successResponse(null, 'Logged out successfully.');
    }

    public function user(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! $user) {
            return $this->unauthorizedResponse('Unauthenticated.');
        }

        return $this->successResponse(
            UserResource::make($user->load('profile.municipality', 'municipality', 'kyc', 'businesses', 'riderDetail'))
        );
    }

    public function forgotPassword(Request $request): JsonResponse
    {
        $request->validate(['email' => 'required|email']);

        $user = User::where('email', $request->email)->first();

        if (! $user) {
            return $this->successResponse(null, 'If an account exists with that email, a password reset link has been sent.');
        }

        $token = Str::random(64);

        \DB::table('password_resets')->updateOrInsert(
            ['email' => $user->email],
            [
                'token' => Hash::make($token),
                'created_at' => now(),
            ]
        );

        $frontendUrl = rtrim((string) config('app.frontend_url', 'http://localhost:3000'), '/');
        $resetUrl = $frontendUrl.'/reset-password?token='.$token.'&email='.urlencode($user->email);

        try {
            Mail::to($user->email)->send(new \App\Mail\ResetPasswordMail($user->name ?? 'User', $resetUrl));
        } catch (\Throwable $e) {
            \DB::table('password_resets')->where('email', $user->email)->delete();
            report($e);

            return $this->errorResponse('Password reset email could not be sent. Please try again later.', 503);
        }

        return $this->successResponse(null, 'If an account exists with that email, a password reset link has been sent.');
    }

    public function resetPassword(Request $request): JsonResponse
    {
        $request->validate([
            'token' => 'required',
            'email' => 'required|email',
            'password' => 'required|min:8|confirmed',
        ]);

        $record = \DB::table('password_resets')
            ->where('email', $request->email)
            ->first();

        if (! $record || ! Hash::check($request->token, $record->token)) {
            return $this->errorResponse('Invalid or expired reset token.', 422);
        }

        if (now()->diffInMinutes($record->created_at) > 60) {
            \DB::table('password_resets')->where('email', $request->email)->delete();
            return $this->errorResponse('Reset token has expired. Please request a new one.', 422);
        }

        $user = User::where('email', $request->email)->first();
        if (! $user) {
            return $this->errorResponse('User not found.', 422);
        }

        $user->forceFill([
            'password' => Hash::make($request->password),
            'remember_token' => Str::random(60),
        ])->save();

        \DB::table('password_resets')->where('email', $request->email)->delete();

        return $this->successResponse(null, 'Password has been reset successfully.');
    }

    public function sendVerificationEmail(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user->hasVerifiedEmail()) {
            return $this->successResponse(
                ['retry_after' => 0],
                'Email already verified.',
            );
        }

        if ($this->emailVerificationOtpService->isLockedOut($user)) {
            return response()->json([
                'success' => false,
                'message' => 'Too many failed attempts. Please try again later.',
                'retry_after' => $this->emailVerificationOtpService->lockoutSecondsRemaining($user),
            ], 429);
        }

        try {
            $retryAfter = $this->emailVerificationOtpService->send($user);
        } catch (OtpDeliveryException $e) {
            return $this->errorResponse('The verification code could not be emailed. Please try again later.', 503);
        }

        return $this->successResponse(
            ['retry_after' => $retryAfter],
            $retryAfter > 0
                ? 'A verification code was recently sent. Check your inbox before requesting another.'
                : 'A verification code has been sent to your email address.',
        );
    }

    public function verifyEmailOtp(Request $request): JsonResponse
    {
        $request->validate([
            'otp_code' => ['required', 'string', 'regex:/^\d{6}$/'],
        ]);

        $user = $request->user();

        if ($user->hasVerifiedEmail()) {
            return $this->successResponse(null, 'Email already verified.');
        }

        if ($this->emailVerificationOtpService->isLockedOut($user)) {
            return response()->json([
                'success' => false,
                'message' => 'Too many failed attempts. Please try again later.',
                'retry_after' => $this->emailVerificationOtpService->lockoutSecondsRemaining($user),
            ], 429);
        }

        if ($this->emailVerificationOtpService->verifyAndConsume($user, $request->string('otp_code')->toString())) {
            event(new Verified($user));

            return $this->successResponse([
                'email_verified_at' => $user->fresh()->email_verified_at,
            ], 'Email verified successfully.');
        }

        if ($this->emailVerificationOtpService->isLockedOut($user)) {
            return response()->json([
                'success' => false,
                'message' => 'Too many failed attempts. Please try again later.',
                'retry_after' => $this->emailVerificationOtpService->lockoutSecondsRemaining($user),
            ], 429);
        }

        $remaining = $this->emailVerificationOtpService->remainingAttempts($user);

        return response()->json([
            'success' => false,
            'message' => "Invalid or expired verification code. {$remaining} attempt(s) remaining.",
            'attempts_remaining' => $remaining,
        ], 422);
    }

    public function confirmPassword(Request $request): JsonResponse
    {
        $request->validate([
            'password' => 'required',
        ]);

        if (! Hash::check($request->password, $request->user()->password)) {
            return $this->errorResponse('The provided password does not match.', 422);
        }

        return $this->successResponse(null, 'Password confirmed.');
    }
}
