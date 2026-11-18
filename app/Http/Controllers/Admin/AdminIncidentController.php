<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\SystemIncident;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Bansud Tourism Office — Incident History: every recorded failure (logins,
 * uploads, payments, refunds, dispatch, jobs, server errors, diagnostics),
 * with filters, and the record of how each was fixed.
 */
class AdminIncidentController extends Controller
{
    private const TZ = 'Asia/Manila';

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'category' => ['nullable', 'string'],
            'status' => ['nullable', Rule::in([...SystemIncident::STATUSES, 'all'])],
            'severity' => ['nullable', Rule::in(SystemIncident::SEVERITIES)],
            'q' => ['nullable', 'string', 'max:120'],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'per_page' => ['nullable', 'integer', 'min:5', 'max:100'],
        ]);

        $query = $this->filtered($filters)->with('user:id,name,role', 'resolver:id,name')->latest('occurred_at')->latest('id');
        $page = $query->paginate($filters['per_page'] ?? 25);

        // Counts per category for the filter chips: every filter except the category itself.
        $byCategory = $this->filtered(array_merge($filters, ['category' => null]))
            ->selectRaw('category, COUNT(*) as total')->groupBy('category')->pluck('total', 'category');
        $today = CarbonImmutable::now(self::TZ)->startOfDay()->utc();

        return $this->successResponse(collect($page->items())->map(fn ($i) => $this->present($i))->all(), 'Incidents retrieved.', 200, [
            'current_page' => $page->currentPage(),
            'last_page' => $page->lastPage(),
            'per_page' => $page->perPage(),
            'total' => $page->total(),
            'by_category' => (object) $byCategory->all(),
            'stats' => [
                'open' => SystemIncident::where('status', SystemIncident::STATUS_OPEN)->count(),
                'today' => SystemIncident::where('occurred_at', '>=', $today)->count(),
                'failed_logins_today' => SystemIncident::where('code', 'login_failed')->where('occurred_at', '>=', $today)->count(),
                'resolved_this_week' => SystemIncident::where('status', SystemIncident::STATUS_RESOLVED)->where('resolved_at', '>=', now()->subDays(7))->count(),
            ],
        ]);
    }

    public function show(SystemIncident $incident): JsonResponse
    {
        $incident->load('user:id,name,role,email', 'resolver:id,name');
        $similar = SystemIncident::where('fingerprint', $incident->fingerprint);

        return $this->successResponse(array_merge($this->present($incident), [
            'similar' => [
                'total' => (clone $similar)->count(),
                'open' => (clone $similar)->where('status', SystemIncident::STATUS_OPEN)->count(),
                'first_at' => (clone $similar)->min('occurred_at'),
                'last_at' => (clone $similar)->max('occurred_at'),
                'recent' => (clone $similar)->whereKeyNot($incident->id)->with('resolver:id,name')->latest('occurred_at')->limit(5)
                    ->get(['id', 'title', 'status', 'occurred_at', 'resolved_at', 'resolved_by', 'resolution'])
                    ->map(fn (SystemIncident $s) => [
                        'id' => $s->id, 'title' => $s->title, 'status' => $s->status, 'occurred_at' => $s->occurred_at?->toIso8601String(),
                        'resolved_at' => $s->resolved_at?->toIso8601String(), 'resolved_by' => $s->resolver?->name, 'resolution' => $s->resolution,
                    ]),
            ],
            // Resolution history: every fix / dismiss / reopen on this incident, oldest first
            // (kept in the audit log, so a reopen never erases an earlier fix).
            'history' => ActivityLog::with('user:id,name')
                ->where('model_type', SystemIncident::class)->where('model_id', $incident->id)
                ->where('action', 'like', 'system_incident.%')->orderBy('id')->get()
                ->map(fn (ActivityLog $log) => [
                    'action' => str_replace('system_incident.', '', $log->action),
                    'description' => $log->description,
                    'by' => $log->user?->name,
                    'at' => $log->created_at?->toIso8601String(),
                ]),
        ]));
    }

    public function resolve(Request $request, SystemIncident $incident): JsonResponse
    {
        $data = $request->validate([
            'note' => ['required', 'string', 'min:3', 'max:1000'],
            'include_similar' => ['nullable', 'boolean'],
        ]);

        $count = $this->close($incident, SystemIncident::STATUS_RESOLVED, $data['note'], (bool) ($data['include_similar'] ?? false), $request);
        ActivityLog::record('system_incident.resolved', "Marked {$count} incident(s) as fixed: {$incident->title} — {$data['note']}", $incident, ActivityLog::TYPE_ADMIN);

        return $this->successResponse($this->present($incident->fresh(['user:id,name,role', 'resolver:id,name'])), "{$count} incident(s) marked as fixed.");
    }

    public function dismiss(Request $request, SystemIncident $incident): JsonResponse
    {
        $data = $request->validate([
            'note' => ['nullable', 'string', 'max:1000'],
            'include_similar' => ['nullable', 'boolean'],
        ]);

        $count = $this->close($incident, SystemIncident::STATUS_DISMISSED, $data['note'] ?? 'Reviewed — no action needed.', (bool) ($data['include_similar'] ?? false), $request);
        ActivityLog::record('system_incident.dismissed', "Dismissed {$count} incident(s): {$incident->title}", $incident, ActivityLog::TYPE_ADMIN);

        return $this->successResponse($this->present($incident->fresh(['user:id,name,role', 'resolver:id,name'])), "{$count} incident(s) dismissed.");
    }

    public function reopen(Request $request, SystemIncident $incident): JsonResponse
    {
        if (! in_array($incident->status, [SystemIncident::STATUS_RESOLVED, SystemIncident::STATUS_DISMISSED], true)) {
            return $this->errorResponse('Only a fixed or dismissed incident can be reopened.', 422);
        }
        $incident->update(['status' => SystemIncident::STATUS_OPEN, 'resolved_at' => null, 'resolved_by' => null, 'resolution' => null]);
        ActivityLog::record('system_incident.reopened', "Reopened incident: {$incident->title}", $incident, ActivityLog::TYPE_ADMIN);

        return $this->successResponse($this->present($incident->fresh(['user:id,name,role', 'resolver:id,name'])), 'Incident reopened.');
    }

    // ------------------------------------------------------------------

    private function close(SystemIncident $incident, string $status, string $note, bool $includeSimilar, Request $request): int
    {
        $closable = [SystemIncident::STATUS_OPEN, SystemIncident::STATUS_RECORDED];
        $values = ['status' => $status, 'resolved_at' => now(), 'resolved_by' => $request->user()->id, 'resolution' => $note];

        if ($includeSimilar) {
            return SystemIncident::where('fingerprint', $incident->fingerprint)->whereIn('status', $closable)->update($values);
        }
        if (! in_array($incident->status, $closable, true)) {
            return 0;
        }
        $incident->update($values);

        return 1;
    }

    private function filtered(array $f): Builder
    {
        $status = $f['status'] ?? 'all';
        $categories = array_values(array_intersect(array_filter(explode(',', (string) ($f['category'] ?? ''))), SystemIncident::CATEGORIES));

        return SystemIncident::query()
            ->when($categories, fn ($q) => $q->whereIn('category', $categories))
            ->when($status !== 'all', fn ($q) => $q->where('status', $status))
            ->when($f['severity'] ?? null, fn ($q, $s) => $q->where('severity', $s))
            ->when($f['from'] ?? null, fn ($q, $d) => $q->where('occurred_at', '>=', CarbonImmutable::parse($d, self::TZ)->startOfDay()->utc()))
            ->when($f['to'] ?? null, fn ($q, $d) => $q->where('occurred_at', '<=', CarbonImmutable::parse($d, self::TZ)->endOfDay()->utc()))
            ->when($f['q'] ?? null, function ($q, $term) {
                $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $term).'%';
                $q->where(fn ($w) => $w->where('title', 'like', $like)->orWhere('message', 'like', $like)
                    ->orWhere('path', 'like', $like)->orWhere('ip_address', 'like', $like)->orWhere('context', 'like', $like)
                    ->orWhereHas('user', fn ($u) => $u->where('name', 'like', $like)->orWhere('email', 'like', $like)));
            });
    }

    private function present(SystemIncident $i): array
    {
        return [
            'id' => $i->id,
            'category' => $i->category,
            'code' => $i->code,
            'severity' => $i->severity,
            'status' => $i->status,
            'title' => $i->title,
            'message' => $i->message,
            'context' => $i->context,
            'user' => $i->user ? ['id' => $i->user->id, 'name' => $i->user->name, 'role' => $i->user->role] : null,
            'ip_address' => $i->ip_address,
            'method' => $i->method,
            'path' => $i->path,
            'subject' => $i->subject_type ? ['type' => class_basename($i->subject_type), 'id' => $i->subject_id] : null,
            'occurred_at' => $i->occurred_at?->toIso8601String(),
            'resolved_at' => $i->resolved_at?->toIso8601String(),
            'resolved_by' => $i->resolver?->name,
            'resolution' => $i->resolution,
        ];
    }
}
