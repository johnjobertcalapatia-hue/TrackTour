# Known Issues

## Current Baseline
- **PHPUnit (2026-10-06)**: 566 tests / 3,080 assertions / 3 failures / 2 skipped (561 passed). All three failures are in the previously documented `TouristConfirmRatingPersistenceTest` rating flow: two rating requests receive 422 instead of the expected 200, and the expected persisted delivery rating is missing.
- **Node.js Socket**: 51 tests (`npm run test:js`) — all passing.
- **Frontend UI**: 128 tests across 18 files — all passing when run with one Vitest worker; parallel worker startup timed out on this Windows environment.
- **Frontend build**: `npm run build` — passing.

## Activated Defects (audited 2026-09-24 — ride-hailing gap analysis)

The tourist **transport (ride) flow was broken end-to-end** against the API. Items
1–5 and 7 are **RESOLVED** by the ride-hailing Phase 1 integration fix
(`docs/PROGRESS.md` → *Tourist Ride-Hailing — Phase 1*). Items 6, 8, and 9 are
**still open** and are tracked as follow-up ride-hailing phases; they were out of
scope for the integration fix. Reference: `docs/architecture/ride-hailing-rider-gap-analysis.md` §7.

| # | Defect | Status | Evidence |
|---|--------|--------|----------|
| 1 | Ride booking 404s | RESOLVED | `frontend/src/features/tourist/components/BookRideSheet.tsx` now POSTs `/tourist/transport/book` (`routes/api.php:219`) |
| 2 | Fare estimate always fails validation | RESOLVED | `BookRideSheet.tsx` now sends `destination_lat/destination_lng`; `TransportController::estimate` accepts them |
| 3 | Booking payload incompatible | RESOLVED | `BookRideSheet.tsx` now sends the full canonical payload; `BookTransportRequest` matches |
| 4 | Estimate shape mismatch | RESOLVED | `BookRideSheet.tsx` parses `fares[vehicle].fare_text` from `estimateFare()` |
| 5 | Tracking screen is a stub | RESOLVED | `tourist/transport/trip/{id}/status` returns the rich snake_case contract; `TouristTransportTracking.tsx` consumes it |
| 6 | Rider-side passenger verification impossible | OPEN | `ride_pin` is tourist-only (`TransportController::tracking`); never returned by `RiderDeliveryController`/`DeliveryResource` |
| 7 | Booking trusts client fare | RESOLVED | `TransportationService::createRide()` now re-derives the authoritative fare/distance/duration server-side (spec §64); `BookTransportRequest.fare` is advisory-only |
| 8 | Transport rides have no payment flow | OPEN | `payment_method` recorded, but no `Payment` row / PayMongo intent for non-cash; food COD settlement would mis-allocate against fake `business_id = 1` |
| 9 | Rider rating is fake | OPEN | `RiderController.php:45` hard-codes `rating = 0` |

## Recently Reconciled

- **COD ping root causes (4 fixed)** — the rider "never gets a ping" was **eligibility + offer lifecycle, not Socket.IO transport**. Fixed: (A) MySQL `gps_stale` — 60 s location heartbeat in `DashboardLayout` while online, so a stationary/away rider no longer ages past the 5-min COD gate; (B) `radar_gps_stale` — radar re-registration every 60 s inside the 120 s window (`rider_location_update` is ownership-gated to an *assigned* rider, so idle riders previously froze at connect time); (C) `already_offered` — a **timed-out** offer is now re-offerable by reopening the same row (`updateOrCreate`, `UNIQUE` preserved); `declined`/`pending`/`accepted` still block; (D) socket reconnect was `3` attempts (~6 s) then permanent silence → now infinite with backoff. New: `DispatchTimedOutReofferTest` (5). Full record: `docs/PROGRESS.md`.
- **Removed restaurant accept/reject routes** — the five retired entry points (`acceptOrder`, `rejectOrder`, `acceptAll`, `acceptItem`, `rejectItem`) were deliberately removed (restaurants no longer manually accept); the 16 tests that still called them were migrated to the surviving API and the retired endpoints are now pinned as 404s. The §4.2 rider-acceptance gate was pinned **directly** at its canonical layer by the new `PreparationStartServiceGateTest` (5 tests), closing a coverage gap — no test previously referenced that service. Also fixed: ambiguous `updated_at` in `ScheduledDispatchProcessor::dueDeliveryIds()` and the pickup-status expectation in `PaymentApiTest`. Full record: `docs/PROGRESS.md` → *Test Reconciliation*.

---

## Skipped Tests

