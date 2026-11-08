<?php

return [
    'min_distance' => env('TRACKING_MIN_DISTANCE', 5),
    'checkpoint_seconds' => env('TRACKING_CHECKPOINT_SECONDS', 60),
    // Arrival geofence radius in meters. When a rider is within this distance of
    // the pickup/delivery point, the system marks them as "arrived".
    'arrival_radius_meters' => env('TRACKING_ARRIVAL_RADIUS_METERS', 100),
    // Restaurant pickup-confirmation radius; separate from general arrival.
    'pickup_radius_meters' => env('TRACKING_PICKUP_RADIUS_METERS', 50),
    // Drop-off completion radius: the rider must be within this distance of
    // the delivery address to upload the proof photo and confirm delivered.
    'dropoff_radius_meters' => env('TRACKING_DROPOFF_RADIUS_METERS', 50),
    // The rider's saved GPS fix used for that check must be this fresh.
    'proof_location_max_age_seconds' => env('TRACKING_PROOF_LOCATION_MAX_AGE_SECONDS', 120),
    // Teleport guard: a location fix implying a speed above this ceiling is
    // rejected before it can trigger an arrival or be persisted.
    'max_speed_kph' => env('TRACKING_MAX_SPEED_KPH', 150),
    // Only judge plausibility for fixes within this window; larger gaps are
    // treated as unconstrained (a rider may have been offline).
    'plausibility_window_seconds' => env('TRACKING_PLAUSIBILITY_WINDOW_SECONDS', 120),
];
