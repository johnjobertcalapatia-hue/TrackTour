<?php

namespace App\Http\Controllers\Municipal;

use App\Http\Controllers\Controller;
use App\Models\Municipality;
use App\Models\User;
use App\Services\MunicipalScopeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;

/**
 * Base for the Municipality Tourism Admin controllers. The municipality is
 * always the one resolved by the `municipal.scope` middleware.
 */
abstract class MunicipalController extends Controller
{
    public const MODERATION_ACTIONS = [
        'approve' => 'approved',
        'reject' => 'rejected',
        'suspend' => 'suspended',
        'reactivate' => 'reactivated',
    ];

    public function __construct(protected MunicipalScopeService $scope) {}

    protected function municipality(Request $request): Municipality
    {
        return $request->attributes->get('municipality');
    }

    protected function municipalityId(Request $request): int
    {
        return (int) $this->municipality($request)->id;
    }

    /** The account has the expected role AND sits inside the officer's municipality. */
    protected function covers(Request $request, User $subject, string $role): bool
    {
        return $subject->role === $role && $this->scope->coversUser($request->user(), $subject);
    }

    /** Remarks are required when rejecting or suspending, optional otherwise. */
    protected function validatedRemarks(Request $request, string $action): ?string
    {
        $rule = in_array($action, ['reject', 'suspend'], true) ? 'required' : 'nullable';

        return $request->validate([
            'remarks' => [$rule, 'string', 'max:1000'],
        ])['remarks'] ?? null;
    }

    /** Paginated list with extra meta (stats) in the shape the frontend already reads. */
    protected function paginatedWithStats(LengthAwarePaginator $page, array $stats, string $message): JsonResponse
    {
        return $this->successResponse($page->items(), $message, 200, [
            'current_page' => $page->currentPage(),
            'last_page' => $page->lastPage(),
            'per_page' => $page->perPage(),
            'total' => $page->total(),
            'stats' => $stats,
        ]);
    }
}
