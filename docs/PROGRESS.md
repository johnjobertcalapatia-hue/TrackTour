# Project Progress — Tourism Management Portal

## Overview
A multi-role tourism management platform built with **Laravel 12** (PHP 8.2), **Tailwind CSS 3**, **Alpine.js**, **MySQL** (via XAMPP), and **Firebase** (FCM for real-time notifications). The system serves five user roles: **Tourist**, **Business Owner**, **Rider**, **Staff**, and **Tourism Office/Bansud Admin**.

---

## Delivery Pipeline Roadmap (P1–P10)

Checkpoint log for the multi-restaurant delivery architecture work.

### P4 — Order/Delivery Regression & Rider Concurrency: Complete

The delivery pipeline was regression-tested through the existing HTTP/API architecture. Rider acceptance is protected by a database transaction and rider-row lock to enforce the **one-active-delivery** rule: accepting an offer assigns the delivery, marks the rider busy, cancels that rider's other outstanding offers, and returns those deliveries to dispatch for re-offering. Concurrent acceptance attempts resolve atomically, so a rider can hold only one active delivery.

- Result: 86 pipeline tests / 500 assertions passed.
- 3 known pre-existing pipeline failures remain outside P4 scope.
- Full suite: 163 passed, 35 deferred (unrelated Auth/Profile/OfferingManagement) failures.

Next: **P5.1 — GPS integrity** (WebSocket location validation, rider↔delivery ownership, coordinate/timestamp validation, stale-location handling), then **P5.2 — basic order size & dispatch eligibility**.

### P5.1 — GPS Integrity: Complete

Real-time and HTTP location ingress hardened so invalid or malicious fixes cannot mislead tracking or fake an arrival.

- **Pure validation module** `socket-validation.js` (coordinate/heading/speed ranges, timestamp freshness, rider identity binding, rider↔delivery ownership, implied-speed teleport guard), unit-tested with `node --test` via `npm run test:js` (12 tests).
- **Socket engine** (`socket-server.js`): `driver_go_online` rejects invalid registrations (no more `0,0` fallback); `rider_location_update` enforces socket identity + trip ownership + teleport guard and drops rejected packets; `driver_accept_order` requires an identity match; the dispatch radar excludes stale/coordinate-less riders.
- **Bridge auth**: all `:3002` endpoints (`/dispatch`, `/trip/complete`, `/trip/assign`, `/status`) require the `SOCKET_BRIDGE_SECRET` shared secret (constant-time compare); `WebsocketNotifierService` sends it on every call.
- **Authoritative assignment**: on a successful accept, `handleRiderResponse` pushes `/trip/assign`, so only the assigned rider's socket may stream into a trip room.
- **HTTP teleport guard**: `RiderMapController` rejects implausible jumps before the arrival geofence; the existing 100 m arrival radius is preserved.
- Tests: `GpsIntegrityTest` 6 passed / 20 assertions; pipeline regression 83 passed / 492 assertions. Full suite: 169 passed, 35 deferred failures.

### P5.2 — Basic Order Size & Dispatch Eligibility: Complete

Deliberately lightweight safeguard, **not** a weight/dimension vehicle-capacity engine. Orders are tagged `normal` or `large` from their live item quantity / line count; large orders are flagged for operational review but are still dispatched normally (flag-only).

- **Configurable thresholds**: `config/delivery.php → order_size.large_item_quantity` (default 12) and `order_size.large_line_items` (default 6), env-overridable (`DELIVERY_LARGE_ORDER_ITEM_QUANTITY`, `DELIVERY_LARGE_ORDER_LINE_ITEMS`).
- **`OrderSizeClassifier`** (`classify` / `isLarge` / `sync` / `dispatchEligibility`): quantity-based; excludes rejected items and cancelled quantities so a shrunk order falls back to `normal`. `dispatchEligibility()` returns `{size_class, requires_review, dispatchable: true}` as the flag-only seam for a future hard gate.
- **Persistence**: `orders.size_class` (default `normal`); an `OrderItem` saved/deleted hook keeps the tag in sync and only writes when the class changes.
- **Dispatch**: `NearestRiderService::dispatchToNearest` refreshes the tag and logs a warning for large orders — it never blocks them. One rider = one active delivery remains the only hard dispatch constraint.
- Migration `2026_09_17_000001_add_size_class_to_orders_table.php`; applied to the dev DB via tinker `Schema::table` ALTER (the dev DB has no `migrations` table).
- Tests: `OrderSizeDispatchEligibilityTest` 9 passed / 27 assertions (normal, quantity & line thresholds, cancelled/rejected exclusion, configurable thresholds, revert-on-shrink, independent orders, large still dispatchable, large flows through the real dispatch path). P4/P5.1 regression 19 passed / 184 assertions. Full suite: 178 passed, 35 deferred failures.

Next: **P6 — WebSocket tracking**.

### P6 — WebSocket Live-Tracking Hardening: Complete

Live tracking was hardened end to end: only authorized participants can watch a trip, the trip lifecycle actually releases the rider back to the radar, and the tourist map now consumes the authorized socket stream with HTTP polling as fallback.

Decisions locked in with the user: tourist map = **socket-primary with poll fallback**; room authorization = **HMAC trip token minted by Laravel**; `driver_accept_order` = **Laravel `/trip/assign` is the only writer**.

- **Trip-token authorization**: new `socket-token.js` (Node) ⇄ `app/Services/TripTokenService.php` (Laravel) — HMAC-SHA256 signed `{v, deliveryId, role, sub, exp}` tokens over the shared `SOCKET_BRIDGE_SECRET`, verified constant-time by the Zero-DB engine. Byte-identical parity asserted both ways via a shared fixture (Node + PHPUnit). `config/socket.php` adds `trip_token_ttl_seconds` (default 7200 s).
- **Authorized room joins**: `join_trip_room` now requires a valid token for the target delivery. Customers pass `tracking.token`; riders must additionally match the token subject **and** hold the current `/trip/assign`-written assignment. Unauthorized joins get `join_trip_room_rejected` and are logged.
- **Lifecycle fix**: `/trip/complete` now releases the rider (`status → available`) so they re-enter the dispatch radar, marks the trip completed before teardown (late GPS fixes rejected), emits `trip_completed`, and ejects room members. `driver_go_online` also marks a rider busy when they already hold a live assigned trip.
- **Authority fix**: `driver_accept_order` no longer writes assignment state (responds `accept_via_api`); `restaurant_accepted_order` (unauthenticated dispatch trigger) removed; declines require socket↔rider binding.
- **Abuse hardening**: rate limit on `rider_location_update` (`SOCKET_LOCATION_MIN_INTERVAL_MS`, default 1000 ms); pending dispatches expire (`SOCKET_PENDING_TRIP_TTL_MS`, default 120 s); `(0,0)` Null Island rejected everywhere (new `isSatelliteLocation`); frontend stops sending `(0,0)` on geolocation failure.
- **Tourist map**: `FoodController::orderStatus` now mints a customer token into `data.tracking` (assigned rider + non-terminal order only). `useCustomerMapSocket` joins the room with the token, exposes connection/stale/completed/rejected states; `TouristOrderStatus` renders the socket fix when fresh and falls back to HTTP-polled `rider_location`, with a state-aware Live/Waiting/Reconnecting/Track-Unavailable badge.
- Tests: `tests/js/socket-token.test.js` 10 + `socket-validation.test.js` 15 = **25 node tests passed**; `TripTokenServiceTest` 5 passed / 12 assertions (incl. cross-language fixture). P4/P5.1/P5.2 regression 33 passed / 223 assertions. Full suite: 183 passed, 35 deferred failures (unchanged set, zero new regressions).

### P7 — Fast Delivery Rider Tip: Complete

Rescoped with the user: there is **no post-delivery tipping**. Fast Delivery carries a **mandatory ₱20–₱100 rider tip** that is part of the original order transaction — charged online through the same PayMongo payment, or collected with the COD cash due — and flows into the rider's earning. Normal Delivery carries no tip. The behavior already existed end to end; P7 locks it so it cannot silently regress.

- **Mandatory at checkout**: `FoodController::orderFlat` (`:242-245`) and `GroupOrderController::store` (`:46-49`) reject a fast-delivery order whose tip is missing or outside ₱20–₱100. Removing the tip from a fast order fails with 422 before any order row is written.
- **Part of the original total**: the tip is folded into `order.total` (`FoodController.php:306`, `GroupOrderService.php:118`). Online payments therefore capture it in the single PayMongo charge (`PaymentController.php:53`, plus a "Rider Tip" line item `:72-79`); group orders get a "Rider Tips" line (`:113-120`). Standard delivery forces the tip to `0`.
- **COD**: `cash_due = order.total` (`NearestRiderService.php:799-800`, `:859-860`) so the rider collects the tip together with the cash. Group tips are split evenly across the child orders (`GroupOrderService.php:101-102`).
- **Rider earnings**: `recordEarning()` (`NearestRiderService.php:962-976`) books `order->rider_tip` into `rider_earnings.rider_tip` and `total_earning` (= delivery commission + tip), for both prepaid (`completeDelivery` `:811-815`) and COD (`settleCodDelivery` `:900`).
- Tests: new `FastDeliveryTipTest` **9 passed / 37 assertions** — missing/under/over tip rejected on single and group orders, tip in the order total, standard ignores tips, group tip split, and tip reaching rider earnings on prepaid completion and COD settlement.

