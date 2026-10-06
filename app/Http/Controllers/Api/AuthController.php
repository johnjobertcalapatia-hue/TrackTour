<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\RegisterRequest;
use App\Http\Resources\UserResource;
use App\Models\Barangay;
use App\Models\User;
use App\Services\DeliveryService;
use App\Services\UserService;
use Illuminate\Auth\Events\Registered;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class AuthController extends Controller
{
    public function __construct(
        private UserService $userService,
        private DeliveryService $deliveryService,
    ) {}

    public function register(RegisterRequest $request): JsonResponse
    {
        $userData = [
            'email' => $request->email,
            'password' => Hash::make($request->password),
            'role' => $request->role,
            'account_status' => $request->role === User::ROLE_BUSINESS_OWNER
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

            $validIdFrontPath = $request->file('valid_id_front')?->store('ids', 'public');
            $validIdBackPath = $request->file('valid_id_back')?->store('ids', 'public');
            $selfiePath = $request->file('selfie_holding_id')?->store('ids', 'public');

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
                    'mobile_number' => $request->mobile_number,
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

    public function login(LoginRequest $request): JsonResponse
    {
        $request->authenticate();

        $user = User::where('email', $request->email)->first();

        if (! $user) {
            return $this->unauthorizedResponse('The provided credentials are incorrect.');
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

        $resetUrl = "http://localhost:3000/reset-password?token={$token}&email=" . urlencode($user->email);

        Mail::to($user->email)->send(new \App\Mail\ResetPasswordMail($user->name ?? 'User', $resetUrl));

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
        if ($request->user()->hasVerifiedEmail()) {
            return $this->successResponse(null, 'Email already verified.');
        }

        $request->user()->sendEmailVerificationNotification();

        return $this->successResponse(null, 'A new verification link has been sent to your email address.');
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
