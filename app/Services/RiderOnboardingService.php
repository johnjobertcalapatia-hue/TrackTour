<?php

namespace App\Services;

use App\Exceptions\OnboardingException;
use App\Models\ActivityLog;
use App\Models\Municipality;
use App\Models\Notification;
use App\Models\RiderApprovalRecord;
use App\Models\RiderAppointment;
use App\Models\RiderDetail;
use App\Models\RiderInterview;
use App\Models\RiderServiceEligibility;
use App\Models\RiderTrainingAssessment;
use App\Models\RiderTrainingAttendance;
use App\Models\RiderTrainingAvailability;
use App\Models\RiderTrainingSchedule;
use App\Models\TourismSetting;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Grab-style rider onboarding: automatic scheduling, manual evaluation,
 * controlled activation.
 *
 *   application → automatic appointment → check-in → interview (requirement
 *   checklist) → training attendance → assessment (per item) → final
 *   decision by the Tourism Office, approved per service.
 *
 * Scheduling: sessions are generated automatically on dates where both the
 * trainer and the interviewer are available (working days by default; an
 * office overrides single dates). Each new applicant gets the earliest open
 * seat; when nothing is open the application waits as `pending_schedule` and
 * is scheduled as soon as availability opens. Marking a booked date
 * unavailable never moves confirmed appointments by itself — they are listed
 * as affected until the office reschedules them.
 *
 * Seats are real inventory (conditional atomic increment, never above
 * capacity) and a rider holds at most one active appointment (unique
 * rider_appointments.active_rider_id). Account approval/rejection goes
 * through the canonical AccountModerationService; per-service eligibility is
 * stored in rider_service_eligibilities and enforced by dispatch.
 */
class RiderOnboardingService
{
    public const SERVICES = [User::SERVICE_FOOD, User::SERVICE_TRANSPORT];

    /** Registrable rider vehicles; a bicycle is food delivery only (RideVehicles). */
    public const VEHICLES = RideVehicles::RIDER_VEHICLES;

    public const DOCUMENTS = [
        'drivers_license_front' => "Driver's license (front)",
        'drivers_license_back' => "Driver's license (back)",
        'or_cr_image' => 'Vehicle OR/CR',
        'nbi_clearance' => 'NBI or police clearance',
    ];

    /** Application status — separate from the account status. */
    public const STATUS_PENDING_REVIEW = 'pending_review';
    /** Phase 1: requirements submitted online, awaiting Tourism Office verification. */
    public const STATUS_REQUIREMENTS_REVIEW = 'requirements_review';
    /** Phase 1: requirements returned to the applicant for correction. */
    public const STATUS_REQUIREMENTS_RETURNED = 'requirements_returned';
    public const STATUS_APPOINTMENT_SCHEDULED = 'appointment_scheduled';
    public const STATUS_PENDING_SCHEDULE = 'pending_schedule';
    public const STATUS_UNDER_VERIFICATION = 'under_verification';
    public const STATUS_INTERVIEW_COMPLETED = 'interview_completed';
    public const STATUS_TRAINING_COMPLETED = 'training_completed';
    public const STATUS_FOR_FINAL_APPROVAL = 'for_final_approval';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_PARTIALLY_APPROVED = 'partially_approved';
    public const STATUS_REJECTED = 'rejected';
    public const STATUS_NEEDS_RETRAINING = 'needs_retraining';

    public const STATUS_LABELS = [
        self::STATUS_PENDING_REVIEW => 'Application submitted',
        self::STATUS_REQUIREMENTS_REVIEW => 'Requirements under review',
        self::STATUS_REQUIREMENTS_RETURNED => 'Requirements need correction',
        self::STATUS_APPOINTMENT_SCHEDULED => 'Appointment scheduled',
        self::STATUS_PENDING_SCHEDULE => 'Pending schedule',
        self::STATUS_UNDER_VERIFICATION => 'Under verification',
        self::STATUS_INTERVIEW_COMPLETED => 'Interview completed',
        self::STATUS_TRAINING_COMPLETED => 'Training completed',
        self::STATUS_FOR_FINAL_APPROVAL => 'For final approval',
        self::STATUS_APPROVED => 'Approved',
        self::STATUS_PARTIALLY_APPROVED => 'Partially approved',
        self::STATUS_REJECTED => 'Rejected',
        self::STATUS_NEEDS_RETRAINING => 'Needs retraining',
    ];

    public const CHECKLIST = [
        'identification' => 'Valid identification',
        'drivers_license' => "Driver's license",
        'vehicle_documents' => 'Vehicle documents',
        'profile' => 'Profile information',
    ];

    public const ASSESSMENT_ITEMS = [
        'orientation' => 'TrackTour orientation',
        'safety' => 'Safety procedures',
        'navigation' => 'Navigation and GPS',
        'delivery' => 'Delivery procedures',
        'passenger' => 'Passenger procedures',
        'practical' => 'Practical assessment',
    ];

    /** Items every service needs, and the item each service adds. */
    public const COMMON_ITEMS = ['orientation', 'safety', 'navigation', 'practical'];

    public const SERVICE_ITEMS = [User::SERVICE_FOOD => 'delivery', User::SERVICE_TRANSPORT => 'passenger'];

    /**
     * Two phases: (1) account and requirements submitted online and verified
     * by the Tourism Office; (2) scheduled interview and training, then the
     * final approval that makes the rider eligible.
     */
    public const STAGES = [
        'submitted' => 'Application submitted',
        'requirements' => 'Requirements verified',
        'appointment' => 'Training scheduled',
        'visit' => 'Visit Tourism Office',
        'interview' => 'Interview and document verification',
        'training' => 'Actual rider training',
        'assessment' => 'Assessment and final approval',
        'activation' => 'Rider account activation',
    ];

    public function __construct(
        private AccountModerationService $moderation,
        private MunicipalScopeService $scope
    ) {}

    // ------------------------------------------------------------------
    // Application
    // ------------------------------------------------------------------

