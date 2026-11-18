<?php

namespace App\Http\Controllers\Municipal;

use App\Http\Resources\BusinessDocumentResource;
use App\Http\Resources\UserResource;
use App\Models\BusinessDocument;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Verification queue for the municipality: business documents (reviewed one by
 * one through the business review endpoint) and rider requirements (reviewed
 * as part of the rider account decision).
 */
class MunicipalDocumentController extends MunicipalController
{
    public const BUSINESS_STATUSES = ['pending', 'flagged', 'verified'];

    public function index(Request $request): JsonResponse
    {
        $id = $this->municipalityId($request);
        $validated = $request->validate([
            'type' => ['nullable', 'in:business,rider'],
            'status' => ['nullable', 'in:pending,flagged,verified,all'],
            'search' => ['nullable', 'string', 'max:100'],
        ]);

        return ($validated['type'] ?? 'business') === 'rider'
            ? $this->riders($id, $validated)
            : $this->businessDocuments($id, $validated);
    }

    private function businessDocuments(int $id, array $filters): JsonResponse
    {
        $status = $filters['status'] ?? 'pending';

        $query = $this->documentsQuery($id)
            ->with(['requiredDocument', 'business:id,business_name,status,business_category_id', 'business.category:id,name'])
            ->latest('updated_at');

        if ($status !== 'all') {
            $query->where('verification_status', $status);
        }

        if ($search = $filters['search'] ?? null) {
            $query->whereHas('business', fn ($b) => $b->where('business_name', 'like', "%{$search}%"));
        }

        $page = $query->paginate(15)->withQueryString()->through(fn (BusinessDocument $doc) => array_merge(
            BusinessDocumentResource::make($doc)->resolve(),
            [
                'uploaded_at' => $doc->created_at,
                'business' => [
                    'id' => $doc->business?->id,
                    'business_name' => $doc->business?->business_name,
                    'category' => $doc->business?->category?->name,
                    'status' => $doc->business?->status,
                ],
            ]
        ));

        return $this->paginatedWithStats($page, $this->stats($id), 'Documents retrieved successfully.');
    }

    private function riders(int $id, array $filters): JsonResponse
    {
        $query = $this->scope->riders($id)
            ->with('profile', 'riderDetail')
            ->where('account_status', User::ACCOUNT_STATUS_PENDING)
            ->latest();

        if ($search = $filters['search'] ?? null) {
            $query->where(fn ($q) => $q->where('users.name', 'like', "%{$search}%")->orWhere('users.email', 'like', "%{$search}%"));
        }

        $page = $query->paginate(15)->withQueryString()->through(fn (User $rider) => array_merge(
            UserResource::make($rider)->resolve(),
            [
                'vehicle_type' => $rider->riderDetail?->vehicle_type,
                'license_number' => $rider->riderDetail?->license_number,
                'license_expiry' => $rider->riderDetail?->license_expiry,
            ]
        ));

        return $this->paginatedWithStats($page, $this->stats($id), 'Rider requirements retrieved successfully.');
    }

    private function documentsQuery(int $id)
    {
        return BusinessDocument::query()
            ->whereHas('business', fn ($b) => $b->where('municipality_id', $id));
    }

    private function stats(int $id): array
    {
        $counts = $this->documentsQuery($id)
            ->selectRaw('verification_status, COUNT(*) as aggregate')
            ->groupBy('verification_status')
            ->pluck('aggregate', 'verification_status');

        return [
            'business_pending' => (int) ($counts['pending'] ?? 0),
            'business_flagged' => (int) ($counts['flagged'] ?? 0),
            'business_verified' => (int) ($counts['verified'] ?? 0),
            'riders_pending' => $this->scope->riders($id)->where('account_status', User::ACCOUNT_STATUS_PENDING)->count(),
        ];
    }
}
