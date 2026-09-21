<?php

namespace App\Http\Controllers\TourismOffice;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\Municipality;
use App\Models\User;
use App\Services\TourismOfficeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BusinessOwnerApprovalController extends Controller
{
    private array $managedRoles = [
        User::ROLE_BUSINESS_OWNER,
        User::ROLE_TOURIST,
        User::ROLE_RIDER,
    ];

    public function __construct(
        private TourismOfficeService $tourismOfficeService
    ) {}

    public function index(Request $request): JsonResponse
    {
        $query = User::whereIn('role', $this->managedRoles)
            ->with('municipality', 'profile')
            ->withCount('businesses');

        if ($request->filled('status')) {
            if ($request->status === 'archived') {
                $query->whereNotNull('archived_at');
            } else {
                $query->where('account_status', $request->status)->whereNull('archived_at');
            }
        } else {
            $query->whereNull('archived_at');
        }

        if ($request->filled('role')) {
            $query->where('role', $request->role);
        }

        if ($request->filled('search')) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('email', 'like', "%{$search}%")
                    ->orWhereHas('profile', function ($q2) use ($search) {
                        $q2->where('first_name', 'like', "%{$search}%")
                            ->orWhere('last_name', 'like', "%{$search}%");
                    });
            });
        }

        if ($request->filled('municipality_id')) {
            $query->where('municipality_id', $request->municipality_id);
        }

        $users = $query->latest()->paginate(15)->withQueryString();

        $baseQuery = fn () => User::whereIn('role', $this->managedRoles);
        $activeQuery = fn () => $baseQuery()->whereNull('archived_at');

        $stats = [
            'total' => $activeQuery()->count(),
            'pending' => $activeQuery()->where('account_status', User::ACCOUNT_STATUS_PENDING)->count(),
            'approved' => $activeQuery()->where('account_status', User::ACCOUNT_STATUS_APPROVED)->count(),
            'rejected' => $activeQuery()->where('account_status', User::ACCOUNT_STATUS_REJECTED)->count(),
            'archived' => $baseQuery()->whereNotNull('archived_at')->count(),
        ];

        return $this->paginatedResponse(
            $users->through(fn ($user) => UserResource::make($user)),
            'Users retrieved successfully.',
        );
    }

    public function show(User $user): JsonResponse
    {
        if (! in_array($user->role, $this->managedRoles)) {
            return $this->notFoundResponse('User not found.');
        }

        $user->load([
            'profile',
            'kyc',
            'municipality',
            'businesses' => function ($q) {
                $q->with('category', 'municipality');
            },
            'approvalRequests' => function ($q) {
                $q->latest()->limit(10);
            },
        ]);

        return $this->successResponse(UserResource::make($user));
    }

    public function approve(Request $request, User $user): JsonResponse
    {
        if (! in_array($user->role, $this->managedRoles)) {
            return $this->notFoundResponse('User not found.');
        }

        $user->update(['account_status' => User::ACCOUNT_STATUS_APPROVED]);

        $user->approvalRequests()->create([
            'reference_type' => User::class,
            'reference_id' => $user->id,
            'status' => 'approved',
            'remarks' => $request->input('remarks', 'Account approved by Tourism Office'),
            'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(),
        ]);

        return $this->successResponse(
            UserResource::make($user->fresh()),
            "Account for \"{$user->fullName}\" has been approved."
        );
    }

    public function reject(Request $request, User $user): JsonResponse
    {
        if (! in_array($user->role, $this->managedRoles)) {
            return $this->notFoundResponse('User not found.');
        }

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
            UserResource::make($user->fresh()),
            "Account for \"{$user->fullName}\" has been rejected."
        );
    }

    public function archive(Request $request, User $user): JsonResponse
    {
        if (! in_array($user->role, $this->managedRoles)) {
            return $this->notFoundResponse('User not found.');
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
            UserResource::make($user->fresh()),
            "Account for \"{$user->fullName}\" has been archived."
        );
    }

    public function suspend(Request $request, User $user): JsonResponse
    {
        if (! in_array($user->role, $this->managedRoles)) {
            return $this->notFoundResponse('User not found.');
        }

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
            UserResource::make($user->fresh()),
            "Account for \"{$user->fullName}\" has been suspended."
        );
    }

    public function restore(User $user): JsonResponse
    {
        if (! in_array($user->role, $this->managedRoles)) {
            return $this->notFoundResponse('User not found.');
        }

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
            UserResource::make($user->fresh()),
            "Account for \"{$user->fullName}\" has been restored."
        );
    }
}
