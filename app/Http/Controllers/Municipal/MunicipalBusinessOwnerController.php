<?php

namespace App\Http\Controllers\Municipal;

use App\Http\Resources\BusinessResource;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Services\AccountModerationService;
use App\Services\MunicipalScopeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MunicipalBusinessOwnerController extends MunicipalController
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

        $query = $this->scope->businessOwners($id)
            ->with('profile', 'municipality')
            ->withCount(['businesses' => fn ($q) => $q->where('municipality_id', $id)])
            ->whereNull('archived_at');

        if ($status = $request->input('status')) {
            $query->where('account_status', $status);
        }

        if ($search = $request->input('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('users.email', 'like', "%{$search}%")
                    ->orWhere('users.name', 'like', "%{$search}%")
                    ->orWhereHas('profile', fn ($p) => $p->where('first_name', 'like', "%{$search}%")
                        ->orWhere('last_name', 'like', "%{$search}%")
                        ->orWhere('mobile_number', 'like', "%{$search}%"));
            });
        }

        $page = $query->latest()->paginate(15)->withQueryString()
            ->through(fn (User $owner) => array_merge(
                UserResource::make($owner)->resolve(),
                ['businesses_count' => $owner->businesses_count]
            ));

        return $this->paginatedWithStats($page, $this->statusStats($id), 'Business owners retrieved successfully.');
    }

    public function show(Request $request, User $owner): JsonResponse
    {
        $id = $this->municipalityId($request);
        if (! $this->covers($request, $owner, User::ROLE_BUSINESS_OWNER)) {
            return $this->notFoundResponse('Business owner not found.');
        }

        $owner->load([
            'profile',
            'municipality',
            'kyc',
            'businesses' => fn ($q) => $q->where('municipality_id', $id)->with('category', 'barangay', 'municipality'),
            'approvalRequests' => fn ($q) => $q->latest()->limit(10),
        ]);

        $kyc = $owner->kyc;

        return $this->successResponse([
            'owner' => UserResource::make($owner)->resolve(),
            'businesses' => BusinessResource::collection($owner->businesses)->resolve(),
            'kyc' => $kyc ? [
                'government_id_type' => $kyc->government_id_type,
                'verification_status' => $kyc->verification_status,
                'documents' => collect([
                    'valid_id_front' => ['Valid ID (front)', 'valid-id-front'],
                    'valid_id_back' => ['Valid ID (back)', 'valid-id-back'],
                    'selfie_holding_id' => ['Selfie holding ID', 'selfie-holding-id'],
                ])->filter(fn ($details, $field) => filled($kyc->getAttribute($field)))
                    ->map(fn ($details) => [
                        'name' => $details[0],
                        'file_url' => route('api.user-kyc.file', [$kyc->id, $details[1]]),
                    ])->values(),
            ] : null,
            'history' => $owner->approvalRequests->map(fn ($r) => [
                'status' => $r->status,
                'remarks' => $r->remarks,
                'reviewed_at' => $r->reviewed_at,
            ]),
        ]);
    }

    public function moderate(Request $request, User $owner, string $action): JsonResponse
    {
        if (! $this->covers($request, $owner, User::ROLE_BUSINESS_OWNER)) {
            return $this->notFoundResponse('Business owner not found.');
        }

        $remarks = $this->validatedRemarks($request, $action);
        $decision = self::MODERATION_ACTIONS[$action];

        $owner = $this->moderation->moderateBusinessOwner($owner, $request->user(), $decision, $remarks);

        return $this->successResponse(
            UserResource::make($owner->load('profile', 'municipality')),
            "Business owner account {$decision}."
        );
    }

    private function statusStats(int $id): array
    {
        $base = fn () => $this->scope->businessOwners($id)->whereNull('archived_at');

        return [
            'total' => $base()->count(),
            'pending' => $base()->where('account_status', User::ACCOUNT_STATUS_PENDING)->count(),
            'approved' => $base()->where('account_status', User::ACCOUNT_STATUS_APPROVED)->count(),
            'rejected' => $base()->where('account_status', User::ACCOUNT_STATUS_REJECTED)->count(),
            'suspended' => $base()->where('account_status', User::ACCOUNT_STATUS_SUSPENDED)->count(),
        ];
    }
}