    /** @param array<string, UploadedFile|null> $files */
    public function submitApplication(User $rider, array $data, array $files): RiderDetail
    {
        $this->assertApplicant($rider);
        if ($rider->riderDetail?->requirements_verified_at) {
            throw new OnboardingException('Your requirements are already verified. Contact the Tourism Office if something needs to change.');
        }

        $detail = DB::transaction(function () use ($rider, $data, $files) {
            $detail = RiderDetail::firstOrCreate(['user_id' => $rider->id], ['current_service' => User::SERVICE_FOOD]);
            $services = array_values(array_unique($data['requested_services']));

            $attributes = [
                'requested_services' => $services,
                'current_service' => in_array($detail->current_service, $services, true) ? $detail->current_service : $services[0],
                'vehicle_type' => $data['vehicle_type'],
                'vehicle_make' => $data['vehicle_make'] ?? null,
                'vehicle_model' => $data['vehicle_model'] ?? null,
                // A bicycle (food delivery only) has no plate or driver's license.
                'vehicle_plate_number' => filled($data['vehicle_plate_number'] ?? null) ? strtoupper((string) $data['vehicle_plate_number']) : null,
                'vehicle_year' => $data['vehicle_year'] ?? null,
                'license_number' => $data['license_number'] ?? null,
                'license_expiry' => $data['license_expiry'] ?? null,
                'application_submitted_at' => now(),
                // Phase 1: the Tourism Office verifies the requirements first.
                'application_status' => self::STATUS_REQUIREMENTS_REVIEW,
                'requirements_remarks' => null,
            ];

            foreach (array_keys(self::DOCUMENTS) as $field) {
                if (($files[$field] ?? null) instanceof UploadedFile) {
                    $attributes[$field] = $files[$field]->store("riders/{$rider->id}", 'local');
                }
            }

            $detail->fill($attributes);
            if (! $detail->application_reference) {
                $detail->application_reference = sprintf('TT-RIDER-%s-%05d', now('Asia/Manila')->year, $rider->id);
            }
            $detail->save();

            ActivityLog::record('rider_onboarding.application_submitted', sprintf('Rider application %s submitted (%s).', $detail->application_reference, $rider->email), $rider);

            return $detail;
        });

        // Training is scheduled only after the requirements are verified.
        $this->notify($rider, 'Requirements received', 'The Tourism Office is reviewing your requirements. Your training will be scheduled once they are verified.');

        return $detail->fresh();
    }

    /** Phase 1 → 2: the Tourism Office verified and validated the requirements. */
    public function requirementsVerified(?RiderDetail $detail): bool
    {
        return $detail?->requirements_verified_at !== null;
    }

    /**
     * The Tourism Office verifies and validates the submitted requirements.
     * Training is then scheduled automatically (earliest open seat, or
     * Pending Schedule when none is open).
     */
    public function verifyRequirements(User $rider, User $actor): ?RiderAppointment
    {
        $this->assertApplicant($rider);
        $detail = $rider->riderDetail;
        if ($detail?->application_status !== self::STATUS_REQUIREMENTS_REVIEW) {
            throw new OnboardingException('Only requirements that are under review can be verified.');
        }
        if ($missing = $this->missingDocuments($detail)) {
            throw new OnboardingException('Required documents are missing: '.implode(', ', array_map(fn ($f) => self::DOCUMENTS[$f], $missing)).'.');
        }

        $detail->update(['requirements_verified_at' => now(), 'requirements_verified_by' => $actor->id, 'requirements_remarks' => null]);
        $this->record($rider, $actor, 'requirements_verified', [], null);
        $this->log($actor, 'requirements_verified', 'Verified the requirements of %s.', $rider);
        $this->notify($rider, 'Requirements verified', 'Your requirements were verified. Your interview and training are being scheduled.');

        // Automatic scheduling (earliest open seat, or Pending Schedule).
        return $this->autoBook($rider->fresh(['riderDetail', 'municipality']));
    }

    /** The Tourism Office returns the requirements for correction (reason required). */
    public function returnRequirements(User $rider, User $actor, string $reason): void
    {
        $this->assertApplicant($rider);
        $detail = $rider->riderDetail;
        if ($detail?->application_status !== self::STATUS_REQUIREMENTS_REVIEW) {
            throw new OnboardingException('Only requirements that are under review can be returned.');
        }
        if (blank($reason)) {
            throw new OnboardingException('Say what needs to be corrected.');
        }

        $detail->update(['application_status' => self::STATUS_REQUIREMENTS_RETURNED, 'requirements_remarks' => $reason]);
        $this->record($rider, $actor, 'requirements_returned', [], $reason);
        $this->log($actor, 'requirements_returned', 'Returned the requirements of %s for correction.', $rider);
        $this->notify($rider, 'Requirements need correction', "Please update your application: {$reason}");
    }

    public function missingDocuments(?RiderDetail $detail): array
    {
        // A bicycle needs no driver's license or OR/CR.
        $required = $detail?->vehicle_type === 'bicycle' ? [] : ['drivers_license_front', 'drivers_license_back', 'or_cr_image'];

        return array_values(array_filter($required, fn ($field) => ! filled($detail?->getAttribute($field))));
    }

    // ------------------------------------------------------------------
    // Availability & automatic schedule
    // ------------------------------------------------------------------

    /** Whether onboarding can run on a date: both trainer and interviewer available. */
    public function isSchedulable(Municipality $municipality, Carbon $date, ?Collection $overrides = null): bool
    {
        $key = $date->toDateString();
        $row = $overrides
            ? $overrides->get($key)
            : RiderTrainingAvailability::where('municipality_id', $municipality->id)->whereDate('date', $key)->first();

        if ($row) {
            return $row->isSchedulable();
        }

        return in_array($date->dayOfWeekIso, config('rider_onboarding.work_days', [1, 2, 3, 4, 5]), true);
    }

    /** @return Collection<string, RiderTrainingAvailability> keyed by Y-m-d */
    public function availabilityOverrides(Municipality $municipality, Carbon $from, Carbon $to): Collection
    {
        return RiderTrainingAvailability::where('municipality_id', $municipality->id)
            ->whereBetween('date', [$from->toDateString(), $to->toDateString()])
            ->get()
            ->keyBy(fn ($row) => $row->date->toDateString());
    }

    /**
     * Make sure the standard sessions exist on schedulable dates from today
     * through the horizon. Idempotent (unique municipality_id + starts_at,
     * insert-or-ignore).
     */
    public function ensureSessions(Municipality $municipality, ?Carbon $through = null): void
    {
        $cfg = config('rider_onboarding');
        $first = now('Asia/Manila')->startOfDay();
        $last = ($through ?? now('Asia/Manila')->addDays((int) $cfg['horizon_days']))->copy()->timezone('Asia/Manila')->startOfDay();
        $overrides = $this->availabilityOverrides($municipality, $first, $last);
        $office = $this->officeFor($municipality);
        $stamp = now();

        $rows = [];
        for ($day = $first->copy(); $day->lte($last); $day->addDay()) {
            if (! $this->isSchedulable($municipality, $day, $overrides)) {
                continue;
            }
            foreach ($cfg['slot_times'] as $time) {
                $rows[] = [
                    'municipality_id' => $municipality->id,
                    'starts_at' => self::manilaToUtc($day->toDateString(), $time),
                    'capacity' => (int) $cfg['capacity'],
                    'booked_count' => 0,
                    'location_name' => $office['name'],
                    'location_address' => $office['address'],
                    'status' => RiderTrainingSchedule::STATUS_OPEN,
                    'created_at' => $stamp,
                    'updated_at' => $stamp,
                ];
            }
        }

        foreach (array_chunk($rows, 200) as $chunk) {
            RiderTrainingSchedule::insertOrIgnore($chunk);
        }
    }

