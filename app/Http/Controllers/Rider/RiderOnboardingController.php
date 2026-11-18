<?php

namespace App\Http\Controllers\Rider;

use App\Exceptions\OnboardingException;
use App\Http\Controllers\Controller;
use App\Models\RiderReview;
use App\Models\RiderTrainingSchedule;
use App\Models\User;
use App\Services\RiderOnboardingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** The applicant's own onboarding: application, appointment, tracker. */
class RiderOnboardingController extends Controller
{
    public function __construct(private RiderOnboardingService $onboarding) {}

    public function show(Request $request): JsonResponse
    {
        return $this->successResponse($this->payload($request->user()));
    }

    public function submitApplication(Request $request): JsonResponse
    {
        $rider = $request->user();
        $detail = $rider->riderDetail;
        // A bicycle (food delivery only) needs no plate, driver's license or OR/CR.
        $bicycle = $request->input('vehicle_type') === 'bicycle';
        $docRule = fn (string $field, bool $required) => [
            $required && ! $bicycle && ! filled($detail?->getAttribute($field)) ? 'required' : 'nullable',
            'file', 'mimes:jpg,jpeg,png,webp,pdf', 'max:8192',
        ];

        $validated = $request->validate([
            'requested_services' => ['required', 'array', 'min:1', function (string $attribute, mixed $value, \Closure $fail) use ($bicycle) {
                if ($bicycle && is_array($value) && in_array(User::SERVICE_TRANSPORT, $value, true)) {
                    $fail('A bicycle can be used for food delivery only, not ride-hailing.');
                }
            }],
            'requested_services.*' => ['string', Rule::in(RiderOnboardingService::SERVICES)],
            'vehicle_type' => ['required', Rule::in(RiderOnboardingService::VEHICLES)],
            'vehicle_make' => ['nullable', 'string', 'max:50'],
            'vehicle_model' => ['nullable', 'string', 'max:50'],
            'vehicle_plate_number' => [$bicycle ? 'nullable' : 'required', 'string', 'max:20', 'regex:/^[A-Za-z0-9\- ]+$/'],
            'vehicle_year' => ['nullable', 'integer', 'between:1980,'.(now()->year + 1)],
            'license_number' => [$bicycle ? 'nullable' : 'required', 'string', 'max:30'],
            'license_expiry' => [$bicycle ? 'nullable' : 'required', 'date', 'after:today'],
            'drivers_license_front' => $docRule('drivers_license_front', true),
            'drivers_license_back' => $docRule('drivers_license_back', true),
            'or_cr_image' => $docRule('or_cr_image', true),
            'nbi_clearance' => $docRule('nbi_clearance', false),
        ], [
            'requested_services.required' => 'Choose at least one rider service.',
            'license_expiry.after' => 'Your driver\'s license must not be expired.',
            'drivers_license_front.required' => 'Upload the front of your driver\'s license.',
            'drivers_license_back.required' => 'Upload the back of your driver\'s license.',
            'or_cr_image.required' => 'Upload your vehicle OR/CR.',
        ]);

        try {
            $this->onboarding->submitApplication($rider, $validated, $request->allFiles());
        } catch (OnboardingException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        return $this->successResponse($this->payload($rider->fresh('riderDetail')), 'Application submitted. The Tourism Office will verify your requirements, then schedule your training.');
    }

    public function slots(Request $request): JsonResponse
    {
        $rider = $request->user();
        $municipality = $rider->municipality;
        if (! $municipality) {
            return $this->errorResponse('Set your municipality in your profile first.', 422);
        }

        return $this->successResponse([
            'office' => $this->onboarding->officeFor($municipality),
            'slots' => $this->onboarding->openSlots($municipality->id)->map(fn ($s) => $this->onboarding->presentSlot($s))->values(),
        ]);
    }

    public function book(Request $request): JsonResponse
    {
        $validated = $request->validate(['schedule_id' => ['required', 'integer', 'exists:rider_training_schedules,id']]);

        try {
            $this->onboarding->book($request->user(), RiderTrainingSchedule::findOrFail($validated['schedule_id']));
        } catch (OnboardingException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        return $this->successResponse($this->payload($request->user()->fresh()), 'Appointment confirmed.');
    }

    public function cancel(Request $request): JsonResponse
    {
        try {
            $this->onboarding->cancel($request->user());
        } catch (OnboardingException $e) {
            return $this->errorResponse($e->getMessage(), $e->status);
        }

        return $this->successResponse($this->payload($request->user()->fresh()), 'Appointment cancelled.');
    }

    private function payload(User $rider): array
    {
        $rider->loadMissing('riderDetail', 'municipality');
        $detail = $rider->riderDetail;

        return [
            'reference' => $detail?->application_reference,
            'account_status' => $rider->account_status,
            'application_status' => $detail?->application_status,
            'application_status_label' => $detail?->application_status ? (RiderOnboardingService::STATUS_LABELS[$detail->application_status] ?? null) : null,
            'notices' => $this->onboarding->notices($rider),
            // Phase 1 → 2: training is scheduled once the office verifies the requirements.
            'requirements' => [
                'verified' => $detail?->requirements_verified_at !== null,
                'verified_at' => $detail?->requirements_verified_at?->toIso8601String(),
                'remarks' => $detail?->requirements_remarks,
            ],
            'rejection_remarks' => $rider->account_status === User::ACCOUNT_STATUS_REJECTED
                ? RiderReview::where('rider_id', $rider->id)->where('decision', 'rejected')->latest('id')->value('remarks')
                : null,
            'office' => $rider->municipality ? $this->onboarding->officeFor($rider->municipality) : null,
            'application' => [
                'submitted' => (bool) $detail?->application_submitted_at,
                'submitted_at' => $detail?->application_submitted_at?->toIso8601String(),
                'requested_services' => $detail?->requested_services ?? [],
                'vehicle_type' => $detail?->vehicle_type,
                'vehicle_make' => $detail?->vehicle_make,
                'vehicle_model' => $detail?->vehicle_model,
                'vehicle_plate_number' => $detail?->vehicle_plate_number,
                'vehicle_year' => $detail?->vehicle_year,
                'license_number' => $detail?->license_number,
                'license_expiry' => $detail?->license_expiry?->toDateString(),
                'documents' => collect(RiderOnboardingService::DOCUMENTS)->map(fn ($label, $field) => [
                    'key' => $field,
                    'name' => $label,
                    'uploaded' => filled($detail?->getAttribute($field)),
                    // A bicycle needs no driver's license or OR/CR.
                    'required' => $field !== 'nbi_clearance' && $detail?->vehicle_type !== 'bicycle',
                ])->values(),
            ],
            'appointment' => $this->onboarding->presentAppointment($this->onboarding->activeAppointment($rider)),
            'stages' => $this->onboarding->stages($rider),
        ];
    }
}
