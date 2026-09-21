<?php

return [
    'credentials' => [
        'api_key' => env('FIREBASE_API_KEY', env('VITE_FIREBASE_API_KEY', '')),
        'auth_domain' => env('FIREBASE_AUTH_DOMAIN', env('VITE_FIREBASE_AUTH_DOMAIN', '')),
        'database_url' => env('FIREBASE_DATABASE_URL', env('VITE_FIREBASE_DATABASE_URL', 'https://track-tour-default-rtdb.firebaseio.com')),
        'project_id' => env('FIREBASE_PROJECT_ID', env('VITE_FIREBASE_PROJECT_ID', 'track-tour')),
        'storage_bucket' => env('FIREBASE_STORAGE_BUCKET', env('VITE_FIREBASE_STORAGE_BUCKET', '')),
        'messaging_sender_id' => env('FIREBASE_MESSAGING_SENDER_ID', env('VITE_FIREBASE_MESSAGING_SENDER_ID', '')),
        'app_id' => env('FIREBASE_APP_ID', env('VITE_FIREBASE_APP_ID', '')),
        'database_secret' => env('FIREBASE_DATABASE_SECRET', ''),
    ],

    'database' => [
        'timeout' => 5,
        'retry' => 2,
    ],

    'dispatch_enabled' => env('FIREBASE_DISPATCH_ENABLED', false),
];