    /**
     * Save trainer / interviewer availability for a date. Making a date
     * unavailable closes its sessions but leaves confirmed appointments in
     * place (returned as affected for the office to reschedule). Making it
     * available reopens the sessions and schedules waiting applicants.
     *
     * @return array{schedulable: bool, affected: Collection, scheduled_from_pending: int}
     */
    public function setAvailability(Municipality $municipality, string $date, bool $trainer, bool $interviewer, ?string $notes, User $actor): array
    {
        $day = Carbon::createFromFormat('Y-m-d', $date, 'Asia/Manila')->startOfDay();

        RiderTrainingAvailability::updateOrCreate(
            ['municipality_id' => $municipality->id, 'date' => $date],
            ['trainer_available' => $trainer, 'interviewer_available' => $interviewer, 'notes' => $notes, 'updated_by' => $actor->id]
        );

        $schedulable = $trainer && $interviewer;
        $scheduled = 0;

        if ($schedulable) {
            $this->sessionsOn($municipality, $day)->update(['status' => RiderTrainingSchedule::STATUS_OPEN]);
            $horizon = now('Asia/Manila')->addDays((int) config('rider_onboarding.horizon_days'));
            $this->ensureSessions($municipality, $day->gt($horizon) ? $day : $horizon);
            $scheduled = $this->schedulePending($municipality);
        } else {
            $this->sessionsOn($municipality, $day)->update(['status' => RiderTrainingSchedule::STATUS_CLOSED]);
        }

        $affected = $this->affectedAppointments($municipality, $date);

        ActivityLog::record(
            'rider_onboarding.availability_updated',
            $this->scope->auditPrefix($actor).sprintf(
                'Onboarding availability on %s: trainer %s, interviewer %s%s.',
                $date,
                $trainer ? 'available' : 'unavailable',
                $interviewer ? 'available' : 'unavailable',
                $affected->isNotEmpty() ? sprintf(' — %d confirmed appointment(s) affected', $affected->count()) : ''
            ),
            $municipality
        );

        return ['schedulable' => $schedulable, 'affected' => $affected, 'scheduled_from_pending' => $scheduled];
    }

    /** Confirmed (booked, not yet checked-in) appointments sitting on unavailable sessions. */
    public function affectedAppointments(Municipality $municipality, ?string $date = null): Collection
    {
        return RiderAppointment::with('schedule', 'rider.profile', 'rider.riderDetail', 'rider.municipality')
            ->where('status', RiderAppointment::STATUS_BOOKED)
            ->whereHas('schedule', function ($s) use ($municipality, $date) {
                $s->where('municipality_id', $municipality->id)
                    ->where('status', RiderTrainingSchedule::STATUS_CLOSED)
                    ->where('starts_at', '>=', now('Asia/Manila')->startOfDay()->utc());
                if ($date) {
                    $day = Carbon::createFromFormat('Y-m-d', $date, 'Asia/Manila')->startOfDay();
                    $s->whereBetween('starts_at', [$day->copy()->utc(), $day->copy()->endOfDay()->utc()]);
                }
            })
            ->get();
    }

    /**
     * Office-confirmed bulk move of affected appointments to the next open
     * seats. Each applicant is notified of the replacement appointment.
     *
     * @return array{moved: int, unplaced: int}
     */
    public function rescheduleAffected(Municipality $municipality, User $actor, ?string $date = null): array
    {
        $moved = 0;
        $unplaced = 0;
        foreach ($this->affectedAppointments($municipality, $date) as $appointment) {
            $this->autoBook($appointment->rider, $actor, $appointment->walk_in, $appointment->schedule_id) ? $moved++ : $unplaced++;
        }

        return ['moved' => $moved, 'unplaced' => $unplaced];
    }

    /** Give every applicant waiting in `pending_schedule` the earliest open seat. */
    public function schedulePending(Municipality $municipality): int
    {
        $count = 0;
        $waiting = User::with('riderDetail', 'municipality')
            ->where('role', User::ROLE_RIDER)
            ->where('municipality_id', $municipality->id)
            ->where('account_status', User::ACCOUNT_STATUS_PENDING)
            ->whereHas('riderDetail', fn ($d) => $d->where('application_status', self::STATUS_PENDING_SCHEDULE))
            ->orderBy('id')
            ->get();

        foreach ($waiting as $rider) {
            if (! $this->activeAppointment($rider) && $this->autoBook($rider)) {
                $count++;
            }
        }

        return $count;
    }

    /**
     * Book the earliest open seat from the next working day on. With no open
     * seat the application waits in `pending_schedule`.
     */
    public function autoBook(User $rider, ?User $actor = null, bool $walkIn = false, ?int $excludeScheduleId = null): ?RiderAppointment
    {
        if (! $this->requirementsVerified($rider->riderDetail)) {
            return null; // phase 2 starts only after the requirements are verified
        }
        $municipality = $rider->municipality;
        if (! $municipality) {
            return null;
        }
        $this->ensureSessions($municipality);

        $earliest = now('Asia/Manila')->addDays((int) config('rider_onboarding.lead_days', 1))->startOfDay()->utc();
        $candidates = RiderTrainingSchedule::where('municipality_id', $municipality->id)
            ->where('status', RiderTrainingSchedule::STATUS_OPEN)
            ->where('starts_at', '>=', $earliest)
            ->whereColumn('booked_count', '<', 'capacity')
            ->when($excludeScheduleId, fn ($q) => $q->whereKeyNot($excludeScheduleId))
            ->orderBy('starts_at')
            ->limit(50)
            ->get();

        foreach ($candidates as $slot) {
            try {
                return $this->book($rider, $slot, $actor, $walkIn, $actor === null);
            } catch (OnboardingException $e) {
                if ($e->status !== 409) {
                    throw $e;
                }
                // Filled in the meantime — try the next one.
            }
        }

        if (! $this->activeAppointment($rider) && $rider->riderDetail?->application_status !== self::STATUS_PENDING_SCHEDULE) {
            $this->setStatus($rider, self::STATUS_PENDING_SCHEDULE);
            $this->notify($rider, 'Waiting for an onboarding schedule', 'No onboarding date is open right now. We will schedule you automatically and notify you as soon as the Tourism Office has an available date.');
        }

        return null;
    }

    // ------------------------------------------------------------------
    // Appointments (real capacity)
    // ------------------------------------------------------------------

    public function activeAppointment(User $rider): ?RiderAppointment
    {
        return RiderAppointment::with('schedule')
            ->where('rider_id', $rider->id)
            ->whereIn('status', RiderAppointment::ACTIVE)
            ->latest('id')
            ->first();
    }

