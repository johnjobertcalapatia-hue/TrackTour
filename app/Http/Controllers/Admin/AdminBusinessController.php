<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\BusinessDocumentResource;
use App\Http\Resources\BusinessResource;
use App\Exceptions\ModerationException;
use App\Models\Business;
use App\Models\BusinessDocument;
use App\Services\BusinessModerationService;
use App\Services\BusinessService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminBusinessController extends Controller
{
    public function __construct(
        private BusinessService $businessService,
        private BusinessModerationService $moderation
    ) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->only(['search', 'status', 'category', 'municipality']);
        $businesses = $this->businessService->getPaginatedBusinesses($filters, 15);

        return $this->paginatedResponse(
            $businesses->through(fn ($business) => BusinessResource::make($business))
        );
    }

    public function show(Business $business): JsonResponse
    {
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

    public function approve(Request $request, Business $business): JsonResponse
    {
        try {
            $this->moderation->approve($business, $request->user(), $request->input('remarks'));
        } catch (ModerationException $e) {
            return $this->errorResponse($e->getMessage(), 422);
        }

        return $this->successResponse(
            BusinessResource::make($business->fresh()->load(['owner', 'category', 'municipality'])),
            "Business \"{$business->business_name}\" has been approved. Modules assigned from {$business->category->name} template."
        );
    }

    public function reject(Request $request, Business $business): JsonResponse
    {
        $request->validate([
            'remarks' => 'required|string|max:500',
        ]);

        $this->moderation->reject($business, $request->user(), $request->remarks);

        return $this->successResponse(
            BusinessResource::make($business),
            "Business \"{$business->business_name}\" has been rejected."
        );
    }

    public function suspend(Request $request, Business $business): JsonResponse
    {
        $request->validate([
            'remarks' => 'required|string|max:500',
        ]);

        $this->moderation->suspend($business, $request->user(), $request->remarks);

        return $this->successResponse(
            BusinessResource::make($business),
            "Business \"{$business->business_name}\" has been suspended."
        );
    }

    public function reviewDocument(Request $request, Business $business, BusinessDocument $document): JsonResponse
    {
        if ($document->business_id !== $business->id) {
            return $this->errorResponse('Document does not belong to this business.', 404);
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
