<?php

namespace App\Services;

use App\Models\Business;
use App\Models\BusinessEngagementEvent;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Records real tourist-facing views for popularity analytics.
 *
 * One row per viewer, business, kind and Philippine day (unique index +
 * insertOrIgnore), so reloads cannot inflate numbers. Staff, owners and
 * administrators viewing a listing are not counted. Recording never breaks
 * the page: failures are logged and swallowed.
 */
class BusinessEngagementRecorder
{
    private const NON_AUDIENCE_ROLES = [
        User::ROLE_BUSINESS_OWNER, User::ROLE_TOURISM_OFFICE, User::ROLE_BANSUD_TOURISM_OFFICE, User::ROLE_RIDER,
    ];

    public function profileView(Business $business, Request $request): void
    {
        $this->record($business, BusinessEngagementEvent::TYPE_PROFILE_VIEW, null, $request);
    }

    public function offeringView(Business $business, int $offeringId, Request $request): void
    {
        $this->record($business, BusinessEngagementEvent::TYPE_OFFERING_VIEW, $offeringId, $request);
    }

    private function record(Business $business, string $type, ?int $offeringId, Request $request): void
    {
        try {
            $user = $request->user('sanctum');
            if ($user && (in_array($user->role, self::NON_AUDIENCE_ROLES, true) || (int) $business->owner_id === (int) $user->id)) {
                return;
            }

            $viewer = $user
                ? 'u:'.$user->id
                : 'g:'.hash('sha256', ($request->ip() ?? '').'|'.substr((string) $request->userAgent(), 0, 200));

            BusinessEngagementEvent::query()->insertOrIgnore([
                'business_id' => $business->id,
                'type' => $type,
                'offering_id' => $offeringId,
                'viewer_key' => substr(hash('sha256', $viewer), 0, 64),
                'viewed_on' => now('Asia/Manila')->toDateString(),
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('Business engagement not recorded', ['business_id' => $business->id, 'type' => $type, 'error' => $e->getMessage()]);
        }
    }
}