    /**
     * Book (or move to) a slot. Seats are claimed with a conditional atomic
     * increment, so concurrent bookings can never exceed capacity.
     */
    public function book(User $rider, RiderTrainingSchedule $schedule, ?User $actor = null, bool $walkIn = false, bool $system = false): RiderAppointment
    {
        $this->assertApplicant($rider);
        $byStaff = $actor !== null && $actor->id !== $rider->id;

        if (! $byStaff && $rider->account_status === User::ACCOUNT_STATUS_REJECTED) {
            throw new OnboardingException('Your application was not approved. Please contact the Tourism Office.');
        }
        if (! $byStaff && ! $rider->riderDetail?->application_submitted_at) {
            throw new OnboardingException('Submit your rider application before booking an appointment.');
        }
        if (! $this->requirementsVerified($rider->riderDetail)) {
            throw new OnboardingException($byStaff
                ? 'Verify the applicant\'s requirements before scheduling training.'
                : 'Your requirements are still being reviewed. Your training will be scheduled once they are verified.');
        }
        if ((int) $schedule->municipality_id !== (int) $rider->municipality_id) {
            throw new OnboardingException("Book at your own municipality's Tourism Office.");
        }

        try {
            $appointment = DB::transaction(function () use ($rider, $schedule, $actor, $walkIn, $byStaff, $system) {
                // Serialise this rider's booking changes.
                User::whereKey($rider->id)->lockForUpdate()->first();

                $current = RiderAppointment::where('rider_id', $rider->id)
                    ->whereIn('status', RiderAppointment::ACTIVE)
                    ->lockForUpdate()
                    ->first();

                if ($current && (int) $current->schedule_id === (int) $schedule->id) {
                    return $current;
                }
                if ($current && $current->status === RiderAppointment::STATUS_CHECKED_IN) {
                    throw new OnboardingException('The applicant has already checked in for the current appointment.');
                }

                // Riders book future sessions; staff may also fill a same-day session.
                $earliest = $byStaff ? now('Asia/Manila')->startOfDay()->utc() : now();
                $claimed = RiderTrainingSchedule::whereKey($schedule->id)
                    ->where('status', RiderTrainingSchedule::STATUS_OPEN)
                    ->where('starts_at', '>=', $earliest)
                    ->whereColumn('booked_count', '<', 'capacity')
                    ->increment('booked_count');

                if ($claimed === 0) {
                    throw new OnboardingException('That time slot is full or no longer available. Please choose another.', 409);
                }

                if ($current) {
                    $this->releaseSeat($current, RiderAppointment::STATUS_CANCELLED);
                }

                return RiderAppointment::create([
                    'rider_id' => $rider->id,
                    'schedule_id' => $schedule->id,
                    'status' => RiderAppointment::STATUS_BOOKED,
                    'active_rider_id' => $rider->id,
                    'walk_in' => $walkIn,
                    // NULL = scheduled automatically by the system.
                    'booked_by' => $system ? null : ($actor?->id ?? $rider->id),
                ]);
            });
        } catch (UniqueConstraintViolationException) {
            throw new OnboardingException('You already have an active appointment. Refresh and try again.', 409);
        }

        $appointment->load('schedule');
        $when = $appointment->schedule->starts_at->copy()->timezone('Asia/Manila')->format('F j, Y \a\t g:i A');

        if (in_array($rider->riderDetail?->application_status, [null, self::STATUS_PENDING_REVIEW, self::STATUS_REQUIREMENTS_REVIEW, self::STATUS_PENDING_SCHEDULE, self::STATUS_APPOINTMENT_SCHEDULED], true)) {
            $this->setStatus($rider, self::STATUS_APPOINTMENT_SCHEDULED);
        }

        if ($system) {
            $this->notify($rider, 'Onboarding appointment scheduled', "Your Tourism Office onboarding is on {$when} at {$appointment->schedule->location_name}. Bring your original documents.");
        } elseif ($byStaff) {
            $this->notify($rider, 'Onboarding appointment set by the Tourism Office', "Your onboarding appointment is now on {$when} at {$appointment->schedule->location_name}.");
        }

        ActivityLog::record(
            'rider_onboarding.appointment_booked',
            ($actor ? $this->scope->auditPrefix($actor) : '').sprintf(
                'Onboarding appointment %s for %s on %s%s.',
                $system ? 'scheduled automatically' : 'booked',
                $rider->email,
                $when,
                $walkIn ? ' (walk-in)' : ''
            ),
            $rider
        );

        return $appointment;
    }

    public function cancel(User $rider, ?User $actor = null): void
    {
        DB::transaction(function () use ($rider) {
            $current = RiderAppointment::where('rider_id', $rider->id)
                ->where('status', RiderAppointment::STATUS_BOOKED)
                ->lockForUpdate()
                ->first();

            if (! $current) {
                throw new OnboardingException('There is no booked appointment to cancel.');
            }

            $this->releaseSeat($current, RiderAppointment::STATUS_CANCELLED);
        });

        $this->setStatus($rider, self::STATUS_PENDING_REVIEW);
        ActivityLog::record('rider_onboarding.appointment_cancelled', ($actor ? $this->scope->auditPrefix($actor) : '').sprintf('Onboarding appointment cancelled for %s.', $rider->email), $rider);
    }

    public function checkIn(User $rider, User $actor): RiderAppointment
    {
        $appointment = $this->requireActive($rider);
        if ($appointment->status !== RiderAppointment::STATUS_BOOKED) {
            throw new OnboardingException('This applicant has already checked in.');
        }

        $appointment->update(['status' => RiderAppointment::STATUS_CHECKED_IN, 'checked_in_at' => now()]);
        $this->setStatus($rider, self::STATUS_UNDER_VERIFICATION);
        $this->log($actor, 'checked_in', 'Checked in %s for onboarding.', $rider);

        return $appointment;
    }

    public function markNoShow(User $rider, User $actor): void
    {
        $appointment = $this->requireActive($rider);
        if ($appointment->status !== RiderAppointment::STATUS_BOOKED) {
            throw new OnboardingException('Only a booked (not yet checked-in) appointment can be marked as a no-show.');
        }

        // The session has passed, so the seat is not returned to inventory.
        $appointment->update(['status' => RiderAppointment::STATUS_NO_SHOW, 'active_rider_id' => null]);
        $this->setStatus($rider, self::STATUS_PENDING_REVIEW);
        $this->notify($rider, 'Missed onboarding appointment', 'You missed your onboarding appointment. Choose a new time in your application, or contact the Tourism Office.');
        $this->log($actor, 'no_show', 'Marked %s as a no-show.', $rider);
    }