Next: **P8 — rider payouts**.

---

### P8 — Rider Payouts: Complete

Rider payouts run through a **ledger-first** flow with **no live disbursement gateway**: a rider requests a payout of all available earnings, an admin approves/rejects, and an admin confirms `paid`. The money truth is the `rider_payouts` row; a separate pivot (`rider_payout_rider_earning`) locks—and idempotently prevents double-spending—each earning via `UNIQUE(rider_earning_id)`.

- **Four binding decisions locked with the user**: payout channel = *ledger now, gateway later* (in-app confirmation, no API push); trigger = *rider requests → admin approves*; ledger placement = *`rider_payouts` + pivot with `UNIQUE(rider_earning_id)` as the idempotency key* (an earning linked into a pending/approved/paid payout can never be linked again); COD interplay = *COD earnings are payable exactly like prepaid, and the `rider_credits` wallet is a separate financing ledger never touched by a payout*.
- **Service** (`app/Services/RiderPayoutService.php`): `getAvailableEarnings()` = earned earnings with **no live pivot link** (`whereDoesntHave('payouts', status IN locking)`); `requestPayout()` atomically creates the payout in a batch and `syncWithoutDetaching`s the available earnings (pivot unique key is the double-draw barrier); `approve()`/`reject()`/`markPaid()`/`cancel()` enforce the state machine; reject & cancel `detach()` earnings so they return to available.
- **Models**: `RiderPayout` (statuses pending/approved/rejected/paid/cancelled, `LOCKING_STATUSES`, `rider()`/`reviewer()`/`earnings()`); `RiderEarning::payouts()` back-relation (BelongsToMany via `rider_payout_rider_earning`, with pivots).
- **API**: rider routes `GET /rider/payouts/available`, `GET /rider/payouts`, `POST /rider/payouts/request`, `GET /rider/payouts/{payout}`, `POST /rider/payouts/{payout}/cancel`; admin routes `GET /admin/payouts`, `GET /admin/payouts/{payout}`, `POST .../approve`, `POST .../reject`, `POST .../mark-paid` (`RiderPayoutController`, `AdminPayoutController`, both on `ApiResponse`).
- **Error path**: `PayoutConflictException` → **409 Conflict** for state violations (nothing available to withdraw, wrong state transitions).
- **Writes to the earnings path are untouched**: `NearestRiderService::recordEarning` (`:962-976`), prepaid completion (`:811-815`) and COD settlement (`:900`) are unchanged — P8 is strictly downstream, reading already-earned `rider_earnings` rows.
- Tests: new `RiderPayoutTest` **7 passed / 18 assertions** — available = earned + unlocked (pending excluded), request locks earnings, locked earnings never reappear (no double-draw), approve→mark-paid locks forever, reject & cancel release earnings, request with nothing available throws. Full suite: **199 passed, 35 deferred failures (unchanged set, zero new regressions), 2 skipped**, 236 total.

Next: **P9 — dispatch & concurrency locks**.

---

### P9 — Dispatch & Concurrency Locks: Complete

The dispatch lifecycle's read-then-write races are closed at the **transaction/row-lock level with DB unique-index backstops** — the rule carried through every seam is *identify the authoritative database state transition and enforce the invariant under lock; never rely on frontend state or WebSocket timing*.

- **Four binding decisions locked with the user**: scope = *dispatch + terminal-state guards* (prepaid double-accept, one-delivery-per-order, scheduled-vs-manual dispatch, timeout-vs-accept/complete, reimbursed COD settlement, payout one-live-payout; payment-webhook idempotency explicitly out of scope); enforcement = *row locks + DB unique backstops*; one-delivery-per-order = *UNIQUE `deliveries.order_id` + locked re-check*; payout race = *lock rider row + clean 409 + one-live-payout guard*.
- **Migration `2026_09_20_000001_add_concurrency_guards.php`**: dedupes to the earliest row (`MIN(id)`) then adds UNIQUE `deliveries.order_id`, UNIQUE `(delivery_id, rider_id)` on `booking_dispatch_logs`, UNIQUE `(rider_id, order_id, status)` on `rider_earnings`, and nullable + UNIQUE `rider_payouts.active_payout_key` (app-managed marker = `rider_id` while `pending`/`approved`, `NULL` for terminal so payout history is unlimited; the payouts DB has no `migrations` table, so the ALTERs are applied to the dev DB via tinker `Schema::table`, as in P5.2).
- **`SmartDispatchService`**: `scheduleDispatch` runs in a transaction with `Order::lockForUpdate()` + re-check `delivery()` existence, catching `UniqueConstraintViolationException` so a duplicate create rolls back cleanly; `dispatchNow` locks the delivery and refuses to re-offer when `rider_id` is set or `dispatch_status` is `notified`/`dispatching`.
- **`NearestRiderService`**: the accept path in `handleRiderResponse` locks the delivery first and returns `already_assigned` (no re-offer spam) when someone won first; `processTimeouts` locks each delivery before expiry + re-dispatch; `settleCodDelivery` re-validates `delivered` + rider under the lock; new canonical `cancelDelivery()` (lock, skip delivered/completed/cancelled, release COD reserve, set cancelled + clear dispatch). `OrderRefundService` and `AutoCancelUndeliveredOrder` route through it, closing the latent unreleased-COD-reserve hole in auto-cancel.
- **Controllers**: `RiderDeliveryController::updateStatus` and `RiderMapController::updateDeliveryStatus` run in a transaction with `Delivery::lockForUpdate()`, re-validate assignment and the `from` state under the lock, run the delivered branch inside the transaction, and dispatch `DeliveryStatusChanged` post-commit; ownership checks use `$request->user()` so direct-call tests behave identically to the Bearer-token route.
- **`RiderPayoutService`**: `requestPayout` locks the rider row, rejects with a clean **409 `PayoutConflictException`** when a live payout exists, sets `active_payout_key`, and catches the unique violation as a belt-and-suspenders barrier; `reject`/`cancel`/`markPaid` clear the marker.
- Tests: new `ConcurrencyLockTest` **7 passed / 28 assertions** — double-accept claimed once, one-delivery-per-order (incl. schema backstop: a hand-rolled second `Delivery` for an order throws `UniqueConstraintViolationException`), dispatchNow single-claim guard, rider 409 after auto-cancel (no ghost earning), cancel idempotency + no resurrection, COD settle-once (single payment + single earning), one-live-payout 409 then released. Affected suites re-run clean (RiderApiTest / RiderPayoutTest / ReadyToDeliveredOrderSyncTest / OneActiveDeliveryTest / CodDeliverySettlementTest / ScheduledDispatchProcessorTest: 30 passed / 217 assertions). Full suite: **206 passed, 35 deferred failures (unchanged set, zero new regressions), 2 skipped**, 243 total (+7 new P9 tests).

### P10 — Completion & Money Invariants + Suite to Green: Complete

Closed the P10 scope — delivery→order completion consistency, the group-index money invariant, and a full sweep of the remaining suite failures — with the P10 binding decision carried through: *per-test verdict* (TEST DRIFT → update the test; REAL BUG → fix app code) with the exit criterion *full suite green*.

