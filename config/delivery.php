<?php

return [
    'base_fare' => (float) env('DELIVERY_BASE_FARE', 40.00),
    'included_kilometers' => (float) env('DELIVERY_INCLUDED_KILOMETERS', 2.00),
    'per_kilometer' => (float) env('DELIVERY_PER_KILOMETER', 15.00),
    'minimum_fee' => (float) env('DELIVERY_MINIMUM_FEE', 40.00),
    'service_adjustment' => (float) env('DELIVERY_SERVICE_ADJUSTMENT', 0.00),
    'surge_multiplier' => (float) env('DELIVERY_SURGE_MULTIPLIER', 1.00),
    'currency' => 'PHP',
    'routing_url' => env('DELIVERY_ROUTING_URL', 'https://router.project-osrm.org/route/v1/driving'),
    'routing_timeout' => (int) env('DELIVERY_ROUTING_TIMEOUT', 5),
    'system_fee_percentage' => (float) env('SYSTEM_FEE_PERCENTAGE', 10.00),
    // P11.1 Tourism Office share of each COD restaurant settlement (percent).
    // The remaining (100 - x)% is the restaurant's receivable. Must come from
    // configuration so the split is never hard-coded at the settlement site.
    'cod_platform_fee_percent' => (int) env('COD_PLATFORM_FEE_PERCENT', 20),
    'cod_max_pickup_distance_km' => (float) env('COD_MAX_PICKUP_DISTANCE_KM', 5.00),
    'cod_location_max_age_minutes' => (int) env('COD_LOCATION_MAX_AGE_MINUTES', 5),
    'cod_active_order_limit' => (int) env('COD_ACTIVE_ORDER_LIMIT', 2),
    // B2 (Option C, master spec §14): a live socket-radar entry is trusted as
    // the GPS freshness source only when the rider reported within this window.
    // Mirrors socket-validation.js LIMITS.radarStaleMs (2 minutes).
    'radar_location_max_age_seconds' => (int) env('DISPATCH_RADAR_MAX_AGE_SECONDS', 120),
    'order_size' => [
        // P5.2 basic order-size classification. Deliberately quantity-based and
        // lightweight (no weights/dimensions). An order is 'large' when its live
        // item quantity OR distinct line items reach either threshold. Large
        // orders are flagged for operational review but still dispatched
        // normally (flag-only) - see App\Services\OrderSizeClassifier.
        'large_item_quantity' => (int) env('DELIVERY_LARGE_ORDER_ITEM_QUANTITY', 12),
        'large_line_items' => (int) env('DELIVERY_LARGE_ORDER_LINE_ITEMS', 6),
    ],
    'scheduler' => [
        // Total allowed attempts = 1 initial + max_retries retries.
        // Default sized so the retry loop can span the full dispatch cycle:
        // 1 + 11 attempts x 5 min ~= 60 min = dispatch_deadline_minutes.
        'max_retries' => (int) env('DISPATCH_MAX_RETRIES', 11),
        'retry_after_minutes' => (int) env('DISPATCH_RETRY_AFTER_MINUTES', 5),
        // A 'dispatching' claim older than this is treated as a crashed worker
        // and safely re-claimed by the next scheduler run.
        'claim_timeout_minutes' => (int) env('DISPATCH_CLAIM_TIMEOUT_MINUTES', 5),
        // Master spec §17: the whole dispatch cycle (every retry, every wave)
        // is bounded by dispatch_started_at + this deadline. On expiry the
        // delivery terminally fails with dispatch_end_reason.
        'dispatch_deadline_minutes' => (int) env('DISPATCH_DEADLINE_MINUTES', 60),
    ],
];