    // ------------------------------------------------------------------
    // Evaluation
    // ------------------------------------------------------------------

    /** @param array<string, bool> $checklist */
    public function recordInterview(User $rider, User $actor, string $result, array $checklist, ?string $notes): RiderInterview
    {
        $appointment = $this->requireActive($rider);
        if ($appointment->status !== RiderAppointment::STATUS_CHECKED_IN) {
            throw new OnboardingException('Check the applicant in before recording the interview.');
        }

        $checklist = collect(array_keys(self::CHECKLIST))->mapWithKeys(fn ($k) => [$k => (bool) ($checklist[$k] ?? false)])->all();
        $allVerified = ! in_array(false, $checklist, true);
        if ($result === 'passed' && ! $allVerified) {
            throw new OnboardingException('Verify every requirement before passing the interview.');
        }

        $interview = RiderInterview::create([
            'rider_id' => $rider->id,
            'appointment_id' => $appointment->id,
            'result' => $result,
            'documents_verified' => $allVerified,
            'checklist' => $checklist,
            'notes' => $notes,
            'recorded_by' => $actor->id,
        ]);
        if ($result === 'passed') {
            $this->setStatus($rider, self::STATUS_INTERVIEW_COMPLETED);
        }
        $this->log($actor, 'interview_'.$result, 'Interview for %s: '.$result.'.', $rider);

        return $interview;
    }

    public function recordAttendance(User $rider, User $actor, string $status, ?string $notes): RiderTrainingAttendance
    {
        if ($this->latest(RiderInterview::class, $rider)?->result !== 'passed') {
            throw new OnboardingException('The applicant must pass the interview before training.');
        }

        $attendance = RiderTrainingAttendance::create([
            'rider_id' => $rider->id,
            'appointment_id' => $this->activeAppointment($rider)?->id,
            'status' => $status,
            'notes' => $notes,
            'recorded_by' => $actor->id,
        ]);
        if ($status === 'present') {
            $this->setStatus($rider, self::STATUS_TRAINING_COMPLETED);
        }
        $this->log($actor, 'training_'.$status, 'Training attendance for %s: '.$status.'.', $rider);

        return $attendance;
    }

    /** @param array<string, string> $items item => passed|failed|na */
    public function recordAssessment(User $rider, User $actor, array $items, int $score, ?string $notes): RiderTrainingAssessment
    {
        if ($this->latest(RiderTrainingAttendance::class, $rider)?->status !== 'present') {
            throw new OnboardingException('Record training attendance before the assessment.');
        }

        $requested = $rider->riderDetail?->requested_services ?: self::SERVICES;
        $required = array_merge(self::COMMON_ITEMS, array_map(fn ($s) => self::SERVICE_ITEMS[$s], $requested));
        foreach ($required as $key) {
            if (! in_array($items[$key] ?? null, ['passed', 'failed'], true)) {
                throw new OnboardingException('Record a result for '.self::ASSESSMENT_ITEMS[$key].'.');
            }
        }

        $items = collect(array_keys(self::ASSESSMENT_ITEMS))->mapWithKeys(fn ($k) => [$k => $items[$k] ?? 'na'])->all();
        $eligible = $this->eligibleServices($items, $requested, $rider->riderDetail?->vehicle_type);
        $result = $eligible === [] ? 'failed' : 'passed';

        $assessment = RiderTrainingAssessment::create([
            'rider_id' => $rider->id,
            'appointment_id' => $this->activeAppointment($rider)?->id,
            'score' => $score,
            'result' => $result,
            'items' => $items,
            'notes' => $notes,
            'recorded_by' => $actor->id,
        ]);

        // Never activates the rider: it only moves the application to review.
        $this->setStatus($rider, $result === 'passed' ? self::STATUS_FOR_FINAL_APPROVAL : self::STATUS_NEEDS_RETRAINING);
        $this->log($actor, 'assessment_'.$result, "Assessment for %s: {$result} ({$score}/100).", $rider);

        return $assessment;
    }

    /** Services the assessment qualifies for, limited to those requested. */
    public function eligibleServices(?array $items, array $requested, ?string $vehicle = null): array
    {
        if (! $items) {
            return [];
        }
        // Only motor vehicles can do ride-hailing.
        if ($vehicle !== null && ! RideVehicles::canRideHail($vehicle)) {
            $requested = array_values(array_diff($requested, [User::SERVICE_TRANSPORT]));
        }
        foreach (self::COMMON_ITEMS as $key) {
            if (($items[$key] ?? null) !== 'passed') {
                return [];
            }
        }

        return array_values(array_filter($requested, fn ($s) => ($items[self::SERVICE_ITEMS[$s]] ?? null) === 'passed'));
    }

    /**
     * Final decision by the Tourism Office.
     *
     * - approve: per-service approval (only services the assessment qualified);
     *   activates the account through the canonical moderation service.
     * - reject: reason required; the account is rejected and the seat freed.
     * - return: reason required; the application goes back for retraining.
     */
    public function decide(User $rider, User $actor, string $decision, array $services, ?string $remarks): User
    {
        $this->assertApplicant($rider);
        $detail = $rider->riderDetail;
        $requested = $detail?->requested_services ?: self::SERVICES;

        if (in_array($decision, ['reject', 'return'], true) && blank($remarks)) {
            throw new OnboardingException('Give a reason for this decision.');
        }

        if ($decision === 'approve') {
            $assessment = $this->latest(RiderTrainingAssessment::class, $rider);
            if ($assessment?->result !== 'passed') {
                throw new OnboardingException('The applicant must pass the training assessment before approval.');
            }
            $eligible = $this->eligibleServices($assessment->items, $requested, $detail?->vehicle_type);
            $services = array_values(array_unique($services));
            if ($services === []) {
                throw new OnboardingException('Choose at least one service to approve.');
            }
            if ($invalid = array_diff($services, $eligible)) {
                throw new OnboardingException('The assessment does not qualify the applicant for: '.implode(', ', array_map(fn ($s) => $this->serviceLabel($s), $invalid)).'.');
            }

            return $this->approveServices($rider, $actor, $services, $requested, $remarks ?: 'Completed Tourism Office onboarding.', $remarks);
        }

        if ($decision === 'reject') {
            return DB::transaction(function () use ($rider, $actor, $remarks) {
                $active = RiderAppointment::where('rider_id', $rider->id)->whereIn('status', RiderAppointment::ACTIVE)->lockForUpdate()->first();
                if ($active) {
                    $this->releaseSeat($active, RiderAppointment::STATUS_CANCELLED);
                }
                $this->setStatus($rider, self::STATUS_REJECTED);
                $this->record($rider, $actor, 'rejected', [], $remarks);
                $this->notify($rider, 'Rider application not approved', "Reason: {$remarks} You may contact the Tourism Office about reapplying.");

                return $this->moderation->moderateRider($rider, $actor, 'rejected', $remarks);
            });
        }

        if ($decision === 'return') {
            $this->setStatus($rider, self::STATUS_NEEDS_RETRAINING);
            $this->record($rider, $actor, 'returned', [], $remarks);
            $this->notify($rider, 'Further evaluation needed', "The Tourism Office returned your application for further evaluation: {$remarks}");
            $this->log($actor, 'returned', 'Returned %s for further evaluation.', $rider);

            return $rider->fresh();
        }

        throw new OnboardingException('Unknown decision.');
    }

