<?php

return [
    // Secure rider cashout (2026-11-11): at or above this amount (PHP) the
    // staff member who confirms the GCash payment must not be the approver.
    'two_person_threshold' => (float) env('PAYOUT_TWO_PERSON_THRESHOLD', 5000),
];
