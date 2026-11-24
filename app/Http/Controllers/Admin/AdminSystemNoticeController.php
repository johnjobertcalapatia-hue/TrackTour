<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Notification;
use App\Models\SystemNotice;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * System maintenance notices (admin = Bansud Tourism Office). Sending one
 * notifies every user in the audience (System tab of their notifications) and
 * shows a banner in their portal until the maintenance window ends.
 */
class AdminSystemNoticeController extends Controller
{
    public function index(): JsonResponse
    {
        $page = SystemNotice::latest()->latest('id')->paginate(20);

        return response()->json([
            'success' => true,
            'message' => 'Success',
            'data' => collect($page->items())->map(fn (SystemNotice $n) => $n->toSummary())->all(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title' => ['required', 'string', 'max:120'],
            'message' => ['required', 'string', 'max:2000'],
            'audience' => ['required', Rule::in(array_keys(SystemNotice::AUDIENCE_ROLES))],
            'starts_at' => ['required', 'date'],
            'ends_at' => ['required', 'date', 'after:starts_at'],
        ]);

        // A time without an offset is Philippine time (the admin's clock).
        $startsAt = Carbon::parse($validated['starts_at'], 'Asia/Manila')->utc();
        $endsAt = Carbon::parse($validated['ends_at'], 'Asia/Manila')->utc();
        if ($endsAt->lte(now())) {
            throw \Illuminate\Validation\ValidationException::withMessages(['ends_at' => 'The maintenance must end in the future.']);
        }

        $notice = DB::transaction(function () use ($validated, $request, $startsAt, $endsAt) {
            $notice = SystemNotice::create([
                ...$validated,
                'starts_at' => $startsAt,
                'ends_at' => $endsAt,
                'created_by' => $request->user()->id,
            ]);

            $sent = 0;
            $start = $notice->starts_at->copy()->timezone('Asia/Manila')->format('M j, Y g:i A');
            $end = $notice->ends_at->copy()->timezone('Asia/Manila')->format('M j, Y g:i A');
            $body = "{$notice->message}\n\nMaintenance window: {$start} to {$end} (Philippine time).";
            $now = now();

            User::whereIn('role', SystemNotice::AUDIENCE_ROLES[$notice->audience])
                ->select('id')
                ->chunkById(500, function ($users) use ($notice, $body, $now, &$sent) {
                    Notification::insert($users->map(fn ($u) => [
                        'user_id' => $u->id,
                        'title' => "Scheduled maintenance: {$notice->title}",
                        'message' => $body,
                        'type' => 'system_maintenance',
                        'data' => json_encode(['notice_id' => $notice->id]),
                        'created_at' => $now,
                        'updated_at' => $now,
                    ])->all());
                    $sent += $users->count();
                });

            $notice->update(['recipients_count' => $sent]);

            return $notice;
        });

        return $this->createdResponse($notice->fresh()->toSummary(), "Notice sent to {$notice->fresh()->recipients_count} users.");
    }

    public function cancel(Request $request, SystemNotice $notice): JsonResponse
    {
        if ($notice->cancelled_at) {
            return $this->errorResponse('This notice is already cancelled.', 422);
        }
        if ($notice->ends_at->isPast()) {
            return $this->errorResponse('This maintenance window has already ended.', 422);
        }

        $notice->update(['cancelled_at' => now(), 'cancelled_by' => $request->user()->id]);

        return $this->successResponse($notice->fresh()->toSummary(), 'Notice cancelled. The banner is removed.');
    }

    /** GET /system-notices/active: notices for the signed-in user's role that have not ended. */
    public function active(Request $request): JsonResponse
    {
        $audiences = SystemNotice::audiencesFor((string) $request->user()->role);

        return $this->successResponse(
            SystemNotice::active()->whereIn('audience', $audiences)->orderBy('starts_at')->get()
                ->map(fn (SystemNotice $n) => $n->toSummary())->values()->all()
        );
    }
}