| Test | Reason |
|------|--------|
| `TouristApiTest` — "tourist can get dashboard" (1) | Controller uses HAVING on non-aggregate queries — SQLite test-driver limitation |
| `RepositoryTest` — Haversine (1) | Distance helper — SQLite test-driver limitation |

GD-guarded tests ran in the 2026-10-06 verification environment; only the two SQLite-limited tests above were skipped.

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

- **The frontend's API path is XAMPP Apache, not `php artisan serve` (changed 2026-09-23).** The browser calls `/api` relative to `localhost:3000`; Vite proxies it to `http://localhost/Capstone%20Project%201/public`. **Apache must be running, or API calls fail with `502`.** Reason: `php -S` is single-threaded on Windows (~0.87 req/s) while the rider app's own polling (offers 4 s, GPS 3 s, map queries 10 s) demands ~1 req/s — the queue grew without bound, so requests blew axios' 30 s timeout and surfaced as a false **"Unable to change availability right now."** The endpoint itself was healthy (200 on both hops every time). With Apache: 30-concurrent burst fell **34,451 ms → 11,614 ms with 0 timeouts**, steady-state ~1.6 req/s > demand. `php artisan serve :8000` is now **redundant** (optional/revert path only).
- **`PHP_CLI_SERVER_WORKERS` is a NO-OP on Windows** — do not try it as a slowness fix. PHP *receives* the variable (verified `getenv()` returns `4`) but the built-in server never forks (worker forking needs `fork()`): a 12-way burst measured **12,585 ms with it set vs 12,589 ms without**, 1 PID either way.
- **`frontend/vite.config.js` is GONE (deleted 2026-09-23) — `vite.config.ts` is now the only config.** The duplicate was the trap: `.js` resolves first, so a corrected `.ts` was **silently ignored** while `.js` kept proxying to `:8000` (this cost a full misdiagnosis). It later drifted back to `:8000` a second time — re-introducing the single-threaded `php -S` path — so it was removed rather than kept "identical". *Observation:* on Vite 8.1.5 deleting the loaded config made the server re-resolve **in-process** (same PID; proxy target flipped `php -S` → Apache) with no manual restart. If a config edit ever appears to do nothing, restart Vite anyway.
- `.env` secrets (PayMongo, Socket Bridge) appear placeholder-short — environment concern, not code bug.
- Dev database **now has a `migrations` table** (reconciled — see PROGRESS "Development Database Migration Reconciliation"); `php artisan migrate` is safe. The old "no migrations table / tinker `Schema::table`" note is obsolete.
- `BROADCAST_CONNECTION=log` means no WebSocket broadcast driver active.
- **Scheduler requires a live runner on Windows** — nothing invokes `schedule:run` by itself. While `php artisan schedule:work` runs (currently an agent-session background shell), all per-minute tasks fire: `schedule:dispatch` (dispatch retries incl. the `no_rider_available` retry loop and the timed-out-offer re-offer cycle), `orders:advance-preparation` (promote eligible waiting orders + complete due preparation timers), plus the 30-min refund reconcile and daily/6-hourly tasks. After that session closes, time-based behavior stops until started persistently (Windows Task Scheduler → `php artisan schedule:run` every minute, or a dedicated console on `schedule:work`).
  - *Superseded:* the earlier `orders:auto-reject-waiting` (10-min paid `waiting_restaurant` cutoff) and `orders:auto-cancel-undelivered` entries were **deleted** with the Restaurant Order Redesign — riderless orders now wait indefinitely by design ("never auto-cancel"). Do not expect those commands to exist.
- **OPEN — OPcache is disabled and Laravel's config/route caches don't exist; this is now the dominant per-request cost.** In `C:\xampp\php\php.ini` both `;zend_extension=opcache` and `;opcache.enable=1` are **commented out**, and `bootstrap/cache/` contains only `packages.php` + `services.php` (no `config.php`, no `routes.php`), so every request recompiles the framework and rebuilds config + routes. Measured 2026-09-23 direct to Apache: single `/api/user` **~0.8–1.0 s**; a bare Laravel 404 route **1,769 / 1,673 / 5,046 / 5,277 / 1,990 ms**. A 12-way burst through the Vite proxy measured **5,471 ms with the old `php -S` target and 5,552 ms with Apache — i.e. the transport was not the remaining bottleneck**, Laravel boot is. Fix = uncomment both opcache lines + restart Apache, then `php artisan config:cache && php artisan route:cache` (the latter must be re-run after every config/route edit). **Not applied — needs explicit approval** (system-level php.ini change + Apache restart, and it changes the config-edit workflow).
