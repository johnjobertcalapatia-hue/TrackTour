<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\BusinessResource;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\BusinessDocument;
use App\Models\BusinessStatusLog;
use App\Models\Municipality;
use App\Services\BusinessService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class AdminBusinessController extends Controller
{
    public function __construct(
        private BusinessService $businessService
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
            'documents',
            'media',
            'statusLogs' => fn ($q) => $q->latest()->limit(10),
        ]);

        return $this->successResponse(BusinessResource::make($business));
    }

    public function approve(Request $request, Business $business): JsonResponse
    {
        $unverified = BusinessDocument::where('business_id', $business->id)
            ->where('verification_status', '!=', 'verified')
            ->count();

        if ($unverified > 0) {
            return $this->errorResponse(
                'All documents must be approved before the business can be approved. ' . $unverified . ' document(s) still pending or rejected.',
                422
            );
        }

        $business->update(['status' => 'approved']);

        BusinessStatusLog::create([
            'business_id' => $business->id,
            'status' => 'approved',
            'remarks' => $request->input('remarks', 'Business approved by Tourism Office'),
            'reviewed_by' => $request->user()->id,
        ]);

        $business->syncModulesFromCategory();
        Cache::forget("business_{$business->id}_modules");

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

        $business->update(['status' => 'rejected']);

        BusinessStatusLog::create([
            'business_id' => $business->id,
            'status' => 'rejected',
            'remarks' => $request->remarks,
            'reviewed_by' => $request->user()->id,
        ]);

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

        $business->update(['status' => 'suspended']);

        BusinessStatusLog::create([
            'business_id' => $business->id,
            'status' => 'suspended',
            'remarks' => $request->remarks,
            'reviewed_by' => $request->user()->id,
        ]);

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

        $document->update([
            'verification_status' => $validated['verification_status'],
            'admin_remarks' => $validated['admin_remarks'] ?? $document->admin_remarks,
            'verified_by' => $request->user()->id,
            'verified_at' => now(),
        ]);

        $document->load('requiredDocument');

        return $this->successResponse($document, 'Document status updated.');
    }
}