    /**
     * Demo/presentation shortcut (config rider_onboarding.quick_approve):
     * approve an applicant for the chosen requested services without the
     * interview, training and assessment records. Uses the same approval path
     * as decide() and is recorded as a quick approval.
     */
    public function quickApprove(User $rider, User $actor, array $services): User
    {
        if (! config('rider_onboarding.quick_approve')) {
            throw new OnboardingException('Quick approval is turned off. Complete the evaluation and use the final decision.', 403);
        }
        $this->assertApplicant($rider);
        $requested = $rider->riderDetail?->requested_services ?: self::SERVICES;
        $vehicle = $rider->riderDetail?->vehicle_type;
        $rideCapable = RideVehicles::canRideHail($vehicle);
        if (! $services) {
            // Default: everything requested that the registered vehicle can do.
            $services = $rideCapable ? $requested : array_values(array_diff($requested, [User::SERVICE_TRANSPORT]));
        }
        $services = array_values(array_unique($services));
        if ($invalid = array_diff($services, $requested)) {
            throw new OnboardingException('The applicant did not apply for: '.implode(', ', array_map(fn ($s) => $this->serviceLabel($s), $invalid)).'.');
        }
        if (in_array(User::SERVICE_TRANSPORT, $services, true) && ! $rideCapable) {
            throw new OnboardingException($vehicle
                ? 'A '.strtolower(RideVehicles::LABELS[$vehicle] ?? $vehicle).' cannot be used for ride-hailing. Approve food delivery only, or register a motor vehicle.'
                : 'Register the rider\'s vehicle before approving ride-hailing.');
        }
        if ($services === []) {
            throw new OnboardingException('Choose at least one service to approve.');
        }

        $remarks = 'Quick approval (presentation/demo) — interview, training and assessment were not recorded.';

        return $this->approveServices($rider, $actor, $services, $requested, $remarks, $remarks);
    }

    /** Shared approval: per-service eligibility, appointment completed, status, record, activation, notice. */
    private function approveServices(User $rider, User $actor, array $services, array $requested, string $moderationRemarks, ?string $remarks): User
    {
        $rider->loadMissing('riderDetail');
        // Accounts created before onboarding (e.g. seeded test riders) may lack a details row.
        $detail = $rider->riderDetail ?? $rider->riderDetail()->create([]);

        return DB::transaction(function () use ($rider, $actor, $services, $requested, $remarks, $moderationRemarks, $detail) {
            foreach ($requested as $service) {
                RiderServiceEligibility::updateOrCreate(
                    ['rider_id' => $rider->id, 'service' => $service],
                    [
                        'status' => in_array($service, $services, true) ? RiderServiceEligibility::STATUS_APPROVED : RiderServiceEligibility::STATUS_NOT_ELIGIBLE,
                        'remarks' => $remarks,
                        'decided_by' => $actor->id,
                        'decided_at' => now(),
                    ]
                );
            }

            $active = RiderAppointment::where('rider_id', $rider->id)->whereIn('status', RiderAppointment::ACTIVE)->lockForUpdate()->first();
            $active?->update(['status' => RiderAppointment::STATUS_COMPLETED, 'active_rider_id' => null]);

            $partial = count($services) < count($requested);
            $detail->update([
                'current_service' => in_array($detail->current_service, $services, true) ? $detail->current_service : $services[0],
                'application_status' => $partial ? self::STATUS_PARTIALLY_APPROVED : self::STATUS_APPROVED,
            ]);
            $this->record($rider, $actor, $partial ? 'partially_approved' : 'approved', $services, $remarks);

            $approved = $this->moderation->moderateRider($rider, $actor, 'approved', $moderationRemarks);
            $labels = implode(' and ', array_map(fn ($s) => $this->serviceLabel($s), $services));
            $this->notify($rider, 'You are now a TrackTour rider', "The Tourism Office approved you for {$labels}. You can go online now.");

            return $approved;
        });
    }

    // ------------------------------------------------------------------
    // Read models
    // ------------------------------------------------------------------

    /** Office identity for a municipality (the Bansud office profile for Bansud). */
    public function officeFor(Municipality $municipality): array
    {
        $scopeId = $municipality->isHome() ? null : $municipality->id;
        $values = TourismSetting::query()
            ->when($scopeId === null, fn ($q) => $q->whereNull('municipality_id'), fn ($q) => $q->where('municipality_id', $scopeId))
            ->whereIn('key', ['office_name', 'office_address', 'office_phone', 'office_hours', 'office_email'])
            ->pluck('value', 'key');

        return [
            'municipality_id' => $municipality->id,
            'municipality' => $municipality->name,
            'name' => $values['office_name'] ?? "{$municipality->name} Tourism Office",
            'address' => $values['office_address'] ?? "Municipal Hall, {$municipality->name}, {$municipality->province}",
            'phone' => $values['office_phone'] ?? null,
            'email' => $values['office_email'] ?? null,
            'hours' => $values['office_hours'] ?? 'Monday to Friday, 8:00 AM – 5:00 PM',
        ];
    }

    /** Future open sessions for a municipality. */
    public function openSlots(int $municipalityId, ?int $days = null): Collection
    {
        $days ??= (int) config('rider_onboarding.horizon_days', 21);
        if ($municipality = Municipality::find($municipalityId)) {
            $this->ensureSessions($municipality);
        }

        return RiderTrainingSchedule::query()
            ->where('municipality_id', $municipalityId)
            ->where('status', RiderTrainingSchedule::STATUS_OPEN)
            ->where('starts_at', '>', now())
            ->where('starts_at', '<', now()->addDays($days + 1))
            ->orderBy('starts_at')
            ->get();
    }

