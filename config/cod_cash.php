<?php

return [
    // Daily COD cash policy (AGENTS.md §5.1). Off until an authorized Tourism
    // Office administrator approves a Philippine-local effective date; while
    // off, cash returns / COD remittances cannot be recorded.
    'reconciliation_enabled' => (bool) env('COD_CASH_RECONCILIATION_ENABLED', false),
    'effective_date' => env('COD_CASH_EFFECTIVE_DATE'),
    'cash_movement_reference_namespaces' => [],
];
