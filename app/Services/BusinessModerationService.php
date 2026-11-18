<?php

namespace App\Services;

use App\Exceptions\ModerationException;
use App\Models\ActivityLog;
use App\Models\Business;
use App\Models\BusinessDocument;
use App\Models\BusinessStatusLog;
use App\Models\User;
use Illuminate\Support\Facades\Cache;

/**
 * Canonical business approval workflow, shared by the District Super Admin
 * (/admin/businesses) and the Municipality Tourism Admin (/municipal/businesses).
 * Callers are responsible for authorization and municipality scoping.
 */
class BusinessModerationService
{
    public function __construct(private MunicipalScopeService $scope) {}

    public function unverifiedDocumentCount(Business $business): int
    {
        return BusinessDocument::where('business_id', $business->id)
            ->where('verification_status', '!=', 'verified')
            ->count();
    }

    /**
     * @throws ModerationException when any document is not yet verified.
     */
    public function approve(Business $business, User $actor, ?string $remarks = null): Business
    {
        $unverified = $this->unverifiedDocumentCount($business);
        if ($unverified > 0) {
            throw new ModerationException(
                'All documents must be approved before the business can be approved. '.$unverified.' document(s) still pending or rejected.'
            );
        }

        $business->update(['status' => 'approved']);

        BusinessStatusLog::create([
            'business_id' => $business->id,
            'status' => 'approved',
            'remarks' => $remarks ?? 'Business approved by Tourism Office',
            'reviewed_by' => $actor->id,
        ]);

        $business->syncModulesFromCategory();
        Cache::forget("business_{$business->id}_modules");

        ActivityLog::record(
            'business.approved',
            $this->scope->auditPrefix($actor).sprintf('Approved business "%s".', $business->business_name),
            $business
        );

        return $business;
    }

    public function reject(Business $business, User $actor, string $remarks): Business
    {
        return $this->setStatus($business, $actor, 'rejected', $remarks, 'Rejected');
    }

    public function suspend(Business $business, User $actor, string $remarks): Business
    {
        return $this->setStatus($business, $actor, 'suspended', $remarks, 'Suspended');
    }

    public function reviewDocument(
        Business $business,
        BusinessDocument $document,
        User $actor,
        string $status,
        ?string $remarks = null
    ): BusinessDocument {
        $document->update([
            'verification_status' => $status,
            'admin_remarks' => $remarks ?? $document->admin_remarks,
            'verified_by' => $actor->id,
            'verified_at' => now(),
        ]);

        $document->load('requiredDocument');

        ActivityLog::record(
            'business_document.reviewed',
            $this->scope->auditPrefix($actor).sprintf(
                'Reviewed document "%s" for business "%s" → %s.',
                $document->requiredDocument?->name ?? $document->id,
                $business->business_name,
                $status
            ),
            $business
        );

        return $document;
    }

    private function setStatus(Business $business, User $actor, string $status, string $remarks, string $verb): Business
    {
        $business->update(['status' => $status]);

        BusinessStatusLog::create([
            'business_id' => $business->id,
            'status' => $status,
            'remarks' => $remarks,
            'reviewed_by' => $actor->id,
        ]);

        ActivityLog::record(
            'business.'.$status,
            $this->scope->auditPrefix($actor).sprintf('%s business "%s". Remarks: %s', $verb, $business->business_name, $remarks),
            $business
        );

        return $business;
    }
}
