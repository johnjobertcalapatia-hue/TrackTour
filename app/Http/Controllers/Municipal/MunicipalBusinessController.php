<?php

namespace App\Http\Controllers\Municipal;

use App\Exceptions\ModerationException;
use App\Http\Resources\BusinessDocumentResource;
use App\Http\Resources\BusinessResource;
use App\Models\Business;
use App\Models\BusinessDocument;
use App\Services\BusinessModerationService;
use App\Services\MunicipalScopeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MunicipalBusinessController extends MunicipalController
{
    public function __construct(
        MunicipalScopeService $scope,
        private BusinessModerationService $moderation
    ) {
        parent::__construct($scope);
    }

    public function index(Request $request): JsonResponse
    {
        $id = $this->municipalityId($request);

        $query = $this->scope->businesses($id)->with(['owner', 'barangay', 'category', 'municipality']);

        if ($status = $request->input('status')) {
            $status === 'pending'
                ? $query->whereIn('status', MunicipalScopeService::PENDING_BUSINESS_STATUSES)
                : $query->where('status', $status);
        }

        if ($category = $request->input('category_id')) {
            $query->where('business_category_id', $category);
        }

        if ($search = $request->input('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('business_name', 'like', "%{$search}%")
                    ->orWhere('address', 'like', "%{$search}%")
                    ->orWhereHas('owner', fn ($o) => $o->where('name', 'like', "%{$search}%")
                        ->orWhere('email', 'like', "%{$search}%"));
            });
        }

        $page = $query->latest()->paginate(15)->withQueryString()
            ->through(fn (Business $b) => BusinessResource::make($b)->resolve());

        $base = fn () => $this->scope->businesses($id);

        return $this->paginatedWithStats($page, [
            'total' => $base()->count(),
            'pending' => $base()->whereIn('status', MunicipalScopeService::PENDING_BUSINESS_STATUSES)->count(),
            'approved' => $base()->where('status', 'approved')->count(),
            'rejected' => $base()->where('status', 'rejected')->count(),
            'suspended' => $base()->where('status', 'suspended')->count(),
        ], 'Businesses retrieved successfully.');
    }

    public function show(Request $request, Business $business): JsonResponse
    {
        if (! $this->scope->coversBusiness($request->user(), $business)) {
            return $this->notFoundResponse('Business not found.');
        }

        $business->load([
            'owner',
            'municipality',
            'barangay',
            'category',
            'documents.requiredDocument',
            'media',
            'statusLogs' => fn ($q) => $q->latest()->limit(10),
        ]);

        return $this->successResponse(BusinessResource::make($business));
    }

    public function moderate(Request $request, Business $business, string $action): JsonResponse
    {
        if (! $this->scope->coversBusiness($request->user(), $business)) {
            return $this->notFoundResponse('Business not found.');
        }

        $remarks = $this->validatedRemarks($request, $action);

        try {
            match ($action) {
                'approve' => $this->moderation->approve($business, $request->user(), $remarks),
                'reject' => $this->moderation->reject($business, $request->user(), $remarks),
                'suspend' => $this->moderation->suspend($business, $request->user(), $remarks),
            };
        } catch (ModerationException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }

        $label = ['approve' => 'approved', 'reject' => 'rejected', 'suspend' => 'suspended'][$action];

        return $this->successResponse(
            BusinessResource::make($business->fresh()->load(['owner', 'category', 'municipality', 'barangay'])),
            "Business \"{$business->business_name}\" has been {$label}."
        );
    }

    public function reviewDocument(Request $request, Business $business, BusinessDocument $document): JsonResponse
    {
        if (! $this->scope->coversBusiness($request->user(), $business) || $document->business_id !== $business->id) {
            return $this->notFoundResponse('Document not found.');
        }

        $validated = $request->validate([
            'verification_status' => ['required', 'string', 'in:verified,flagged,pending'],
            'admin_remarks' => ['nullable', 'string', 'max:1000'],
        ]);

        $document = $this->moderation->reviewDocument(
            $business,
            $document,
            $request->user(),
            $validated['verification_status'],
            $validated['admin_remarks'] ?? null
        );

        return $this->successResponse(BusinessDocumentResource::make($document), 'Document status updated.');
    }
}
