<?php

namespace App\Http\Controllers\Municipal;

use App\Http\Resources\UserResource;
use App\Models\User;
use App\Services\AccountModerationService;
use App\Services\MunicipalScopeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MunicipalRiderController extends MunicipalController
{
    public function __construct(
        MunicipalScopeService $scope,
        private AccountModerationService $moderation
    ) {
        parent::__construct($scope);
    }

    public function index(Request $request): JsonResponse
    {
        $id = $this->municipalityId($request);

        $query = $this->scope->riders($id)->with('profile', 'municipality', 'riderDetail');

        if ($status = $request->input('status')) {
            $query->where('account_status', $status);
        }

        if ($vehicle = $request->input('vehicle')) {
            $query->whereHas('riderDetail', fn ($q) => $q->where('vehicle_type', $vehicle));
        }

        if ($search = $request->input('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('users.email', 'like', "%{$search}%")
                    ->orWhere('users.name', 'like', "%{$search}%")
                    ->orWhereHas('profile', fn ($p) => $p->where('mobile_number', 'like', "%{$search}%")
                        ->orWhere('first_name', 'like', "%{$search}%")
                        ->orWhere('last_name', 'like', "%{$search}%"));
            });
        }

        $page = $query->latest()->paginate(15)->withQueryString()
            ->through(fn (User $rider) => array_merge(
                UserResource::make($rider)->resolve(),
                ['vehicle_type' => $rider->riderDetail?->vehicle_type]
            ));

        $base = fn () => $this->scope->riders($id);

        return $this->paginatedWithStats($page, [
            'total' => $base()->count(),
            'pending' => $base()->where('account_status', User::ACCOUNT_STATUS_PENDING)->count(),
            'approved' => $base()->where('account_status', User::ACCOUNT_STATUS_APPROVED)->count(),
            'rejected' => $base()->where('account_status', User::ACCOUNT_STATUS_REJECTED)->count(),
            'suspended' => $base()->where('account_status', User::ACCOUNT_STATUS_SUSPENDED)->count(),
            'active_now' => $base()
                ->where('account_status', User::ACCOUNT_STATUS_APPROVED)
                ->whereHas('riderDetail', fn ($q) => $q->whereIn('rider_status', MunicipalScopeService::ACTIVE_RIDER_STATUSES))
                ->count(),
        ], 'Riders retrieved successfully.');
    }

    public function show(Request $request, User $rider): JsonResponse
    {
        if (! $this->covers($request, $rider, User::ROLE_RIDER)) {
            return $this->notFoundResponse('Rider not found.');
        }

        $rider->load('municipality', 'profile.municipality', 'profile.barangay', 'riderDetail', 'riderReviews.admin');

        return $this->successResponse(array_merge(
            UserResource::make($rider)->resolve(),
            [
                'vehicle_type' => $rider->riderDetail?->vehicle_type,
                'plate_number' => $rider->riderDetail?->vehicle_plate_number,
                'history' => $rider->riderReviews->sortByDesc('created_at')->values()->map(fn ($r) => [
                    'decision' => $r->decision,
                    'remarks' => $r->remarks,
                    'reviewed_by' => $r->admin?->name,
                    'created_at' => $r->created_at,
                ]),
            ]
        ));
    }

    public function moderate(Request $request, User $rider, string $action): JsonResponse
    {
        if (! $this->covers($request, $rider, User::ROLE_RIDER)) {
            return $this->notFoundResponse('Rider not found.');
        }

        $remarks = $this->validatedRemarks($request, $action);
        $decision = self::MODERATION_ACTIONS[$action];

        $rider = $this->moderation->moderateRider($rider, $request->user(), $decision, $remarks);

        return $this->successResponse(
            UserResource::make($rider->load('profile', 'municipality', 'riderDetail')),
            "Rider account {$decision}."
        );
    }
}
