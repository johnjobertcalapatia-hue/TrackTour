<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\FormDraftRequest;
use App\Models\FormDraft;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FormDraftController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $drafts = FormDraft::where('user_id', $request->user()->id)
            ->where(function ($q) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->orderBy('updated_at', 'desc')
            ->get(['id', 'draft_key', 'form_id', 'version', 'updated_at']);

        return $this->successResponse($drafts);
    }

    public function show(Request $request, string $draftKey): JsonResponse
    {
        $draft = FormDraft::where('user_id', $request->user()->id)
            ->where('draft_key', $draftKey)
            ->first();

        if (!$draft) {
            return $this->successResponse(null);
        }

        if ($draft->expires_at && $draft->expires_at->isPast()) {
            $draft->delete();
            return $this->notFoundResponse('Draft has expired');
        }

        return $this->successResponse($draft);
    }

    public function store(FormDraftRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $draft = FormDraft::updateOrCreate(
            [
                'user_id' => $request->user()->id,
                'draft_key' => $validated['draft_key'],
            ],
            [
                'form_id' => $validated['form_id'],
                'fields' => $validated['fields'],
                'ui_state' => $validated['ui_state'] ?? null,
                'version' => $validated['version'] ?? 1,
                'expires_at' => $validated['expires_at'] ?? null,
            ]
        );

        return $this->successResponse($draft, 'Draft saved');
    }

    public function destroy(Request $request, string $draftKey): JsonResponse
    {
        $deleted = FormDraft::where('user_id', $request->user()->id)
            ->where('draft_key', $draftKey)
            ->delete();

        if (!$deleted) {
            return $this->notFoundResponse('Draft not found');
        }

        return $this->noContentResponse('Draft deleted');
    }
}
