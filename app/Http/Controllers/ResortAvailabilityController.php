<?php

namespace App\Http\Controllers;

use App\Models\Business;
use App\Models\ResortBlockedDate;
use App\Models\ResortOffering;
use App\Models\ResortOfferingAllocation;
use App\Services\ResortAvailabilityService;
use App\Services\ResortClassificationService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * Resort availability (reservations Stage 6, docs/resort-reservation-architecture.md §11).
 *
 * Tourists: the calendar of a resort's published offerings (read-only, public like
 * the resort page). Owners: the same calendar with unpublished offerings, and the
 * resort's blocked dates (closures for the whole resort or one offering).
 */
class ResortAvailabilityController extends Controller
{
    public function __construct(private ResortAvailabilityService $availability) {}

    /** GET /tourist/resorts/{business}/availability?from=&to= */
    public function show(Request $request, Business $business): JsonResponse
    {
        $business->loadMissing('category');
        if ($business->status !== 'approved' || ! ResortClassificationService::isResort($business)) {
            return $this->errorResponse('Resort not found.', 404);
        }
        [$from, $to] = $this->range($request, allowPast: false);
        $offerings = $business->resortOfferings()->published()->get()
            ->filter(fn (ResortOffering $o) => $o->requires_offering_id === null || $o->requires?->is_published)
            ->values();

        return $this->successResponse($this->availability->calendar($business, $offerings, $from, $to));
    }

    /** GET /business-owner/businesses/{business}/resort-availability?from=&to= */
    public function ownerShow(Request $request, Business $business): JsonResponse
    {
        $this->authorizeResort($request, $business);
        [$from, $to] = $this->range($request, allowPast: true);

        return $this->successResponse($this->availability->calendar($business, $business->resortOfferings()->get(), $from, $to));
    }

    /** GET /business-owner/businesses/{business}/resort-blocked-dates — today onwards. */
    public function blockedIndex(Request $request, Business $business): JsonResponse
    {
        $this->authorizeResort($request, $business);

        return $this->successResponse(
            ResortBlockedDate::where('business_id', $business->id)
                ->where('end_date', '>=', $this->availability->today())
                ->with('offering:id,name')
                ->orderBy('start_date')->get()
                ->map(fn (ResortBlockedDate $b) => $this->present($b))->values()
        );
    }

    /**
     * POST /business-owner/businesses/{business}/resort-blocked-dates
     * Existing reservations on those dates are kept; the reply says how many units are
     * already reserved there so the owner can contact those guests.
     */
    public function blockedStore(Request $request, Business $business): JsonResponse
    {
        $this->authorizeResort($request, $business);
        $today = $this->availability->today();
        $data = $request->validate([
            'start_date' => ['required', 'date_format:Y-m-d', 'after_or_equal:'.$today],
            'end_date' => ['required', 'date_format:Y-m-d', 'after_or_equal:start_date'],
            'resort_offering_id' => ['nullable', 'integer'],
            'reason' => ['nullable', 'string', 'max:255'],
        ], [
            'start_date.after_or_equal' => 'Choose today or a later date.',
            'end_date.after_or_equal' => 'The last day cannot be before the first day.',
        ]);
        if (CarbonImmutable::parse($data['start_date'])->diffInDays(CarbonImmutable::parse($data['end_date'])) > 365) {
            throw ValidationException::withMessages(['end_date' => 'Block at most one year at a time.']);
        }
        $offeringIds = $business->resortOfferings()->pluck('id');
        if (isset($data['resort_offering_id']) && ! $offeringIds->contains((int) $data['resort_offering_id'])) {
            throw ValidationException::withMessages(['resort_offering_id' => 'Choose an offering of this resort.']);
        }

        $block = ResortBlockedDate::create([
            'business_id' => $business->id,
            'resort_offering_id' => $data['resort_offering_id'] ?? null,
            'start_date' => $data['start_date'],
            'end_date' => $data['end_date'],
            'reason' => isset($data['reason']) && trim($data['reason']) !== '' ? trim($data['reason']) : null,
            'created_by' => $request->user()->id,
        ]);

        $reserved = (int) ResortOfferingAllocation::whereIn('resort_offering_id', isset($data['resort_offering_id']) ? [(int) $data['resort_offering_id']] : $offeringIds)
            ->whereBetween('date', [$data['start_date'], $data['end_date']])
            ->sum('reserved_quantity');

        return $this->createdResponse(
            $this->present($block->load('offering:id,name')) + ['already_reserved' => $reserved],
            $reserved > 0
                ? "Dates blocked. {$reserved} already reserved on those dates stay booked; contact those guests if needed."
                : 'Dates blocked.'
        );
    }

    /** DELETE /business-owner/businesses/{business}/resort-blocked-dates/{block} */
    public function blockedDestroy(Request $request, Business $business, ResortBlockedDate $block): JsonResponse
    {
        $this->authorizeResort($request, $business);
        if ((int) $block->business_id !== (int) $business->id) {
            return $this->errorResponse('Not found.', 404);
        }
        $block->delete();

        return $this->successResponse(null, 'Dates reopened.');
    }

    /** @return array{0: string, 1: string} */
    private function range(Request $request, bool $allowPast): array
    {
        $today = $this->availability->today();
        $data = $request->validate([
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
        ]);
        $from = $data['from'] ?? $today;
        if (! $allowPast && $from < $today) {
            $from = $today;
        }
        $to = $data['to'] ?? CarbonImmutable::parse($from)->addDays(29)->toDateString();
        if ($to < $from) {
            throw ValidationException::withMessages(['to' => 'The end date cannot be before the start date.']);
        }
        if (CarbonImmutable::parse($from)->diffInDays(CarbonImmutable::parse($to)) >= ResortAvailabilityService::MAX_RANGE_DAYS) {
            throw ValidationException::withMessages(['to' => 'Ask for at most '.ResortAvailabilityService::MAX_RANGE_DAYS.' days at a time.']);
        }

        return [$from, $to];
    }

    private function present(ResortBlockedDate $b): array
    {
        return [
            'id' => $b->id,
            'resort_offering_id' => $b->resort_offering_id,
            'offering_name' => $b->offering?->name,
            'start_date' => $b->start_date->toDateString(),
            'end_date' => $b->end_date->toDateString(),
            'reason' => $b->reason,
        ];
    }

    private function authorizeResort(Request $request, Business $business): void
    {
        if ((int) $business->owner_id !== (int) $request->user()->id) {
            abort(403);
        }
        $business->loadMissing('category');
        if (! ResortClassificationService::isResort($business)) {
            abort(response()->json(['success' => false, 'message' => 'Availability is only for Resort businesses.'], 422));
        }
    }
}
