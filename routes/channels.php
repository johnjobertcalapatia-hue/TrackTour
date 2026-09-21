<?php

use App\Models\User;
use App\Services\SocketChannelAuthorizer;
use Illuminate\Support\Facades\Broadcast;

/*
|--------------------------------------------------------------------------
| Broadcast Channels
|--------------------------------------------------------------------------
|
| P11.5 — Authorized room definitions for the realtime consumers.
|
| The Zero-DB Socket.IO engine authorizes joins itself via signed HMAC tokens
| (socket-token.js). These channel callbacks are the Laravel/Echo equivalent
| and share the same policy (SocketChannelAuthorizer) so consumers receive
| ONLY the events they are authorized to see:
|
|   business.{businessId}  restaurant / kitchen staff
|   rider.{riderId}        the rider themself
|   user.{userId}          the tourist themself
|
| The trip.{deliveryId} room is authorized via the trip tokens minted by
| TripTokenService and does not use Echo channel callbacks.
*/

Broadcast::channel('business.{businessId}', function (User $user, int $businessId) {
    return app(SocketChannelAuthorizer::class)->canAccessBusiness($user, $businessId)
        ? ['id' => $user->id, 'name' => $user->name]
        : false;
});

Broadcast::channel('rider.{riderId}', function (User $user, int $riderId) {
    return app(SocketChannelAuthorizer::class)->canAccessRiderChannel($user, $riderId)
        ? ['id' => $user->id]
        : false;
});

Broadcast::channel('user.{userId}', function (User $user, int $userId) {
    return app(SocketChannelAuthorizer::class)->canAccessUserChannel($user, $userId)
        ? ['id' => $user->id]
        : false;
});