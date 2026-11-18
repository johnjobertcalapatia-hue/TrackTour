<?php

namespace App\Http\Controllers;

use App\Exceptions\OnboardingException;
use App\Http\Resources\UserResource;
use App\Models\Municipality;
use App\Models\RiderAppointment;
use App\Models\RiderTrainingSchedule;
use App\Models\User;
use App\Services\MunicipalScopeService;
use App\Services\RiderOnboardingService;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

/**
 * Tourism Office side of rider onboarding. Scheduling is automatic; the office
 * manages trainer / interviewer availability, runs the evaluation (check-in,
 * interview checklist, training, assessment) and makes the final per-service
 * decision.
 *
 * A Municipality Tourism Admin works on its own municipality; the Bansud
 * super admin picks one with `municipality_id` (default: Bansud).
 */
class OnboardingOfficeController extends Controller
{
    public function __construct(
        private RiderOnboardingService $onboarding,
        private MunicipalScopeService $scope
    ) {}

    // ------------------------------------------------------------------
    // Availability (drives the automatic schedule)
    // ------------------------------------------------------------------

    public function availability(Request $request): JsonResponse
    {
        $m = $this->office($request);
        $month = $request->validate(['month' => ['nullable', 'date_format:Y-m']])['month'] ?? now('Asia/Manila')->format('Y-m');

        return $this->successResponse(array_merge(
            ['office' => $this->onboarding->officeFor($m)],
            $this->onboarding->availabilityMonth($m, $month)
        ));
    }

    public function setAvailability(Request $request, string $date): JsonResponse
    {
        $m = $this->office($request);
        abort_unless((bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $date), 404);
        if ($date < now('Asia/Manila')->toDateString()) {
            return $this->errorResponse('Past dates cannot be changed.', 422);
        }

        $v = $request->validate([
            'trainer_available' => ['required', 'boolean'],
            'interviewer_available' => ['required', 'boolean'],
            'notes' => ['nullable', 'string', 'max:255'],
        ]);

        $result = $this->onboarding->setAvailability($m, $date, (bool) $v['trainer_available'], (bool) $v['interviewer_available'], $v['notes'] ?? null, $request->user());

        $message = $result['schedulable'] ? "{$date} is available for onboarding." : "{$date} marked unavailable.";
        if ($result['affected']->isNotEmpty()) {
            $message .= " {$result['affected']->count()} confirmed appointment(s) are affected — review and reschedule them.";
        }
        if ($result['scheduled_from_pending'] > 0) {
            $message .= " {$result['scheduled_from_pending']} waiting applicant(s) were scheduled.";
        }

        return $this->successResponse([
            'schedulable' => $result['schedulable'],
            'affected' => $result['affected']->map(fn (RiderAppointment $a) => $this->applicantSummary($a->rider))->values(),
            'scheduled_from_pending' => $result['scheduled_from_pending'],
        ], $message);
    }

    /** Appointments on unavailable dates, waiting for the office to reschedule them. */
    public function affected(Request $request): JsonResponse
    {
        $m = $this->office($request);

        return $this->successResponse(
            $this->onboarding->affectedAppointments($m)->map(fn (RiderAppointment $a) => $this->applicantSummary($a->rider))->values()
        );
    }

    /** Office-confirmed move of affected appointments to the next open times. */
    public function rescheduleAffected(Request $request): JsonResponse
    {
        $m = $this->office($request);
        $date = $request->validate(['date' => ['nullable', 'date_format:Y-m-d']])['date'] ?? null;

        $result = $this->onboarding->rescheduleAffected($m, $request->user(), $date);
        $message = "{$result['moved']} appointment(s) rescheduled; applicants were notified.";
        if ($result['unplaced'] > 0) {
            $message .= " {$result['unplaced']} could not be placed — no open time yet.";
        }

        return $this->successResponse($result, $message);
    }

    // ------------------------------------------------------------------
    // Sessions (generated) — read, capacity
    // ------------------------------------------------------------------

