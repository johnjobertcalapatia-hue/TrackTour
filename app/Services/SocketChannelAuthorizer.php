<?php

namespace App\Services;

use App\Models\Staff;
use App\Models\User;

/**
 * P11.5 — Shared channel-access policy used by routes/channels.php.
 *
 * The Zero-DB socket engine authorizes room joins itself with signed HMAC
 * tokens (socket-token.js); this service is the Laravel-side equivalent used
 * by the Echo/pusher channel definitions and is unit-testable without booting
 * the broadcaster.
 */
class SocketChannelAuthorizer
{
    /**
     * A business_owner may join a business room only for businesses they own;
     * a staff user only for the business they are staffed at.
     */
    public function canAccessBusiness(User $user, int $businessId): bool
    {
        if ($user->role === User::ROLE_BUSINESS_OWNER) {
            return $user->businesses()->whereKey($businessId)->exists();
        }

        if ($user->role === 'staff') {
            return Staff::where('business_id', $businessId)
                ->where('user_id', $user->id)
                ->exists();
        }

        return false;
    }

    public function canAccessRiderChannel(User $user, int $riderId): bool
    {
        return (int) $user->id === (int) $riderId;
    }

    public function canAccessUserChannel(User $user, int $userId): bool
    {
        return (int) $user->id === (int) $userId;
    }
}