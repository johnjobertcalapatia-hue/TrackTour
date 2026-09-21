# Completed Milestones & Engineering Checkpoints

## Current Regression Baseline
- **PHPUnit Test Suite**: 292 tests passed / 1,369 assertions / 0 failures / 2 skipped
- **Node.js Socket Suite**: 25 tests passed (`npm run test:js`)

---

## Phase History & Completed Work

### P4: Order / Delivery Regression & Rider Concurrency
- Enforced the **one-active-delivery** rule via DB transactions and rider-row locks.
- Rider acceptance atomically assigns delivery, marks rider busy, cancels competing offers, and returns unassigned deliveries to dispatch.

### P5.1: GPS Integrity
- Created pure validation module `socket-validation.js` (bounds, freshness, rider identity, teleport speed guard).
- Hardened `socket-server.js` against Null Island `(0,0)` and invalid registrations.
- Secured internal `:3002` bridge with `SOCKET_BRIDGE_SECRET` constant-time verification.

### P5.2: Order Size & Dispatch Safeguards
- Introduced configurable thresholds (`DELIVERY_LARGE_ORDER_ITEM_QUANTITY = 12`, `DELIVERY_LARGE_ORDER_LINE_ITEMS = 6`).
- Created `OrderSizeClassifier` to tag orders `normal` or `large`.
- Large orders are flagged for review but not hard-blocked.

### P6: WebSocket Live-Tracking Hardening
- Implemented cryptographic HMAC-SHA256 trip tokens (`socket-token.js` ⇄ `TripTokenService.php`).
- Gated room access by delivery ID and subject matching.
- Released rider back to radar on trip completion.
- Added dual-mode tracking to tourist frontend (`useCustomerMapSocket` with 4-second HTTP polling fallback).

### P7: Fast Delivery Rider Tip
- Standardized Fast Delivery with a mandatory **₱20.00 – ₱100.00** rider tip charged upfront.
- Tip folded into order total and captured in PayMongo or COD cash.
- Group tips divided equally across child restaurant orders.
- 100% of tip allocated directly to `rider_earnings`.

### P8: Rider Payouts
- Implemented ledger-first payout lifecycle (`RiderPayoutService`).
- Created `rider_payouts` and pivot `rider_payout_rider_earning` with `UNIQUE(rider_earning_id)` preventing double-spending.
- Rider requests payout → Admin reviews and marks paid.

### P9: Dispatch & Concurrency Locks
- Added schema-level backstops:
  - `UNIQUE(deliveries.order_id)`
  - `UNIQUE(booking_dispatch_logs.delivery_id, booking_dispatch_logs.rider_id)`
  - `UNIQUE(rider_earnings.rider_id, rider_earnings.order_id, rider_earnings.status)`
  - `UNIQUE(rider_payouts.active_payout_key)`
- Hardened `SmartDispatchService` and `NearestRiderService` against double-accept races.

### P11.1: COD Financial Settlement Allocation
- Fixed accounting and created `cod_settlements` table.
- Configurable revenue split: 80% to restaurant, 20% to Tourism Office (`COD_PLATFORM_FEE_PERCENT=20`).
- Added reporting endpoints: `GET /business-owner/reports/cod-settlements` and `GET /admin/reports/cod-settlements`.

### P11.2: Rider Acceptance Gates Food Preparation
- Implemented `Order::hasAcceptedRider()` gate.
- Blocked all cooking endpoints with HTTP 422 if an accepted rider is not assigned.
- Inverted sequence: orders dispatch immediately at placement so riders accept before kitchen starts preparation.

### P11.3: Refund Path Hardening
- Created `PaymentRefundProcessor`: an order is never marked `refunded` unless PayMongo reports synchronous `SUCCESS`.
- Added idempotent webhook handler and scheduled command `payments:reconcile-refunds` to resolve pending refunds.

### P11.4: Payment Idempotency
- Added `payment_webhook_events` with `UNIQUE(event_id)` preventing duplicate webhook processing.
- Built `Payment::canApplyProviderVerdict` state machine preventing payment downgrade or resurrection.