    /** Month view for the availability calendar. */
    public function availabilityMonth(Municipality $municipality, string $month): array
    {
        $start = Carbon::createFromFormat('Y-m-d', "{$month}-01", 'Asia/Manila')->startOfDay();
        $end = $start->copy()->endOfMonth()->startOfDay();
        $overrides = $this->availabilityOverrides($municipality, $start, $end);

        $sessions = RiderTrainingSchedule::where('municipality_id', $municipality->id)
            ->whereBetween('starts_at', [$start->copy()->utc(), $end->copy()->endOfDay()->utc()])
            ->get(['id', 'starts_at', 'booked_count', 'capacity', 'status']);
        $byDay = $sessions->groupBy(fn ($s) => $s->starts_at->copy()->timezone('Asia/Manila')->toDateString());
        $affected = $this->affectedAppointments($municipality);
        $affectedByDay = $affected->groupBy(fn ($a) => $a->schedule->starts_at->copy()->timezone('Asia/Manila')->toDateString());
        $workDays = config('rider_onboarding.work_days', [1, 2, 3, 4, 5]);

        $days = [];
        for ($day = $start->copy(); $day->lte($end); $day->addDay()) {
            $key = $day->toDateString();
            $row = $overrides->get($key);
            $default = in_array($day->dayOfWeekIso, $workDays, true);
            $daySessions = $byDay->get($key, collect());
            $days[] = [
                'date' => $key,
                'weekday' => $day->dayOfWeekIso,
                'past' => $day->lt(now('Asia/Manila')->startOfDay()),
                'schedulable' => $row ? $row->isSchedulable() : $default,
                'overridden' => $row !== null,
                'trainer_available' => $row ? $row->trainer_available : $default,
                'interviewer_available' => $row ? $row->interviewer_available : $default,
                'notes' => $row?->notes,
                'booked' => (int) $daySessions->sum('booked_count'),
                'affected' => $affectedByDay->get($key, collect())->count(),
            ];
        }

        $schedulable = collect($days)->where('schedulable', true)->count();

        return [
            'month' => $month,
            'days' => $days,
            'summary' => [
                'available_days' => $schedulable,
                'unavailable_days' => count($days) - $schedulable,
                'affected_appointments' => $affected->count(),
                'pending_schedule' => User::where('role', User::ROLE_RIDER)
                    ->where('municipality_id', $municipality->id)
                    ->where('account_status', User::ACCOUNT_STATUS_PENDING)
                    ->whereHas('riderDetail', fn ($d) => $d->where('application_status', self::STATUS_PENDING_SCHEDULE))
                    ->count(),
            ],
        ];
    }

    public function presentSlot(RiderTrainingSchedule $slot): array
    {
        $local = $slot->starts_at->copy()->timezone('Asia/Manila');

        return [
            'id' => $slot->id,
            'starts_at' => $slot->starts_at->toIso8601String(),
            'date' => $local->toDateString(),
            'time' => $local->format('h:i A'),
            'capacity' => $slot->capacity,
            'booked' => $slot->booked_count,
            'remaining' => $slot->remaining(),
            'status' => $slot->status,
            'location_name' => $slot->location_name,
            'location_address' => $slot->location_address,
        ];
    }

    public function presentAppointment(?RiderAppointment $appointment): ?array
    {
        if (! $appointment) {
            return null;
        }

        return [
            'id' => $appointment->id,
            'status' => $appointment->status,
            'walk_in' => $appointment->walk_in,
            'scheduled_by' => $appointment->booked_by === null ? 'system' : ((int) $appointment->booked_by === (int) $appointment->rider_id ? 'rider' : 'office'),
            'needs_reschedule' => $appointment->status === RiderAppointment::STATUS_BOOKED && $appointment->schedule?->status === RiderTrainingSchedule::STATUS_CLOSED,
            'checked_in_at' => $appointment->checked_in_at?->toIso8601String(),
            'slot' => $appointment->schedule ? $this->presentSlot($appointment->schedule) : null,
        ];
    }

    /** Evaluation summary for the final review page. */
    public function evaluation(User $rider): array
    {
        $interview = $this->latest(RiderInterview::class, $rider);
        $assessment = $this->latest(RiderTrainingAssessment::class, $rider);
        $requested = $rider->riderDetail?->requested_services ?: self::SERVICES;

        return [
            'requested_services' => $requested,
            'checklist' => collect(self::CHECKLIST)->map(fn ($label, $key) => [
                'key' => $key,
                'label' => $label,
                'verified' => $interview ? (bool) ($interview->checklist[$key] ?? $interview->documents_verified) : null,
            ])->values(),
            'interview' => $interview ? ['result' => $interview->result, 'notes' => $interview->notes] : null,
            'assessment' => $assessment ? [
                'result' => $assessment->result,
                'score' => $assessment->score,
                'notes' => $assessment->notes,
                'items' => collect(self::ASSESSMENT_ITEMS)->map(fn ($label, $key) => [
                    'key' => $key,
                    'label' => $label,
                    'result' => $assessment->items[$key] ?? 'na',
                ])->values(),
            ] : null,
            'eligible_services' => $this->eligibleServices($assessment?->items, $requested, $rider->riderDetail?->vehicle_type),
            'eligibility' => RiderServiceEligibility::where('rider_id', $rider->id)->get()
                ->map(fn ($e) => ['service' => $e->service, 'status' => $e->status, 'decided_at' => $e->decided_at]),
            'decisions' => RiderApprovalRecord::with('decider.profile')->where('rider_id', $rider->id)->latest('id')->get()
                ->map(fn ($r) => ['decision' => $r->decision, 'services' => $r->services, 'remarks' => $r->remarks, 'by' => $r->decider?->full_name, 'at' => $r->decided_at]),
        ];
    }

