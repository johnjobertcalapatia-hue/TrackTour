<?php

return [
    'min_distance' => env('TRACKING_MIN_DISTANCE', 5),
    'checkpoint_seconds' => env('TRACKING_CHECKPOINT_SECONDS', 60),
    // Arrival geofence radius in meters. When a rider is within this distance of
    // the pickup/delivery point, the system marks them as "arrived".
    'arrival_radius_meters' => env('TRACKING_ARRIVAL_RADIUS_METERS', 100),
    // Teleport guard: a location fix implying a speed above this ceiling is
    // rejected before it can trigger an arrival or be persisted.
    'max_speed_kph' => env('TRACKING_MAX_SPEED_KPH', 150),
    // Only judge plausibility for fixes within this window; larger gaps are
    // treated as unconstrained (a rider may have been offline).
    'plausibility_window_seconds' => env('TRACKING_PLAUSIBILITY_WINDOW_SECONDS', 120),
];
