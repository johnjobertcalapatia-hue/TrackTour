<?php

return [
    // Percentage (as a decimal) deducted from a cancelled item's amount before refunding.
    // e.g. 0.02 = a 2% transaction/refund deduction. Real payment-gateway transaction fees
    // are not modeled in this codebase, so this defaults to 0 (full item amount refundable).
    'deduction_rate' => (float) env('REFUND_DEDUCTION_RATE', 0.00),

    // When a cancelled item leaves a restaurant's delivery order with no remaining active
    // items, the restaurant's whole delivery is no longer needed, so its delivery fee is
    // refunded in full (no deduction) and the delivery/rider dispatch is cancelled.
    'refund_delivery_fee_on_last_item' => true,
];
