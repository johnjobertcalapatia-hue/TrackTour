<?php

return [
    'server_url' => env('SOCKET_SERVER_URL', 'http://127.0.0.1:3002'),
    'port' => env('SOCKET_PORT', 3001),
    'bridge_port' => env('SOCKET_BRIDGE_PORT', 3002),
    // Shared secret between Laravel and the socket bridge. The socket server
    // rejects any bridge request that does not present this value. The same
    // secret signs HMAC trip tokens minted by TripTokenService.
    'bridge_secret' => env('SOCKET_BRIDGE_SECRET', ''),
    // Lifetime (seconds) of a minted trip token. Bounds how long a participant
    // may (re-)join their trip room across reconnects.
    'trip_token_ttl_seconds' => env('SOCKET_TRIP_TOKEN_TTL_SECONDS', 7200),
];
