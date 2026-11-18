<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\SystemDiagnosticsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Bansud Tourism Office — System Diagnostics: run the system checks and apply
 * an allow-listed fix (each one an existing canonical command or service).
 */
class AdminSystemDiagnosticsController extends Controller
{
    public function __construct(private SystemDiagnosticsService $diagnostics) {}

    public function index(): JsonResponse
    {
        return $this->successResponse($this->diagnostics->run());
    }

    public function fix(Request $request): JsonResponse
    {
        $data = $request->validate([
            'action' => ['required', 'string', Rule::in(array_keys(SystemDiagnosticsService::ACTIONS))],
            'confirm' => ['nullable', 'boolean'],
        ]);

        // Destructive actions must be confirmed explicitly.
        if ((SystemDiagnosticsService::ACTIONS[$data['action']]['confirm'] ?? false) && ! ($data['confirm'] ?? false)) {
            return $this->errorResponse('Confirm this action before running it.', 422);
        }

        $result = $this->diagnostics->fix($data['action'], $request->user());

        return $this->successResponse($result, $result['message']);
    }
}
