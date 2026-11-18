<?php

namespace App\Http\Controllers\Municipal;

use App\Models\ActivityLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/** Administrative actions taken by this municipality's Tourism Office. */
class MunicipalActivityLogController extends MunicipalController
{
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'area' => ['nullable', 'in:business_owner,business,business_document,rider,municipal'],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);

        $query = $this->scope->activityLogs($this->municipalityId($request))
            ->with('user:id,name,email')
            ->orderByDesc('created_at')
            ->orderByDesc('id');

        if ($area = $validated['area'] ?? null) {
            $query->where('action', 'like', $area.'.%');
        }

        if ($search = $validated['search'] ?? null) {
            $query->where(fn ($q) => $q->where('description', 'like', "%{$search}%")->orWhere('action', 'like', "%{$search}%"));
        }

        if ($from = $validated['from'] ?? null) {
            $query->where('created_at', '>=', Carbon::createFromFormat('Y-m-d', $from, 'Asia/Manila')->startOfDay()->utc());
        }

        if ($to = $validated['to'] ?? null) {
            $query->where('created_at', '<=', Carbon::createFromFormat('Y-m-d', $to, 'Asia/Manila')->endOfDay()->utc());
        }

        $page = $query->paginate(20)->withQueryString()->through(fn (ActivityLog $log) => self::present($log));

        return $this->paginatedWithStats($page, [], 'Activity logs retrieved successfully.');
    }

    public static function present(ActivityLog $log): array
    {
        return [
            'id' => $log->id,
            'action' => $log->action,
            'description' => preg_replace('/^\[[^\]]+ Tourism Office\]\s*/', '', (string) $log->description),
            'actor' => $log->user?->name ?? $log->user?->email ?? 'System',
            'model_type' => $log->model_type ? class_basename($log->model_type) : null,
            'model_id' => $log->model_id,
            'created_at' => $log->created_at,
        ];
    }
}
