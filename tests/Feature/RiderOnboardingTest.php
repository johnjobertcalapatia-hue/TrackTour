<?php

namespace Tests\Feature;

use App\Models\Municipality;
use App\Models\Notification;
use App\Models\RiderAppointment;
use App\Models\RiderDetail;
use App\Models\RiderServiceEligibility;
use App\Models\RiderTrainingSchedule;
use App\Models\RiderApprovalRecord;
use App\Models\User;
use App\Services\RiderOnboardingService;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Rider onboarding: automatic scheduling driven by trainer/interviewer
 * availability, manual evaluation, and controlled per-service activation.
 */
class RiderOnboardingTest extends TestCase
{
    use RefreshDatabase;

    private Municipality $bansud;
    private Municipality $gloria;
    private User $gloriaOffice;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        // Wednesday 2026-11-18, 10:00 Philippine time.
        Carbon::setTestNow(Carbon::create(2026, 11, 18, 10, 0, 0, 'Asia/Manila'));

        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->gloria = Municipality::create(['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
        $this->gloriaOffice = $this->user(User::ROLE_TOURISM_OFFICE, $this->gloria, User::ACCOUNT_STATUS_APPROVED);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    // ------------------------------------------------------------------
    // Application & automatic scheduling
    // ------------------------------------------------------------------

    public function test_new_riders_cannot_go_online_until_activated(): void
    {
        $rider = $this->applicant($this->gloria);
        RiderDetail::create(['user_id' => $rider->id, 'rider_status' => 'offline']);

        $this->actingAs($rider, 'sanctum')->postJson('/api/rider/availability/toggle')->assertForbidden();
        $this->assertSame('offline', $rider->riderDetail->fresh()->rider_status);
    }

    public function test_submitting_the_application_schedules_the_earliest_slot_and_notifies(): void
    {
        $rider = $this->applicant($this->gloria);

        $this->actingAs($rider, 'sanctum')
            ->post('/api/rider/onboarding/application', ['requested_services' => ['food']], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['vehicle_type', 'drivers_license_front', 'or_cr_image', 'license_expiry']);

        $response = $this->submitApplication($rider, ['food', 'transport'])->assertOk();

        $this->assertMatchesRegularExpression('/^TT-RIDER-\d{4}-\d{5}$/', $response->json('data.reference'));
        $response->assertJsonPath('data.application_status', 'appointment_scheduled')
            ->assertJsonPath('data.appointment.slot.date', '2026-11-19')
            ->assertJsonPath('data.appointment.slot.time', '08:00 AM')
            ->assertJsonPath('data.appointment.scheduled_by', 'system')
            ->assertJsonPath('data.stages.1.status', 'done')
            ->assertJsonPath('data.notices.0.title', 'Onboarding appointment scheduled');

        $this->assertSame(User::ACCOUNT_STATUS_PENDING, $rider->fresh()->account_status);
        Storage::disk('local')->assertExists($rider->riderDetail()->first()->drivers_license_front);
    }

    public function test_sessions_are_generated_only_on_available_working_days(): void
    {
        $rider = $this->applicant($this->gloria);

        $slots = collect($this->actingAs($rider, 'sanctum')->getJson('/api/rider/onboarding/slots')->assertOk()->json('data.slots'));

        $this->assertSame(6, $slots->where('date', '2026-11-19')->count());
        $this->assertSame(0, $slots->whereIn('date', ['2026-11-21', '2026-11-22'])->count());

        $count = RiderTrainingSchedule::count();
        $this->actingAs($rider, 'sanctum')->getJson('/api/rider/onboarding/slots')->assertOk();
        $this->assertSame($count, RiderTrainingSchedule::count());
    }

    public function test_without_any_available_date_the_application_waits_in_pending_schedule(): void
    {
        config(['rider_onboarding.work_days' => []]);
        $rider = $this->applicant($this->gloria);

        $this->submitApplication($rider)
            ->assertOk()
            ->assertJsonPath('data.appointment', null)
            ->assertJsonPath('data.application_status', 'pending_schedule')
            ->assertJsonPath('data.notices.0.title', 'Waiting for an onboarding schedule');

        // The office opens a date: both available → the waiting applicant is scheduled.
        $this->office()
            ->putJson('/api/onboarding-office/availability/2026-11-19', ['trainer_available' => true, 'interviewer_available' => true])
            ->assertOk()
            ->assertJsonPath('data.scheduled_from_pending', 1);

        $this->actingAs($rider->fresh(), 'sanctum')->getJson('/api/rider/onboarding')
            ->assertJsonPath('data.application_status', 'appointment_scheduled')
            ->assertJsonPath('data.appointment.slot.date', '2026-11-19');
    }

    public function test_a_date_needs_both_trainer_and_interviewer(): void
    {
        $this->office()
            ->putJson('/api/onboarding-office/availability/2026-11-19', ['trainer_available' => true, 'interviewer_available' => false])
            ->assertOk()
            ->assertJsonPath('data.schedulable', false);

        $rider = $this->applicant($this->gloria);
        $this->submitApplication($rider)->assertJsonPath('data.appointment.slot.date', '2026-11-20');

        $month = $this->office()->getJson('/api/onboarding-office/availability?month=2026-11')->assertOk();
        $day = collect($month->json('data.days'))->firstWhere('date', '2026-11-19');
        $this->assertFalse($day['schedulable']);
        $this->assertFalse($day['interviewer_available']);
        $this->assertTrue($day['trainer_available']);
        // November 2026: 21 working days, one made unavailable.
        $month->assertJsonPath('data.summary.available_days', 20);
    }

    public function test_marking_a_booked_date_unavailable_keeps_appointments_until_the_office_reschedules(): void
    {
        $riders = collect([1, 2, 3])->map(fn () => $this->applicant($this->gloria));
        $riders->each(fn ($r) => $this->submitApplication($r));

        $response = $this->office()
            ->putJson('/api/onboarding-office/availability/2026-11-19', ['trainer_available' => false, 'interviewer_available' => true, 'notes' => 'Trainer on leave'])
            ->assertOk()
            ->assertJsonPath('data.schedulable', false)
            ->assertJsonCount(3, 'data.affected');
        $this->assertStringContainsString('3 confirmed appointment(s) are affected', $response->json('message'));

        // Not moved silently: still on November 19, flagged for rescheduling.
        foreach ($riders as $rider) {
            $slot = RiderAppointment::with('schedule')->where('rider_id', $rider->id)->whereNotNull('active_rider_id')->first()->schedule;
            $this->assertSame('2026-11-19', $slot->starts_at->timezone('Asia/Manila')->toDateString());
        }
        $this->actingAs($riders[0], 'sanctum')->getJson('/api/rider/onboarding')->assertJsonPath('data.appointment.needs_reschedule', true);
        $this->office()->getJson('/api/onboarding-office/affected')->assertOk()->assertJsonCount(3, 'data');

        $this->office()->postJson('/api/onboarding-office/affected/reschedule')
            ->assertOk()
            ->assertJsonPath('data.moved', 3);

        foreach ($riders as $rider) {
            $slot = RiderAppointment::with('schedule')->where('rider_id', $rider->id)->whereNotNull('active_rider_id')->first()->schedule;
            $this->assertSame('2026-11-20', $slot->starts_at->timezone('Asia/Manila')->toDateString());
            $this->assertTrue(Notification::where('user_id', $rider->id)->where('title', 'Onboarding appointment set by the Tourism Office')->exists());
        }
        $this->office()->getJson('/api/onboarding-office/affected')->assertJsonCount(0, 'data');
        $this->office()->putJson('/api/onboarding-office/availability/2026-11-01', ['trainer_available' => true, 'interviewer_available' => true])->assertStatus(422);
    }

    public function test_a_full_slot_sends_the_next_applicant_to_the_following_time(): void
    {
        config(['rider_onboarding.capacity' => 1]);
        $first = $this->applicant($this->gloria);
        $second = $this->applicant($this->gloria);

        $this->submitApplication($first)->assertJsonPath('data.appointment.slot.time', '08:00 AM');
        $this->submitApplication($second)->assertJsonPath('data.appointment.slot.time', '09:00 AM');

        $eight = RiderAppointment::where('rider_id', $first->id)->first()->schedule;
        $this->actingAs($second, 'sanctum')->postJson('/api/rider/onboarding/appointment', ['schedule_id' => $eight->id])->assertStatus(409);
        $this->assertSame(1, $eight->fresh()->booked_count);
    }

    public function test_rebooking_moves_the_seat_and_cancelling_releases_it(): void
    {
        $rider = $this->applicant($this->gloria);
        $this->submitApplication($rider);
        $auto = RiderAppointment::where('rider_id', $rider->id)->first()->schedule;
        $afternoon = $this->slot($this->gloria, 5, '2026-11-19 13:00');
        $bansudSlot = $this->slot($this->bansud, 5, '2026-11-19 13:00');

        $this->actingAs($rider, 'sanctum')->postJson('/api/rider/onboarding/appointment', ['schedule_id' => $bansudSlot->id])->assertStatus(422);
        $this->actingAs($rider, 'sanctum')->postJson('/api/rider/onboarding/appointment', ['schedule_id' => $afternoon->id])
            ->assertOk()->assertJsonPath('data.appointment.scheduled_by', 'rider');

        $this->assertSame(0, $auto->fresh()->booked_count);
        $this->assertSame(1, $afternoon->fresh()->booked_count);

        $this->actingAs($rider, 'sanctum')->deleteJson('/api/rider/onboarding/appointment')->assertOk();
        $this->assertSame(0, $afternoon->fresh()->booked_count);
        $this->assertNull(RiderAppointment::where('rider_id', $rider->id)->whereNotNull('active_rider_id')->first());
    }

    public function test_the_database_allows_only_one_active_appointment_per_rider(): void
    {
        $rider = $this->applicant($this->gloria);
        $a = $this->slot($this->gloria, 2, '2026-11-20 08:00');
        $b = $this->slot($this->gloria, 2, '2026-11-20 09:00');

        RiderAppointment::create(['rider_id' => $rider->id, 'schedule_id' => $a->id, 'status' => 'booked', 'active_rider_id' => $rider->id]);

        $this->expectException(UniqueConstraintViolationException::class);
        RiderAppointment::create(['rider_id' => $rider->id, 'schedule_id' => $b->id, 'status' => 'booked', 'active_rider_id' => $rider->id]);
    }

    public function test_session_capacity_cannot_drop_below_bookings(): void
    {
        $rider = $this->applicant($this->gloria);
        $this->submitApplication($rider);
        $slot = RiderAppointment::where('rider_id', $rider->id)->first()->schedule;

        $this->office()->patchJson("/api/onboarding-office/schedules/{$slot->id}", ['capacity' => 0])->assertStatus(422);
        $this->office()->patchJson("/api/onboarding-office/schedules/{$slot->id}", ['capacity' => 8])->assertOk()->assertJsonPath('data.capacity', 8);

        $other = $this->slot($this->bansud, 3, '2026-11-20 13:00');
        $this->office()->patchJson("/api/onboarding-office/schedules/{$other->id}", ['capacity' => 9])->assertNotFound();
    }

    // ------------------------------------------------------------------
    // Evaluation & final decision
    // ------------------------------------------------------------------

    public function test_full_evaluation_requires_a_final_decision_before_activation(): void
    {
        $rider = $this->applicant($this->gloria);
        $this->submitApplication($rider, ['food', 'transport']);
        $base = "/api/onboarding-office/applicants/{$rider->id}";

        $this->office()->postJson("{$base}/interview", $this->interview())->assertStatus(422); // not checked in
        $this->office()->postJson("{$base}/check-in")->assertOk()->assertJsonPath('data.application_status', 'under_verification');
        $this->office()->postJson("{$base}/interview", $this->interview(['vehicle_documents' => false]))->assertStatus(422);
        $this->office()->postJson("{$base}/attendance", ['status' => 'present'])->assertStatus(422);
        $this->office()->postJson("{$base}/interview", $this->interview())->assertOk()->assertJsonPath('data.application_status', 'interview_completed');
        $this->office()->postJson("{$base}/attendance", ['status' => 'present'])->assertOk()->assertJsonPath('data.application_status', 'training_completed');

        // Every requested service needs its item recorded.
        $this->office()->postJson("{$base}/assessment", ['score' => 90, 'items' => $this->items(['passenger' => 'na'])])->assertStatus(422);
        $this->office()->postJson("{$base}/assessment", ['score' => 90, 'items' => $this->items()])
            ->assertOk()
            ->assertJsonPath('data.application_status', 'for_final_approval')
            // Passing training never activates the account by itself.
            ->assertJsonPath('data.account_status', 'pending_review');

        $evaluation = $this->office()->getJson($base)->assertOk();
        $evaluation->assertJsonPath('data.evaluation.eligible_services', ['food', 'transport'])
            ->assertJsonPath('data.evaluation.checklist.0.verified', true)
            ->assertJsonPath('data.evaluation.assessment.items.0.label', 'TrackTour orientation');

        $this->office()->postJson("{$base}/decision", ['decision' => 'approve', 'services' => []])->assertStatus(422);
        $this->office()->postJson("{$base}/decision", ['decision' => 'approve', 'services' => ['food', 'transport']])
            ->assertOk()
            ->assertJsonPath('data.account_status', 'approved')
            ->assertJsonPath('data.application_status', 'approved')
            ->assertJsonPath('data.stages.6.status', 'done');

        $this->assertSame(2, RiderServiceEligibility::where('rider_id', $rider->id)->where('status', 'approved')->count());
        $this->assertDatabaseHas('rider_approval_records', ['rider_id' => $rider->id, 'decision' => 'approved', 'decided_by' => $this->gloriaOffice->id]);
        $this->assertSame('completed', RiderAppointment::where('rider_id', $rider->id)->value('status'));
        $this->assertTrue(Notification::where('user_id', $rider->id)->where('title', 'You are now a TrackTour rider')->exists());

        $this->actingAs($rider->fresh(), 'sanctum')->postJson('/api/rider/availability/toggle')->assertOk();
    }

    public function test_services_are_approved_separately_and_enforced(): void
    {
        $rider = $this->evaluatedApplicant(['food', 'transport'], ['passenger' => 'failed']);
        $base = "/api/onboarding-office/applicants/{$rider->id}";

        $this->office()->getJson($base)->assertJsonPath('data.evaluation.eligible_services', ['food']);
        $this->office()->postJson("{$base}/decision", ['decision' => 'approve', 'services' => ['food', 'transport']])->assertStatus(422);
        $this->office()->postJson("{$base}/decision", ['decision' => 'approve', 'services' => ['food']])
            ->assertOk()
            ->assertJsonPath('data.application_status', 'partially_approved');

        $rider = $rider->fresh();
        $this->assertTrue($rider->isEligibleForService('food'));
        $this->assertFalse($rider->isEligibleForService('transport'));
        $this->assertDatabaseHas('rider_service_eligibilities', ['rider_id' => $rider->id, 'service' => 'transport', 'status' => 'not_eligible']);

        // The rider API refuses the unapproved service.
        $this->actingAs($rider, 'sanctum')->postJson('/api/rider/service', ['service' => 'transport'])->assertForbidden();
        $this->assertSame('food', $rider->riderDetail->fresh()->current_service);

        // Dispatch candidate queries skip riders for services they are not approved for;
        // riders approved before onboarding (no eligibility rows) keep both — and
        // ride-hailing additionally needs a registered motor vehicle (reconciled 2026-11-16).
        $legacy = $this->user(User::ROLE_RIDER, $this->gloria, User::ACCOUNT_STATUS_APPROVED);
        $this->assertTrue(User::whereKey($rider->id)->eligibleForService('food')->exists());
        $this->assertFalse(User::whereKey($rider->id)->eligibleForService('transport')->exists());
        $this->assertFalse(User::whereKey($legacy->id)->eligibleForService('transport')->exists()); // no vehicle registered
        RiderDetail::updateOrCreate(['user_id' => $legacy->id], ['vehicle_type' => 'motorcycle']);
        $this->assertTrue(User::whereKey($legacy->id)->eligibleForService('transport')->exists());
        $this->assertTrue($legacy->fresh()->isEligibleForService('transport'));
    }

    public function test_return_for_further_evaluation_then_retraining(): void
    {
        $rider = $this->evaluatedApplicant(['food']);
        $base = "/api/onboarding-office/applicants/{$rider->id}";

        $this->office()->postJson("{$base}/decision", ['decision' => 'return'])->assertStatus(422);
        $this->office()->postJson("{$base}/decision", ['decision' => 'return', 'remarks' => 'Repeat the practical assessment.'])
            ->assertOk()
            ->assertJsonPath('data.application_status', 'needs_retraining')
            ->assertJsonPath('data.account_status', 'pending_review');

        $this->office()->postJson("{$base}/attendance", ['status' => 'present'])->assertOk();
        $this->office()->postJson("{$base}/assessment", ['score' => 85, 'items' => $this->items(['passenger' => 'na'])])->assertOk();
        $this->office()->postJson("{$base}/decision", ['decision' => 'approve', 'services' => ['food']])->assertOk()->assertJsonPath('data.application_status', 'approved');

        // Phase 1's verification is part of the decision history (2026-11-17).
        $this->assertSame(['requirements_verified', 'returned', 'approved'], \App\Models\RiderApprovalRecord::where('rider_id', $rider->id)->orderBy('id')->pluck('decision')->all());
    }

    public function test_rejecting_requires_a_reason_frees_the_seat_and_blocks_self_rebooking(): void
    {
        $rider = $this->applicant($this->gloria);
        $this->submitApplication($rider);
        $slot = RiderAppointment::where('rider_id', $rider->id)->first()->schedule;
        $base = "/api/onboarding-office/applicants/{$rider->id}";

        $this->office()->postJson("{$base}/decision", ['decision' => 'reject'])->assertStatus(422);
        $this->office()->postJson("{$base}/decision", ['decision' => 'reject', 'remarks' => 'License is not valid.'])->assertOk();

        $this->assertSame(User::ACCOUNT_STATUS_REJECTED, $rider->fresh()->account_status);
        $this->assertSame(0, $slot->fresh()->booked_count);
        $this->assertDatabaseHas('rider_approval_records', ['rider_id' => $rider->id, 'decision' => 'rejected', 'remarks' => 'License is not valid.']);

        $this->actingAs($rider->fresh(), 'sanctum')->getJson('/api/rider/onboarding')
            ->assertJsonPath('data.rejection_remarks', 'License is not valid.')
            ->assertJsonPath('data.application_status', 'rejected');
        $this->actingAs($rider->fresh(), 'sanctum')->postJson('/api/rider/onboarding/appointment', ['schedule_id' => $slot->id])->assertStatus(422);
    }

    public function test_offices_only_see_their_own_applicants(): void
    {
        $bansudRider = $this->applicant($this->bansud);

        $this->office()->getJson("/api/onboarding-office/applicants/{$bansudRider->id}")->assertNotFound();
        $this->office()->postJson("/api/onboarding-office/applicants/{$bansudRider->id}/decision", ['decision' => 'reject', 'remarks' => 'x'])->assertNotFound();
        $this->assertSame(User::ACCOUNT_STATUS_PENDING, $bansudRider->fresh()->account_status);

        $admin = $this->user(User::ROLE_BANSUD_TOURISM_OFFICE, $this->bansud, User::ACCOUNT_STATUS_APPROVED);
        $this->actingAs($admin, 'sanctum')->getJson("/api/onboarding-office/applicants/{$bansudRider->id}")->assertOk();

        foreach ([User::ROLE_RIDER, User::ROLE_TOURIST] as $role) {
            $this->actingAs($this->user($role, $this->gloria, User::ACCOUNT_STATUS_APPROVED), 'sanctum')
                ->getJson('/api/onboarding-office/applicants')
                ->assertForbidden();
        }
    }

    /**
     * Onboarding is strictly per municipality: a rider registered in Gloria
     * trains in Gloria and is seen and decided only by the Gloria office. The
     * Bansud office runs Bansud's onboarding only (it no longer switches
     * municipalities with municipality_id).
     */
    public function test_the_bansud_office_cannot_see_or_decide_another_municipalitys_applicants(): void
    {
        $gloriaRider = $this->applicant($this->gloria);
        $this->submitApplication($gloriaRider)->assertOk();
        $admin = $this->actingAs($this->user(User::ROLE_BANSUD_TOURISM_OFFICE, $this->bansud, User::ACCOUNT_STATUS_APPROVED), 'sanctum');

        $admin->getJson("/api/onboarding-office/applicants/{$gloriaRider->id}")->assertNotFound();
        $admin->postJson("/api/onboarding-office/applicants/{$gloriaRider->id}/check-in")->assertNotFound();
        $ids = collect($admin->getJson('/api/onboarding-office/applicants')->assertOk()->json('data'))->pluck('id');
        $this->assertNotContains($gloriaRider->id, $ids);

        foreach (['availability', 'appointments', 'applicants', 'schedules', 'affected'] as $path) {
            $admin->getJson("/api/onboarding-office/{$path}?municipality_id={$this->gloria->id}")->assertForbidden();
        }
        $admin->putJson('/api/onboarding-office/availability/2026-11-20', ['municipality_id' => $this->gloria->id, 'trainer_available' => false, 'interviewer_available' => true])
            ->assertForbidden();
        $this->assertDatabaseMissing('rider_training_availability', ['municipality_id' => $this->gloria->id]);

        // No bypass through the admin rider directory either.
        $admin->postJson("/api/admin/riders/{$gloriaRider->id}/approve")->assertForbidden();
        $admin->postJson("/api/admin/riders/{$gloriaRider->id}/reject", ['remarks' => 'x'])->assertForbidden();
        $this->assertSame(User::ACCOUNT_STATUS_PENDING, $gloriaRider->fresh()->account_status);

        // The rider's own office still handles them.
        $this->office()->getJson("/api/onboarding-office/applicants/{$gloriaRider->id}")->assertOk();
    }

    public function test_an_applicant_cannot_train_outside_the_registered_municipality(): void
    {
        $rider = $this->applicant($this->gloria);
        $this->submitApplication($rider)->assertOk();
        $bansudSlot = $this->slot($this->bansud, 5, '2026-11-20 13:00');

        // Rider cannot book another municipality's session...
        $this->actingAs($rider, 'sanctum')->postJson('/api/rider/onboarding/appointment', ['schedule_id' => $bansudSlot->id])->assertStatus(422);
        // ...nor can their office move them into one.
        $this->office()->postJson("/api/onboarding-office/applicants/{$rider->id}/reschedule", ['schedule_id' => $bansudSlot->id])->assertStatus(422);
        $this->assertSame(0, $bansudSlot->fresh()->booked_count);

        // The admin cannot move a mid-onboarding rider to another municipality.
        $admin = $this->actingAs($this->user(User::ROLE_BANSUD_TOURISM_OFFICE, $this->bansud, User::ACCOUNT_STATUS_APPROVED), 'sanctum');
        $admin->putJson("/api/admin/riders/{$rider->id}/municipality", ['municipality_id' => $this->bansud->id])->assertStatus(422);
        $this->assertSame($this->gloria->id, (int) $rider->fresh()->municipality_id);
    }

    /** Presentation/demo shortcut: approve without the evaluation records. */
    public function test_quick_approve_activates_an_applicant_for_the_chosen_services(): void
    {
        config(['rider_onboarding.quick_approve' => true]);
        $rider = $this->applicant($this->gloria);
        $this->submitApplication($rider, ['food', 'transport'])->assertOk();
        $appointment = RiderAppointment::where('rider_id', $rider->id)->firstOrFail();

        $this->office()->getJson("/api/onboarding-office/applicants/{$rider->id}")->assertJsonPath('data.quick_approve_enabled', true);
        $this->office()->postJson("/api/onboarding-office/applicants/{$rider->id}/quick-approve", ['services' => ['bogus']])->assertStatus(422);

        $this->office()->postJson("/api/onboarding-office/applicants/{$rider->id}/quick-approve", ['services' => ['food']])
            ->assertOk()
            ->assertJsonPath('data.account_status', User::ACCOUNT_STATUS_APPROVED)
            ->assertJsonPath('data.application_status', 'partially_approved');

        $this->assertTrue($rider->fresh()->isEligibleForService('food'));
        $this->assertFalse($rider->fresh()->isEligibleForService('transport'));
        $this->assertSame(RiderAppointment::STATUS_COMPLETED, $appointment->fresh()->status);
        $this->assertDatabaseHas('rider_approval_records', ['rider_id' => $rider->id, 'decision' => 'partially_approved']);
        $this->assertStringContainsString('Quick approval', RiderApprovalRecord::where('rider_id', $rider->id)->latest('id')->value('remarks'));
        $this->assertDatabaseHas('notifications', ['user_id' => $rider->id, 'title' => 'You are now a TrackTour rider']);

        // Already active: a second quick approval is refused.
        $this->office()->postJson("/api/onboarding-office/applicants/{$rider->id}/quick-approve")->assertStatus(422);
    }

    public function test_quick_approve_without_services_approves_everything_requested_and_works_without_an_application(): void
    {
        config(['rider_onboarding.quick_approve' => true]);
        $rider = $this->applicant($this->gloria); // registered, never submitted the application

        // Reconciled 2026-11-16: with no registered vehicle, the default is
        // food only — ride-hailing needs a registered motor vehicle.
        $this->office()->postJson("/api/onboarding-office/applicants/{$rider->id}/quick-approve")->assertOk()
            ->assertJsonPath('data.application_status', 'partially_approved');
        $this->assertTrue($rider->fresh()->isEligibleForService('food'));
        $this->assertFalse($rider->fresh()->isEligibleForService('transport'));

        $withMotorcycle = $this->applicant($this->gloria);
        RiderDetail::updateOrCreate(['user_id' => $withMotorcycle->id], ['vehicle_type' => 'motorcycle']);
        $this->office()->postJson("/api/onboarding-office/applicants/{$withMotorcycle->id}/quick-approve")->assertOk()
            ->assertJsonPath('data.application_status', 'approved');
        $this->assertTrue($withMotorcycle->fresh()->isEligibleForService('transport'));
    }

    public function test_quick_approve_can_be_turned_off_and_stays_per_municipality(): void
    {
        $rider = $this->applicant($this->gloria);

        config(['rider_onboarding.quick_approve' => false]);
        $this->office()->getJson("/api/onboarding-office/applicants/{$rider->id}")->assertJsonPath('data.quick_approve_enabled', false);
        $this->office()->postJson("/api/onboarding-office/applicants/{$rider->id}/quick-approve")->assertForbidden();
        $this->assertSame(User::ACCOUNT_STATUS_PENDING, $rider->fresh()->account_status);

        config(['rider_onboarding.quick_approve' => true]);
        $admin = $this->user(User::ROLE_BANSUD_TOURISM_OFFICE, $this->bansud, User::ACCOUNT_STATUS_APPROVED);
        $this->actingAs($admin, 'sanctum')->postJson("/api/onboarding-office/applicants/{$rider->id}/quick-approve")->assertNotFound();
        $this->actingAs($this->user(User::ROLE_RIDER, $this->gloria, User::ACCOUNT_STATUS_APPROVED), 'sanctum')
            ->postJson("/api/onboarding-office/applicants/{$rider->id}/quick-approve")->assertForbidden();
        $this->assertSame(User::ACCOUNT_STATUS_PENDING, $rider->fresh()->account_status);
    }

    /**
     * Two phases (2026-11-17): (1) the rider creates an account and submits
     * the requirements online; the Tourism Office verifies and validates
     * them — only then is training scheduled; (2) interview and training,
     * then the final approval. The office never registers riders itself.
     */
    public function test_requirements_are_verified_before_training_is_scheduled(): void
    {
        $this->slot($this->gloria, 5, '2026-11-19 08:00');
        $rider = $this->applicant($this->gloria);

        $this->submitOnly($rider, ['food'])->assertOk()
            ->assertJsonPath('data.application_status', 'requirements_review')
            ->assertJsonPath('data.appointment', null)
            ->assertJsonPath('data.requirements.verified', false)
            ->assertJsonPath('data.stages.1.key', 'requirements')
            ->assertJsonPath('data.notices.0.title', 'Requirements received');
        $this->assertSame(0, RiderAppointment::where('rider_id', $rider->id)->count());

        // Nothing can be scheduled before verification: not by the rider, not by the office.
        $slot = RiderTrainingSchedule::where('municipality_id', $this->gloria->id)->firstOrFail();
        $this->actingAs($rider, 'sanctum')->postJson('/api/rider/onboarding/appointment', ['schedule_id' => $slot->id])->assertStatus(422);
        $this->office()->postJson("/api/onboarding-office/applicants/{$rider->id}/reschedule", ['schedule_id' => $slot->id])->assertStatus(422);

        // Returned for correction (a reason is required), then resubmitted.
        $this->office()->postJson("/api/onboarding-office/applicants/{$rider->id}/requirements/return", [])->assertStatus(422);
        $this->office()->postJson("/api/onboarding-office/applicants/{$rider->id}/requirements/return", ['remarks' => 'The OR/CR photo is blurry.'])
            ->assertOk()->assertJsonPath('data.application_status', 'requirements_returned');
        $this->actingAs($rider->fresh(), 'sanctum')->getJson('/api/rider/onboarding')
            ->assertJsonPath('data.requirements.remarks', 'The OR/CR photo is blurry.')
            ->assertJsonPath('data.stages.1.status', 'failed');
        $this->office()->postJson("/api/onboarding-office/applicants/{$rider->id}/requirements/verify")->assertStatus(422); // not under review
        $this->submitOnly($rider->fresh(), ['food'])->assertOk()->assertJsonPath('data.application_status', 'requirements_review');

        // Verified and validated → training is scheduled automatically.
        $this->office()->postJson("/api/onboarding-office/applicants/{$rider->id}/requirements/verify")
            ->assertOk()->assertJsonPath('data.application_status', 'appointment_scheduled');
        $this->actingAs($rider->fresh(), 'sanctum')->getJson('/api/rider/onboarding')
            ->assertJsonPath('data.requirements.verified', true)
            ->assertJsonPath('data.stages.1.status', 'done')
            ->assertJsonPath('data.appointment.slot.date', '2026-11-19');
        $this->assertDatabaseHas('rider_approval_records', ['rider_id' => $rider->id, 'decision' => 'requirements_verified']);
        $this->assertDatabaseHas('rider_approval_records', ['rider_id' => $rider->id, 'decision' => 'requirements_returned', 'remarks' => 'The OR/CR photo is blurry.']);

        // Verified requirements cannot be changed by the rider.
        $this->submitOnly($rider->fresh(), ['food'])->assertStatus(422);
    }

    public function test_only_the_riders_own_office_verifies_and_walk_in_registration_is_gone(): void
    {
        $rider = $this->applicant($this->gloria);
        $this->submitOnly($rider)->assertOk();

        $admin = $this->user(User::ROLE_BANSUD_TOURISM_OFFICE, $this->bansud, User::ACCOUNT_STATUS_APPROVED);
        $this->actingAs($admin, 'sanctum')->postJson("/api/onboarding-office/applicants/{$rider->id}/requirements/verify")->assertNotFound();
        $this->actingAs($this->user(User::ROLE_RIDER, $this->gloria, User::ACCOUNT_STATUS_APPROVED), 'sanctum')
            ->postJson("/api/onboarding-office/applicants/{$rider->id}/requirements/verify")->assertForbidden();
        $this->assertNull($rider->riderDetail()->value('requirements_verified_at'));

        // The office does not register riders: there is no walk-in endpoint.
        $this->office()->postJson('/api/onboarding-office/walk-ins', ['first_name' => 'Pedro'])->assertNotFound();

        // The office's applicant list can filter the requirements queue.
        $list = $this->office()->getJson('/api/onboarding-office/applicants?application_status=requirements_review')->assertOk();
        $this->assertSame([$rider->id], collect($list->json('data'))->pluck('id')->all());
        $this->assertSame(1, $list->json('meta.stats.requirements_review'));
    }

    public function test_public_office_list_shows_open_seats(): void
    {
        $offices = collect($this->getJson('/api/rider-registration/offices')->assertOk()->json('data'))->keyBy('municipality');

        $this->assertGreaterThan(0, $offices['Gloria']['open_seats']);
        $this->assertTrue($offices['Bansud']['is_home']);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private function office()
    {
        return $this->actingAs($this->gloriaOffice, 'sanctum');
    }

    private function user(string $role, ?Municipality $municipality, string $status): User
    {
        return User::create([
            'name' => ucfirst($role).' '.Str::random(4),
            'email' => Str::lower($role.'.'.Str::random(10)).'@example.com',
            'password' => 'Password123!',
            'role' => $role,
            'account_status' => $status,
            'municipality_id' => $municipality?->id,
        ]);
    }

    private function applicant(Municipality $municipality): User
    {
        return $this->user(User::ROLE_RIDER, $municipality, User::ACCOUNT_STATUS_PENDING);
    }

    /** Applicant who is checked in, interviewed, trained and assessed. */
    private function evaluatedApplicant(array $services, array $itemOverrides = []): User
    {
        $rider = $this->applicant($this->gloria);
        $this->submitApplication($rider, $services);
        $base = "/api/onboarding-office/applicants/{$rider->id}";
        $this->office()->postJson("{$base}/check-in")->assertOk();
        $this->office()->postJson("{$base}/interview", $this->interview())->assertOk();
        $this->office()->postJson("{$base}/attendance", ['status' => 'present'])->assertOk();
        $items = $this->items(in_array('transport', $services, true) ? $itemOverrides : array_merge(['passenger' => 'na'], $itemOverrides));
        $this->office()->postJson("{$base}/assessment", ['score' => 80, 'items' => $items])->assertOk();

        return $rider;
    }

    private function interview(array $overrides = []): array
    {
        return [
            'result' => 'passed',
            'checklist' => array_merge(array_fill_keys(array_keys(RiderOnboardingService::CHECKLIST), true), $overrides),
            'notes' => 'Clear answers.',
        ];
    }

    private function items(array $overrides = []): array
    {
        return array_merge(array_fill_keys(array_keys(RiderOnboardingService::ASSESSMENT_ITEMS), 'passed'), $overrides);
    }

    /** @param string $when Philippine local time, "Y-m-d H:i" */
    private function slot(Municipality $municipality, int $capacity, string $when): RiderTrainingSchedule
    {
        return RiderTrainingSchedule::updateOrCreate(
            ['municipality_id' => $municipality->id, 'starts_at' => Carbon::createFromFormat('Y-m-d H:i', $when, 'Asia/Manila')->utc()],
            ['capacity' => $capacity, 'location_name' => "{$municipality->name} Tourism Office", 'status' => 'open']
        );
    }

    /**
     * Phase 1 then the office's verification: training is scheduled only after
     * the rider's own Tourism Office verifies the requirements (2026-11-17).
     * Returns the rider's onboarding state afterwards.
     */
    private function submitApplication(User $rider, array $services = ['food'])
    {
        $submitted = $this->submitOnly($rider, $services);
        if ($submitted->getStatusCode() !== 200) {
            return $submitted;
        }
        $this->actingAs($this->verifierFor($rider), 'sanctum')
            ->postJson("/api/onboarding-office/applicants/{$rider->id}/requirements/verify")
            ->assertOk();

        return $this->actingAs($rider->fresh(), 'sanctum')->getJson('/api/rider/onboarding');
    }

    private function verifierFor(User $rider): User
    {
        if ((int) $rider->municipality_id === (int) $this->gloria->id) {
            return $this->gloriaOffice;
        }

        return User::where('role', User::ROLE_BANSUD_TOURISM_OFFICE)->first()
            ?? $this->user(User::ROLE_BANSUD_TOURISM_OFFICE, $this->bansud, User::ACCOUNT_STATUS_APPROVED);
    }

    /** Phase 1 only: account and requirements submitted online. */
    private function submitOnly(User $rider, array $services = ['food'])
    {
        return $this->actingAs($rider, 'sanctum')->post('/api/rider/onboarding/application', [
            'requested_services' => $services,
            'vehicle_type' => 'motorcycle',
            'vehicle_plate_number' => 'abc 1234',
            'license_number' => 'N01-23-456789',
            'license_expiry' => now()->addYear()->toDateString(),
            'drivers_license_front' => UploadedFile::fake()->image('front.jpg'),
            'drivers_license_back' => UploadedFile::fake()->image('back.jpg'),
            'or_cr_image' => UploadedFile::fake()->image('orcr.jpg'),
        ], ['Accept' => 'application/json']);
    }
}