    /** The seven-step tracker shown to the applicant and to staff. */
    public function stages(User $rider): array
    {
        $detail = $rider->riderDetail;
        $status = $detail?->application_status;
        $active = $this->activeAppointment($rider);
        $lastAppointment = $active ?? RiderAppointment::with('schedule')->where('rider_id', $rider->id)->latest('id')->first();
        $interview = $this->latest(RiderInterview::class, $rider);
        $attendance = $this->latest(RiderTrainingAttendance::class, $rider);
        $assessment = $this->latest(RiderTrainingAssessment::class, $rider);
        $approved = $rider->account_status === User::ACCOUNT_STATUS_APPROVED;
        $visited = $interview !== null || in_array($lastAppointment?->status, [RiderAppointment::STATUS_CHECKED_IN, RiderAppointment::STATUS_COMPLETED], true);
        $when = $active?->schedule?->starts_at?->copy()->timezone('Asia/Manila');
        $retraining = $status === self::STATUS_NEEDS_RETRAINING;
        $services = RiderServiceEligibility::where('rider_id', $rider->id)->where('status', RiderServiceEligibility::STATUS_APPROVED)->pluck('service')
            ->map(fn ($s) => $this->serviceLabel($s))->implode(', ');

        $state = [
            'submitted' => [(bool) $detail?->application_submitted_at, $detail?->application_submitted_at?->timezone('Asia/Manila')->format('F j, Y')],
            'requirements' => [
                $this->requirementsVerified($detail) || $approved,
                $detail?->requirements_verified_at
                    ? $detail->requirements_verified_at->timezone('Asia/Manila')->format('F j, Y')
                    : ($status === self::STATUS_REQUIREMENTS_RETURNED ? 'Needs correction: '.$detail?->requirements_remarks : ($status === self::STATUS_REQUIREMENTS_REVIEW ? 'Under review by the Tourism Office' : null)),
                $status === self::STATUS_REQUIREMENTS_RETURNED,
            ],
            'appointment' => [
                $active !== null || $visited || $approved,
                $when ? $when->format('F j, Y · g:i A') : ($status === self::STATUS_PENDING_SCHEDULE ? 'Waiting for an available date' : null),
            ],
            'visit' => [$visited || $approved, $active?->status === RiderAppointment::STATUS_BOOKED ? 'Bring your original documents.' : ($lastAppointment?->checked_in_at?->timezone('Asia/Manila')->format('F j, Y · g:i A'))],
            'interview' => [$interview?->result === 'passed' || $approved, $interview ? ucfirst($interview->result) : null, $interview?->result === 'failed'],
            'training' => [($attendance?->status === 'present' && ! $retraining) || $approved, $attendance ? ucfirst($attendance->status) : null, $attendance?->status === 'absent'],
            'assessment' => [
                $approved,
                $status && in_array($status, [self::STATUS_FOR_FINAL_APPROVAL, self::STATUS_NEEDS_RETRAINING, self::STATUS_REJECTED, self::STATUS_APPROVED, self::STATUS_PARTIALLY_APPROVED], true) ? self::STATUS_LABELS[$status] : null,
                $retraining || $status === self::STATUS_REJECTED,
            ],
            'activation' => [$approved, $approved ? ($services ? "Approved for {$services}" : 'Your rider account is active.') : null, $rider->account_status === User::ACCOUNT_STATUS_REJECTED],
        ];

        $stages = [];
        $currentAssigned = false;
        foreach (self::STAGES as $key => $label) {
            [$done, $detailText] = $state[$key];
            $failed = $state[$key][2] ?? false;
            $stageStatus = $done ? 'done' : ($failed ? 'failed' : (! $currentAssigned ? 'current' : 'upcoming'));
            if (! $done) {
                $currentAssigned = true;
            }
            $stages[] = ['key' => $key, 'label' => $label, 'status' => $stageStatus, 'detail' => $detailText];
        }

        return $stages;
    }

    public function history(User $rider): array
    {
        $who = fn ($row) => $row->recorder?->full_name;

        return [
            'interviews' => RiderInterview::with('recorder.profile')->where('rider_id', $rider->id)->latest('id')->get()
                ->map(fn ($r) => ['result' => $r->result, 'documents_verified' => $r->documents_verified, 'notes' => $r->notes, 'by' => $who($r), 'at' => $r->created_at]),
            'attendance' => RiderTrainingAttendance::with('recorder.profile')->where('rider_id', $rider->id)->latest('id')->get()
                ->map(fn ($r) => ['status' => $r->status, 'notes' => $r->notes, 'by' => $who($r), 'at' => $r->created_at]),
            'assessments' => RiderTrainingAssessment::with('recorder.profile')->where('rider_id', $rider->id)->latest('id')->get()
                ->map(fn ($r) => ['score' => $r->score, 'result' => $r->result, 'notes' => $r->notes, 'by' => $who($r), 'at' => $r->created_at]),
        ];
    }

    /** Latest onboarding notices for the applicant's tracker. */
    public function notices(User $rider, int $limit = 5): Collection
    {
        return Notification::where('user_id', $rider->id)
            ->where('type', 'rider_onboarding')
            ->latest('id')
            ->limit($limit)
            ->get(['id', 'title', 'message', 'created_at']);
    }

    public function serviceLabel(string $service): string
    {
        return [User::SERVICE_FOOD => 'Food Delivery', User::SERVICE_TRANSPORT => 'Ride-Hailing'][$service] ?? $service;
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    private function assertApplicant(User $rider): void
    {
        if ($rider->role !== User::ROLE_RIDER) {
            throw new OnboardingException('Only rider applicants go through onboarding.', 404);
        }
        if ($rider->account_status === User::ACCOUNT_STATUS_APPROVED) {
            throw new OnboardingException('This rider account is already active.');
        }
        if ($rider->account_status === User::ACCOUNT_STATUS_SUSPENDED) {
            throw new OnboardingException('This rider account is suspended. Contact the Tourism Office.');
        }
    }

    private function requireActive(User $rider): RiderAppointment
    {
        $appointment = $this->activeAppointment($rider);
        if (! $appointment) {
            throw new OnboardingException('This applicant has no active appointment. Book or reschedule one first.');
        }

        return $appointment;
    }

    private function sessionsOn(Municipality $municipality, Carbon $day)
    {
        return RiderTrainingSchedule::where('municipality_id', $municipality->id)
            ->whereBetween('starts_at', [$day->copy()->utc(), $day->copy()->endOfDay()->utc()]);
    }

    /** End an active appointment and give its seat back to the session. */
    private function releaseSeat(RiderAppointment $appointment, string $status): void
    {
        $appointment->update(['status' => $status, 'active_rider_id' => null, 'cancelled_at' => now()]);
        RiderTrainingSchedule::whereKey($appointment->schedule_id)->where('booked_count', '>', 0)->decrement('booked_count');
    }

    private function setStatus(User $rider, string $status): void
    {
        RiderDetail::where('user_id', $rider->id)->update(['application_status' => $status]);
        $rider->riderDetail?->setAttribute('application_status', $status);
    }

    private function record(User $rider, User $actor, string $decision, array $services, ?string $remarks): void
    {
        RiderApprovalRecord::create([
            'rider_id' => $rider->id,
            'decision' => $decision,
            'services' => $services,
            'remarks' => $remarks,
            'decided_by' => $actor->id,
            'decided_at' => now(),
        ]);
    }

    /** In-app notice in the app's notifications table (shown in the tracker too). */
    private function notify(User $rider, string $title, string $message): void
    {
        Notification::create([
            'user_id' => $rider->id,
            'title' => $title,
            'message' => $message,
            'type' => 'rider_onboarding',
        ]);
    }

    /** @param class-string $model */
    private function latest(string $model, User $rider)
    {
        return $model::where('rider_id', $rider->id)->latest('id')->first();
    }

    private function log(User $actor, string $action, string $format, User $rider): void
    {
        ActivityLog::record('rider_onboarding.'.$action, $this->scope->auditPrefix($actor).sprintf($format, $rider->email), $rider);
    }

    public static function manilaToUtc(string $date, string $time): Carbon
    {
        return Carbon::createFromFormat('Y-m-d H:i', "{$date} {$time}", 'Asia/Manila')->utc();
    }
}
