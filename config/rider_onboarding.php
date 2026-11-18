<?php

/*
 * Automatic rider onboarding schedule.
 *
 * Tourism Offices do not post sessions: the system generates them (the
 * interviewer and trainer are assumed available) and assigns every new online
 * applicant to the earliest open slot. An office only marks a time or a whole
 * day unavailable, and the affected applicants are moved to the next open slot.
 */
return [
    // Session start times (Philippine time, 24-hour).
    'slot_times' => ['08:00', '09:00', '10:00', '13:00', '14:00', '15:00'],

    // Applicants per session.
    'capacity' => (int) env('RIDER_ONBOARDING_CAPACITY', 5),

    // ISO weekdays with sessions (1 = Monday … 7 = Sunday).
    'work_days' => [1, 2, 3, 4, 5],

    // Earliest automatic appointment: this many days after today.
    'lead_days' => 1,

    // How far ahead sessions are generated.
    'horizon_days' => 21,

    // Demo/presentation shortcut: lets a Tourism Office approve one of its own
    // applicants without recording the interview, training and assessment.
    // Still per municipality, recorded and audit-logged. Turn OFF for real
    // operations: RIDER_ONBOARDING_QUICK_APPROVE=false
    'quick_approve' => (bool) env('RIDER_ONBOARDING_QUICK_APPROVE', true),
];