- **Delivery→order completion divergence (REAL BUG)**: COD delivered flush sets `DeliveryStatusChanged` (`finalStatus`); `NearestRiderService::settleCodDelivery` now marks the order **completed** in the same transaction and only sets `delivery_status=pending_payment` for prepaid; `BusinessOwnerOrderController::updateStatus` uses a `match` (dead branch removed). New `CompletionConsistencyTest` (3 tests) + updated `ReadyToDeliveredOrderSyncTest` lock the invariants (rider completes ⇒ order completed with `completed_at`; prepaid never regresses). 23/23 green with `ConcurrencyLockTest`/`RiderApiTest`/`CodDeliverySettlementTest`/`GroupedOrderDeliveryLifecycleTest` (206 assertions).
- **Group-index money invariant (REAL BUG)**: one total feeds the prepaid charge, child `paid_amount`s, and COD `cash_due` — `GroupOrderService::createGroup` now accumulates the `system_fee` in the restaurant loop and includes it in `grand_total`, persisting `group_checkouts.system_fee_total`; `PaymentController` group branch adds a "System Fees" line item. Migration `2026_09_20_000002_add_system_fee_total_to_group_checkouts_table.php` (dev MySQL has no `migrations` table, so apply the column to the dev DB via tinker `Schema::table` as in P5.2/P9). **58/58 group/payment/tip tests green**, including the previously failing `RestaurantSubOrderItemsLifecycleTest` (Σ child totals == `grand_total` now holds).
- **OCR registration crash (TEST DRIFT the seeder gap + REAL contract fixes)**: `BusinessRegistrationOcrTest` depended on a seeded `RequiredDocument` that `DatabaseSeeder` never triggers (`RequiredDocumentSeeder` truncates via MySQL-only `SET FOREIGN_KEY_CHECKS`, so it cannot join the shared seeder); the test now self-provisions the Mayor's Business Permit in `setUp`. Then two real-contract gaps surfaced and were fixed in the tests: `documents.*.file` is required when documents are present, and the rejects-key list no longer includes the fields dropped from the request (`owner_full_name`, `owner_address`, `initial_capital`, `gross_floor_area`, `number_of_employees`, `occupancy_status`). `BusinessRegistrationTest`'s 4 stale web-SSR tests were rewritten to the API contract (`postJson('/api/business-owner/businesses')`, `registrationPayload()` helper, real field names). 12/12 green across both files.
- **Business-owner offering management (REAL BUG + TEST DRIFT)**: all 12 failures were dead route names (`business-owner.offerings.*` never existed). Tests rewritten to the real paths (`/api/business-owner/offerings`, `/offerings/categories`). Fixed a REAL bug in `routes/api.php`: offering routes used `{id}` but the controller type-hints `Offering $offering`, so implicit binding never resolved (empty model, "read property owner_id on null") — changed to `{offering}` for show/update/destroy. Reverted destroy-status asserts to 200 (`noContentResponse` = 200, not 204). 12/12 green.
- **Auth drift (2 REAL BUGS + TEST DRIFT)**: `/api/register` profile-field payloads (tourist/rider) and the invalid-login error key (`password`, not `email`) updated in `ApiResponseTest`/`AuthApiTest` (16/16). Breeze cluster: `AuthenticatedSessionController::store` called `Auth::login($request->user(), …)` where `user()` is null on guest requests → the session never authenticated (fixed by re-fetching the validated user); five legacy controllers referenced the non-existent `route('dashboard')` → 500 (redirects pointed at `route('home')`). `RegistrationTest` payload updated (first/last name, DOB, mobile). `ProfileTest` (Breeze's dead SSR profile) rewritten to the real tourist API profile (GET/PUT `/api/tourist/profile`). `EmailVerificationTest`'s dead signed-web flow (the SPA catch-all swallows `/{any}` before the auth routes match) rewritten to the live API (`POST /api/email/verification-notification`). 21/21 green.
- **Data-cluster triage (TEST DRIFT)**: `RepositoryTest::test_order_repository_get_today_summary` used the stale `'pending'` literal — `OrderRepository::getTodaySummary` treats `pending_payment`/`waiting_restaurant` as pending, so the seeded order now uses `waiting_restaurant`. `TourismOfficeApiTest` expected a removed dashboard shape (`active_trips`/`recent_completed`/`guides_lookup`) — real keys are `stats`/`tourism`/`recent_businesses`/`top_municipalities`. `TouristApiTest::test_non_tourist_cannot_access` asserted 403 on `/api/tourist/explore/search`, which is publicly routable by design — now asserts 200 as `test_non_tourist_can_access_public_explore`.
- **Full suite: 244 passed-equivalent, 0 failed, 2 skipped, 1018 assertions — GREEN** (baseline 243 total / 206 pass / 35 fail / 2 skip).

### P10 Audit Follow-up — Route-Model Binding Sweep: Complete

Post-green audit of the `{id}`-vs-typed-model pattern (surfaced by the offerings fix) found **real binding mismatches in routes/api.php** — not cosmetic: implicit binding matches route segments to the controller's type-hinted variable **by name**, so a segment named `{id}` never binds a parameter typed `Model $model`, leaving an empty model (late runtime errors downstream). Fixed and covered with regression tests (`RouteModelBindingTest`, 4 tests / 17 assertions):

- `food/{id}` → `food/{offering}` — `FoodController::show(Offering $offering)` was 500 (empty `$offering` → null `business`).
- `booking/{id}` → `booking/{business}` — `Tourist\BookingController::show(Business $business)` returned an empty business.
- `promotions/{id}` → `promotions/{promotion}` for `PUT`/`DELETE` — `BusinessOwnerPromotionController::update/destroy(Promotion $promotion)` was 500 (empty `$promotion`). ALSO fixed a second latent promotions bug found en route: the FormRequest contract (`title`/`discount_percentage`/`valid_from`/`valid_until`) did not map to `Promotion`'s columns (`name`/`value`/`start_date`/`end_date`), so create/update silently dropped every field — the controller now maps explicitly and sets `type => 'percentage'` (column is NOT NULL).
- `riders/{user}` → `riders/{rider}` (show/approve/reject/suspend) — `AdminRiderController` methods type-hint `User $rider`; previously an empty model made every call return "Rider not found".
- Audit verdicts for the rest of the API: menu items, staff menu, kitchen, orders(+items), bookings, staff, trips, payouts, credits, promotions-show, prep-prediction, admin users/businesses/payouts — **all correctly named** (`int $id` + manual `findOrFail`, or matching typed segments). Dead (unrouted) typed methods noted but left: `BusinessOwnerMenuController::update/destroy(Offering $offering)` and `BusinessOwnerPromotionManageController::update/destroy(int $id)`.
- URLs are unchanged for the React client (only segment names changed — `/food/5`, `/promotions/5`, `/riders/5`, `/booking/5`); no frontend impact.
- Dev DB: `group_checkouts.system_fee_total decimal(12,2) NOT NULL DEFAULT '0.00'` applied via tinker and verified (`SHOW COLUMNS`).
- Full suite after audit fixes: **248 passed-equivalent, 0 failed, 2 skipped, 1035 assertions — GREEN** (244 + 4 regression tests).

### P11.1 — COD Credit Settlement & Tourism Office Revenue: Complete

The COD money model is now fully auditable end to end: the tourist pays the rider in cash at the drop-off **and the rider keeps that cash**; the restaurant order was financed out of the rider's TrackTour credit wallet, which is debited **once** by the pre-existing `finalizeCredits()` path. P11.1 adds the missing settlement **allocation ledger** on top of that deduction (never instead of it, never a second wallet):

```
settlement_base = delivery.cod_credit_reserved == order.rider_financed_amount  (subtotal + system_fee)
    ├── restaurant_share = base − platform_fee        (default 80%, the restaurant's receivable)
    └── platform_fee    = base × cod_platform_fee_percent (default 20%, Tourism Office revenue)
```

- **Config first, never hard-coded**: `config/delivery.php → cod_platform_fee_percent` (`COD_PLATFORM_FEE_PERCENT=20` in `.env`/`.env.example`). The split is consumed only by `CodSettlementService::split()`; changing the env immediately changes the booked split (tested).
- **Single settlement ledger** (`cod_settlements`, migration `2026_09_20_000003_create_cod_settlements_table.php`): one row per settled COD order. Serves as BOTH the restaurant receivable ledger and the Tourism Office/admin revenue ledger. Columns: `settlement_number` (unique), `order_id` (**UNIQUE** = duplicate-split backstop), `delivery_id`, `business_id`, `rider_id`, `settlement_base`, `restaurant_share`, `platform_fee`, `status` (`settled`/`paid`), `settled_at`.
- **One canonical settlement path**: `NearestRiderService::settleCodDelivery` books the settlement **inside its existing DB transaction and delivery row-lock** — atomic with the single cash `Payment`, `RiderEarning`, order completion, and the one-time credit finalization. The rider's credit deduction is untouched and happens exactly once.
- **Base integrity guard**: `CodSettlementService::settlementBaseFor()` uses the exact reserved amount (`delivery.cod_credit_reserved`) and rejects a mismatch with `order.rider_financed_amount`, or a zero base — a settlement can never be invented from unfunded cash. Split arithmetic is decimal-safe (`restaurant_share = base − fee`), and the service asserts the split reconciles to the base.
- **No remittance, earnings separate**: the rider keeps the cash (single `Payment(method=cash, provider=rider)` for the full order total); no remittance liability is created. Rider earnings remain `rider_earnings` = delivery fee + eligible tip only (`recordEarning` untouched). Fast-delivery tips are preserved and never enter the settlement base or the TO revenue.
- **Cancellation / insufficiency**: cancel before completion releases the credit reservation (`COD_RELEASE`, existing path) and books **no** settlement; an unreserved delivery can never be settled (`record()` throws), so no restaurant/TO revenue is created without rider financing.
- **Multi-restaurant independence**: each restaurant sub-order settles against its own financed base — never the group `grand_total`.
- **Visibility endpoints**: `GET /business-owner/reports/cod-settlements` (restaurant receivable ledger + totals) and `GET /admin/reports/cod-settlements` (Tourism Office revenue ledger with source order/delivery/restaurant/rider). Both return the full allocation per order from `CodSettlementService::restaurantLedger()/tourismOfficeLedger()`.
- Tests: new `CodFinancialSettlementTest` **10 passed / 112 assertions** — 80/20 split, base==reserved==financed, single deduction, cash-not-a-remittance + earnings separation, idempotency (one row/order + UNIQUE backstop), insufficient-credit blocks everything, cancellation books nothing, multi-restaurant independence, config-driven split (₱100/₱500/₱1000 → ₱80/20, ₱400/100, ₱800/200, 10% override through the live settlement path), and fast-delivery tip exclusion. `CodDeliverySettlementTest` re-runs green (2 passed / 70 assertions) with the settlement integration live.
- **Full suite verified green after P11.1 verification pass: 258 tests / 1,149 assertions / 0 failures / 2 skipped.** `RestaurantSubOrderItemsLifecycleTest` was reconciled to the P11.2 rider-gated flow (dispatch at `waiting_restaurant` creation, riders accept before restaurants prepare): it now asserts per-sub-order deliveries exist in `notified` state at creation, rider A claims sub-order A and rider B claims sub-order B (re-offered via `cancelOtherPendingOffers`), and each sub-order's delivery stays bound to its accepted rider through readiness. Its `makeRider` now funds the rider wallet (`rider_credits.total_credits=10000`, `rider_status=available`) so COD reserve eligibility holds, matching the other COD tests.
- **Deferred (LOW, spec §5 completeness):** `rider_credit_transactions` records `order_id` but not `delivery_id`. The trail is reconstructable 1:1 via the UNIQUE `deliveries.order_id` map, and the dedicated `cod_settlements` ledger already carries `delivery_id`, so no correctness gap; a nullable `delivery_id` column (migration + `RiderCredit`/`RiderCreditService`/`NearestRiderService` threading) is scoped for a later hardening pass if required.

### P11.2 — Rider-Acceptance Gate: Complete

The critical rule — **NO ACCEPTED RIDER ⇒ NO PREPARATION** — is enforced on every prep-reaching path and now formally verified end to end:

```
tourist places order → restaurant order created → rider offer (dispatch at waiting_restaurant)
    → rider accepts → restaurant prepares → ready → pickup → delivered → completed
```

- **Gate:** `Order::hasAcceptedRider()` (delivery assigned to a rider) drives `requiresAcceptedRider()` in `BusinessOwnerOrderController` — `acceptOrder`, `startPreparation`, `markReady`, `acceptAll`, `updateStatus`→`preparing`/`ready`, `updateItemStatus`→`preparing`/`ready` — and in `BusinessOwnerKitchenController` (`updateStatus`, `updateItemStatus`). `acceptItem`→`accepted` alone never reaches `preparing` (item refresh keeps the sub-order `accepted`).
- **Hole closed:** `StaffDashboardApiController::updateOrderStatus` (`PATCH /staff/orders/{order}/status`) allowed `preparing`/`ready` without a rider — now gated identically. (The legacy Blade `StaffDashboardController` is unrouted/dead and untouched.)
- **No double-dispatch:** dispatch is created/offered at order placement (`waiting_restaurant`); `SmartDispatchService::scheduleDispatch` returns early when a delivery exists and `dispatchNow` skips assigned/pending — so the accept-order re-dispatch call is a safe no-op.
- **Atomicity:** accept is serialized on the delivery row-lock with COD credit reserve inside `handleRiderResponse`; binding is 1:1 via UNIQUE `deliveries.order_id`, one offer per rider via UNIQUE `(delivery_id, rider_id)`.
- Tests: new `RiderAcceptanceGateTest` **6 tests / 78 assertions** — 422 on every prep endpoint until acceptance then authorized immediately; order-`accepted`-but-riders-null still blocked; only the offered rider can claim; multi-restaurant independence (A prepares while B waits, deliveries permanently bound, rider A cannot claim B's delivery, owner A cannot satisfy its gate via rider B's assignment); decline re-offers to the next eligible rider without a duplicate offer; `no_rider_available` blocks forever. The two-riders-same-delivery `already_assigned` race remains covered by `ConcurrencyLockTest`.
- Full suite after P11.2: **264 tests / 1,227 assertions / 0 failures / 2 skipped**.

### P11.3 — Refund-Path Hardening: Complete

Payment refunds are now **provider-authoritative and retryable**: an order is only ever marked `refunded` after PayMongo confirms `SUCCESS`, failures leave it retryable, and every `pending_refund` is settled by an idempotent webhook handler plus a snapshot reconciliation scheduler. The invariant enforced throughout: **ONE provider refund ⇒ ONE internal effect**, and internal state never claims a refund the gateway disagrees with.

- **Provider-authoritative core** (new `app/Services/PaymentRefundProcessor.php`): `initiateRefund()` runs in a transaction with `payments::lockForUpdate()`, guards (already `refunded`/`pending_refund`/not paid), refuses to run while an active provider-backed refund exists, then books the refund — `SUCCESS` finalizes `refunded` immediately, `PENDING` sets `pending_refund`, and provider failure/null records a `failed` ledger row and leaves the payment `paid` (order stays refundable). `applyProviderStatus()` is the single idempotent status applier for webhooks and reconciliation — it never downgrades a `refunded` state. New relationships/columns: `Payment::refunds()` HasMany, `refunds.provider_refund_id` (nullable, unique) + `refunds.metadata` (json) via migration `2026_09_19_000001_add_provider_refund_id_to_refunds_table.php`.
- **Webhooks**: `PaymentController` now dispatches `refund.pending|succeeded|failed|updated` and `payment.refunded` to `handleRefundWebhook()` (event-type-authoritative; `refund.updated` reads the payload status); `handlePaymentFailed` refuses to downgrade an already-`refunded` payment. Replaying a `succeeded` webhook is a no-op.
- **Reconciliation** (new `app/Console/Commands/ReconcilePendingRefunds.php`, `payments:reconcile-refunds`, scheduled `everyThirtyMinutes` in `routes/console.php`): re-queries the provider per pending refund via new `PaymongoService::retrieveRefund` / `listPaymentRefunds` (with legacy `payment.metadata.refund.id` fallback), finalizes success, reverts failure to `paid`, restores an empty provider list to `paid`, and leaves unreachable refunds `pending_refund` — never blind-flips, never issues a refund.
- **Bug fixes**: `OrderRefundService::refundPaidOrder` no longer marks the order `refunded` on a failed/null gateway call (previous HIGH finding — it had also set the payment `cancelled`); `BusinessOwnerOrderController::rejectOrder` and `Tourist\FoodController::cancelOrder`'s inline refund duplicates were rewired through `refundPaidOrder()` with status-aware responses; `processItemRefund`'s standalone path now runs through the processor (its `provider_refund_id` was silently dropped before the column existed); `AutoRejectWaitingOrder`/`AutoCancelUndeliveredOrder` now preserve the processor's `refund_status` instead of clobbering it. Group-local/`refundCancelledItem` store-credit-ledger refunds remain unchanged by design (no gateway movement, documented).
- Tests: new `RefundPathHardeningTest` **15 tests / 83 assertions** — success finalizes refunded, provider failure keeps payment paid + order unrefunded + failed ledger, pending → `pending_refund`, succeeded/failed webhooks resolve state idempotently, duplicate webhooks / duplicate requests never duplicate financial effects, late `failed` never downgrades `refunded`, already-refunded & in-flight reject re-refund (asserting no provider call), reconciliation finalizes success / reverts failure / leaves unreachable pending, cancelled-order finals (fail ⇒ never marked refunded, success ⇒ marked refunded).
- Full suite after P11.3: **279 tests / 1,310 assertions / 0 failures / 2 skipped** (264 + 15 new).

### P11.4 — Payment Idempotency: Complete

Duplicate provider events and concurrent webhook deliveries can no longer create duplicate financial effects, while legitimate payment retries keep working. Webhook handling is now **exactly-once at the database level**, and payment state can never downgrade illegally:

- **Webhook exactly-once** (new `payment_webhook_events` table, UNIQUE `provider_event_id` = the stable PayMongo event id `data.id`): `PaymentController::webhook` derives a deterministic event key (event id → `type|resource-id` for legacy payloads → payload hash), then runs the event-id insert **and** the handler inside one transaction (`processWebhookEvent`). A repeated or concurrently delivered webhook loses its insert (`UniqueConstraintViolationException`) and becomes a no-op before the handler can run — the DB is the backstop, not an `if ($alreadyProcessed)`. Handlers resolve the payment by provider refs and lock it (`lockForUpdate`), so distinct events for the same payment serialize and converge.
- **State-machine guard** (`Payment::canApplyProviderVerdict`): verdict `paid` is applied only from non-refund states (pending/authorized/failed/cancelled converge to paid; refunded/pending_refund are never resurrected); verdict `failed` only from pending/authorized. This closes the previously-live `paid → failed` downgrade in `handlePaymentFailed` and the `refunded → paid` resurrection in `verifyAndConfirmPayment`/`checkAndConfirm` (both now re-lock + guard under a transaction).
- **Duplicate intent protection**: UNIQUE `payments.provider_payment_id` and UNIQUE `payments.provider_source_id` — a provider retry (timeout / HTTP 5xx / duplicate delivery) can never create a second payment row aliasing the same PayMongo session or payment. A blanket UNIQUE `(payable_type, payable_id)` was deliberately **not** added: multiple `pending` attempts per payable are legitimate retries; the one-authoritative-paid rule is enforced at the transition — `markPayablePaid` now short-circuits when the payable is already `payment_status='paid'`, so a second paid payment (or a re-run/crash-retry) can never re-run amounts, acceptance timestamps, dispatch, or group fan-out.
- **Retry after provider crash keeps every effect single**: delivery creation stays guarded by the existing `scheduleDispatch` order-row lock + UNIQUE `deliveries.order_id` (verified again in the new tests); `PaymentReceived` broadcasts and `markPayablePaid` side effects run at most once per payable.
- Migration `2026_09_19_000002_add_payment_idempotency_guards.php` (unique provider refs + `payment_webhook_events`). **Applied to and verified on the dev MySQL DB** via a one-off Schema/bootstrap script (the dev DB has no `migrations` table, as in P5.2/P9–P11.3): pre-check confirmed `payment_webhook_events` absent and **0 duplicate** `provider_payment_id`/`provider_source_id` values; `up()` applied; `SHOW CREATE TABLE payments` + `payment_webhook_events` verified `UNIQUE KEY payments_provider_payment_id_unique`, `payments_provider_source_id_unique`, `payment_webhook_events_provider_event_id_unique`; a live MySQL probe confirmed a duplicate `provider_event_id` insert raises `UniqueConstraintViolationException` (rolled back, no test rows persisted).
- Tests: new `PaymentIdempotencyTest` **13 tests / 59 assertions** — same webhook twice = one effect + single event row; concurrent duplicate event-id insert blocked by the UNIQUE backstop; already-committed event = no-op; three distinct events for one payment converge with a single finalization (stable acceptance/dispatch timestamps, one delivery); paid can't be downgraded by late `payment.failed`; failed → retry-paid stays possible; refunded/pending-refund can't be resurrected (webhook and checkAndConfirm); duplicate provider intent rejected at DB; duplicate `checkAndConfirm` applies once; webhook transaction rollback (crash leaves no event row and no transition, redelivery succeeds); legacy no-event-id payloads deduped by type+resource.
- Full suite after P11.4: **292 tests / 1,369 assertions / 0 failures / 2 skipped** (279 + 13 new). **P11.4 verified end-to-end**: dev MySQL schema applied + UNIQUE constraints live-tested.

### P11.5 — Realtime Completeness: Complete

The canonical order/delivery state transitions now reach every authorized consumer in real time through a **single bridge path** (event → listener → HTTP `/event` → audience rooms), with cancellation bridged as a terminal trip event and the socket engine's transient RAM cleaned up. The existing Zero-DB Socket.IO/GPS architecture was extended — never rebuilt.

- **Canonical bridge** (`app/Listeners/ForwardStatusEventsToBridge.php`): listens to `OrderStatusChanged`, `DeliveryAssigned`, `DeliveryStatusChanged` and forwards each to the socket engine via `WebsocketNotifierService::notifyStatusEvent`, computing the **audience rooms** `business:{business_id}`, `user:{user_id}`, `rider:{rider_id}`, `trip:{delivery_id}` + an enriched payload (order/business/user/rider/delivery ids, new status, `trip` for assigned trips). `notifyTripCancelled()` bridges cancellation as a terminal event.
- **Authoritative dispatch points**: `DeliveryAssigned` fires on successful rider acceptance in `NearestRiderService` (right after the ON-state/trip-assign notification, not on offers); `OrderStatusChanged` fires at the real status transitions in `BusinessOwnerOrderController` (accept→preparing, assign-rider→accepted, start-prepare→preparing, mark-ready→ready, acceptAll, acceptItem, reject→rejected) and `BusinessOwnerKitchenController::updateStatus`; `Order::refreshStatusFromItems` broadcasts item-driven `OrderStatusChanged`; `cancelDelivery()` (the canonical cancel path used by reject/auto-cancel/refund) bridges `notifyTripCancelled` only when it truly cancels. `DeliveryStatusChanged` was already dispatched post-commit at `NearestRiderService`, `RiderMapController`, `RiderDeliveryController` (verified, unchanged).
- **Channels & tokens**: `SocketChannelAuthorizer` + `SocketTokenController` mint role-scoped tokens: `POST /api/socket/user-token` (user:{id}) and `POST /api/business-owner/socket/token?business_id=` (business:{id}); `routes/channels.php` carries the Laravel channel definitions; `BroadcastServiceProvider` rewritten (Laravel 12.62 dropped the legacy base class) to route broadcasts + load channels. `TripTokenService::issueUserToken` extends the existing HMAC token schema to `user:{id}` rooms.
- **Socket engine** (Zero-DB): new `socket-events.js` exposes `validateAudienceRooms` (whitelisted `business/user/rider/trip` room shapes, de-duped), `routeStatusEvent` (event-name validation → one emit per room, each it-the-eventName+data), and `applyTripTerminal` (mark trip terminal in RAM, **release the radar rider back to `available`**, emit `trip_completed`/`trip_cancelled` + `dispatch_status_update`, evict the room members and RAM trip — idempotent on duplicates). `socket-server.js` gains `join_user_room` (HMAC-verified against `user:{id}`) and the `/event` HTTP endpoint (`verifyServerToken` + `routeStatusEvent`; invalid → 400, nothing emitted); the `/trip/complete` + `/trip/cancel` shared handler now uses `applyTripTerminal`. `socket-token.js` adds `issueUserToken`/`verifyUserToken`/`canJoinUserRoom`.
- **Frontend wiring**: new `useBusinessSocketNotifier` (mints `/business-owner/socket/token?business_id=` and joins `business:{id}`, invalidates kitchen queries on state events, connection-aware "Live/Polling" indicator) wired into `BusinessOwnerKitchen`; new `useUserSocketNotifier` (mints `/socket/user-token`, joins `user:{id}`) wired into `TouristOrderStatus` (invalidates the order-status query, live "Delivery Cancelled" on terminal cancel, hides Live Tracking) — the **cancellation exit behavior**; `useCustomerMapSocket` now surfaces `tripCancelled` and clears telemetry on a `trip_cancelled` receipt. HTTP polling remains the recovery/fallback for every view (never socket-authoritative).
- **Root-cause fix — duplicate events**: every listener fired **twice** because Laravel 12's `Application::configure()` enables event **discovery** while all 12 `app/Listeners` are also registered explicitly in `$listen` (raw listener counts = 4 per event). `bootstrap/app.php` now calls `->withEvents(false)` (with an explanatory comment), so each event reaches its listener exactly once. Without this, `delivery.assigned` was bridged twice per accept.
- **Dead code retired**: the old `useMerchantSocketNotifier` (private-unsubscribed, half-broken) is superseded by `useBusinessSocketNotifier` (no remaining consumers).
- Tests: `RealtimeCompletenessTest` **7 tests / 49 assertions** (HTTP-faked bridge) — rider accept fans out to `rider/trip/business/user` rooms with the enriched payload; duplicate acceptance = a single event (and re-accept no-ops at the DB); restaurant prepare→ready ordering and the preparation gate remain intact around the event dispatch; multi-restaurant/group orders emit per-restaurant rooms that stay isolated; canonical cancel (reject + `cancelDelivery`) bridges `trip_cancelled` + `order.status.changed`, is a no-op on terminal, and releases the COD reserve; token endpoints authorize per role (403/422 on cross-role/hostile use). JS: `socket-realtime.test.js` (7 tests: room validation/dedup, per-room fan-out, unauthorized rooms never emitted, terminal completion/cancel emit + RAM eviction + rider release, duplicate-terminal no-op) and user-token cases added to `socket-token.test.js` (6 tests) — **43 node tests pass**. Near-miss fixed in `applyTripTerminal`: radar key normalization (`String(freedRiderId)`) so a numeric bridge `riderId` releases a string-keyed RAM rider.
- Full suite after P11.5: **297 passed / 1,418 assertions / 0 failures / 2 skipped** (292 + 7 new PHP; 1,369 + 49 new assertions). **Regressed fully green** — including the `withEvents(false)` change re-running the entire suite (no listener-count-dependent tests exist).

### P11.6 — Acceptance-Gate Regression: Complete

Closed the item-level state-transition holes around the rider-acceptance gate so `preparing` is only ever reached when the kitchen is actually cooking:

- **`Order::refreshStatusFromItems` rule-3 fix (REAL BUG):** the item-refresh previously mapped `pendingCount > 0` to `preparing` whenever a rider was accepted. Two flows exploited it: `rejectItem` on one of several pending items flipped a `waiting_restaurant` order straight to `preparing` (a **rejection** authorized cooking), and `acceptItem` of one item (with a pending sibling still unacked) also jumped the whole sub-order to `preparing` — breaking the documented P11.2 invariant "item-accept alone never reaches preparing" for multi-item orders. Now `preparing` requires **at least one active item actually `preparing`**; accepted/pending-only item sets settle on `accepted` (or stay `waiting_restaurant` when nothing was accepted). All real prep paths still work (acceptOrder/acceptAll/startPreparation/kitchen explicitly set items to `preparing` first — verified by the existing lifecycle suites).
- **`acceptItem` payment-status fix (REAL BUG):** the `waiting_restaurant` branch stamped `payment_status='paid'` unconditionally, which marked a **COD** order paid the moment one item was accepted (before the rider collects cash at delivery). Now `paid` is only written when an actually-`authorized` online payment is captured (identical semantics to `acceptOrder`); COD waits until cash settlement.
- **`acceptAll` payment-status fix (same defect, MED from recon §2):** same conditioning — COD `acceptAll` no longer stamps `paid`.
- **Tests:** 5 new regression tests in `RiderAcceptanceGateTest` (`test_multi_item_accept_with_accepted_rider_stays_accepted_until_actually_preparing`, `test_multi_item_reject_with_accepted_rider_never_causes_preparing`, `test_cod_item_accept_keeps_payment_pending`, `test_cod_accept_all_keeps_payment_pending`, `test_prepaid_item_accept_captures_authorized_payment` — the last is the positive control that a real authorized payment still captures to `paid`). Combined with the existing no-rider multi-item regressions, every `preparing`-capable path is now covered: no-rider (all prep endpoints 422), with-rider item-accept/reject (stays non-preparing), and authorised-prep transition.
- Full suite after P11.6: **305 passed / 1,479 assertions / 0 failures / 2 skipped** (**300 + 5 new gate tests**; the rider-gate suite is now 14 tests / 139 assertions).

### P11.7 — Final System Verification: Complete

Post-P11.6 verification sweep across every subsystem, per the regression rule (targeted → full → docs → checkpoint):

- **Full Laravel suite**: 305 passed / 1,479 assertions / 0 failures / 2 skipped; JS socket suite: **43/43 passed**.
- **Targeted regression matrix** (105 passed / 743 assertions): dispatch concurrency (`ConcurrencyLockTest`), COD reservation/settlement (`CodDeliverySettlementTest` + `CodFinancialSettlementTest`), payment idempotency (`PaymentIdempotencyTest`), refund hardening (`RefundPathHardeningTest`), payouts (`RiderPayoutTest`), group checkout (`GroupedOrderDeliveryLifecycleTest`, `GroupItemRejectionRefundTest`, `RestaurantSubOrderItemsLifecycleTest`, `FastDeliveryTipTest`), dispatch scheduling/eligibility (`ScheduledDispatchProcessorTest`, `OrderSizeDispatchEligibilityTest`, `OneActiveDeliveryTest`, `ReadyToDeliveredOrderSyncTest`), GPS/telemetry (`GpsIntegrityTest`), route-model binding (`RouteModelBindingTest`), and realtime rooms (`RealtimeCompletenessTest`).
- **Route/API audit**: `route:list` verified the realtime token endpoints (`api/socket/user-token`, `api/business-owner/socket/token`) and the full business-owner order surface (accept / accept-all / assign-rider / item accept|reject|status / mark-ready / reject / start-preparation / update-status + kitchen item/order status + staff status). Implicit-route-model binding covered by the P10 audit + `RouteModelBindingTest`.
- **Architecture invariants re-verified**: no path can produce `preparing` without an accepted rider; one active delivery per rider; delivery ownership permanent; COD money flow (reserve → settle → single deduction → 80/20 split → cash kept by rider); provider-authoritative payment/refund idempotency; socket engine transient-only with HTTP recovery; admin/boundary never weakens these rules.
- **Documentation synchronized**: `docs/PROGRESS.md` (P11.6/P11.7 checkpoints), `docs/P11-recon.md` (item-gate + payment-status findings resolved).

The **delivery/dispatch/payment/realtime phase is declared complete (P11.1 → P11.7)**. Remaining P11-recon candidates 6 (state-machine hardening) and 7 (payout transition atomicity) are documented but intentionally deferred to the Admin-phase maintenance window. **Admin module (Tourism Office governance/monitoring) is the next build phase** (Phases 1–7 as outlined).

### P11.5 Gap Audit Follow-up — Item Accept/Reject Rider-Gate Drift: Fixed

During the P11.5 realtime completeness audit, an untested bypass of the P11.2 preparation gate was verified in `Order::refreshStatusFromItems()` rule 3: `BusinessOwnerOrderController::acceptItem()` / `rejectItem()` (and `updateItemStatus`/kitchen item status) allowed an item-level status change before rider assignment, and the shared item-status recalculation flipped the whole **order** status to `preparing` whenever a sibling item remained `pending` — an invalid preparation-authorizing state with `delivery.rider_id = NULL`.

- **Root cause**: the P11.2 gate checked only the direct prep endpoints. The item accept/reject path fed the shared recalculation, whose rule 3 treated a lingering `pending` sibling as "preparing" with no awareness of the rider gate. The existing `RiderAcceptanceGateTest` missed it because its relevant test used a single-item order (item accept leaves that order at `accepted`, never `preparing`).
- **Smallest canonical fix** (model-level, closes the bypass for every caller, not just the two endpoints): rule 3 in `app/Models/Order.php` now only permits the `preparing` transition when `preparationUnlocked = order_type !== 'delivery' || hasAcceptedRider()`. Otherwise the order stays at its pre-preparation state (`accepted` when items are accepted, `waiting_restaurant` otherwise). Item-level accept/reject before rider assignment **remains allowed** — item `accepted`/`rejected` alone does not authorize cooking, matching the existing P11.2 contract; only the order-level preparation transition is blocked.
- **Realtime invariant**: `OrderStatusChanged` is never emitted as a `preparing` transition from an invalid item operation — the backend state transition itself is prevented (the broadcast follows the persisted transition).
- Tests: `RiderAcceptanceGateTest` +3 tests / 22 assertions — multi-item accept pre-rider and reject pre-rider never produce `preparing` nor an invalid `OrderStatusChanged(preparing)` event; post-rider-acceptance multi-item workflow still proceeds normally (guard is a pure gate, not a workflow change). Existing single-item and all reflection-based lifecycle suites (`GroupedOrderDeliveryLifecycleTest`, `CodFinancialSettlementTest`, `CodDeliverySettlementTest`, `GroupItemRejectionRefundTest`) re-ran green.
- Full suite after fix: **300 passed / 1,447 assertions / 0 failures / 2 skipped** (pre-existing skips unchanged).

### P12.1 — Restaurant Wallet Foundation: Implementation Complete; Development Schema Pending

This P12 checkpoint supersedes the earlier statement that Admin was the next build phase: the next phase is **P12 — Restaurant Wallet & Financial Settlement**.

Established the restaurant-side account and immutable-ledger foundation without changing any existing payment, COD, refund, rider-credit, or payout behavior.

- **Wallet account:** `restaurant_wallets` is unique per business and stores cached `available_balance`, `pending_balance`, `total_earned`, and `total_withdrawn`, all decimal(12,2).
- **Immutable ledger foundation:** `restaurant_wallet_transactions` records a unique transaction number, wallet/business ownership, type, source reference, signed amount, and before/after snapshots for both available and pending balances. Supported types are `ORDER_EARNING`, `REFUND_DEDUCTION`, `ADJUSTMENT`, `WITHDRAWAL`, and `WITHDRAWAL_REVERSAL`.
- **Eligibility and provisioning:** `RestaurantWalletService::ensureForBusiness()` provisions exactly one empty wallet only for an approved food business (`Business::isRestaurant()`). The `Business` saved hook invokes this provisioning seam; it creates no monetary transaction and does not touch non-food or unapproved businesses.
- **Boundaries preserved:** `CodSettlement`, `CodSettlementService`, `NearestRiderService::settleCodDelivery()`, rider credit, PayMongo processing, refunds, and payouts are unchanged. P12.2 will introduce the common `order_settlements` record and the only money-moving wallet-posting service.
- **Database verification:** the two migrations and the one-wallet-per-business database unique constraint were exercised by Laravel's `RefreshDatabase` test database. The development database was inspected with `migrate:status`, but its application is intentionally pending: it already has two unrelated P11 migrations pending (`2026_09_19_000001_add_provider_refund_id_to_refunds_table` and `2026_09_19_000002_add_payment_idempotency_guards`), followed by the two P12 migrations. No broad `migrate` was run, so this checkpoint is not marked development-schema verified.
- **Tests:** new `RestaurantWalletFoundationTest` — 3 passed / 11 assertions (approved restaurant provisioning, non-food/unapproved exclusion, application duplicate prevention, and the database unique constraint).
- **Full Laravel suite:** **308 passed / 1,490 assertions / 0 failures / 2 skipped**.

### P12.2 — Common Settlement Record & Atomic COD Wallet Posting: Implementation Complete; Development Schema Pending

Added the common financial-effect layer while retaining `cod_settlements` as the authoritative COD allocation ledger. GCash allocation, refunds, withdrawals, and all financial UI remain deliberately out of scope.

- **Common settlement:** `order_settlements` has one database-enforced row per order and, for COD, one database-enforced link to its `cod_settlements` source. It records the source, persisted payment method, settlement base, restaurant amount, platform amount, and status.
- **Single writer:** `OrderSettlementService::recordCodSettlement()` locks the completed order and restaurant wallet, creates the common settlement plus exactly one `ORDER_EARNING` ledger entry, then updates cached wallet totals in the same database transaction. The wallet ledger has a unique `order_settlement_id` effect key as a second database backstop.
- **Canonical COD extension:** `NearestRiderService::settleCodDelivery()` still finalizes rider credit and records the existing COD allocation first. Once the order is atomically marked `completed`, it calls the P12 service in that same transaction. No rider-credit, cash, rider-earning, or COD-split calculation was changed or repeated.
- **Guards:** an incomplete order cannot create a common settlement; repeat calls return the existing common settlement without a second wallet entry; each business wallet is locked during the balance update; `UNIQUE(order_id)`, `UNIQUE(cod_settlement_id)`, and `UNIQUE(restaurant_wallet_transactions.order_settlement_id)` provide database-level duplicate protection.
- **Tests:** `CodFinancialSettlementTest` now has 11 tests / 131 assertions. It verifies COD common-settlement creation, allocation parity, one `ORDER_EARNING`, cached-wallet consistency, idempotent repeat posting, incomplete-order rejection, independent multi-restaurant wallet credits, the database duplicate-settlement backstop, and the existing single rider-credit deduction. Combined P12.1/P12.2 targeted run: 14 tests / 142 assertions.
- **Full Laravel suite:** **309 passed / 1,509 assertions / 0 failures / 2 skipped**. One prior run hit an unrelated one-second `PreparationPredictionTest` timestamp-boundary flake; the immediate full re-run passed cleanly.
- **Database status:** all four P12 migrations are verified through `RefreshDatabase` in the isolated test database. Development-schema application remains pending and was not attempted, because the development database still has unrelated pending P11 migrations; P12.2 is therefore not marked development-schema verified.

## Current Status (July 2026)

### P12.4 — COD Settlement Integration Verification: Complete

Verification-only checkpoint; no COD production logic was rewritten. The canonical `NearestRiderService::settleCodDelivery()` transaction remains: delivery/order lock → one rider-credit finalization → one authoritative `cod_settlements` allocation → completed order → one common `order_settlements` effect → one restaurant `ORDER_EARNING`/wallet update.

- Verified invariant: `delivery.cod_credit_reserved = order.rider_financed_amount = one rider-credit deduction = cod settlement base = restaurant share + platform share`.
- Verified allocation: restaurant wallet receives only the configured COD restaurant share (default 80%); Tourism Office/platform remains the 20% `cod_settlements.platform_fee`; cash is not rider earnings, while rider earnings remain delivery fee plus eligible tip.
- Verified duplicate/cancellation/group isolation through the existing COD financial, delivery, concurrency, and completion suites.
- Targeted matrix: 23 passed / 252 assertions. Full Laravel suite: **311 passed / 1,520 assertions / 0 failures / 2 skipped**. Development migrations remain unapplied.

### P12.3 — GCash Settlement Allocation: Implementation Complete; Development Schema Pending

- `OrderSettlementService::recordGcashSettlement()` is the existing settlement writer's GCash branch. It requires a completed order plus a PayMongo `paid` GCash payment (order-level or group-checkout payment).
- The allocation uses persisted checkout values only: restaurant amount is `subtotal`; delivery fee and rider tip are excluded; persisted `system_fee` is platform amount. Non-zero discounts or non-reconciling components are rejected rather than assigned by a new formula.
- `SyncOrderStatusFromDelivery` invokes this path after the canonical prepaid delivery completion transition. Existing COD settlement remains unchanged.
- Tests: `GcashOrderSettlementTest` covers provider confirmation, completion gate, duplicate no-op, and exclusion of delivery/tip/system components. Full Laravel suite: **311 passed / 1,520 assertions / 0 failures / 2 skipped**.
- Development schema remains pending because of the pre-existing pending P11 migrations; no broad migrate was run.

### Menu Groups Removal & Simplified Menu Creation: Complete

Maintenance change outside the P11/P12 financial scope: the **Menu Groups** feature (menu groups + menu group variations) was fully removed, and the business-owner **create-menu** flow was simplified to a single-item form.

- **Menu Groups removed end-to-end**: `BusinessOwnerMenuGroupController`, `MenuGroup` + `MenuGroupVariation` models, migrations `2026_08_25_100000`/`2026_08_25_100001` (deleted from disk), the `/business-owner/menu-groups*` API routes, the backend tables + migration records dropped from the dev DB and `track_tour_db.sql`, the two React pages (`BusinessOwnerMenuGroups`, `BusinessOwnerMenuGroupForm`), and their nav items / routes in `frontend/src/app/App.tsx`.
- **Create-menu simplified**: `BusinessOwnerMenuCreate.tsx` no longer offers variants/types — each menu item is one individual identity with its own name/price (create the same dish under different names/prices instead of using variations). The `has_variations`/`variations` editor and discount-preview gates were removed. The form still posts through the existing canonical `BusinessOwnerMenuManageController::store` (which ignores `has_variations`/`variations` anyway). The **Edit** page was intentionally left unchanged, and the tourist `offering_variations` flow was not touched.
- **Pre-existing refund bug fixed while here** (found by the full-suite regression): `PaymentRefundProcessor::recordLedger()` referenced an undefined `$forOrder` at line ~273, 500-ing every refund/cancel path. Fixed by accepting `$forOrder` as an optional parameter and passing it from the two `initiateRefund` call sites; `applyProviderStatus` falls back to `$payableId`.
- **Tests**: full Laravel suite **311 passed / 1,520 assertions / 0 failures / 2 skipped**; socket JS **43/43**. Frontend `vite build` succeeds (pre-existing tsc/oxlint warnings in untouched files remain).

### Group Delivery Unified Trip (Design Steps 3–5): One Group = One Delivery = One Rider: Complete

Rescoped the COD/group architecture with the user to steps 3–5 only: **credit-free COD eligibility**, **one physical delivery per group checkout**, **one rider per group delivery** — with all affected tests and migrations rewritten to the new model. Settlement/purchase records stay on the interim legacy base (persisted `order.rider_financed_amount`); the future formula ("actual purchase cost paid by rider" via a new `cod_purchases` table) is deferred.

- **One delivery per group checkout**: migration `2026_09_21_000010_add_group_delivery_anchor_to_deliveries_table.php` adds nullable `deliveries.group_checkout_id` with a UNIQUE group anchor and makes `deliveries.order_id` nullable. The per-order `UNIQUE(order_id)` backstop already existed from `2026_09_20_000001_add_concurrency_guards.php`; the new migration declares no duplicate index (sqlite rebuild and mysql branches both verified through `RefreshDatabase`).
- **Dispatch points**: `GroupOrderService::createGroup` fires `scheduleGroupDispatch` immediately for COD groups; `PaymentController`'s group-paid branch fires it for GCash groups once the checkout is paid. Child orders never spawn a delivery — `SmartDispatchService::scheduleDispatch` no-ops for group children, and `createOrGetGroupDelivery` creates/returns the single group trip (pickup anchored on the first/pickup restaurant, `order_id=null`, `rider_commission=40` split evenly across child orders).
- **Resolution helpers**: `Delivery::primaryOrder()/childOrders()`, `Order::activeDelivery()`, and the existing `hasAcceptedRider()` resolve the rider-preparation gate for every restaurant sub-order **through the shared trip**, so no per-restaurant delivery exists to bind (4.2/4.4 preserved).
- **Credit-free COD eligibility**: order acceptance no longer debits rider credit. `reserveCodCredit()` freezes `cash_due` (= order `total`, or group `grand_total` via `codAmountDue()`) with `cod_credit_reserved = 0` and never calls the legacy credit-reserve path; the dispatch gate is now `passesCodActiveOrderLimit` (active-order limit only). A low-credit rider stays COD-eligible and the ₱200 protected reserve is untouched.
- **Interim settlement base**: `CodSettlementService::settlementBaseFor()` uses `cod_credit_reserved` when > 0, otherwise the persisted `order.rider_financed_amount`; per-child cash payments amount to the child `total`. Settlement still records the single restaurant/platform 80/20 split and a single rider-credit deduction never occurs.
- **Tests rewritten to the new model** (session): `CodFinancialSettlementTest` 11/143 and `CodDeliverySettlementTest` 2/120 (credit-untouched, low-credit eligibility, cancelled-COD no-settlement, multi-restaurant COD settles per restaurant on one shared trip, shared-trip lifecycle + cash settlement); `RiderAcceptanceGateTest` 14/137 (prep gate resolves via the shared trip, single-trip ownership/binding, decline/reoffer, no-rider block); `GroupedOrderDeliveryLifecycleTest`, `RestaurantSubOrderItemsLifecycleTest`, and `RealtimeCompletenessTest` reconciled to the one-trip model (realtime room isolation now *per-restaurant business rooms riding a shared trip room*). Standalone-order suites (`ConcurrencyLockTest`, `OneActiveDeliveryTest`, `ScheduledDispatchProcessorTest`, `FastDeliveryTipTest`, `GpsIntegrityTest`, `OrderSizeDispatchEligibilityTest`, `GroupOrderServiceTest`) verified unaffected — non-group orders still bind per-order deliveries.
- **Full Laravel suite**: **311 passed / 1,571 assertions / 0 failures / 2 skipped** (a clean full-suite run — the earlier documented refund-path failures are all green). Socket JS **43/43**. Frontend `tsc --noEmit` reports only the pre-existing untouched-file errors.
- **Database**: the migration is verified via `RefreshDatabase` (sqlite `:memory:`); the development MySQL schema is **not** applied (pending-migration backlog), so this checkpoint is not marked development-schema verified.
- **Deferred**: `cod_purchases`-based settlement formula (actual purchase cost) and `rider_credit_transactions.delivery_id` (AGENTS.md §17) both remain future/low-priority.

### ✅ Completed

#### 1. Authentication & Authorization
- User registration, login, email verification, password reset
- Role-based access control via `CheckRole` middleware
- Account status checks (`CheckAccountStatus` middleware — pending/rejected/suspended)
- Staff-specific middleware
- Sanctum API tokens for mobile/API auth
- Firebase UID linking for push notifications

#### 2. Role System
- 5 roles: `tourist`, `business_owner`, `rider`, `staff`, `tourism_office`, `bansud_tourism_office`
- Staff role assignments with granular permissions via `RolePermission` model
- Role-based UI routing (role selection page, dashboard redirects)

#### 3. Municipality & Barangay Management
- CRUD for municipalities (admin)
- Barangay assignment to municipalities
- Municipality admin assignment
- Coordinates (lat/lng) on municipalities for map features

#### 4. Business Registration & Management
- Multi-step business registration wizard (with session persistence)
- Business categories with dynamic fields and required documents
- Business documents upload (with DTI/SEC/Mayor's Permit tracking)
- Business media gallery (images with sort order)
- Business status lifecycle: `draft` → `pending_review` → `approved` / `rejected` / `suspended`
- Business verification workflow (submit for review)
- Business modules (features/settings per business category)
- Soft deletes and archiving

#### 5. Business Owner Dashboard & Operations
- Dashboard with KPIs (total orders, bookings, revenue, ratings)
- Offerings (products/services) CRUD with categories, featured toggle, bulk actions, analytics
- Menu management (with soft deletes)
- Orders management (status updates, rider assignment, delivery tracking)
- Bookings management (calendar view, status workflow)
- Promotions management (create/edit/toggle/destroy)
- Reports: sales, orders, bookings
- Staff management (create/edit/deactivate riders)
- Activity logs and notifications
- Chat (messaging with tourists/riders)
- Account settings and profile management
- Business switching (multi-business ownership)

#### 6. Tourist Dashboard & Experience
- Explore page (browse businesses by municipality/category with map)
- Business detail view (info, gallery, reviews, services)
- Map view with Leaflet (interactive business markers)
- Food ordering (place orders, track status, cancel, rate)
- Tour/activity booking (calendar-based availability)
- Transport booking (tricycle/tour guide with fare estimation)
- Events page
- Favorites (save businesses)
- Reviews and ratings
- Notifications
- Messages/Chat
- Order/booking history
- Profile management (with photo upload)

#### 7. Rider Module
- Dashboard with earnings and delivery stats
- Delivery management: pending (accept/reject), active (status updates), completed
- Real-time map navigation with Leaflet
- GPS location tracking (periodic updates via `RiderLocation` model)
- Service switching (food delivery vs. tour guide)
- Availability toggling
- Dispatch system (pending dispatch requests)
- Trip logging (`TripLog` model with location sequences)
- Chat with business owners and tourists
- Rider reviews

#### 8. Admin (Bansud Tourism Office) Panel
- Dashboard with platform-wide KPIs
- User management (CRUD, approve/reject/suspend/archive/restore)
- Role management
- Municipality management (CRUD + admin assignment)
- Business management (approve/reject/suspend)
- Business categories (CRUD, archive, required documents)
- Business modules (CRUD, archive, category-module assignments)
- Rider management (approve/reject/suspend/activate)
- Tourist listing
- System management: backup, config, security, audit logs, notifications
- Live operations: tours, deliveries, map, SOS
- Reports & Analytics: system, tourism, business, rider, customer

#### 9. Staff Dashboard
- Order dashboard (view and update order status)
- Booking dashboard (view and update booking status)
- Staff-specific role-based access

#### 10. Tourism Office Panel
- Dashboard
- Reports
- Business owner account approval workflow (approve/reject/suspend/archive/restore)

#### 11. Database — 80+ Migrations
- Users, profiles, KYC, roles, permissions
- Municipalities, barangays
- Businesses, categories, modules, documents, media, details, status logs
- Offerings (products/services), categories
- Orders, order items
- Bookings, booking items
- Promotions
- Deliveries, dispatch logs, rider locations, trip logs
- Reviews, rider reviews
- Favorites
- Chat rooms, participants, messages, read receipts
- Notifications, activity logs, approval requests
- Required documents
- Soft deletes on major tables
- Tracking indexes for performance

#### 12. Services
- **FirebaseService** — FCM push notifications
- **GpsService** — GPS coordinate handling
- **LocationPersistenceService** — rider location persistence
- **NearestRiderService** — nearest rider matching algorithm
- **PolylineEncoder** — route encoding for maps
- **TransportationService** — fare estimation and transport logic

#### 13. Frontend Components
- Shared `app-card`, `food-card`, `promotion-carousel`, `chat-widget`, `tracking-component`
- Admin layouts/components
- Tourism-specific components
- Reusable UI: modals, dropdowns, alerts, buttons, nav-links, text inputs, input labels

#### 14. Testing
- PHPUnit `TestCase` base class
- Selenium tests: business registration, staff creation, forgot password flow

#### 15. Other
- Firestore/Firebase Realtime DB rules configured
- Vite build setup with Tailwind CSS 4
- Axios for HTTP client
- Concurrent dev server (PHP artisan, queue worker, logs, Vite)
- Console command: `CleanupRiderLocations`

---

### 🚧 In Progress / Planned

- **Mobile application** (Ionic?) — API routes are defined, Sanctum auth ready
- **Real-time tracking enhancements** — deeper WebSocket/pusher integration
- **Automated test coverage expansion** — more feature/unit tests
- **SOS/Emergency alert system** — admin live SOS page exists (stub)
- **Advanced reporting dashboards** — with data export (CSV/PDF)
- **Payment gateway integration**
- **Multi-language support**

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Laravel 12, PHP 8.2 |
| Frontend | Blade, Tailwind CSS 3, Alpine.js |
| Build | Vite 7 |
| Database | MySQL (XAMPP) |
| Auth | Laravel Breeze + Sanctum |
| Real-time | Firebase Cloud Messaging (FCM) |
| Maps | Leaflet.js (self-hosted tiles) |
| Dev Tools | Laravel Pail (logs), Queue listener, Selenium |

## Project Structure (Key Directories)

```
app/
├── Console/Commands/        # Artisan commands
├── Enums/                   # GuideStatus, PriceRange, TripStatus
├── Http/
│   ├── Controllers/
│   │   ├── Admin/           # 11 admin controllers
│   │   ├── Api/             # Auth + Trip Tracking
│   │   ├── Auth/            # Breeze auth controllers
│   │   ├── Rider/           # 4 rider controllers
│   │   ├── Tourist/         # 12 tourist controllers
│   │   └── ...              # BusinessOwner, Staff, TourismOffice controllers
│   ├── Middleware/           # CheckRole, CheckAccountStatus, StaffMiddleware, SetBusinessContext
│   └── Requests/            # Form request validation
├── Models/                  # 43 Eloquent models
├── Notifications/            # ResetPassword, RiderAccountStatusChanged
├── Observers/               # BookingObserver, FavoriteObserver, ReviewObserver
├── Services/                # Firebase, GPS, Transport, etc.
└── View/Components/         # AppLayout, GuestLayout
database/
├── migrations/              # 85 migration files
├── factories/
└── seeders/
resources/views/
├── admin/                   # 13 subdirectories
├── business-owner/          # 16 subdirectories
├── rider/                   # 7 views
├── tourist/                 # 13 subdirectories
├── staff/                   # dashboard + components
├── tourism-office/          # 3 views
├── auth/                    # login, register, etc.
├── components/              # shared Blade components
└── layouts/                 # app, guest, navigation
routes/
├── web.php                  # 529 lines — all role-based web routes
├── api.php                  # Sanctum auth + trip tracking
├── auth.php                 # Auth routes (Breeze)
└── console.php
```