    public function schedules(Request $request): JsonResponse
    {
        $m = $this->office($request);
        $validated = $request->validate([
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);
        $from = Carbon::createFromFormat('Y-m-d', $validated['from'] ?? now('Asia/Manila')->toDateString(), 'Asia/Manila')->startOfDay();
        $to = Carbon::createFromFormat('Y-m-d', $validated['to'] ?? $from->copy()->addDays(13)->toDateString(), 'Asia/Manila')->endOfDay();
        $this->onboarding->ensureSessions($m, $to->copy()->startOfDay());

        $slots = RiderTrainingSchedule::where('municipality_id', $m->id)
            ->whereBetween('starts_at', [$from->copy()->utc(), $to->copy()->utc()])
            ->orderBy('starts_at')
            ->get()
            ->map(fn ($s) => $this->onboarding->presentSlot($s));

        return $this->successResponse(['office' => $this->onboarding->officeFor($m), 'slots' => $slots]);
    }

    public function updateSchedule(Request $request, RiderTrainingSchedule $schedule): JsonResponse
    {
        $m = $this->office($request);
        abort_unless((int) $schedule->municipality_id === (int) $m->id, 404);
        $validated = $request->validate(['capacity' => ['required', 'integer', 'between:1,100']]);

        try {
            $updated = DB::transaction(function () use ($schedule, $validated) {
                $locked = RiderTrainingSchedule::whereKey($schedule->id)->lockForUpdate()->first();
                if ($validated['capacity'] < $locked->booked_count) {
                    throw new OnboardingException("Capacity cannot be lower than the {$locked->booked_count} seat(s) already booked.");
                }
                $locked->update(['capacity' => $validated['capacity']]);

                return $locked;
            });
        } catch (OnboardingException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        return $this->successResponse($this->onboarding->presentSlot($updated), 'Session capacity updated.');
    }

    // ------------------------------------------------------------------
    // Applicants & daily appointments
    // ------------------------------------------------------------------

    public function appointments(Request $request): JsonResponse
    {
        $m = $this->office($request);
        $date = $request->validate(['date' => ['nullable', 'date_format:Y-m-d']])['date'] ?? now('Asia/Manila')->toDateString();
        $start = Carbon::createFromFormat('Y-m-d', $date, 'Asia/Manila')->startOfDay();

        $slots = RiderTrainingSchedule::where('municipality_id', $m->id)
            ->whereBetween('starts_at', [$start->copy()->utc(), $start->copy()->endOfDay()->utc()])
            ->with(['appointments' => fn ($q) => $q->whereIn('status', [...RiderAppointment::ACTIVE, RiderAppointment::STATUS_COMPLETED, RiderAppointment::STATUS_NO_SHOW])->with('rider.profile', 'rider.riderDetail')])
            ->orderBy('starts_at')
            ->get()
            ->filter(fn ($s) => $s->status === RiderTrainingSchedule::STATUS_OPEN || $s->appointments->isNotEmpty());

        return $this->successResponse([
            'date' => $date,
            'sessions' => $slots->map(fn (RiderTrainingSchedule $s) => array_merge($this->onboarding->presentSlot($s), [
                'appointments' => $s->appointments->map(fn (RiderAppointment $a) => [
                    'id' => $a->id,
                    'status' => $a->status,
                    'walk_in' => $a->walk_in,
                    'applicant' => $this->applicantSummary($a->rider),
                ])->values(),
            ]))->values(),
        ]);
    }

    public function applicants(Request $request): JsonResponse
    {
        $m = $this->office($request);
        $validated = $request->validate([
            'status' => ['nullable', Rule::in(['pending_review', 'rejected', 'approved', 'all'])],
            'application_status' => ['nullable', Rule::in(array_keys(RiderOnboardingService::STATUS_LABELS))],
            'search' => ['nullable', 'string', 'max:100'],
        ]);
        $status = $validated['status'] ?? 'pending_review';

        $query = $this->scope->riders($m->id)->with('profile', 'riderDetail')->latest();
        if ($status !== 'all') {
            $query->where('account_status', $status);
        }
        if ($applicationStatus = $validated['application_status'] ?? null) {
            $query->whereHas('riderDetail', fn ($d) => $d->where('application_status', $applicationStatus));
        }
        if ($search = $validated['search'] ?? null) {
            $query->where(fn ($q) => $q->where('users.name', 'like', "%{$search}%")->orWhere('users.email', 'like', "%{$search}%")
                ->orWhereHas('riderDetail', fn ($d) => $d->where('application_reference', 'like', "%{$search}%")));
        }

        $page = $query->paginate(20)->withQueryString()->through(fn (User $r) => $this->applicantSummary($r));
        $pendingRiders = fn () => $this->scope->riders($m->id)->where('account_status', User::ACCOUNT_STATUS_PENDING);

        return $this->successResponse($page->items(), 'Applicants retrieved.', 200, [
            'current_page' => $page->currentPage(),
            'last_page' => $page->lastPage(),
            'per_page' => $page->perPage(),
            'total' => $page->total(),
            'stats' => [
                'pending' => $pendingRiders()->count(),
                'booked' => RiderAppointment::whereIn('status', RiderAppointment::ACTIVE)
                    ->whereHas('schedule', fn ($s) => $s->where('municipality_id', $m->id))->count(),
                'for_final_approval' => $pendingRiders()->whereHas('riderDetail', fn ($d) => $d->where('application_status', RiderOnboardingService::STATUS_FOR_FINAL_APPROVAL))->count(),
                'pending_schedule' => $pendingRiders()->whereHas('riderDetail', fn ($d) => $d->where('application_status', RiderOnboardingService::STATUS_PENDING_SCHEDULE))->count(),
                'requirements_review' => $pendingRiders()->whereHas('riderDetail', fn ($d) => $d->where('application_status', RiderOnboardingService::STATUS_REQUIREMENTS_REVIEW))->count(),
            ],
        ]);
    }

    public function applicant(Request $request, User $rider): JsonResponse
    {
        $this->assertCovered($request, $rider);
        $rider->load('profile', 'municipality', 'riderDetail');
        $detail = $rider->riderDetail;

        return $this->successResponse([
            'applicant' => array_merge(UserResource::make($rider)->resolve(), $this->applicantSummary($rider), [
                'vehicle' => [
                    'type' => $detail?->vehicle_type,
                    'make' => $detail?->vehicle_make,
                    'model' => $detail?->vehicle_model,
                    'plate_number' => $detail?->vehicle_plate_number,
                    'year' => $detail?->vehicle_year,
                    'license_number' => $detail?->license_number,
                    'license_expiry' => $detail?->license_expiry?->toDateString(),
                ],
                'missing_documents' => $this->onboarding->missingDocuments($detail),
            ]),
            'appointment' => $this->onboarding->presentAppointment($this->onboarding->activeAppointment($rider)),
            'stages' => $this->onboarding->stages($rider),
            'evaluation' => $this->onboarding->evaluation($rider),
            'quick_approve_enabled' => (bool) config('rider_onboarding.quick_approve'),
            'history' => $this->onboarding->history($rider),
        ]);
    }

    public function checkIn(Request $request, User $rider): JsonResponse
    {
        return $this->act($request, $rider, fn () => $this->onboarding->checkIn($rider, $request->user()), 'Applicant checked in.');
    }

    public function noShow(Request $request, User $rider): JsonResponse
    {
        return $this->act($request, $rider, fn () => $this->onboarding->markNoShow($rider, $request->user()), 'Marked as no-show.');
    }

    public function interview(Request $request, User $rider): JsonResponse
    {
        $v = $request->validate([
            'result' => ['required', Rule::in(['passed', 'failed'])],
            'checklist' => ['required', 'array'],
            'checklist.*' => ['boolean'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        return $this->act($request, $rider, fn () => $this->onboarding->recordInterview($rider, $request->user(), $v['result'], $v['checklist'], $v['notes'] ?? null), 'Interview recorded.');
    }

    public function attendance(Request $request, User $rider): JsonResponse
    {
        $v = $request->validate([
            'status' => ['required', Rule::in(['present', 'absent'])],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        return $this->act($request, $rider, fn () => $this->onboarding->recordAttendance($rider, $request->user(), $v['status'], $v['notes'] ?? null), 'Training attendance recorded.');
    }

    public function assessment(Request $request, User $rider): JsonResponse
    {
        $v = $request->validate([
            'items' => ['required', 'array'],
            'items.*' => [Rule::in(['passed', 'failed', 'na'])],
            'score' => ['required', 'integer', 'between:0,100'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        return $this->act($request, $rider, fn () => $this->onboarding->recordAssessment($rider, $request->user(), $v['items'], (int) $v['score'], $v['notes'] ?? null), 'Assessment recorded.');
    }

    /** Final decision: approve (per service), reject, or return for further evaluation. */
    public function decision(Request $request, User $rider): JsonResponse
    {
        $v = $request->validate([
            'decision' => ['required', Rule::in(['approve', 'reject', 'return'])],
            'services' => ['array'],
            'services.*' => [Rule::in(RiderOnboardingService::SERVICES)],
            'remarks' => ['nullable', 'string', 'max:1000'],
        ]);
        $messages = ['approve' => 'Rider approved and activated.', 'reject' => 'Application rejected.', 'return' => 'Application returned for further evaluation.'];

        return $this->act($request, $rider, fn () => $this->onboarding->decide($rider, $request->user(), $v['decision'], $v['services'] ?? [], $v['remarks'] ?? null), $messages[$v['decision']]);
    }

    /** Demo/presentation shortcut; see config rider_onboarding.quick_approve. */
    public function quickApprove(Request $request, User $rider): JsonResponse
    {
        $v = $request->validate([
            'services' => ['array'],
            'services.*' => [Rule::in(RiderOnboardingService::SERVICES)],
        ]);

        return $this->act($request, $rider, fn () => $this->onboarding->quickApprove($rider, $request->user(), $v['services'] ?? []), 'Rider approved (quick approval).');
    }

    /** Phase 1 → 2: requirements verified and validated; training is scheduled automatically. */
    public function verifyRequirements(Request $request, User $rider): JsonResponse
    {
        return $this->act($request, $rider, fn () => $this->onboarding->verifyRequirements($rider, $request->user()), 'Requirements verified. Training has been scheduled.');
    }

    /** Phase 1: requirements returned to the applicant for correction (reason required). */
    public function returnRequirements(Request $request, User $rider): JsonResponse
    {
        $v = $request->validate(['remarks' => ['required', 'string', 'max:500']]);

        return $this->act($request, $rider, fn () => $this->onboarding->returnRequirements($rider, $request->user(), $v['remarks']), 'Requirements returned for correction.');
    }

    public function reschedule(Request $request, User $rider): JsonResponse
    {
        $v = $request->validate(['schedule_id' => ['required', 'integer', 'exists:rider_training_schedules,id']]);
        $schedule = RiderTrainingSchedule::findOrFail($v['schedule_id']);

        return $this->act($request, $rider, fn () => $this->onboarding->book($rider, $schedule, $request->user()), 'Appointment scheduled; the applicant was notified.');
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /** The municipality this office works on. */
    private function office(Request $request): Municipality
    {
        $user = $request->user();

        if ($user->role === User::ROLE_TOURISM_OFFICE) {
            $m = $this->scope->municipality($user);
            abort_if($m === null || $user->account_status !== User::ACCOUNT_STATUS_APPROVED, 403, 'This Tourism Office account is not assigned to an active municipality.');

            return $m;
        }

        // Rider onboarding belongs to the rider's own municipality: a rider who
        // registers in Bansud trains in Bansud and is seen only by Bansud. The
        // Bansud office therefore runs Bansud's onboarding only, never another
        // municipality's (no municipality_id switching).
        $m = Municipality::whereRaw('LOWER(name) = ?', [strtolower(Municipality::HOME_MUNICIPALITY)])->first();
        abort_if($m === null, 404, 'Municipality not found.');
        $requested = $request->integer('municipality_id');
        abort_if($requested && $requested !== (int) $m->id, 403, "Rider onboarding is handled by each municipality's own Tourism Office.");

        return $m;
    }

    private function assertCovered(Request $request, User $rider): void
    {
        $m = $this->office($request);
        abort_unless($rider->role === User::ROLE_RIDER && (int) $rider->municipality_id === (int) $m->id, 404, 'Applicant not found.');
    }

    private function act(Request $request, User $rider, Closure $action, string $message): JsonResponse
    {
        $this->assertCovered($request, $rider);

        try {
            $action();
        } catch (OnboardingException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        $rider->refresh();

        return $this->successResponse([
            'account_status' => $rider->account_status,
            'application_status' => $rider->riderDetail?->application_status,
            'appointment' => $this->onboarding->presentAppointment($this->onboarding->activeAppointment($rider)),
            'stages' => $this->onboarding->stages($rider),
        ], $message);
    }

    private function applicantSummary(User $rider): array
    {
        $rider->loadMissing('profile', 'riderDetail');
        $stages = $this->onboarding->stages($rider);
        $current = collect($stages)->first(fn ($s) => $s['status'] !== 'done');
        $status = $rider->riderDetail?->application_status;

        return [
            'id' => $rider->id,
            'name' => $rider->full_name,
            'email' => $rider->email,
            'phone' => $rider->profile?->mobile_number,
            'account_status' => $rider->account_status,
            'application_status' => $status,
            'application_status_label' => $status ? (RiderOnboardingService::STATUS_LABELS[$status] ?? $status) : null,
            'requirements_verified_at' => $rider->riderDetail?->requirements_verified_at?->toIso8601String(),
            'requirements_remarks' => $rider->riderDetail?->requirements_remarks,
            'reference' => $rider->riderDetail?->application_reference,
            'requested_services' => $rider->riderDetail?->requested_services ?? [],
            'vehicle_type' => $rider->riderDetail?->vehicle_type,
            'application_submitted' => (bool) $rider->riderDetail?->application_submitted_at,
            'current_stage' => $current ? ['key' => $current['key'], 'label' => $current['label'], 'status' => $current['status']] : null,
            'appointment' => $this->onboarding->presentAppointment($this->onboarding->activeAppointment($rider)),
            'registered_at' => $rider->created_at,
        ];
    }
}
