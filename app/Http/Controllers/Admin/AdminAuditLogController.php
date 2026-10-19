<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminAuditLogController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = ActivityLog::with('user:id,name,email')->orderByDesc('created_at');

        if ($request->filled('type')) {
            $query->where('type', $request->input('type'));
        }

        if ($request->filled('action')) {
            $query->where('action', $request->input('action'));
        }

        if ($request->filled('user_id')) {
            $query->where('user_id', $request->integer('user_id'));
        }

        if ($request->filled('search')) {
            $search = $request->string('search')->toString();
            $query->where(function ($q) use ($search) {
                $q->where('action', 'like', "%{$search}%")
                    ->orWhere('description', 'like', "%{$search}%");
            });
        }

        $logs = $query->paginate(20)->through(fn (ActivityLog $log) => array_merge(
            $log->only([
                'id',
                'user_id',
                'action',
                'type',
                'description',
                'model_type',
                'model_id',
                'ip_address',
                'user_agent',
                'created_at',
            ]),
            ['user_name' => $log->user?->name ?? $log->user?->email ?? 'System']
        ));

        return $this->paginatedResponse($logs, 'Audit logs retrieved.');
    }
}
