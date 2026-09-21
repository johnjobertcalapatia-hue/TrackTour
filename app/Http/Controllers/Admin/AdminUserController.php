<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\StoreUserRequest;
use App\Http\Requests\Admin\UpdateUserRequest;
use App\Http\Requests\Admin\UserActionRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Services\UserService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;

class AdminUserController extends Controller
{
    public function __construct(
        private UserService $userService
    ) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->only(['search', 'role', 'status']);
        $users = $this->userService->getPaginatedUsers($filters, 15);

        return $this->paginatedResponse($users->through(fn ($user) => UserResource::make($user)));
    }

    public function store(StoreUserRequest $request): JsonResponse
    {
        $user = $this->userService->createUser([
            'email' => $request->email,
            'password' => $request->password,
            'role' => $request->role,
            'account_status' => $request->input('account_status', User::ACCOUNT_STATUS_PENDING),
            'email_verified_at' => now(),
        ]);

        $user->profile()->create([
            'first_name' => $request->input('first_name', $request->input('name', '')),
            'last_name' => $request->input('last_name', ''),
        ]);

        return $this->createdResponse(
            UserResource::make($user->load('profile')),
            'User created successfully.'
        );
    }

    public function show(User $user): JsonResponse
    {
        $user->load('profile', 'municipality');

        return $this->successResponse(UserResource::make($user));
    }

    public function update(UpdateUserRequest $request, User $user): JsonResponse
    {
        $user = $this->userService->updateUser($user, [
            'email' => $request->email,
            'role' => $request->role,
            'account_status' => $request->input('account_status', $user->account_status),
        ]);

        $user->profile()->updateOrCreate([], [
            'first_name' => $request->input('first_name', $request->input('name', '')),
            'last_name' => $request->input('last_name', ''),
        ]);

        if ($request->filled('password')) {
            $user->update(['password' => Hash::make($request->password)]);
        }

        return $this->successResponse(
            UserResource::make($user->load('profile')),
            'User updated successfully.'
        );
    }

    public function destroy(User $user): JsonResponse
    {
        $this->userService->deleteUser($user);

        return $this->noContentResponse('User deleted successfully.');
    }

    public function approve(Request $request, User $user): JsonResponse
    {
        $user->update(['account_status' => User::ACCOUNT_STATUS_APPROVED]);

        $user->approvalRequests()->create([
            'reference_type' => User::class,
            'reference_id' => $user->id,
            'status' => 'approved',
            'remarks' => $request->input('remarks', 'Account approved by Admin'),
            'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(),
        ]);

        return $this->successResponse(
            UserResource::make($user),
            "Account for \"{$user->fullName}\" has been approved."
        );
    }

    public function reject(Request $request, User $user): JsonResponse
    {
        $request->validate([
            'remarks' => 'required|string|max:500',
        ]);

        $user->update(['account_status' => User::ACCOUNT_STATUS_REJECTED]);

        $user->approvalRequests()->create([
            'reference_type' => User::class,
            'reference_id' => $user->id,
            'status' => 'rejected',
            'remarks' => $request->remarks,
            'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(),
        ]);

        return $this->successResponse(
            UserResource::make($user),
            "Account for \"{$user->fullName}\" has been rejected."
        );
    }

    public function suspend(Request $request, User $user): JsonResponse
    {
        $request->validate([
            'remarks' => 'required|string|max:500',
        ]);

        $user->update(['account_status' => User::ACCOUNT_STATUS_SUSPENDED]);

        $user->approvalRequests()->create([
            'reference_type' => User::class,
            'reference_id' => $user->id,
            'status' => 'suspended',
            'remarks' => $request->remarks,
            'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(),
        ]);

        return $this->successResponse(
            UserResource::make($user),
            "Account for \"{$user->fullName}\" has been suspended."
        );
    }

    public function archive(Request $request, User $user): JsonResponse
    {
        if ($user->role === User::ROLE_BANSUD_TOURISM_OFFICE) {
            return $this->forbiddenResponse('Cannot archive system developer accounts.');
        }

        $user->update([
            'archived_at' => now(),
            'account_status' => User::ACCOUNT_STATUS_SUSPENDED,
        ]);

        $user->approvalRequests()->create([
            'reference_type' => User::class,
            'reference_id' => $user->id,
            'status' => 'archived',
            'remarks' => $request->input('remarks', 'Account archived'),
            'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(),
        ]);

        return $this->successResponse(
            UserResource::make($user),
            "Account for \"{$user->fullName}\" has been archived."
        );
    }

    public function restore(User $user): JsonResponse
    {
        $user->update([
            'archived_at' => null,
            'account_status' => User::ACCOUNT_STATUS_PENDING,
        ]);

        $user->approvalRequests()->create([
            'reference_type' => User::class,
            'reference_id' => $user->id,
            'status' => 'restored',
            'remarks' => 'Account restored from archive',
            'reviewed_by' => request()->user()->id,
            'reviewed_at' => now(),
        ]);

        return $this->successResponse(
            UserResource::make($user),
            "Account for \"{$user->fullName}\" has been restored."
        );
    }

    public function resetPassword(Request $request, User $user): JsonResponse
    {
        $request->validate([
            'password' => ['required', 'confirmed', Password::defaults()],
        ]);

        $user->update(['password' => Hash::make($request->password)]);

        return $this->successResponse(null, 'Password reset successfully.');
    }
}
