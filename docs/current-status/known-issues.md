# Known Issues

## Current Baseline
- **PHPUnit**: 300 tests / 1,447 assertions / 0 failures / 2 skipped
- **Node.js Socket**: 25 tests (`npm run test:js`)

---

## Skipped Tests

| Test | Reason |
|------|--------|
| TBD (2 skipped) | Pre-existing; documented but outside current scope |

---

## Active Gaps (from P11 Recon)

### HIGH — Resolved
- COD credit settlement allocation → **P11.1**
- Rider-acceptance gate before preparation → **P11.2**
- Refund-path hardening → **P11.3**
- Payment idempotency → **P11.4**
- **Item accept/reject rider-gate drift** (P11.5 audit follow-up) — `acceptItem()` / `rejectItem()` could flip a multi-item delivery order to `preparing` with no accepted rider via `Order::refreshStatusFromItems()` rule 3. Fixed by moving the transition guard into the shared recalculation (`Order.php`): a delivery order never enters `preparing` unless `hasAcceptedRider()` is true. Item-level accept/reject before rider assignment stays allowed; the order stops at `accepted` / `waiting_restaurant` instead of `preparing`. Regression coverage added to `RiderAcceptanceGateTest` (3 tests).

### MED — Open

| # | Issue | Scope | Status |
|---|-------|-------|--------|
| 1 | **P11.5: Realtime completeness** — dispatch `DeliveryAssigned`/`OrderStatusChanged` on restaurant transitions; wire `restaurant_accepted_order` server handler; connect business/tourist/rider realtime | Events, Socket.IO, Frontend | Pending |
| 2 | **State-machine hardening** — prior-state guards on item transitions, terminal-revival protection, pre-pickup delivery-state check on `completed/cancelled` PATCH, conditional `acceptAll` payment_status | Controllers, Order/OrderItem models | Pending |
| 3 | **Payout transition atomicity** — transactions + `lockForUpdate` on approve/markPaid/reject/cancel | `RiderPayoutService` | Pending |
| 4 | **Admin system-fee / COD receivable reporting** — no platform accounting of `system_fee` or COD receivables | `AdminReportController` | Pending |

### LOW — Deferred

| Issue | Notes |
|-------|-------|
| `rider_credit_transactions.delivery_id` | Reconstructable via UNIQUE `deliveries.order_id`; `cod_settlements` already carries `delivery_id` |
| Settlement/report parity (dashboard vs payout ledger) | Cosmetic divergence |
| Dead schema columns (`rider_credits.available_credits`) | Unused, no runtime impact |
| Magic numbers in fee config | Config-driven, not hard-coded |

---

## Dead Code Paths

Registered but never dispatched events:
- `OrderCreated`
- `DeliveryAssigned`
- `BookingCreated`
- `BookingStatusChanged`
- `UserRegistered`
- `BusinessApproved`
- `BusinessRejected`
- `ReviewCreated`

All broadcast via null driver (`BROADCAST_CONNECTION=log`); `ShouldBroadcast` implementations silently discarded.

---

## Deployment / Environment Notes

- `.env` secrets (PayMongo, Socket Bridge) appear placeholder-short — environment concern, not code bug.
- Dev database has no `migrations` table; schema applied via tinker `Schema::table`.
- `BROADCAST_CONNECTION=log` means no WebSocket broadcast driver active.
