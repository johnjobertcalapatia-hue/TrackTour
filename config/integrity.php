<?php

return [
    // Secure transaction architecture (docs/secure-transaction-audit.md).
    'enabled' => env('TRANSACTION_LEDGER_ENABLED', true),

    // Checkpoint signing keyring. Keep keys OUTSIDE the database (environment
    // or secret store), backed up securely, and never equal to APP_KEY.
    //   TRANSACTION_CHECKPOINT_KEY      current signing key (php artisan integrity:key)
    //   TRANSACTION_CHECKPOINT_KEY_ID   its short name, stored on every checkpoint
    //   TRANSACTION_CHECKPOINT_OLD_KEYS retired keys still needed to verify older
    //                                   checkpoints: "id1:key1,id2:key2"
    // Without a key, local / testing environments sign with a key derived from
    // APP_KEY (key id "derived"); production refuses to sign.
    'checkpoint_key' => env('TRANSACTION_CHECKPOINT_KEY'),
    'checkpoint_key_id' => env('TRANSACTION_CHECKPOINT_KEY_ID', 'k1'),
    'old_keys' => env('TRANSACTION_CHECKPOINT_OLD_KEYS', ''),

    // Each checkpoint is also exported here, so a database edit can be compared
    // against an independent copy. Production should point this at storage the
    // database user cannot write, with a further backup off the app server.
    'export_disk' => env('TRANSACTION_CHECKPOINT_DISK', 'local'),
    'export_dir' => 'integrity/checkpoints',

    // Stage 4: a ride that ends farther than this from its booked destination
    // is FLAGGED for review (never blocked; the rider may have dropped the
    // passenger at a nearby point on request).
    'ride_completion_flag_radius_m' => (int) env('RIDE_COMPLETION_FLAG_RADIUS_M', 200),

    // Stage 5: a location fix older than this when a ride ends is "stale"
    // evidence (reported, not used to judge the distance).
    'ride_evidence_max_age_s' => (int) env('RIDE_EVIDENCE_MAX_AGE_S', 120),
];
