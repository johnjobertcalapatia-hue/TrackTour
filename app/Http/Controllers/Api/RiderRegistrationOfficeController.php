<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Municipality;
use App\Models\RiderTrainingSchedule;
use App\Services\RiderOnboardingService;
use Illuminate\Http\JsonResponse;

/**
 * Public list of Tourism Offices that register riders, for walk-in
 * applicants ("Find Registration Office").
 */
class RiderRegistrationOfficeController extends Controller
{
    public function __invoke(RiderOnboardingService $onboarding): JsonResponse
    {
        // Sessions are generated automatically; make sure each office has them.
        Municipality::all()->each(fn (Municipality $m) => $onboarding->ensureSessions($m));

        $open = RiderTrainingSchedule::where('status', RiderTrainingSchedule::STATUS_OPEN)
            ->where('starts_at', '>', now())
            ->selectRaw('municipality_id, MIN(starts_at) as next_at, SUM(capacity - booked_count) as seats')
            ->groupBy('municipality_id')
            ->get()
            ->keyBy('municipality_id');

        $offices = Municipality::orderByRaw('CASE WHEN LOWER(name) = ? THEN 0 ELSE 1 END', [strtolower(Municipality::HOME_MUNICIPALITY)])
            ->orderBy('name')
            ->get()
            ->map(function (Municipality $m) use ($onboarding, $open) {
                $row = $open->get($m->id);

                return array_merge($onboarding->officeFor($m), [
                    'is_home' => $m->isHome(),
                    'next_session_at' => $row ? \Illuminate\Support\Carbon::parse($row->next_at, 'UTC')->toIso8601String() : null,
                    'open_seats' => $row ? (int) $row->seats : 0,
                ]);
            });

        return $this->successResponse($offices);
    }
}
