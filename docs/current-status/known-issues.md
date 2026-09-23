# Known Issues

## Current Baseline
- **PHPUnit**: 398 tests / 1,968 assertions / 0 failures / 7 skipped (391 passed)
- **Node.js Socket**: 45 tests (`npm run test:js`) — all passing

## Recently Reconciled

- **COD ping root causes (4 fixed)** — the rider "never gets a ping" was **eligibility + offer lifecycle, not Socket.IO transport**. Fixed: (A) MySQL `gps_stale` — 60 s location heartbeat in `DashboardLayout` while online, so a stationary/away rider no longer ages past the 5-min COD gate; (B) `radar_gps_stale` — radar re-registration every 60 s inside the 120 s window (`rider_location_update` is ownership-gated to an *assigned* rider, so idle riders previously froze at connect time); (C) `already_offered` — a **timed-out** offer is now re-offerable by reopening the same row (`updateOrCreate`, `UNIQUE` preserved); `declined`/`pending`/`accepted` still block; (D) socket reconnect was `3` attempts (~6 s) then permanent silence → now infinite with backoff. New: `DispatchTimedOutReofferTest` (5). Full record: `docs/PROGRESS.md`.
- **Removed restaurant accept/reject routes** — the five retired entry points (`acceptOrder`, `rejectOrder`, `acceptAll`, `acceptItem`, `rejectItem`) were deliberately removed (restaurants no longer manually accept); the 16 tests that still called them were migrated to the surviving API and the retired endpoints are now pinned as 404s. The §4.2 rider-acceptance gate was pinned **directly** at its canonical layer by the new `PreparationStartServiceGateTest` (5 tests), closing a coverage gap — no test previously referenced that service. Also fixed: ambiguous `updated_at` in `ScheduledDispatchProcessor::dueDeliveryIds()` and the pickup-status expectation in `PaymentApiTest`. Full record: `docs/PROGRESS.md` → *Test Reconciliation*.

---

## Skipped Tests

| Test | Reason |
|------|--------|
| GD-guarded OCR tests (4) | Require the GD image library — unavailable in this environment |
| `OfferingManagementTest` (1) | Requires GD |
| `TouristApiTest` — "tourist can get dashboard" (1) | Controller uses HAVING on non-aggregate queries — SQLite test-driver limitation |
| `RepositoryTest` — Haversine (1) | Distance helper — SQLite test-driver limitation |

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
| 1 | **State-machine hardening** — prior-state guards on item transitions, terminal-revival protection, pre-pickup delivery-state check on `completed/cancelled` PATCH, conditional `acceptAll` payment_status | Controllers, Order/OrderItem models | Pending |
| 2 | **Payout transition atomicity** — transactions + `lockForUpdate` on approve/markPaid/reject/cancel | `RiderPayoutService` | Pending |
| 3 | **Admin system-fee / COD receivable reporting** — no platform accounting of `system_fee` or COD receivables | `AdminReportController` | Pending |
| 4 | **Offer timeout is poll-driven** — `NearestRiderService::processTimeouts()` has no scheduled runner; its only call sites are `RiderDispatchController::offers()` and `pendingRequest()`. If no rider polls, an expired offer stays `pending` indefinitely. `ScheduledDispatchProcessor` does **not** handle offer timeouts (it only dispatches due `scheduled` deliveries). | `NearestRiderService`, `RiderDispatchController`, `routes/console.php` | Pending |
| 5 | **PING delivery honesty (G1/G3)** — `dispatch_status = 'notified'` is written before any ping attempt and never revised; `notifyDispatch()` / `createRiderRequest()` return values are discarded at every call site; the socket bridge answers `200 "Dispatch ping sent."` even when the intended rider is offline/busy or it silently falls back to a different rider. A failed PING is currently indistinguishable from a successful one. Spec/checkpoint: `docs/architecture/dispatch-ping-reliability-spec.md` | `NearestRiderService`, `WebsocketNotifierService`, `socket-server.js` | Spec drafted — awaiting checkpoint agreement |

### LOW — Deferred

| Issue | Notes |
|-------|-------|
| Settlement/report parity (dashboard vs payout ledger) | Cosmetic divergence |
| Magic numbers in fee config | Config-driven, not hard-coded |
| Manual merchant/admin **Re-dispatch** action (restart a `dispatch_failed` window) | Deferred as a separate product requirement (checkpoint agreement). The automatic retry lifecycle — park → `ScheduledDispatchProcessor` → bounded attempts → `dispatch_failed` — now covers the operational gap; revisit only if merchants need to restart an exhausted window manually. |

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

Frontend dead code:
- `frontend/src/shared/hooks/useRiderSocketDispatch.ts` — **never imported anywhere.** It is the source of the frequently-cited 180 s idle telemetry interval (which exceeds the 120 s radar window), so that interval has **no runtime effect**; the live radar liveness path is `useRiderSocketReceiver.ts`. The ping fixes were applied to the live hook. Deletion is a separate cleanup decision — do not "fix" the 180 s value expecting behaviour to change.

---

## Deployment / Environment Notes

- `.env` secrets (PayMongo, Socket Bridge) appear placeholder-short — environment concern, not code bug.
- Dev database **now has a `migrations` table** (reconciled — see PROGRESS "Development Database Migration Reconciliation"); `php artisan migrate` is safe. The old "no migrations table / tinker `Schema::table`" note is obsolete.
- `BROADCAST_CONNECTION=log` means no WebSocket broadcast driver active.
- **Scheduler requires a live runner on Windows** — nothing invokes `schedule:run` by itself. While `php artisan schedule:work` runs (currently an agent-session background shell), all per-minute tasks fire: `schedule:dispatch` (dispatch retries incl. the `no_rider_available` retry loop and the timed-out-offer re-offer cycle), `orders:advance-preparation` (promote eligible waiting orders + complete due preparation timers), plus the 30-min refund reconcile and daily/6-hourly tasks. After that session closes, time-based behavior stops until started persistently (Windows Task Scheduler → `php artisan schedule:run` every minute, or a dedicated console on `schedule:work`).
  - *Superseded:* the earlier `orders:auto-reject-waiting` (10-min paid `waiting_restaurant` cutoff) and `orders:auto-cancel-undelivered` entries were **deleted** with the Restaurant Order Redesign — riderless orders now wait indefinitely by design ("never auto-cancel"). Do not expect those commands to exist.
