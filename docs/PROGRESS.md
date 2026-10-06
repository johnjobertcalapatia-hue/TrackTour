# Project Progress — Tourism Management Portal

## Order → Rider Ping Delivery — Tested End-to-End at Both Layers — COMPLETE (2026-09-25)

Requested: verify that a rider actually receives the order ping (dispatch) and fix it if the rider does not. The dispatch-reliability diagnosis (AGENTS.md §20) blamed eligibility + retry lifecycle, NOT the Socket.IO transport — this phase converts that claim into a real test at both halves of the contract.

- **Laravel → bridge half** (`tests/Feature/DispatchSocketPingContractTest.php`, 4 tests): runs the REAL `SmartDispatchService → NearestRiderService` checkout pipeline and asserts `dispatchToNearest()` actually POSTs `/dispatch` to the socket bridge naming the rider — `deliveryId`, `riderId`, `restaurantLat/Lng`, `restaurantName` — and that a pending `booking_dispatch_logs` offer exists for that rider. Covered on both candidate sources (MySQL `rider_locations` and the live socket radar fallback), multi-rider radar waves (one ping per eligible rider), and the no-candidate case (blind `riderId: null` ping + `parkForRetry` — never a dead end).
- **Bridge → rider socket half** (`tests/js/socket-dispatch-ping.test.js`, 6 tests): boots the REAL `socket-server.js` as a child process on ephemeral ports and proves a connected rider's socket actually receives `order_received_ping` for the dispatched order — preferred-rider ping, radar-fallback ping (no preferred rider), no ping to an unregistered socket, busy preferred rider skipped so the other online rider gets it, missing bridge secret → 401 (loud, not silent), and malformed payload → 400 with no ping. This is the first test to exercise the socket engine's live ping path (previously only pure helper modules were tested).
- **Findings**: no production defect found — riders receive the ping correctly through both the preferred-rider and radar-scan paths. The two initial radar-scan test failures were test-isolation artifacts (a previous test's still-connected rider was equidistant and intercepted the radar ping); fixed in the test by gating each radar case on the engine radar containing exactly its own riders. New root devDependency `socket.io-client` (server `socket.io` was already present).
- **Checkpoint**: socket JS **51/51 passed** (45 prior + 6 new). Full Laravel suite **565 tests / 3,002 assertions / 3 failures / 7 skipped / 2 PHPUnit deprecations** — the 3 failures are the same pre-existing WIP `TouristConfirmRatingPersistenceTest` rating-gate drifts already documented below (my change is additive test-only + one devDependency; no production code, schema or frontend code touched). No schema change.

## Rider "Go Online" Button — Stuck Offline Mid-Trip With Guaranteed-Fail Toggle — COMPLETE & VERIFIED (2026-09-25)

Requested: a rider mid-delivery sees the grey **Go Online** button (looks offline) and tapping it fails — "you're currently in trip, you cannot go offline".

- **Root cause**: `AuthController::logout` unconditionally wrote `rider_status='offline'` even while the rider still had an active `Deliveries` row (any logout / the earlier auto-logout bug mid-trip). After logging back in the store shows `offline` → grey "Go Online" — but `RiderController::toggleAvailability` **409s** because it applies the canonical row-based `hasActiveTrip()` guard ("You are currently on a delivery or trip. Complete it before going offline."). The 409 is the API correctly refusing to free a trip-bound rider; the bug was the stale `offline` status the logout clobbered.
- **Backend fix**:
  - `DeliveryService::riderHasActiveTrip(User)` — the authoritative row-based guard over every active `TripStatus` plus `TripStatus::DELIVERED` (delivered-but-unsettled COD still binds the rider). Single source of truth for both logout and the availability toggle.
  - `RiderController::hasActiveTrip()` now delegates to it (removed the now-unused `TripStatus` import).
  - `AuthController::logout` only writes `rider_status='offline'` when `! riderHasActiveTrip($user)` — mid-trip riders keep their status; idle riders and stuck-`busy` riders with no trip still go offline.
- **Frontend fix** — `DashboardLayout` now consumes `RiderActiveTripContext` (null outside `/rider` routes, inert for every other role) and derives `inTrip` (active delivery **or** pending COD settlement **or** `busy`) and `effectivelyOnline`. The Go Online/Offline toggle is disabled while `inTrip` (tooltip "On a trip — complete the delivery to go offline"), the availability readout shows **On a trip** instead of a grey Online, and the action grid + auto-accept visibility follow `effectivelyOnline`. The button can no longer fire a request the backend is guaranteed to reject.
- **Tests**:
  - `frontend/tests/ui/rider-chrome-trip-state.test.tsx` (3): mid-trip offline rider → `On a trip` + disabled toggle + **no** toggle request issued; idle offline rider → enabled `Go Online` that drives the real toggle call; delivered-but-unsettled COD → treated as mid-trip.
  - `tests/Feature/RiderStayOnlineForTripTest.php` +5: `dataProvider` over `assigned`/`in_transit`/`delivered` → logout does **not** drop a mid-trip rider offline; idle rider logout → offline; stuck-`busy` rider with no trip → cleared to offline.
- **Checkpoint**: backend `RiderStayOnlineForTripTest` **19 passed / 47 assertions**. Full Laravel suite **561 tests / 2,980 assertions / 3 failures / 7 skipped (2 PHPUnit deprecations)** — the 3 failures are the same **pre-existing, documented WIP** `TouristConfirmRatingPersistenceTest` rating-gate drifts already noted below at the "Per-Stop Confirm Item Pickup" checkpoint (they reproduced with unrelated controller changes stashed; this change does not touch tourist confirm/rate). Its `$orderuffy` undefined-variable **error** was fixed (typo `$order` at `TouristConfirmRatingPersistenceTest.php:278`) → previously 1 error, now 0. Frontend Vitest **128 passed / 18 files / 0 failures**; `vite build` clean; `oxlint` clean on changed files (`DashboardLayout.tsx`, `rider-chrome-trip-state.test.tsx`); the two Fast-Refresh `only-export-components` warnings on `RiderActiveTripContext.tsx` are the pre-existing class already present at HEAD. No schema change.

## Rider "Order details" Sheet Made View-Only + Per-Stop "Confirm Item Pickup" Appearing Message — COMPLETE (2026-09-25)

Requested: the rider **Order details** bottom sheet (`RiderOrderInfoSheet`) must be **read-only** — remove Navigate links and every action/confirm — and per-restaurant pickup confirmation must happen in the **appearing message** (`GlobalRiderAlert`) when the rider is within the pickup radius AND that restaurant's items are ready. After all stops are collected, the final "I Picked Up the Food" confirm must remain available.

- **Per-stop appearing message (authoritative, derived)** — `RiderActiveTripContext` now computes `pickupStopPrompt` (`PickupStopPrompt | null`) via `resolveStopArrival` (100 m `STOP_ARRIVAL_THRESHOLD_METERS`) against the authoritative `/pickup-stops` payload: non-null only while `isPickupStage`, stops exist, not fully collected, the current unconfirmed stop is within the radius AND `is_ready`. Purely derived (not one-shot) so it re-targets the next stop after each confirm and disappears when done. `GlobalRiderAlert` renders this per-stop "Confirm Item Pickup" card (restaurant, stop `X of Y`, distance, error, busy) with precedence over the arrival alert — **this is the canonical confirm action**, calling `confirmPickupStop(businessId)` and the existing backend gate + `/pickup-stops/{business}/confirm` endpoint (unchanged). Also added derived `pickupComplete` (all stops collected while still in pickup stage).
- **Final confirm can never strand the rider** — `GlobalRiderAlert` additionally keeps the "I Picked Up the Food" card on screen via `pickupComplete`, even when the one-shot `arrivalAlert` was dismissed earlier (e.g. a "Collect Food" escape while a stop was still pending). The sheet no longer holds a Start Delivery fallback button.
- **Sheet is now view-only** — `RiderOrderInfoSheet` removed: the `NavigateLink` headers (pickup/delivery), the amber Navigate anchor on the active stop, the per-stop "Confirm Item Pickup" buttons, the COD purchasing-cash display + "Confirm Cash Received" button (`receiveCashMutation`), and the "All food collected — …" / Start Delivery action block. The sheet keeps the read-only stop cards (sequence, `${n} items · ~${m} min prep`, readiness chip, item list, distance/You've arrived, reason, `Collected ✓`), the Route box with planned drop-off ETA, and the X/Y confirmed header. Unused imports removed (`useMutation`, `useQueryClient`, `post`, `Navigation`, `Truck`). The separate tourist-cash settlement screen (`RiderDeliveriesActive` "Confirm Cash Received") is the COD settlement flow and was intentionally untouched.
- **Tests updated** — `rider-order-info-sheet-pickup.test.tsx` second test now asserts the sheet is view-only (no Confirm Item Pickup / Navigate / Confirm Cash Received / Start Delivery, no `/pickup-stops/:id/confirm` post); `global-rider-alert-gate.test.tsx` mock gained the new context fields (`pickupStopPrompt`, `confirmPickupStop`, `confirmStopBusy`, `confirmStopError`, `pickupComplete`) and a new `describe` locking the per-stop message (render within radius+ready, precedence over the arrival alert, confirm-error surfacing, busy disable, confirm wired to `confirmPickupStop(businessId)`) plus the all-collected final-confirm fallback.
- **Checkpoint**: frontend Vitest **128 passed / 18 files / 0 failures**; `vite build` clean (pre-existing chunk-size warning only); `oxlint` clean on changed files (only pre-existing Fast-Refresh warnings on the context export). Socket JS **45/45 passed**. No backend/schema changes — the rider-acceptance gate, one-active-delivery rule, COD settlement, and group-checkout architecture are untouched.

## Business Owner "Food Preparation" Card — Live Time-Remaining Countdown + Per-Item Readiness (2026-09-25)

Requested: the Food Preparation card's **Time Remaining** must be a real ticking countdown (it showed `—`), shown per order item.

- **Root cause of `—`**: the detail card only rendered the `PreparationCountdown` when `order.status === 'preparing'` and keyed it off server `predicted_ready_at`. The UI's "Start Preparing" action (`accepted → preparing`) calls `PATCH /business-owner/orders/{id}/status`, but `BusinessOwnerOrderController::updateStatus` only flipped the status — it never set `preparation_started_at`/`predicted_ready_at` (those are set by `PreparationStartService::startForOrder` on the rider-acceptance path), so any order entering `preparing` through the manual button had `predicted_ready_at = null` → countdown rendered `—`.
- **Backend fix** — `BusinessOwnerOrderController::updateStatus`: when the target status is `preparing` and `predicted_ready_at` is still null, it now arms the canonical timer (`preparation_started_at`, `predicted_ready_at = now + effectivePreparationMinutes`, `predicted_preparation_seconds`, `preparation_time`) via `PreparationStartService`, so the manual start path produces a working countdown exactly like the rider-acceptance path. Additive-only; the rider-acceptance gate (§4.2) is unchanged.
- **Frontend — shared util**: new `deriveReadyAt()` in `shared/utils/index.ts` returns `predicted_ready_at` when present, else derives `preparation_started_at + preparation_time` — so a live `MM:SS` countdown shows whenever prep has started, even on legacy/edge rows. Used by the Orders list (`BusinessOwnerOrders.tsx` Time Remaining row) and the Order detail card.
- **Frontend — detail card** (`BusinessOwnerOrderShow.tsx`): Time Remaining now counts down whenever `preparation_started_at` exists (and the order is not post-prep), with the Estimated Ready row following the same deadline; the order-level **Priority** row (derived from the fast-delivery tip) was replaced by a **Item Readiness** block listing each active item with its own status chip (Ready / Preparing + per-item countdown / Pending), matching the user's request for per-item readiness.
- **Tests**: backend `RestaurantPreparationTimerTest` +1 (`test_manual_start_preparing_arms_the_countdown`: PATCH status `preparing` on an accepted pickup order arms `preparation_started_at`/`predicted_ready_at`/`predicted_preparation_seconds` and exposes `preparation_time`). Frontend `business-owner-orders-live-updates.test.tsx` +1: detail page with `predicted_ready_at: null` but prep started still shows a live `MM:SS` countdown, Estimated Ready, and the Item Readiness block with both a `preparing` and a `ready` item.
- **Checkpoint**: frontend Vitest **123 passed / 18 files / 0 failures**; `vite build` clean (pre-existing chunk-size warning only); `oxlint` clean on changed files (only the pre-existing `formatCountdown` export warning remains in `PreparationCountdown.tsx`). Backend `RestaurantPreparationTimerTest` **12 passed / 106 assertions**; gate/lifecycle suites (`PreparationStartServiceGateTest|RiderAcceptanceGateTest|GroupedOrderDeliveryLifecycleTest`) **18 passed / 188 assertions**. Full Laravel suite **556 tests / 2,968 assertions / 7 skipped / 4 failures** — the 4 failures are the same pre-existing WIP `TouristConfirmRatingPersistenceTest` issues (`$orderuffy` + rating-422 assertions; reproduced with my controller change stashed, so untouched by this fix). No schema change.

## Per-Item Preparation Timer + Manual "Ready for Pickup" on Business Owner Orders; Completed Action Removed — COMPLETE (2026-09-25)

Requested: in the business-owner Orders screens, every order item must carry **its own countdown timer** plus a **manual button** to set it `ready` for pickup (independent of the shared order-level countdown), and the **"Complete" action button must be removed** because a business owner cannot set an order to `completed`.

- **Frontend — Orders list (`BusinessOwnerOrders.tsx`)**: each expanded `ItemCard` now shows its own dish-level clock computed from that item's own window — `itemPredictedReadyAt()` = `preparation_started_at + preparation_time` minutes (per-item `preparation_started_at` is stamped by `PreparationStartService` when prep starts) — rendered as a `PreparationCountdown` under the item's `StatusBadge`, plus a "Mark Ready for Pickup" button that `PATCH`es the canonical item endpoint `/business-owner/orders/{order}/items/{item}/status` with `{ status: 'ready' }` and invalidates `['bo-orders']`. The button renders only while the order is in a preparable state (`accepted`/`preparing`) and the item is not already `ready`; the backend rider-acceptance gate (§4.2) is unchanged and still rejects item-ready on a riderless delivery order.
- **Frontend — Order detail (`BusinessOwnerOrderShow.tsx`)**: the same per-item timer renders in the Prep Status column of the items table (next to the existing per-item Mark Ready button); the `ready → completed` "Complete" transition was removed from `ORDER_TRANSITIONS`, so the Actions panel can no longer offer completion (it falls back to "No actions available for this status." when `ready`).
- **Backend rule (authoritative)**: `UpdateOrderStatusRequest` no longer accepts `completed` (`in:preparing,ready,cancelled`, message updated), and `BusinessOwnerOrderController::updateStatus` dropped its `completed_at = now()` stamping branch — a business owner can never flip an order to `completed` through any order-status endpoint. Completion remains owned by the tourist/rider/settlement flow (tourist confirm → completed for prepaid; COD `settle-cod` → completed; staff may still set `completed` via `StaffUpdateOrderStatusRequest`). Per-item status never accepted `completed`, so the item API needs no change.
- **Tests reconciled (AGENTS.md §12)**: `CompletionConsistencyTest::test_business_owner_marking_order_completed_stamps_completed_at` → renamed `test_business_owner_cannot_mark_order_completed` and now asserts a **422** + order status unchanged + `completed_at` stays `null`. New frontend UI tests in `business-owner-orders-live-updates.test.tsx`: (1) a `preparing` item renders a per-item `MM:SS` timer and a "Mark Ready for Pickup" button that posts the item status endpoint; (2) the detail page in `ready` state offers **no** Complete button and shows "No actions available for this status.".
- **Checkpoint**: full Laravel suite **544 passed / 7 skipped (known env: 5 GD + 2 SQLite-only) / 2,958 assertions / 4 failures** — the 4 failures are the same pre-existing WIP `TouristConfirmRatingPersistenceTest` issues (undefined `$orderuffy` + rating-422 assertions; reproduced with my three changed files stashed, so untouched by this change). Frontend UI **119 passed / 17 files / 0 failures**; `vite build` clean (pre-existing chunk-size warning only); `oxlint` clean on the changed files. Socket JS **45/45 passed**. No schema change.

## Admin Riders — Editable Delivery Fare Policy (Standard Fare + Additional Fees) (2026-09-25)

Requested: the standard fare and additional fees used by the rider delivery-fee calculation must be dynamic/configurable by the Tourism Office, surfaced on the Admin **Riders** page.

- **Backend provider**: new `App\Services\DeliveryFareSettings` (singleton, registered in `AppServiceProvider`) reads the fare policy from `tourism_settings` rows keyed `delivery_{field}` (`base_fare`, `included_kilometers`, `per_kilometer`, `minimum_fee`, `service_adjustment`, `surge_multiplier`), falling back to the existing `config('delivery.*')` defaults when no row exists. `save()` persists all six values atomically in one transaction, re-floors precision to 2 decimals, resets its per-request cache, and returns the effective snapshot. The canonical fee formula is unchanged; only the source of the numeric inputs changed.
- **Authoritative consumption**: `DeliveryFeeService::calculateOrderDeliveryFee` and `OrderResource::delivery_fee_details` now use `DeliveryFareSettings` getters instead of raw `config('delivery.*')` reads, so a saved fare affects new quotes, order placement, rider `rider_delivery_earnings` (= delivery fee), and every fee-breakdown render. Pre-existing orders keep their persisted `delivery_fee`; only the display breakdown reflects the current policy (same behavior as before with config).
- **Admin API** (`AdminRiderController`, inside the existing `role:bansud_tourism_office` group): `GET /api/admin/riders/fares` (current effective policy) and `PUT /api/admin/riders/fares` (validated numeric policy; `min:0` guards) — registered before `GET /riders/{rider}` so model binding never swallows `fares`. Every update writes an `activity_logs` row (`rider_fare_settings.updated`, admin id, before→after deltas, IP/UA).
- **Frontend**: the Admin Riders list page (`AdminRiders.tsx`) now leads with a **Fare Policy** card — six numeric inputs (Base Fare, Included Kilometers, Per-Kilometer Rate, Minimum Fee, Service Adjustment, Surge Multiplier) + a Save action that `PUT`s the settings, surfaces success/error alerts, and shows the fee formula for operators. `API_ENDPOINTS.ADMIN.RIDERS_FARES = '/admin/riders/fares'`.
- **Notes**: the client-side *fallback* estimate constants in `TouristFoodCart.tsx` are unchanged by design — they only render while the authoritative server quote is loading and are always overridden by the response. Ride-hailing vehicle fares (`TransportationService`) are a separate feature and were intentionally left out of scope.
- **Tests**: `AdminApiTest` gains 7 tests (18 total in the class): defaults match config, update persists + round-trips, **updated fares drive the actual `DeliveryFeeService` math** (OSRM-faked 5 km → base 60 / included 1.5 / per-km 12 / adjustment 10 / surge 1.25 → distance charge 42, delivery fee 140), zero-values persist, unknown keys ignored, negative values 422, audit log row written, non-admin 403 on GET and PUT.
- **Checkpoint**: AdminApiTest **18 passed / 85 assertions**. Full Laravel suite **544 passed / 7 skipped / 2,958 assertions / 4 failures** — the 4 failures are pre-existing in the untracked WIP `TouristConfirmRatingPersistenceTest` (undefined `$orderuffy` variable at line 278 plus rating-422 assertions; the file touches no fare/order-fee code) and are not introduced by this change. Frontend `vite build` clean; `oxlint` clean on the changed files (unchanged files keep their pre-existing `BusinessOwnerBookingCalendar.tsx` rules-of-hooks errors); Vitest 8 failures are all in unrelated untracked WIP UI tests. No schema change (reuses `tourism_settings` + `activity_logs`).

## Pickup-Stops Panel Moved Into the Rider "Order details" Panel — COMPLETE (2026-09-24)

Requested: the "Pickup Stops · X/Y confirmed" block currently floating over the rider map should live in the rider **Order details** panel — the draggable bottom sheet (`RiderOrderInfoSheet`) that renders directly below the Service Types / My Destination / Diagnostics / Auto accept quick-action grid in the shared rider layout (`DashboardLayout`).

- **Move**: the full pickup-stops content (header + X/Y counter, COD purchasing-cash blocks + "Confirm Cash Received" + `purchasing_cash` amount, Route box with planned drop-off ETA, per-restaurant stop cards with `Confirm Item Pickup` / `Collected ✓`, arrival-aware unlock, `confirmStopError`, and the `All food collected — you can now leave for delivery` + Start Delivery/Confirm Pickup action) moved verbatim from the `RiderMap` floating overlay into the expanded `RiderOrderInfoSheet` content. It reuses the exact same canonical sources: `pickupStopsData` from `RiderActiveTripContext` (no duplicate `/pickup-stops` request), `resolveStopArrival` + `formatStopDistance` for the local unlock, the context `confirmPickupStop`/`confirmStopBusy`/`confirmStopError`, `busy`/`actionError`, and the context `onArrivedPickup`/`onMarkPickedUp` (the gate-blocked `picked_up` stays enforced server-side + context-side). The drop-leg OSRM ETA (`useOsrmRoute`) moved with the Route block (the only new network the sheet owns); the map page therefore no longer issues a second OSRM request.
- **RiderMap cleanup**: removed the overlay panel + dead locals/imports (`isPickupStage`, `receiveCashMutation`, `isCod`/`purchasingCash`/`cashIssued`/`cashReceived`/`collectedCount`, `resolveStopArrival`, `pickupNextAction`/`pickupNextLabel`, drop-plan OSRM block, `Wallet`/`Package` icons, unused `queryClient`). The map keeps the cockpit, route polyline (`resolvePickupRoute` on `purchaseStops`), stop-number markers, and earnings card unchanged.
- **Tests**: new `frontend/tests/ui/rider-order-info-sheet-pickup.test.tsx` (2 tests) rendering `RiderOrderInfoSheet` inside `RiderActiveTripProvider`: (1) expanding the sheet surfaces "Pickup Stops · 1/2 confirmed" with both stop cards, prepaid wording and "Collected ✓"; (2) confirming a stop posts the canonical `/rider/deliveries/7/pickup-stops/2/confirm` and the header advances to "2/2 confirmed" with the leave-for-delivery callout.
- **Checkpoint**: frontend UI **79 passed / 13 files / 0 failures**; `vite build` clean (only the pre-existing chunk-size warning). Laravel suite unchanged — **519 passed / 7 skipped (known env: 5 GD + 2 SQLite-only) / 0 failures / 2,855 assertions**. No backend/schema changes.

## Admin Business Categories — Adding a Document 500'd on `required_fields` — Fixed (2026-09-24)

`POST /api/admin/business-categories/{category}/documents` (`AdminBusinessCategoryController::addDocument`) returned **500** `SQLSTATE[HY000]: General error: 1364 Field 'required_fields' doesn't have a default value`. The `required_documents.required_fields` JSON column is NOT NULL with no default (migration `2026_07_23_120000_restructure_required_documents_table.php`), but `addDocument` omitted it on `RequiredDocument::create(...)`. Every other creation path supplies it (e.g. `TourismOfficeDocumentController::addCategoryDocument` defaults to `['document_number','issue_date','expiration_date']`).

- **Fix (authoritative layer)**: `AdminBusinessCategoryController::addDocument` now validates `required_fields => nullable|array` and defaults it to `['document_number','issue_date','expiration_date']` on create — matching the canonical tourism-office pattern.
- **Tests**: added `AdminApiTest::test_admin_can_add_document_to_category` (posts a document without `required_fields`, asserts 200 + row persisted) — regression guard against the 1364.
- **Checkpoint**: full Laravel suite **519 passed / 7 skipped (known env: 5 GD + 2 SQLite-only) / 0 failures / 2,855 assertions** (includes the new test).

## P14 — Tourist Delivery-Confirmation Gate — COMPLETE & VERIFIED (2026-09-24)

Requirement: a food delivery may only reach `delivered` when the **tourist** confirms receipt at the drop-off. The rider may never mark a food delivery `delivered` on their own (422). Standalone transport rides stay rider-driven and never hit the gate. COD stays `delivered` + cash_due frozen until the rider settles the cash; prepaid completes (`completed`, order terminal, rider released) on confirmation.

- **Gate fix (authoritative layer)**: `RiderDeliveryController::updateStatus` (`PATCH /rider/deliveries/{d}/status`) and the defense-in-depth `RiderMapController::updateDeliveryStatus` (currently unrouted) now evaluate `NearestRiderService::requiresTouristConfirmation()` **BEFORE** the status write inside the locked transaction. Previously the check ran after the write, so a rejected rider `delivered` still committed the row to `delivered` (never reverting), which masked real tourist confirmations as idempotent no-ops and never stamped the confirmation fields. The `tourist_confirmation_required` 422 now leaves the delivery untouched at `arrived_destination`.
- **Controller + route**: `Tourist\FoodController::confirmDelivery` (`POST /tourist/food/order/{order}/confirm-delivery`, `TokenOnlyAuth` + `role:tourist`) — ownership guard (`order.user_id !== Auth::id()` → 403), calls `NearestRiderService::confirmDeliveryByTourist()` (transactional, row-locked, idempotent re-confirm, `\InvalidArgumentException` → 422), then dispatches `DeliveryStatusChanged` post-commit so `SyncOrderStatusFromDelivery` (+ realtime rooms) follow the authoritative end state (`delivered` for COD, `completed` for prepaid).
- **Model/migration**: `Delivery::$fillable` gains `delivery_confirmed_at` / `delivery_confirmed_by` (columns already defined in the surviving `2026_09_24_000006_add_delivery_confirmation_and_actual_pickup_to_deliveries_table.php` migration; the earlier duplicate `000006` file that caused a `duplicate column` cascade was removed).
- **Tests**: new `tests/Feature/TouristConfirmDeliveryTest.php` (9 tests): rider delivered 422 + delivery untouched, prepaid confirm → completed (order + completed_at + earning + rider released + confirm stamped), COD confirm → delivered (cash_due frozen, order delivered, not terminal) then settle-cod → completed, idempotent re-confirm, other-tourist 403, rider-role 403, before-arrival 422, unauthenticated 401, transport ride stays rider-driven. Reconciled per §12: `CodOrderToSettlementFlowTest`, `CompletionConsistencyTest`, `PurchasingCashFlowTest` e2e (group buyer is now a real `tourist` instead of the business owner), `ReadyToDeliveredOrderSyncTest` (added customer user + split the proximity test into a tourist-confirmation-completed event test).
- **Checkpoint**: full Laravel suite **518 passed / 7 skipped (known env: 5 GD + 2 SQLite-only) / 0 failures / 2,852 assertions**. Frontend unchanged this task — Vitest **77 passed / 12 files / 0 failures**, `vite build` clean (pre-existing chunk-size warning only). Stray `test-run.txt`/`test-run2.txt` removed.

## Bansud Test Data — Business Owner Accounts + Complete Registry Records (2026-09-24)

Seeded the Bansud business/attraction registry with one approved `business_owner` testing account per entity plus complete records, through new `database/seeders/BansudTestDataSeeder.php` (pattern-matched to `RestaurantTestSeeder` and the attraction `business_details` contract). Idempotent: existing accounts/businesses are re-used, missing details/menu are backfilled.

- **Restaurants (category `Restaurant`)** — Eksklusibo Grill & Restaurant, Green Thumb Restobar: full profile (hours, coords, price range, business days/hours, legal entity, capital, floor area, etc.), `business_details` (seating, service type, cuisine, facilities, services), and a 4-category / 18-item menu (`offering_categories` + `offerings`, status `available`). `restaurant_wallets` auto-provisioned by the existing `Business::saved` hook.
- **Tourist spots & attractions (category `Tourist Attraction`)** — Bansud Municipal Park and Plaza, Bansud Museum, Bato Viewing Hills, Batong Buwaya River, Manihala Waterfalls, Paypay Ama Waterfalls, Rosacara Rolling Hills, Sunken Cemetery: full profile + `business_details` (`attraction_type`, `entrance_fee`, `best_time_to_visit`, `activities`). Each synced its category modules via `syncModulesFromCategory()`.
- **Accounts** — `eksklusibo.grill@bansud.test`, `greenthumb.restobar@bansud.test`, `park.plaza@bansud.test`, `bansud.museum@bansud.test`, `bato.viewinghills@bansud.test`, `batong.buwaya@bansud.test`, `manihala.falls@bansud.test`, `paypayama.falls@bansud.test`, `rosacara.hills@bansud.test`, `sunken.cemetery@bansud.test` — all `approved` business owners, password `password123`, with `user_profiles`.
- **Representation decision**: tourist spots were inserted as **approved Tourist Attraction businesses** (not `tourist_destinations`) because (a) the canonical manageable entity for a log-in/testing account is a business owned by that account, and (b) the tourist-facing `/api/tourist/destinations` feed already merges approved `Tourist Attraction` businesses with legacy `tourist_destinations`, so the spots render on the tourist app without duplicating the feed. Re-run with `php artisan db:seed --class=BansudTestDataSeeder`.
- **Database verification**: 10 accounts (users 21–30) + 10 businesses (IDs 9–18), 8/8 attractions with 4 details each, 2 restaurants with 4 categories + 18 offerings + wallet rows; no migrations added.

## Business Owner Orders Now Live-Update on Rider Accept & Timer-0 Ready — Complete (2026-09-24)

Requirement: tourist order → needs rider acceptance → appears on the business-owner Orders screens → rider accepts → order becomes `preparing` and a countdown (a MAX of the item `preparation_time` snapshots, shortened by the restaurant's priority-tip tiers) starts → at 00:00 the items + order auto-flip to `ready` for pickup (manual `mark-ready` also exists). **The pipeline already existed as the canonical backend architecture** (`NearestRiderService::handleRiderResponse` calls `PreparationStartService::startForDelivery` on accept `NearestRiderService.php:924`; the minute `orders:advance-preparation` scheduler auto-completes due countdowns in `PreparationStartService::completeDuePreparations`), fully locked by `RestaurantPreparationTimerTest` / `RiderAcceptanceGateTest` / `PreparationStartServiceGateTest`. The gap was **visibility**: only the Kitchen screen subscribed to the authorized `business:{businessId}` socket room, so on the Orders list and Order detail pages a rider acceptance (→ preparing + countdown) or the timer hitting 00:00 (→ ready) stayed stale until a manual refresh.

- **Fix — wire the existing notifier**: `BusinessOwnerOrders.tsx` and `BusinessOwnerOrderShow.tsx` now mount `useBusinessSocketNotifier` (mints the HMAC business-room token, joins `business:{id}`) and invalidate `['bo-orders']` / `['bo-order', id]` on every canonical event (`order.status.changed`, `delivery.assigned`, `rider_assigned`, `delivery.status.changed`, `trip_cancelled`, `dispatch_status_update`). Rider accept and auto-ready now appear live; a small "Live" chip mirrors the Kitchen indicator. Best-effort by design: when the token/socket is unavailable the pages fall back to manual HTTP refresh exactly as before (no polling added).
- **Tests**: new `frontend/tests/ui/business-owner-orders-live-updates.test.tsx` (3 tests) driving the real pages through mocked api + fake Socket.IO: (1) `delivery.assigned` → list refetches → `preparing` + a running `MM:SS` countdown render; (2) `order.status.changed` (preparing→ready) on the detail page → refetch → countdown cleared, order + items show Ready (proves the timer-0 auto-ready is visible live); (3) no selected business → socket/token never opened, page still renders via HTTP.
- **Checkpoint**: frontend UI **77 passed / 12 files / 0 failures**; `vite build` clean (only the pre-existing chunk-size warning); `oxlint` clean on the three changed files (the two `BusinessOwnerBookingCalendar.tsx` rules-of-hooks errors are pre-existing, untouched). Laravel suite unchanged **508 passed / 7 skipped (known env: 5 GD + 2 SQLite-only) / 0 failures / 2,787 assertions**. No backend/schema changes.
- **Note on scope**: priority-tip countdown shortening remains restaurant-opt-in (`priority_preparation_reduction_enabled`, default off) per the existing tested decision; flipping it to always-on was intentionally out of scope.

## Ride-Hailing Orders Leaked Into Business Owner Orders Page — Fixed (2026-09-24)

Reported: Order `TRP-6AB4D7611BA25` (transport, "Ride: Motorcycle (1 pax)") appeared in the business owner Orders page under "Pending". Root cause: `TransportationService::createRide()` hard-coded `business_id => 1` on every ride order, so every ride was stamped onto whichever business happened to own id 1 (here "John Jobert's Restaurant"). Beyond the owner list, that fake business attribution also leaked ride cash into that restaurant's dashboard KPIs, sales/report/export queries and — worst — the COD/GCash restaurant settlement (a completed ride would credit business 1's RestaurantWallet through `settleCodDelivery`/`recordGcashSettlement`).

- **Fix A — canonical ride isolation**: `database/migrations/2026_09_24_000005_make_orders_business_id_nullable_for_transport_rides.php` makes `orders.business_id` nullable (FK guarded by `Schema::hasIndex`, since the dev schema no longer carries `orders_business_id_foreign`) and nulls every existing `order_type = 'transport'` row. `TransportationService::createRide()` now writes `business_id => null` — a ride has no owning restaurant, so owner order lists, dashboards, sales ledgers, exports and settlement are all naturally excluded (all are `whereIn('business_id', ...)`-based).
- **Fix B — settlement guards**: `OrderSettlementService::recordGcashSettlement()` returns `null` for `order_type === 'transport'` (fare is never a restaurant earning); `CodSettlementService::recordAllocations()` returns an empty collection for transport orders so a COD ride settle books its payment + rider earning but never a restaurant/Tourism Office split. Existing ride-rating guards (`if ($order->business_id)`) already prevented business reviews for rides.
- **Tests**: new `test_transport_ride_orders_are_isolated_from_business_owner_orders` in `BusinessOwnerApiTest` (ride never lists under the owner's orders, owner `show` is 403, ride `business_id` is null); `TouristTransportContractTest` ride-rating test updated to assert a ride creates **no** business review (drift reconciled per §12 — rides have no restaurant); `DispatchNoRiderRetryTest` transport fixture now uses `business_id => null` to encode the canonical rule.
- **Checkpoint**: full Laravel suite **508 passed / 7 skipped (known env: 5 GD + 2 SQLite-only) / 0 failures / 2,787 assertions**. Migration applied to the dev MySQL DB and verified (`orders.business_id` nullable; order 17 `business_id = null`).

## Unified Pickup-Stop Flow (COD + Prepaid) & "Payment Settled?" Step — COMPLETE (2026-09-24)

Requirement: per-restaurant "Confirm Item Pickup" sequence for group orders, one stop per restaurant, gated by route order + pickup radius + restaurant READY — enforced on the backend — for **both** COD and prepaid group orders, advancing the leg stop-by-stop until all stops are collected; then, after `delivered`, a COD delivery that still holds collected cash surfaces a "Payment settled?" step before the rider is released. Backend already enforced the rule; this task wired backend authority through a canonical `/pickup-stops` payload and rebuilt the rider frontend on it.

- **Backend (authoritative)** — `delivery_pickup_stops` migration + `DeliveryPickupStop` model; `app/Services/PickupSequenceService.php` (ensureStops + currentStop COD-aware + transactional `confirmStop` with route-order/radius/READY gate, mark purchases compatible); `app/Http/Controllers/Rider/RiderPickupStopController.php` (GET `/rider/deliveries/{d}/pickup-stops`, POST `.../pickup-stops/{business}/confirm`); the `picked_up` + `in_transit` gate swapped from the old repurchase gate to `PickupSequenceService::allConfirmed`. `PickupSequenceFlowTest` (5 tests / 79 asserts).
- **Frontend — shared contracts**: new `frontend/src/features/rider/pickup-stops.ts` (stop payload types + `pickupStopReasonLabel`/`pickupReadyLabel`); `gating.ts` generalized from COD-only to `{ isPickupStage, hasStops, fullyCollected }` — the pickup gate now blocks **prepaid** group orders too (stops-driven, not COD-driven); `pickup-route.ts` + `stop-arrival.ts` status unions widened to `'pending' | 'collected'`.
- **Frontend — context** (`RiderActiveTripContext.tsx`): one unified query `['rider-delivery-pickup-stops', id]` (shares the map's cache key, no duplicate requests) replaces the old purchases gate; `confirmPickupStop` → canonical POST + refetch; `/rider/deliveries/active` poll drives `pendingSettlement` (a `delivered` + `is_cod` row — the map poll drops `delivered`, the active list keeps COD pending settlement) and `settleCod` → POST `/settle-cod` (invalidates active + map-location, re-fetches `/user` to reconcile rider release).
- **Frontend — UI**: `RiderMap.tsx` rebuilt around `pickupStopsData` — "Pickup Stops · X/Y confirmed" panel with per-stop Confirm Item Pickup (enabled when `stop.can_confirm || (arrivedAtStop && stop.is_ready)`, ready chip, items, reason label; Buy/Collect legacy buttons removed), route box now shown for COD and prepaid; `GlobalRiderAlert.tsx` gained the "Payment settled?" dark overlay (COD cash entry keyed to `cash_due`, exact-amount + change preview, `settleBusy`/`settleError`, disabled until received ≥ due) — fires only for COD because prepaid completes on the backend at `delivered`.
- **Tests** — new `frontend/tests/ui/rider-pickup-stops-flow.test.tsx` (3): gate stays shut until every stop is confirmed (prepaid, patch never fires), confirm posts then refetch opens the gate, delivered-unsettled COD surfaces the payment step + `/settle-cod` posts, delivered prepaid shows none. `rider-pickup-gate.test.ts` reconciled to the hasStops contract (prepaid groups now blocked) per §12 drift rules — old `isCod` input removed.
- **Checkpoint**: full Laravel suite **508 passed / 7 skipped (known env: 5 GD + 2 SQLite-only) / 0 failures / 2,787 assertions**. Frontend UI **74 passed / 11 files / 0 failures**; `vite build` clean; `tsc --noEmit` clean for all changed rider files (remaining repo tsc noise is pre-existing and unrelated to the Vite build); `oxlint` on changed files shows only the pre-existing structural `only-export-components` warning.

## Rider Drop-Off Route Draws Instantly on Pickup Confirm — Fixed (2026-09-24)

Requirement: after confirming pickup, the map must show the route to the destination drop-off location the **moment** the rider taps confirm. The drop leg already existed (`RiderMap.tsx` `isDropLeg` → `useOsrmRoute` polyline), but `tripState` derived only from the server-polled `activeDelivery.status` (10 s poll + refetch round-trip), so the route lagged behind the confirm tap.

- **Fix A — `frontend/src/features/rider/context/RiderActiveTripContext.tsx`**: added an optimistic `picked_up` override. `pickupMutation.onMutate` sets `optimisticStatus = 'picked_up'` the instant `onMarkPickedUp()` runs (both the global arrival alert and the map purchasing panel call it); `tripState` now derives from `effectiveStatus = optimisticStatus ?? activeDelivery.status`, so `OUT_FOR_DELIVERY` (the drop leg + "Delivering" cockpit) is reached synchronously. `onError` reverts to the server truth on rejection (e.g. COD gate 422). A reconciliation effect clears the override once the authoritative status reflects the pickup or the trip ends — no gap in between. Server status stays authoritative everywhere else (arrival alerts still fire only from real status/`nearDropoff`; the map purchases panel still gates on real `isPickupStage`). Also cleaned the pre-existing unused `id` param in `completeMutation.onSuccess`.
- **Fix B — `frontend/src/features/rider/components/GlobalRiderAlert.tsx`**: the exit-animation confirm label no longer infers the leg from `tripState` (which now advances optimistically); it retains the alert kind that triggered the exit (`exitAlertKind`), so the 260 ms exit still correctly shows the pickup label.
- **Tests** — new `frontend/tests/ui/rider-optimistic-pickup-route.test.tsx` (3 tests) exercising the real provider through a mocked api: (1) flips to `OUT_FOR_DELIVERY` while the confirm PATCH is deliberately held in flight (proves the optimistic path, not the poll); (2) stays `OUT_FOR_DELIVERY` after the authoritative poll reports `picked_up`; (3) reverts to `ARRIVED_AT_PICKUP` on server rejection.
- **Checkpoint**: frontend UI **39 passed / 7 files / 0 failures**; `vite build` clean (only pre-existing chunk-size warning); `oxlint` on changed files reports only the pre-existing structural `only-export-components` warning (hook + component co-export, intentional). Backend untouched this task.

## Deployment Prep — Vercel (FRONTEND) + Railway (LARAVEL / SOCKET / MYSQL) — Ready (2026-09-24)

Made the project deployable in the requested split: **react SPA → Vercel**, **Laravel API + scheduler + queue worker + Socket.IO + MySQL → Railway**. Vercel cannot run PHP/MySQL/WebSockets, so the backend and realtime engine live on Railway (managed services).

- **Frontend (`frontend/`)**: `src/shared/services/api.ts` `baseURL` is now `VITE_API_URL || '/api'`; `src/shared/utils/index.ts` asset origin falls back to `VITE_API_URL`. Added `frontend/vercel.json` (SPA fallback rewrite, Vite build/output) and `frontend/.env.example` (`VITE_API_URL`, `VITE_SOCKET_URL`, `VITE_PAYMONGO_PUBLIC_KEY`, `VITE_API_ORIGIN`). `.env` files remain untracked — no secrets reach Vercel.
- **Laravel API (repo root)**: `Dockerfile` (PHP 8.2 + Apache + GD/zip/intl/curl + tesseract OCR) with `docker/apache-vhost.conf`, `docker/supervisord.conf` (Apache + `schedule:work` + `queue:work database`), `docker/start-container.sh` (waits for MySQL, `migrate --force`, `storage:link`, package discover, key generate-if-missing), `docker/opcache.ini`. `.env.example` gained a Deployment block (`FRONTEND_URL`, `SANCTUM_STATEFUL_DOMAINS`, Railway var list).
- **Socket.IO**: `Dockerfile.socket` (node:22-alpine, `socket.io` only, exposes 3001 browsers / 3002 Laravel bridge; shared `SOCKET_BRIDGE_SECRET`).
- **Docs**: `docs/DEPLOYMENT.md` — step-by-step Railway (MySQL data service, API, socket) + Vercel setup, env tables, PayMongo webhook URL, uploads volume, verification checklist.
- **Tests**: socket JS **45/45 pass**; frontend `vite build` clean; `npm run lint` clean of new violations (pre-existing warnings only). Full Laravel suite **478 passed / 7 skipped (known env) / 0 failures / 2,532 assertions** — no runtime PHP code touched.
- **Required at deploy time** (no code): set `VITE_*` on Vercel; set `APP_KEY/DB_*/PAYMONGO/SOCKET_*` on Railway; PayMongo webhook → API `/api/payments/webhook`; volume at `/var/www/html/storage/app/public` for uploads; seed base data if empty DB.

## Rider Still No Ping — Scheduler Not Running + Transport Retry Dead-End — Fixed (2026-09-24)

Reported: rider #14 (now on `food`, available, fresh GPS) still received no order-delivery alert. Investigation found **two distinct blockers** beyond eligibility:

1. **The Laravel scheduler was not running** on the dev box. A checkout-time dispatch failure parks the delivery at `no_rider_available` + `dispatch_retry_at` (`NearestRiderService::parkForRetry`), and only the `Schedule::command(DispatchScheduledDeliveries)` loop (`routes/console.php`) retries it. With `schedule:work`/cron absent, delivery #12 (food, `waiting_restaurant`) sat parked at retry_at 07:40 with `dispatch_attempts=0` at 08:24 — so when rider #14 came online at 08:05, no retry ever re-pinged him. `no_rider_available` is a retryable park, not terminal (`dispatch_failed`, 60-min cycle deadline, is terminal).
2. **Transport (ride-hailing) retries dead-ended in the scheduler.** `ScheduledDispatchProcessor::DISPATCHABLE_ORDER_STATUSES` only accepted `waiting_restaurant/accepted/preparing/ready`, but transport orders live at `pending` for their whole rider-wait — so a transport delivery that missed the instantaneous checkout dispatch could never be re-offered (delivery #13, order `pending`, parked forever). Additionally `processDelivery` hard-coded `'food'` as the dispatch service type, so even if selected, a transport retry polled the wrong rider cohort.

- **Fix A — `app/Services/ScheduledDispatchProcessor.php`**: new `orderIsDispatchable()` accepts a transport order in `pending` alongside the restaurant statuses; `processDelivery` now derives the service type from the order (`transport` vs `food`) so a ride retry offers its own rider cohort. `dueDeliveryIds()` `whereHas` mirrors the transport-`pending` rule.
- **Fix B — operational**: started `php artisan schedule:work` (background, PID recorded at time of fix) so the parked-retry loop actually runs; rider #14 brought online with `current_service=food`. Immediate `php artisan schedule:dispatch` pass: delivery #12 → `notified` with a `pending` offer (#39, 1.278 km) for rider 14 (`[COD Dispatch] delivery=12 eligible riders=1 riders=[14]`). Transport delivery #13 retried with its own cohort (`eligible riders=0`: rider 18/20 stale/offline, 14 on food).
- **Tests** — `tests/Feature/DispatchNoRiderRetryTest.php` +2: parked transport delivery is retried and offered to a **transport** rider only (food rider untouched); a `pending` transport order does not leak into food selection (a `pending` food order is still never dispatched; `waiting_restaurant` retries).
- **Checkpoint**: full Laravel suite **473 passed / 7 skipped (known env) / 0 failures / 2,493 assertions**. No schema or frontend changes.
- **Notes**: a rider must be (a) online, (b) on the service the order uses, and (c) within the COD GPS/radius gates for a ping. The scheduler must stay running for parked-retry recovery.

## Stationary Heartbeat Now Refreshes `recorded_at` — Fixed (2026-09-24)

A successful `POST /api/rider/map/location` returning `{ moved: false, interval: 30, delivery: null }` revealed dead code in the heartbeat feature. `RiderMapController::updateLocation` had an early return for movement < 5 m (`RiderMapController.php:139`) that skipped persistence entirely. A stationary but **online** rider therefore never refreshed `rider_locations.recorded_at`, and after `cod_location_max_age_minutes` (5 min) was silently dropped from COD eligibility and radar as `gps_stale` (`NearestRiderService.php:156`, `:1625`) — the exact GPS-freshness failure the 60 s heartbeat was built to prevent. One extra latent bug made it worse: `LocationPersistenceService::shouldSave` computed `elapsed` as a **signed** `diffInSeconds` (`now() - past` is negative under Carbon 3), so the `elapsed >= checkpoint_seconds` checkpoint was never true on any real path.

- **Fix A — `app/Http/Controllers/Rider/RiderMapController.php`**: the `< 5 m` branch now persists an elapsed-based checkpoint (`shouldSave`) when the last fix is older than `tracking.checkpoint_seconds` and accuracy is acceptable (≤ 50 m). Response contract unchanged (`moved: false`). Stationary online riders now stay fresh → never age out; a rider who was away for > 2 min and returns to the same spot also recovers immediately. Writes are bounded to ≈ 1 row/min while stationary (`CleanupRiderLocations` purges > 30 days).
- **Fix B — `app/Services/LocationPersistenceService.php`**: `elapsed` now uses `abs()` so the elapsed checkpoint is a true duration.
- **Tests** — `tests/Feature/GpsIntegrityTest.php` +3: stationary heartbeat refreshes `recorded_at` (checkpoint persisted, `moved: false`); stationary fix inside the checkpoint window does not write; stationary low-accuracy fix does not write.
- **Checkpoint**: full Laravel suite **471 passed / 7 skipped (known env: 5 GD + 2 SQLite-only) / 0 failures / 2,483 assertions**. No schema or frontend changes.

## Business Registration Wizard Black Band at Bottom — Fixed (2026-09-24)

Reported: black content at the bottom of the wizard registration form on
Business Registration (Register New Business wizard) at steps 5 (Documents &
Registration) and 6 (Review & Submit).

- **Root cause**: `frontend/index.html` styled `html, body { background-color: #0F172A }`
  (dark navy). The dashboard layout root is `h-[100dvh]` with `tourism-bg`
  (`#F7FAF7`), and `main` scrolls internally, so the dark body is normally
  covered. Steps 5 and 6 are the tallest wizard steps; when the page layout
  lets the window scroll past the viewport-height root (body-reveal condition),
  the dark navy body shows as a black band at the bottom of the form.
- **Verification of mechanism**: headless Chrome + CDP pixel analysis of the
  live dev server. Normal layout: 0 dark `#0F172A` pixels at scroll top/bottom
  on steps 5 and 6. Forced window-scroll overflow past the `100vh` root:
  **38,726 dark pixels** at the bottom; same condition with body background
  patched to `#F7FAF7`: **0 dark pixels**.
- **Fix** (`frontend/index.html`): body background changed to the app's actual
  light theme, `#F7FAF7` (matches `.tourism-bg` / `--color-tourism-bg`). Any
  future body-reveal now renders light instead of black. No component-level
  dark-mode styles exist (`dark:` variant is unused), so `class="dark"` on
  `<html>` remains inert and untouched.
- **Checkpoint**: frontend UI **23/23 passed**; `vite build` (regeneration of
  `frontend/dist`) not required for dev; re-run the Laravel-side `npm run build`
  only if the production `public/build` frontend needs the same change.
- **Deferred**: regenerating the production build artifacts is optional.

---

## Refresh/Load Auto-Logout & Dead-Token Recovery — Fixed (2026-09-24)

Follow-up to the earlier "Frontier 401 Logout Hardening". A rider whose token died **mid-session** (DB reseed, revoked in another tab/device) sat on the map with every poll 401ing (`/api/rider/map/location ... 401` in the console), then appeared to be "logged out on refresh/load" — because the authoritative `/user` check only ran at boot (`AuthInitializer`), so the first refresh finally surfaced the dead token and cleared it. Additionally, a **transient** boot `/user` failure (slow dev server / 5xx / network drop) kept the live token on disk but left `user=null`, and `ProtectedRoute` still bounced the user to `/login` — a false logout with a valid session.

- **Fix A — `frontend/src/shared/services/api.ts`**: a 401 from a **non-identity** endpoint still never wipes the token or dispatches `auth:logout` (hardening preserved), but now it schedules a debounced (150 ms) `auth:revalidate` check against the authoritative `/user` endpoint. A fluke 401 re-validates cleanly (no logout); a genuinely dead token clears exactly where it must.
- **Fix B — `frontend/src/app/App.tsx`**: `AuthEventHandler` now listens for `auth:revalidate` → `fetchUser()`. `/user` confirms the session, so the rider recovers at the first 401 instead of lingering on a stuck map and being surprised at next refresh.
- **Fix C — `frontend/src/shared/components/ProtectedRoute.tsx`**: the app never redirects to `/login` while a token is still stored. While `loading` — or a token exists but `/user` has not confirmed the user (transient boot failure) — it keeps the session spinner and retries `/user` in the background (bounded: max 5 retries @ 2.5 s). `/login` is only reached with no token (definitive logout) or after `/user` itself returns 401 and clears the token.
- **Tests**: new `frontend/tests/ui/auth-session-revalidation.test.tsx` (6 tests) driving the REAL api interceptor through a canned axios adapter — non-session 401 does not logout but schedules `auth:revalidate`; fluke 401 + valid `/user` reconciles without logout; `/user` 401 still ends the session and clears the token; no-token 401 dispatches nothing; `fetchUser` clears only on `/user` 401; transient `/user` failure keeps the stored token.
- **Checkpoint**: frontend UI **23/23 passed** (17 pre-existing + 6 new); `vite build` clean; `oxlint` no new findings (2 pre-existing unused-var warnings in `App.tsx` remain, untouched). Backend untouched — no Laravel changes.

---

## Stale-Credential 401 Guard & Session-Race Revalidation Hardening — Complete (2026-09-25)

Continued rider auto-logout reports (`POST /api/rider/map/location` and `GET /api/user` showing 401 while the rider is still logged in). Empirical backend probe (`tmp_auth_probe.php`, since removed) exonerated the server: with a fresh rider token, `/api/user`, `GET`/`POST /api/rider/map/location`, `/api/rider/deliveries/12/pickup-stops`, `/api/rider/deliveries/active`, and `/api/rider/dispatch/offers` all return 200 through the same XAMPP Apache target the browser uses. The tracked symptom is **the browser holding a credential whose personal_access_tokens row is already gone server-side** (token deleted/reseeded/orphaned — the DB contained orphaned tokens pointing at deleted users), plus the **stale-credential race**: an in-flight request still carrying the OLD token resolves a 401 only after a NEWER login already wrote a fresh token over the shared localStorage. The 401 describes the OLD credential and previously looked like a mid-use logout of a live session.

- **Fix A — `frontend/src/shared/services/api.ts`**: the request interceptor now stamps `_presentedToken` on every request. On a 401 from the identity endpoints (`/user`, `/logout`), the token is cleared + `auth:logout` dispatched **only when the presented token is the token still stored** (the definitive session). A 401 for a stale credential is ignored (the fresh session stays authoritative); a 401 with nothing on disk ends the phantom in-memory session (cross-tab logout case).
- **Fix B — `frontend/src/features/auth/services/auth-store.ts`**: `fetchUser` clears on `/user` 401 only when the on-disk credential is the same one that was checked (or already cleared by the interceptor), never when a newer login replaced it.
- **Tests**: `frontend/tests/ui/auth-session-revalidation.test.tsx` extended (9 total) — stale `/user` 401 after a re-login must not end the fresh session; stale non-session 401 only revalidates the fresh token; `fetchUser` ignores a 401 for a credential a newer login replaced.
- **Test-isolation fix**: the file drives the real interceptor through canned adapters on a shared jsdom `window`; a functional `auth:revalidate` listener leaked from one test into later tests and caused a spurious `auth:logout` (the failing test's `logoutSpy` fired). Listeners are now registered through `listen`/`listenFn` and removed in `afterEach`.
- **Verification**: live probe confirmed fresh tokens get 200 for every endpoint in the complaint. `npm run test:ui`: **82/82 passed** (13 files). Backend untouched — no Laravel changes.

---

## Cross-Role Auto-Logout Audit — Complete (2026-09-25)

Project-wide sweep ("fix it across the project, check different users") for role-specific paths that still force a logout / `/login` redirect outside the hardened session rules, in each user type: tourist, business owner, rider, tourism-office admin, and staff.

### Audit result
- **Backend**: only `AuthController::logout` revokes tokens; nothing force-logs-out any role server-side. `CheckRole`/`role:` gates return 403 (not 401), which the interceptor never treats as logout. Admin user deletion cascades tokens (the orphan-token case surfaced earlier) — but that is data churn, not a logout feature.
- **Rider / business-owner / admin / staff**: all `navigate('/login')` sites (`DashboardLayout`, `TouristSidebar`/`Header`, `TouristProfile`, `BusinessOwnerAccountStatus`, `ResetPasswordPage`) are explicit Logout button handlers or post-action redirects; the only real 401 checks in the app are in `api.ts`, `auth-store.ts`, and `TouristFoodCart.tsx`. No false-logout path exists in these roles.
- **Tourist (the bug)**: `TouristFoodCart` checkout `onError` treated ANY 401 as a hard `logout()` + `navigate('/login')` — bypassing the hardened interceptor. A stale-credential 401 (in-flight checkout carrying the pre-re-login token) or a transient dead-token 401 at checkout would boot a LIVE tourist session straight to `/login`. This was the one remaining auto-logout outside the canonical path.

### Fixes
- **`frontend/src/features/tourist/pages/TouristFoodCart.tsx`**:
  - checkout `onError`: a 401 now surfaces the server message instead of calling `logout()`/`navigate('/login')`; the interceptor's debounced `/user` revalidation is the only thing that may end the session (a confirmed-dead credential still logs out ~150 ms later through the canonical path).
  - checkout button gate: `!user && !authToken` → genuine guest → save pending order, `logout()`, go to `/login`. `!user && authToken` (credential present, profile unconfirmed) → block with a "session is still loading" message and NEVER destroy the token.
- **`frontend/src/shared/hooks/use-require-auth.ts`**: only a true guest (no credential on disk) is bounced to `/login`; a live credential with an unconfirmed profile blocks the action without navigating (so it never presents as an auto-logout).
- **Tests**: `frontend/tests/ui/tourist-checkout-401-keeps-session.test.tsx` (3 tests — checkout 401 keeps token/user/route and never calls `/logout`; transient 401 + successful retry recovers; genuine guest still goes to `/login` with the pending order saved) and `frontend/tests/ui/use-require-auth.test.tsx` (3 tests — guest redirects with pending action; credential-but-unconfirmed blocks without navigational; confirmed user passes).
- **Checkpoint**: frontend UI **88/88 passed** (15 files); `vite build` clean; `oxlint` no NEW findings (pre-existing warnings/errors in untouched files remain). Backend untouched — no Laravel changes.

---

## Cross-Role Auto-Logout Verification — All Roles Probed (2026-09-25)

"Test all users for the auto-logout bug" — both sides of the contract verified for EVERY role: **tourist, business_owner, rider, staff, tourism_office, bansud_tourism_office**.

### Backend live probe (all 6 roles)
Probe script hit the real XAMPP Apache target per role with a freshly created token:
- `/user` + the role's own endpoint all return **200** while the token row exists (session is never auto-logged-out server-side; correct role gates pass).
- After the token row is deleted, `/user` returns **401** — proving the ONLY legitimate cause of "unauthorized while still on the page" is the credential being gone (revoked/reseeded/orphaned), and it is identical for every role.
- Endpoints probed: tourist `/tourist/food`, business_owner `/business-owner/profile`, rider `/rider/deliveries/active`, staff `/staff/dashboard`, tourism_office `/tourism-office/municipalities`, bansud_tourism_office `/admin/roles`. Synthetic staff/tourism-office probe users and their tokens were removed by the script; verified no DB residue. Result: **6/6 roles, 0 auto-logout.**
- Note: staff and tourism-office users do not exist in the dev DB yet (only tourist/business_owner/rider are seeded); the probe exercised them via transient rows.

### Frontend regression suite
New `frontend/tests/ui/auth-role-session-401.test.tsx` — drives the REAL api interceptor through canned adapters for all six roles (18 tests = 6 roles × 3 contracts):
- a 401 on that role's own endpoint (`/tourist/food`, `/business-owner/dashboard`, `/rider/map/location`, `/staff/dashboard`, `/tourism-office/dashboard`, `/admin/dashboard`) never logs out — token + user survive, debounced `auth:revalidate` is scheduled;
- only a `/user` 401 definitively ends that role's session (token cleared + `auth:logout`);
- a stale `/user` 401 arriving after a re-login never boots the role's fresh session.
- Together with the tourist cart + use-require-auth + interceptor suites, the session contracts are proven identical across every user role.

### Checkpoint
Frontend UI **111/111 passed** (16 files); `vite build` clean; `oxlint` no new findings. Backend unchanged — verification probes only. No production code changed in this pass (only a dead `CART_VERSION` constant removed from `TouristFoodCart.tsx`).

---

## Ordering Flow → Dispatch Ping → Rider UI — Frontend Regression Coverage (2026-09-24)

Frontend UI test coverage for the tourist-ordering → rider-ping path (both `cash/COD` and `gcash/PayMongo` dispatch emit the same `order_received_ping` socket event; both were previously verified end-to-end in backend tests). These tests prove the rider **renders** the incoming-order UI, not just that the backend emits an event.

- **Test runner added**: `vitest@5.0.1` + `jsdom` + `@testing-library/react/jest-dom/user-event` (dev deps). New `frontend/vitest.config.ts` (jsdom, globals, `@`→`./src`, `tests/ui/**`), `frontend/src/test/setup.ts` (jest-dom + cleanup + geolocation stub), `npm run test:ui` script.
- **17 UI tests** (`frontend/tests/ui/`):
  - `rider-delivery-request-alert.test.tsx` — the "New Order" card itself (no data → nothing; full order details; Accept/Decline callbacks; auto-decline on offer expiry).
  - `use-rider-socket-receiver.test.tsx` — `order_received_ping` / `delivery_offer_cancelled` / `trip_cancelled` delivery; `driver_go_online` radar registration on (re)connect; Null Island (0,0) fixes never registered.
  - `rider-dispatch-notification.test.tsx` — end-to-end React flow: socket ping → state → "Request Incoming" drawer → receipt card with order details + Accept → `PATCH /rider/dispatch/accept` called + "Order Accepted" confirmation; **HTTP polling recovery** (no socket ping, offers poll surfaces the same card and accept works); **duplicate pings never create a second card**; wrong-rider isolation (empty offers → nothing renders even on a stray ping).
- **Checkpoint**: UI **17/17 passed**; socket JS **45/45 passed**; full Laravel suite unchanged **468 tests / 2,474 assertions / 0 failures / 7 skipped** (7 = known env skips); frontend `vite build` clean. No production app code was modified — the ping→accept flow itself was already canonical and is now UI-proven.

---

## Tourist Area Reliability & Contract Normalization — Complete (2026-09-24)

Batch of targeted tourist-area hardening fixes covering backend 500s, offering-status vocabulary consistency, landing-map data, auth-scoped booking details, and frontend alignment with the real API envelopes.

- **Backend 500s fixed**: `EventShowController` now queries `App\Models\TourismEvent` (was `Event`) so event detail no longer 500s; `ExploreController::index` removed an invalid `media` eager-load on `TourismEvent` (was also a 500 path).
- **Offering status vocabulary canonicalized**: canonical statuses are `available / unavailable / hidden`. Tourist filters (`FoodController::index`, `ExploreController` food business/counts/first-offering/`for You`) now filter `status='available'`; legacy writers that emitted `'active'` (`BusinessOwnerMenuManageController`, `BusinessOwnerFoodController`, `StaffMenuController`) now write `'available'`. New data migration `2026_09_24_000002_normalize_offering_status_vocabulary` maps legacy `offering.status='active'` → `'available'` (down() is an intentional documented no-op because rows are no longer identifiable). `staff.status='active'` and `TouristDestination.status='active'` are separate vocabularies and untouched.
- **Landing map**: `landingMap` select now includes `status` so `is_accepting_orders` computes correctly for approved businesses, and the map menu query filters `status='available'`.
- **Booking detail**: new auth-scoped `BookingController::detail` (`GET /api/tourist/booking/{id}/detail`) returns `{booking}` with `business`; scoping is `customer_email = Auth::user()->email`, other users get 404. Route registered before `/booking/{business}` to avoid binding conflicts.
- **Favorites**: index eager-loads `favoritable.category` and `favoritable.municipality` so the tourist UI can render the saved business's category/municipality.
- **Frontend envelope alignment** (standardized readers to real backend payloads): TouristEvents (`data.events` + mapping), TouristFavorites (`data.favorites` + favoritable mapping), TouristStays (`{accommodations, rentals}` merge), TouristBooking My-Bookings tab (`/tourist/history?tab=bookings` → `data.bookings.data`), TouristBookingShow (`/booking/{id}/detail` → `data.booking`, nested business), TouristFoodShow (top-level `menu_items` + `isFavorited`), TouristNotifications (`data.notifications`).
- **Frontend runtime/compile fixes**: `TouristExploreMap` removed a nested `useEffect` inside `.then()` (rules-of-hooks violation) — pending-destination effect is now top-level; `App.tsx` renders the existing `SessionTimeoutHandler` (imports + mount were missing).
- **Tests**: `TouristApiTest` +13 tests / 59 assertions covering explore-with-events, event detail, canonical food filter (legacy `active` offering excluded), favorites/notifications/stays/bookings envelopes, booking-detail owner scoping (+ 404 for another user), and landing-map accepting-orders.
- **Checkpoint**: full Laravel suite **468 tests / 2,474 assertions / 0 failures / 7 skipped** (known env skips). Frontend `vite build` clean; `oxlint` produced no new findings (2 pre-existing rules-of-hooks errors in untouched `BusinessOwnerBookingCalendar.tsx`). Migration `2026_09_24_000002` runs in the full suite; the dev MySQL DB `track_tour_db` is not present in this environment (`Unknown database`), so the data-migration write-probe against dev MySQL could not be performed here — re-run `php artisan migrate` on the dev DB when it is available.

---

## Frontier 401 Logout Hardening — Complete (2026-09-24)

Riders were being logged out (redirected to `/login`) when clicking **Go Online / Go Offline**. Browser console showed `api/rider/map/location ... 401`.

- **Root cause**: the shared `api.ts` response interceptor treated **any** single 401 as a session-ending event — it removed `auth_token` and dispatched `auth:logout`, which `App.tsx` listens for to navigate to `/login`. The backend was exonerated empirically: with a fresh rider token, `GET /api/user`, `POST /api/rider/availability/toggle`, and `GET`/`POST /api/rider/map/location` all return 200 through the same Vite proxy the browser uses. A single stale/errored request (e.g. the heartbeat `location` post racing the optimistic toggle + `navigate('/rider/map')`) destroyed the whole session.
- **Fix** (`frontend/src/shared/services/api.ts`): only a 401 from the authoritative identity endpoint (`/user`, `/logout`) ends the session. A 401 from any other endpoint now just rejects the promise to the caller — it no longer wipes the token or dispatches `auth:logout`. Genuine logout is preserved: the next `fetchUser()` / `GET /user` call surfaces a dead token and clears it (`auth-store.fetchUser` already only treats `/user` 401 as logout).
- **Recovery**: `fetchUser()` reconciliation points already exist at boot (`providers.tsx`), toggle error, trip-end, dispatch notifications, and profile pages, so a truly revoked token still logs the rider out through `/user`.
- **Verification**: `npm run build` clean; `oxlint` no new findings (pre-existing warnings remain unrelated); no code depends on `auth:logout` being dispatched from arbitrary 401s (only `App.tsx` listens). Backend untouched — full Laravel suite **452 tests / 2,383 assertions / 0 failures / 7 skipped** (7 = known env skips).

---

## COD & GCash Lifecycle Audit — POS Readiness Check (2026-09-24)

Read-only end-to-end verification of the two authoritative "paid" sinks that feed POS & SALES, before building the operational payment views (COD Settlement / Online Payments tabs).

### Verified correct

- **COD**: order -> dispatch -> rider accept -> delivered -> `POST /rider/deliveries/{delivery}/settle-cod` -> `NearestRiderService::settleCodDelivery` creates a `payments` row (`method='cash'`, `provider='rider'`, `status='paid'`, `paid_at=now()`), sets order `payment_status='paid'` + `status='completed'`, records `cod_settlements` 80/20 per business + `order_settlements` + rider earning, all inside one delivery row-locked transaction. Single settlement trigger is the rider's own confirm; no staff/admin confirm endpoint exists.
- **GCash**: order created first (`payment_status='pending'`) -> `createIntent` writes `payments` row (`method='gcash'`, `provider='paymongo'`, `status='pending'`, `provider_payment_id=cs_*`) -> PayMongo webhook (`payment.paid`/`checkout_session.*`) -> `markPayablePaid` sets `status='paid'` + `provider_source_id`, promotes the order, dispatches. Idempotent via `payment_webhook_events.provider_event_id` UNIQUE + payment row locks; failed can never downgrade paid.
- **POS alignment**: `methodExpr` maps stored `'cash'` -> `cod`, `'gcash'` -> `gcash`; `paidAtExpr` reads `payments.paid_at` (stamped by both sinks); `NON_SALE_STATUSES` excludes `cancelled/cancelled_by_tourist/rejected/refunded`. Group checkout = one canonical order -> one POS transaction (correct). Targeted lifecycle tests: **35 tests / 268 assertions passed** (SettleCod/CodSettlement/PaymentIdempotency/`AdminPosSales`).

### Findings / gaps (documented, NOT fixed here)

1. **No staff-confirm step**: the architecture's "Staff confirms" leg does not exist — the rider is the sole self-attesting COD trigger. No tourism-office/staff endpoint confirms cash receipt or triggers settlement.
2. **Stuck COD is permanent**: a delivered-but-unsettled COD order parks at `delivered`+`cash_due`+busy rider forever; `AutoCancelUndeliveredOrder` excludes `delivered` and only scans `payment_status='paid'`. No timeout/reconciliation. Prior probe `tmp_stuck_cod_audit.php` (repo root) confirms this state was already under investigation.
3. **Group COD: `group_checkouts.payment_status` never becomes `'paid'`** (`settleCodDelivery` updates child orders only), so `OrderResource.group_paid` is always false for paid COD groups — a drill-through/ledger blind spot, though POS (which reads the canonical order) is unaffected.
4. **COD `payments.amount` = full order total** (incl. delivery fee + tip) while `cod_settlements.settlement_base` = rider-financed subtotal+. Two different bases; POS reports them separately — any new UI must not conflate them.
5. **Transport/ride cash orders flow into COD settlement** with `rider_financed_amount=0` and hardcoded `business_id=1` (`TransportationService`), so `recordAllocations` falls back to subtotal as base — transport fares can pollute restaurant COD settlement ledger/reports.
6. **COD payment idempotency is lock-reliant** (delivery row lock), not DB-enforced via a unique constraint.

### Recommendation

Verified the lifecycle before adding UI as requested. Safe to build the read-only **COD Settlement** (Awaiting = delivered+COD+unsettled; Settled = `cod_settlements` rows) and **Online Payments** (from `payments` ledger) views now, provided COD settlement mutation stays in the existing settlement module — POS remains read-only. Items 1–6 are tracked here for the Admin operational phase; none blocks the read-only POS & Sales module.

---

## Admin POS & Sales Module — Complete (2026-09-24)
A multi-role tourism management platform built with **Laravel 12** (PHP 8.2), **Tailwind CSS 3**, **Alpine.js**, **MySQL** (via XAMPP), and **Firebase** (FCM for real-time notifications). The system serves five user roles: **Tourist**, **Business Owner**, **Rider**, **Staff**, and **Tourism Office/Bansud Admin**.

---

## Admin POS & Sales Module — Complete (2026-09-24)

Read-only **POS & SALES** monitoring surface for the Tourism Office (Admin module Phase 4 financial-monitoring scope entry). A "sale" is an `Order` with `payment_status = 'paid'` whose status is not `cancelled`, `cancelled_by_tourist`, `rejected`, or `refunded`. The module never mutates money state — it only aggregates the canonical `payments` ledger (`PaymentController::markPayablePaid` for GCash, provider `paymongo`; `NearestRiderService::settleCodDelivery` for COD, provider `rider`) and the `cod_settlements` 80/20 split.

- **Backend**: new `AdminPosSalesController` (`GET /api/admin/pos/sales`, `.../sales/summary`, `.../sales/transactions`, `.../sales/by-business`, `.../sales/trend`, all under the existing `role:bansud_tourism_office` admin group). Periods: `today|yesterday|weekly|monthly|yearly|all` plus `from`/`to`. Paid-at derived via `COALESCE(MAX(payments.paid_at WHERE status='paid'), completed_at, acceptance_started_at, updated_at)`; method classified as `cod`/`gcash`/`unmarked`.
- **Frontend**: `AdminPosSales.tsx` at `/admin/pos` ("Sales & POS" nav section): KPI cards, period selector, payment-method bars, order-status funnel, CSS trend chart, sales-by-restaurant, and a filterable/paginated transactions table; wired through `API_ENDPOINTS.ADMIN.POS*`. `vite build` clean.
- **Tests**: `AdminPosSalesApiTest` +9 (RBAC 403, paid-only aggregation, summary KPIs, ledger filters, by-business split, COD platform revenue, trend day buckets, read-only no-mutation). Money assertions cast to `(float)` because PHP json serializes whole floats as ints.
- **Checkpoint**: full Laravel suite **440 tests / 2,336 assertions / 0 failures / 7 skipped** (7 = known env skips: 5 GD, 2 SQLite-only); frontend build clean; the 6 new `tsc --noEmit` strict-null errors in `AdminPosSales.tsx` fixed (`Record<string, T>` lookups made concrete via `FALLBACK_METHOD_COLOR` and `?? 0`).

---

## Rider Profile Photo (Avatar) — Complete (2026-09-24)

Riders can now upload a profile picture that replaces the initials avatar across the app (rider profile page, shared dashboard header/sidebar, bottom nav).

- **Schema**: `2026_09_24_000001_add_avatar_to_user_profiles_table` adds `user_profiles.avatar` (string, nullable) — applied to the dev MySQL DB.
- **Backend**: `RiderProfileController::uploadPhoto` (`POST /api/rider/profile/photo`, field `photo`, `image|max:2048`) stores to the `public` disk under `profiles/`, deletes the previous avatar on replace, and returns the canonical `UserResource`; `UserResource.profile_photo` maps `$profile?->avatar`.
- **Frontend**: `RiderProfile.tsx` avatar upload UI (camera button + live preview + save); `DashboardLayout.tsx` renders the photo when present with initials fallback.
- **Tests**: `RiderApiTest` +4 (upload success, invalid-file 422, replace-deletes-old, non-rider 403) — PNG fixture works without the GD extension.
- **Checkpoint**: full Laravel suite **424 tests / 2,211 assertions / 0 failures / 7 skipped** (7 = known env skips: 5 GD, 2 SQLite-only).

---

## Delivery Pipeline Roadmap (P1–P10)

Checkpoint log for the multi-restaurant delivery architecture work.

### Multi-Restaurant Canonical Order Correction — Implemented

The grouped checkout flow now creates **one canonical `orders` row per tourist checkout**, with restaurant ownership carried by `order_items.business_id`. The order owns one delivery fee, one shared delivery, and one rider; participating restaurants retain independent item preparation/readiness groups inside that order. The shared delivery references the canonical order and the realtime bridge fans status events to every participating business room.

- Added `order_items.business_id` with an index and item/business API exposure.
- Group checkout creation now calculates one delivery fee and one aggregate order total.
- Business-owner order access is item-aware so each participating restaurant can manage its own order items.
- Tourist checkout and tracking now show one rider, one delivery route, and multiple restaurant pickup stops.
- Focused verification: **38 tests / 479 assertions / 0 failures** across group creation, shared delivery lifecycle, rider gate, COD settlement, and realtime fan-out.
- Legacy child-order tests were reconciled to the canonical order contract.

### Rider-Credit System Removal: Complete & Verified

The prepaid rider-credit wallet no longer exists anywhere in the codebase or database. COD is now **credit-free**: no rider balance is checked, reserved, or deducted for COD eligibility or settlement, and the rider-credit code was removed end-to-end.

- **Removed from disk**: `RiderCredit`, `RiderCreditTransaction`, `RiderTopUp` models; `RiderCreditService`; `AdminCreditsController`, `RiderCreditController`; frontend `AdminCredits`, `RiderCreditActivity`, `RiderCreditDetails`, `RiderWallet`, `TopUpSuccess` pages + their routes/nav.
- **Schema (verified + applied)**: `2026_09_22_000003_remove_rider_credit_system` drops `rider_top_ups`, `rider_credit_transactions`, `rider_credits` and `deliveries.cod_credit_reserved`. Confirmed in the live MySQL DB: all credit tables and the credit-reserve column are gone; the `cod_settlements`, `rider_payouts`, `restaurant_wallet*`, `order_settlements` ledgers and `payment_webhook_events` remain intact.
- **Grep-verified**: zero references to rider credits in `app/`, `routes/`, or `frontend/src/`; dead `/rider/wallet` UI entries removed (`RiderMap` earnings panel + `DashboardLayout` bottom nav) and `vite build` passes.
- **Test reconciliation** (drift, per AGENTS §12): `RealtimeCompletenessTest`/`RestaurantSubOrderItemsLifecycleTest` dropped `RiderCredit::create` blocks; `ScheduledDispatchProcessorTest` removed the undefined-`$usable` credit mock and asserts COD dispatch is credit-free; `CodDeliverySettlementTest` now asserts `cod_eligibility` over `available_working_credit`; `FastDeliveryTipTest` and `GroupItemRejectionRefundTest` assert the single canonical order carries the tip/remaining items.
- **Documentation**: AGENTS §5.1–5.3, §9 eligibility list, §15 Admin Phase 4, §16 regress-list, §17 rewritten to the credit-free model; `rider-wallet.md`, `known-issues.md`, `roadmap.md` updated; stale `CodSettlementService` docblock corrected.
- **Checkpoint**: full Laravel suite **311 tests / 1,493 assertions / 0 failures / 2 skipped**; socket JS **43/43**.

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
- **Deferred**: `rider_credit_transactions.delivery_id` (AGENTS.md §17) remains future/low-priority. The `cod_purchases` ledger is **now implemented** (see the Purchasing-Cash checkpoint below) under the professor model with the amount anchored to the exact `CodSettlementService` allocation (settlement base), so the deferred "actual-cost" formula is superseded: the purchase ledger already reconciles to `order.rider_financed_amount`.
### COD Purchasing-Cash Flow (Professor Model): Complete & Verified

Implements the professor-required cash purchasing pipeline inside the existing credit-free COD architecture (AGENTS §5.1–5.3), without reintroducing a wallet and without changing dispatch, settlement, payments, refunds, or realtime:

```text
Tourist places multi-restaurant COD order
    ↓
ONE order + ONE shared delivery + ONE rider (existing)
    ↓
Rider accepts  →  cod_purchases per-restaurant stop rows created (atomic)
    ↓
Tourism Office issues purchasing cash (admin endpoint, RBAC) → ActivityLog audit
    ↓
Rider confirms cash receipt → buys/collects food at every restaurant
    ↓
ALL COLLECTED gate → rider may leave pickup area (picked_up)
    ↓
Delivery → tourist pays cash → settle-cod → settlement 80/20 → completed
```

- **`cod_purchases` ledger** (new table): one row per `(delivery, business)` — `purchase_number`, `purchase_amount`, `status` `pending → purchased → collected`, `purchased_at`, `collected_at`, plus `UNIQUE(delivery_id, business_id)` and index `(delivery_id, status)`. DB constraint verified in the live MySQL dev schema.
- **Money invariant**: `Σ purchase_amount = deliveries.purchasing_cash = order.rider_financed_amount = settlement base`. Each `purchase_amount` reuses the exact `CodSettlementService` allocation formula (business subtotal + system-fee share), so the purchasing ledger is guaranteed to reconcile to the restaurant 80% / Tourism Office 20% split booked at settlement. No rider credit/wallet is read, reserved, or deducted anywhere in the flow.
- **Issuance**: `PurchasingCashService::issuePurchasingCash()` (admin `POST /admin/deliveries/{delivery}/issue-purchasing-cash`, gated by `role:bansud_tourism_office`) validates COD + assigned rider + issueable stage (`assigned`/`en_route_pickup`/`arrived_pickup`), refuses duplicate issuance, and writes an `ActivityLog` (`purchasing_cash.issued`). `deliveries` gained `purchasing_cash`, `purchasing_cash_issued_at`, `purchasing_cash_issued_by`, `purchasing_cash_received_at`. Rider confirmation is `POST /rider/deliveries/{delivery}/purchasing-cash/receive` (idempotent).
- **Per-stop progression**: rider-only endpoints `GET /rider/deliveries/{delivery}/purchases` and `POST .../purchases/{purchase}/mark` (`purchased` then `collected`), each under a delivery row-lock; `purchased`/`collected` require the cash to be issued first, and `collected` requires `purchased`. Duplicate marks are rejected at the API layer (message-level guard) and are harmless no-ops in the DB (no effect rows).
- **ALL-COLLECTED departure gate**: `RiderDeliveryController::updateStatus('picked_up')` returns **422 "Collect food from every restaurant…"** until every `cod_purchases` stop for the delivery is `collected` (checked inside the existing delivery row-lock transaction; COD-only, via the canonical `isCodDelivery`). This enforces the professor's "all food collected" step as a hard backend gate, not UI state.
- **Accept-time initialization**: `NearestRiderService::handleRiderResponse` creates the per-restaurant stop rows atomically with assignment (idempotent — safe for double-taps/race re-runs).
- **Frontend**: `RiderMap` gains a pickup-stage **Purchasing Cash cockpit** (cash-issued state, Confirm-Cash-Received, per-restaurant Buy → Collect buttons, "All food collected — you can now leave for delivery" banner) that queries `/rider/deliveries/{id}/purchases`; `AdminLiveDeliveries` gains a **Purchasing Cash** column with an "Issue Cash" action for COD deliveries in the pickup stage. `DeliveryResource` exposes the purchasing-cash fields and per-stop ledger.
- **Tests**: `PurchasingCashFlowTest` 5 passed / 89 assertions — acceptance ledger reconciliation to `rider_financed_amount`, admin issuance + audit trail + duplicate-issuance rejection + RBAC (403 for a rider), rider confirm/mark API guard ordering (not-issued / wrong order / duplicate / invalid status), the `picked_up` gate until all collected, and a **full end-to-end multi-restaurant COD demo scenario** (accept → issue → receive → buy/collect both restaurants → picked_up → deliver → cash settle → completed with 2 restaurant allocations reconciling to the handed-out cash).
- **Full Laravel suite**: **316 passed / 1,582 assertions / 0 failures / 2 skipped** (pre-existing skips unchanged). Frontend `vite build` passes.
- **Database** (development, live MySQL): migration `2026_09_22_000010_create_cod_purchases_and_purchasing_cash_tables` applied via `php artisan migrate`; `SHOW COLUMNS` verified for `cod_purchases` and the four `deliveries` purchasing-cash columns.
- **Deterministic demo + live verification**: `CodDemoSeeder` (`php artisan db:seed --class=CodDemoSeeder`) creates 2 approved restaurants (A: Adobo ₱120 + Iced Tea ₱80; B: BBQ ₱100 + Calamansi ₱50), riders A/B (online, available, food service, fresh GPS), a tourist, and a Tourism Office account (password `Demo12345!`), then places ONE in-flight 2-restaurant COD order (one group checkout, one canonical order, one delivery) with the dispatch offer deterministically pending on **Rider A** — nothing pre-completed. Re-runs reuse the active delivery and refresh the offer (timed-out dispatch log rows are cleared before re-dispatch, since expired offers block `alreadyDispatchedRiderIds`). Live end-to-end validation against the running API on the **real MySQL dev DB** (`php` bootstrapped script driving real `Http` requests) passed **17/17 checks**: one delivery per group; offer → accept; Rider B 422 on the same delivery; stops A ₱220 / B ₱165; issuance ₱385 once + duplicate 422; cash-receipt confirmation; `picked_up` 422 until both stops `collected`; full trip to `delivered`; `settle-cod` completes; final ledger reconciles `Σ cod_purchases = purchasing_cash = rider_financed_amount = settlement base = ₱385` with **restaurant ₱308 (80%) / Tourism Office ₱77 (20%)**.

### P11.8 — Simultaneous Rider Offers & Atomic Acceptance: Complete

Hardened the dispatch/offer/acceptance layer so **every eligible rider gets an offer at once**, the rider may **accept any one of their pending offers**, a rider holds **only one active delivery**, and acceptance is **atomic** (an offer waves — being pinged is not being assigned). Built on the existing credit-free COD dispatch and the `booking_dispatch_logs` offer ledger — no new tables, no rebuilt dispatch engine.

- **Multi-ping offer wave**: `NearestRiderService::dispatchToNearest` now offers **simultaneously** to every eligible candidate (one `booking_dispatch_logs` row per rider, `UNIQUE (delivery_id, rider_id)` backstop already in place from P9, so a repeated wave can never duplicate an offer). The MySQL candidate query is the primary source; the coordinates-radar fallback remains for SQLite-restricted test contexts and DB-unsupported setups. Dispatch sets `dispatch_status = waiting_for_rider` — a wave, not an assignment.
- **Rider chooses among pending offers**: new `RiderDispatchController::offers()` (`GET /rider/dispatch/offers`, live riders only) returns every pending/notified offer for the authenticated rider with a shared `buildOfferPayload` (delivery/order context, pickup/dropoff, distance/estimate, `cod_amount`, `stops`, `restaurant_count`, per-offer expiry, payout). Frontend `RiderDispatchNotification` polls it every 4s: one offer → the existing alert machine, several → new `RiderOffersPanel` chooser with per-offer countdown/accept.
- **Atomic acceptance**: `handleRiderResponse` re-checks the offer **under the delivery row-lock** inside the existing transaction — an already-assigned delivery, an already-active rider, an expired offer, or a no-longer-pending log returns **409 Conflict** (only ineligibility is 422, the P11.2 contract). Double-tap / double-click resolves with the first accept winning and the second getting a clean 409. Declining/ignoring a wave (`handleNonAcceptResponse`) leaves the delivery on the radar for other offers.
- **Wave cancellation + socket notify**: the moment a rider claims a delivery, `cancelOtherRidersOffersForDelivery()` marks every same-delivery loser offer `cancelled` and `notifyOfferCancelled` bridges `delivery_offer_cancelled` → `rider:{id}` rooms through the existing `/event` path (`routeStatusEvent` already validates any `rider:\d+` room — **zero socket-server change**). `cancelOtherPendingOffers()` withdraws the accepting rider's own other offers; `redispatchIfOffered()` re-offers only when a delivery is unclaimed, in `notified|waiting_for_rider`, and has **no other pending offers** left in the wave.
- **Per-offer expiry + wave-guarded timeout**: each offer expires at `min(dispatched_at + DISPATCH_TIMEOUT_SECONDS(120), delivery.dispatch_expires_at)` (`offerExpiresAt`/`offerIsExpired`). `processTimeouts` locks the delivery row, leaves the wave alone while live offers remain, marks an expired log `timeout`, and re-dispatch only after the last offer lapses — so timeout cannot race an accept or spam a predated wave.
- **Frontend**: new `RiderOffersPanel` (multi-offer chooser: payout/stops/countdown per offer), rewritten `RiderDispatchNotification` (offers poll, 409 → drop the stale offer + toast + immediate `syncOffers()`, socket `delivery_offer_cancelled` → refetch + toast, local toast UI), `useRiderSocketReceiver` gains `onOfferCancelled`, and the delivery-request payload gains optional `stops`/`restaurant_count`/`cod_amount`.
- **Test seam**: new `DeliveryOfferConcurrencyTest` (9 tests / A–H) drives the **real** `dispatchToNearest` wave and **real** `handleRiderResponse` transaction, with a `NearestRiderService` subclass overriding only the two SQLite-unsafe SQL candidate finders and `WebsocketNotifierService` mocked to assert `delivery_offer_cancelled` fan-out — A: winner/loser 409 + cancelled + socket notify; B: choose-one → other re-offered + second accept now 409; C: three riders, two losers cancelled + notified; D: stale/never-offered accept → 409; E: offline/ineligible rider never offered; F: offers endpoint live-only and clears after accept; G: double-click first-wins/second-409; H: expired offer → 409 + `timeout` log + fresh wave re-offered. Reconciled drift (documented in-test per AGENTS §12): `RiderAcceptanceGateTest` 4× 422→**409** (accepted = conflict, not validation), `OneActiveDeliveryTest` loser log `'declined'`→`'cancelled'` (wave cancellation semantics), `ConcurrencyLockTest` loser accept now surfaces as offer-gone `conflict` (the `already_assigned` branch still fires under genuine row-lock overlap).
- **Full Laravel suite**: **325 passed / 1,643 assertions / 0 failures / 2 skipped** (316 + 9 new). Socket JS: **45/45** (+2 `delivery_offer_cancelled` fan-out/isolation tests). Frontend `vite build` passes; no new lint/type errors in the touched files.
- **Database**: no schema change (the `booking_dispatch_logs` UNIQUE `(delivery_id, rider_id)` backstop already shipped in `2026_09_20_000001_add_concurrency_guards.php`).

### COD Purchasing-Cash Flow (Professor Model): Complete & Verified

Implements the professor-required cash purchasing pipeline inside the existing credit-free COD architecture (AGENTS §5.1–5.3), without reintroducing a wallet and without changing dispatch, settlement, payments, refunds, or realtime:

```text
Tourist places multi-restaurant COD order
    ↓
ONE order + ONE shared delivery + ONE rider (existing)
    ↓
Rider accepts  →  cod_purchases per-restaurant stop rows created (atomic)
    ↓
Tourism Office issues purchasing cash (admin endpoint, RBAC) → ActivityLog audit
    ↓
Rider confirms cash receipt → buys/collects food at every restaurant
    ↓
ALL COLLECTED gate → rider may leave pickup area (picked_up)
    ↓
Delivery → tourist pays cash → settle-cod → settlement 80/20 → completed
```

- **`cod_purchases` ledger** (new table): one row per `(delivery, business)` — `purchase_number`, `purchase_amount`, `status` `pending → purchased → collected`, `purchased_at`, `collected_at`, plus `UNIQUE(delivery_id, business_id)` and index `(delivery_id, status)`. DB constraint verified in the live MySQL dev schema.
- **Money invariant**: `Σ purchase_amount = deliveries.purchasing_cash = order.rider_financed_amount = settlement base`. Each `purchase_amount` reuses the exact `CodSettlementService` allocation formula (business subtotal + system-fee share), so the purchasing ledger is guaranteed to reconcile to the restaurant 80% / Tourism Office 20% split booked at settlement. No rider credit/wallet is read, reserved, or deducted anywhere in the flow.
- **Issuance**: `PurchasingCashService::issuePurchasingCash()` (admin `POST /admin/deliveries/{delivery}/issue-purchasing-cash`, gated by `role:bansud_tourism_office`) validates COD + assigned rider + issueable stage (`assigned`/`en_route_pickup`/`arrived_pickup`), refuses duplicate issuance, and writes an `ActivityLog` (`purchasing_cash.issued`). `deliveries` gained `purchasing_cash`, `purchasing_cash_issued_at`, `purchasing_cash_issued_by`, `purchasing_cash_received_at`. Rider confirmation is `POST /rider/deliveries/{delivery}/purchasing-cash/receive` (idempotent).
- **Per-stop progression**: rider-only endpoints `GET /rider/deliveries/{delivery}/purchases` and `POST .../purchases/{purchase}/mark` (`purchased` then `collected`), each under a delivery row-lock; `purchased`/`collected` require the cash to be issued first, and `collected` requires `purchased`. Duplicate marks are rejected at the API layer (message-level guard) and are harmless no-ops in the DB (no effect rows).
- **ALL-COLLECTED departure gate**: `RiderDeliveryController::updateStatus('picked_up')` returns **422 "Collect food from every restaurant…"** until every `cod_purchases` stop for the delivery is `collected` (checked inside the existing delivery row-lock transaction; COD-only, via the canonical `isCodDelivery`). This enforces the professor's "all food collected" step as a hard backend gate, not UI state.
- **Accept-time initialization**: `NearestRiderService::handleRiderResponse` creates the per-restaurant stop rows atomically with assignment (idempotent — safe for double-taps/race re-runs).
- **Frontend**: `RiderMap` gains a pickup-stage **Purchasing Cash cockpit** (cash-issued state, Confirm-Cash-Received, per-restaurant Buy → Collect buttons, "All food collected — you can now leave for delivery" banner) that queries `/rider/deliveries/{id}/purchases`; `AdminLiveDeliveries` gains a **Purchasing Cash** column with an "Issue Cash" action for COD deliveries in the pickup stage. `DeliveryResource` exposes the purchasing-cash fields and per-stop ledger.
- **Tests**: `PurchasingCashFlowTest` 5 passed / 89 assertions — acceptance ledger reconciliation to `rider_financed_amount`, admin issuance + audit trail + duplicate-issuance rejection + RBAC (403 for a rider), rider confirm/mark API guard ordering (not-issued / wrong order / duplicate / invalid status), the `picked_up` gate until all collected, and a **full end-to-end multi-restaurant COD demo scenario** (accept → issue → receive → buy/collect both restaurants → picked_up → deliver → cash settle → completed with 2 restaurant allocations reconciling to the handed-out cash).
- **Full Laravel suite**: **316 passed / 1,582 assertions / 0 failures / 2 skipped** (pre-existing skips unchanged). Frontend `vite build` passes.
- **Database** (development, live MySQL): migration `2026_09_22_000010_create_cod_purchases_and_purchasing_cash_tables` applied via `php artisan migrate`; `SHOW COLUMNS` verified for `cod_purchases` and the four `deliveries` purchasing-cash columns.
- **Deterministic demo + live verification**: `CodDemoSeeder` (`php artisan db:seed --class=CodDemoSeeder`) creates 2 approved restaurants (A: Adobo ₱120 + Iced Tea ₱80; B: BBQ ₱100 + Calamansi ₱50), riders A/B (online, available, food service, fresh GPS), a tourist, and a Tourism Office account (password `Demo12345!`), then places ONE in-flight 2-restaurant COD order (one group checkout, one canonical order, one delivery) with the dispatch offer deterministically pending on **Rider A** — nothing pre-completed. Re-runs reuse the active delivery and refresh the offer (timed-out dispatch log rows are cleared before re-dispatch, since expired offers block `alreadyDispatchedRiderIds`). Live end-to-end validation against the running API on the **real MySQL dev DB** (`php` bootstrapped script driving real `Http` requests) passed **17/17 checks**: one delivery per group; offer → accept; Rider B 422 on the same delivery; stops A ₱220 / B ₱165; issuance ₱385 once + duplicate 422; cash-receipt confirmation; `picked_up` 422 until both stops `collected`; full trip to `delivered`; `settle-cod` completes; final ledger reconciles `Σ cod_purchases = purchasing_cash = rider_financed_amount = settlement base = ₱385` with **restaurant ₱308 (80%) / Tourism Office ₱77 (20%)**.

### P11.8 — Simultaneous Rider Offers & Atomic Acceptance: Complete

Hardened the dispatch/offer/acceptance layer so **every eligible rider gets an offer at once**, the rider may **accept any one of their pending offers**, a rider holds **only one active delivery**, and acceptance is **atomic** (an offer waves — being pinged is not being assigned). Built on the existing credit-free COD dispatch and the `booking_dispatch_logs` offer ledger — no new tables, no rebuilt dispatch engine.

- **Multi-ping offer wave**: `NearestRiderService::dispatchToNearest` now offers **simultaneously** to every eligible candidate (one `booking_dispatch_logs` row per rider, `UNIQUE (delivery_id, rider_id)` backstop already in place from P9, so a repeated wave can never duplicate an offer). The MySQL candidate query is the primary source; the coordinates-radar fallback remains for SQLite-restricted test contexts and DB-unsupported setups. Dispatch sets `dispatch_status = waiting_for_rider` — a wave, not an assignment.
- **Rider chooses among pending offers**: new `RiderDispatchController::offers()` (`GET /rider/dispatch/offers`, live riders only) returns every pending/notified offer for the authenticated rider with a shared `buildOfferPayload` (delivery/order context, pickup/dropoff, distance/estimate, `cod_amount`, `stops`, `restaurant_count`, per-offer expiry, payout). Frontend `RiderDispatchNotification` polls it every 4s: one offer → the existing alert machine, several → new `RiderOffersPanel` chooser with per-offer countdown/accept.
- **Atomic acceptance**: `handleRiderResponse` re-checks the offer **under the delivery row-lock** inside the existing transaction — an already-assigned delivery, an already-active rider, an expired offer, or a no-longer-pending log returns **409 Conflict** (only ineligibility is 422, the P11.2 contract). Double-tap / double-click resolves with the first accept winning and the second getting a clean 409. Declining/ignoring a wave (`handleNonAcceptResponse`) leaves the delivery on the radar for other offers.
- **Wave cancellation + socket notify**: the moment a rider claims a delivery, `cancelOtherRidersOffersForDelivery()` marks every same-delivery loser offer `cancelled` and `notifyOfferCancelled` bridges `delivery_offer_cancelled` → `rider:{id}` rooms through the existing `/event` path (`routeStatusEvent` already validates any `rider:\d+` room — **zero socket-server change**). `cancelOtherPendingOffers()` withdraws the accepting rider's own other offers; `redispatchIfOffered()` re-offers only when a delivery is unclaimed, in `notified|waiting_for_rider`, and has **no other pending offers** left in the wave.
- **Per-offer expiry + wave-guarded timeout**: each offer expires at `min(dispatched_at + DISPATCH_TIMEOUT_SECONDS(120), delivery.dispatch_expires_at)` (`offerExpiresAt`/`offerIsExpired`). `processTimeouts` locks the delivery row, leaves the wave alone while live offers remain, marks an expired log `timeout`, and re-dispatch only after the last offer lapses — so timeout cannot race an accept or spam a predated wave.
- **Frontend**: new `RiderOffersPanel` (multi-offer chooser: payout/stops/countdown per offer), rewritten `RiderDispatchNotification` (offers poll, 409 → drop the stale offer + toast + immediate `syncOffers()`, socket `delivery_offer_cancelled` → refetch + toast, local toast UI), `useRiderSocketReceiver` gains `onOfferCancelled`, and the delivery-request payload gains optional `stops`/`restaurant_count`/`cod_amount`.
- **Test seam**: new `DeliveryOfferConcurrencyTest` (9 tests / A–H) drives the **real** `dispatchToNearest` wave and **real** `handleRiderResponse` transaction, with a `NearestRiderService` subclass overriding only the two SQLite-unsafe SQL candidate finders and `WebsocketNotifierService` mocked to assert `delivery_offer_cancelled` fan-out — A: winner/loser 409 + cancelled + socket notify; B: choose-one → other re-offered + second accept now 409; C: three riders, two losers cancelled + notified; D: stale/never-offered accept → 409; E: offline/ineligible rider never offered; F: offers endpoint live-only and clears after accept; G: double-click first-wins/second-409; H: expired offer → 409 + `timeout` log + fresh wave re-offered. Reconciled drift (documented in-test per AGENTS §12): `RiderAcceptanceGateTest` 4× 422→**409** (accepted = conflict, not validation), `OneActiveDeliveryTest` loser log `'declined'`→`'cancelled'` (wave cancellation semantics), `ConcurrencyLockTest` loser accept now surfaces as offer-gone `conflict` (the `already_assigned` branch still fires under genuine row-lock overlap).
- **Full Laravel suite**: **325 passed / 1,643 assertions / 0 failures / 2 skipped** (316 + 9 new). Socket JS: **45/45** (+2 `delivery_offer_cancelled` fan-out/isolation tests). Frontend `vite build` passes; no new lint/type errors in the touched files.
- **Database**: no schema change (the `booking_dispatch_logs` UNIQUE `(delivery_id, rider_id)` backstop already shipped in `2026_09_20_000001_add_concurrency_guards.php`).

### Development Database Migration Reconciliation & Schema Verification: Complete

A full audit of the development MySQL database (`track_tour_db`) against `database/migrations/` found a **pending-migration backlog**, which was then applied and verified. This is the first checkpoint that marks the development schema as **verified**, closing the "Development Schema Pending" caveat left open by P12.1–P12.4, the Group Delivery, and COD Purchasing-Cash checkpoints.

**Audit before the run**

- **188 migration files / 180 recorded / 13 pending**; pending also included `2026_09_19_000002_add_payment_idempotency_guards`, whose schema was already present (applied earlier via a one-off bootstrap script) but never recorded — i.e. 1 genuinely unapplied-but-recorded-less migration plus 12 genuinely unapplied migrations.
- **Real schema drift confirmed**, not just bookkeeping: `refunds.provider_refund_id`/`metadata`/`order_id`, `restaurant_wallets`, `restaurant_wallet_transactions`, `order_settlements`, `deliveries.group_checkout_id` (with `deliveries.order_id` still NOT NULL), `order_items.business_id`, the `cod_settlements` `UNIQUE(order_id)` → `UNIQUE(order_id, business_id)` rework, the whole rider-credit system (`rider_credits`, `rider_credit_transactions`, `rider_top_ups`, `deliveries.cod_credit_reserved`, `rider_details.working_credit`/`reserved_working_credit`), and `cod_purchases` + the four `deliveries.purchasing_cash*` columns were all absent from the live DB.

**Applied**

- `php artisan migrate --force` ran **13/13 migrations, all DONE, no errors and no warnings**. These **13 requested migrations were the only database changes made** in this checkpoint — no other DDL, no data edits, no index/constraint changes beyond what those files declare. The five historical orphan `migrations` rows were deliberately **left untouched** (see below).
- Migration applied: `2026_09_19_000001`, `2026_09_19_000002`, `2026_09_21_000001`–`000006`, `2026_09_21_000010`, `2026_09_22_000001`–`000003`, `2026_09_22_000010`.

**Verification (SHOW CREATE TABLE pass on all 11 affected tables)**

- **Migrations: 188/188 files recorded → pending = 0.**
- **Column presence: 16/16 OK. Index assertions: 14/14 OK → schema/index drift = 0.**
- DDL spot-checks: `refunds` carries `UNIQUE refunds_provider_refund_id_unique` + `refunds_order_id_foreign … ON DELETE SET NULL`; `payments` carries both provider UNIQUEs; `payment_webhook_events` carries `UNIQUE provider_event_id` (the §6.1 backstop); `restaurant_wallets`/`order_settlements`/`cod_purchases` carry their declared UNIQUE keys (`business_id`, `order_id`, `cod_settlement_id`, `delivery_id + business_id`); `restaurant_wallet_transactions` carries the unique `order_settlement_id` and `refund_id` effect keys.
- `deliveries.order_id` verified `IS_NULLABLE = YES` with `UNIQUE deliveries_group_checkout_id_unique` added; `UNIQUE deliveries_order_id_unique` is **retained by design** as the one-order/one-delivery backstop declared in `2026_09_21_000010`'s docblock (§4.1).
- `cod_settlements` verified: `UNIQUE (order_id, business_id)` present, plain `KEY (order_id)` present, old `UNIQUE (order_id)` gone.
- Rider-credit removal verified: `rider_credits`, `rider_credit_transactions`, `rider_top_ups` all absent; `deliveries.cod_credit_reserved`, `rider_details.working_credit`, `rider_details.reserved_working_credit` all absent.

**Test results**

- **Full suite before the GD guard: 320 passed / 1,606 assertions / 4 failed / 3 skipped.**
- All 4 failures were a single environment root cause — `Call to undefined function imagecreatetruecolor()` in `tests/Feature/BusinessRegistrationOcrTest.php:61` (PHP 8.2.12, `GD loaded: NO`). **Confirmed the four failures occur before any DB access**: each one throws inside the `createTestImage()` helper (`imagecreatetruecolor` is the first statement), which runs before any request is dispatched or assertion is made — so the failures are provably unrelated to the migration.
- **GD guard added** to all four GD-dependent tests in `BusinessRegistrationOcrTest`, matching the existing `OfferingManagementTest:250-252` pattern verbatim (`if (! extension_loaded('gd')) { $this->markTestSkipped('GD extension is required to create fake images.'); }`). The suite now reports an environment prerequisite instead of four misleading failures; the non-GD test in that file (`test_business_creation_rejects_without_required_fields`) is untouched and still runs.
- **3 skipped, all understood** (test DB is in-memory SQLite per `phpunit.xml`): `TouristApiTest` — SQLite does not support `HAVING` on non-aggregate queries; `RepositoryTest` — Haversine (`acos`/`sin`/`cos`) functions not in SQLite; `OfferingManagementTest` — GD extension required to create fake images.
- The suite runs on `DB_CONNECTION=sqlite` / `DB_DATABASE=:memory:`, so all 320 passing tests migrate the schema from scratch independently of `track_tour_db` — confirming the migration set is internally consistent, not merely applied to the dev DB.

**Remaining (non-functional) mismatch, deliberately left alone**

- **5 historical orphan `migrations` rows** — rows exist for migration files that were deleted from disk: `2026_08_25_100000_create_menu_groups_table`, `2026_08_25_100001_create_menu_group_variations_table` (Menu Groups feature removal), `2026_09_14_000001_rename_rider_credits_to_rider_wallets`, `2026_09_14_000002_extend_rider_credit_transactions`, `2026_09_14_000003_create_rider_top_ups_table` (superseded by the current `2026_09_14_000001`/`000002` files). They are harmless to `migrate` (they simply never re-run) and cause **no functional or schema problem**, but they make `recorded` (193) ≠ `files` (188) and mean a fresh clone's migration history will not match this DB's. **Not deleted** in this checkpoint: removing them rewrites recorded migration history without fixing anything functional. Reconciling repository migration history for fresh-clone consistency is a separate decision.
- Consequently the "tables in DB with no create-migration" finding is fully explained: `offerings`/`offering_categories` (renamed from `products`/`product_categories` by `2026_07_07_070558`) and `menu_groups`/`menu_group_variations`. **Correction to the Menu Groups Removal checkpoint above:** that checkpoint records "the backend tables + migration records dropped from the dev DB and `track_tour_db.sql`". Re-verified in this checkpoint: the **SQL dump is clean** (`track_tour_db.sql` contains no `menu_group` CREATE statement), but the **development MySQL database still has both tables** (`Schema::hasTable('menu_groups') === true`, `menu_group_variations === true`) **and both migration rows** (batch 4). So the removal was completed in code and in the dump, but not in the dev DB — the two leftover tables are inert (no model, route, or controller references them) and are reported here rather than dropped, since dropping them is a schema change outside this checkpoint's 13-migration scope. The four migration-created tables absent from the DB are also intentional: `products`/`product_categories` (renamed), `business_documents` (dropped by the rebuild-to-uploads migration), `business_category_documents` (dropped by `2026_07_23_120000`).

**Full Laravel suite after the GD guard: 327 tests / 1,604 assertions / 0 failures / 7 skipped — GREEN** (4 failed → 0 failed; the 7 skips are the 3 pre-existing SQLite/GD skips + the 4 newly guarded OCR tests). Assertion delta 1,606 → 1,604 is fully accounted for: `test_business_created_with_documents_and_ocr_data` executed its 2 `assertNotNull` seeding checks *before* hitting the GD error, and those 2 assertions disappear once the test skips up front.

Socket JS suite: **45/45** (unchanged; not re-run in this checkpoint).

---

### Rider Stale-`busy` Release on Delivery Cancellation: Complete

**Symptom** — `POST /api/rider/availability/toggle` answered **409 Conflict** (from `frontend/src/shared/layouts/DashboardLayout.tsx:206`, surfacing as an uncaught `AxiosError` at `:215`). The route has exactly one 409 source: `RiderController::toggleAvailability()` → `errorResponse('You are currently on a delivery. Complete it before going offline.', 409)`, fired whenever `rider_details.rider_status = 'busy'`.

**Root cause** — `NearestRiderService::cancelDelivery()` changed only `deliveries.status → cancelled` and never released the rider. The `busy` state is set atomically with the assignment on accept (`NearestRiderService`, accept transaction: `rider_id` + `rider_status = 'busy'`), but is only cleared by success paths: prepaid `delivered` (`RiderDeliveryController`, `RiderMapController`), COD `settle-cod` (`NearestRiderService`), and guide trip end (`TripTrackingController`). Every cancellation entry point — tourist cancel, restaurant reject, `AutoRejectWaitingOrder`, `AutoCancelUndeliveredOrder`, refund-driven cancel — funnels through `cancelDeliveryForOrder()` → `cancelDelivery()`, so a rider whose delivery was cancelled stayed `busy` indefinitely:

```text
delivery.status = cancelled     rider_status = busy     → toggle = 409 forever
```

**Fix (smallest authoritative layer)** — inside the existing `cancelDelivery()` transaction, immediately after the status flip:

- **Conditional release** via new helper `riderBusyStateOwnedBy()`: release only when (a) the rider is still `busy`, and (b) the rider has **no other non-terminal delivery**. A COD delivery parked at `delivered` until `settle-cod` counts as occupying, so the intentional "busy until cash is collected" rule is preserved and a genuinely occupied rider is never blindly set `available`.
- The release runs **inside the same transaction** as the cancellation, so the invariant is atomic — no crash window can re-create the stale state.
- **Race safety:** the accept path writes `rider_id` + `busy` in one transaction, so a concurrent accept is either already visible here (release skipped) or commits after us (overwrites back to `busy`). Both orderings stay correct without extra locks.
- **Post-commit, best-effort** `firebase->setRiderStatus(..., AVAILABLE, ...)` mirrors the release to the socket radar so dispatch stops treating the rider as busy.
- The legitimate conflict is untouched: `busy` + an active delivery still returns 409, and `cancelDelivery()` still refuses `delivered`/`completed`/`cancelled` deliveries.

**Deliberately not changed** — frontend error handling (separate UX follow-up), and no acceptance/dispatch/COD/one-active-delivery logic.

**Tests** — new `tests/Feature/RiderBusyReleaseTest.php`, 6 tests / 17 assertions: (1) cancelling the owning delivery releases the rider → toggle 200; (2) genuine 409 preserved while on a delivery; (3) rider with another active delivery is *not* released; (4) a non-`busy` rider is never promoted to `available`; (5) the shared `cancelDeliveryForOrder()` caller inherits the release; (6) COD `delivered` is not cancelled and keeps the rider busy (409).

**Full suite: 333 tests (326 passed + 7 skipped) / 1,621 assertions / 0 failures — GREEN.** Δ vs the previous checkpoint = +6 tests / +17 assertions, exactly the new file; the 7 skips are the same known environment skips (4 GD-guarded OCR, `OfferingManagementTest` GD, `TouristApiTest` SQLite HAVING, `RepositoryTest` Haversine).

**Deferred follow-ups**

- **Frontend:** `toggleRiderAvailability()` still has no `try/catch` (`DashboardLayout.tsx:205-215`) — any non-2xx becomes an unhandled promise rejection. UX-only fix, pending decision; it must not mask the backend message.
- **Data repair:** riders already stuck at `busy` in `track_tour_db` stay stuck until they complete/settle or are reset manually — the fix prevents new occurrences but does not retroactively clean rows (repair SQL offered, not run).
- **Related, separate:** PING delivery reliability checkpoint — `docs/architecture/delivery-offer-atomic-acceptance.md` and `docs/architecture/dispatch-ping-reliability-spec.md`.

---

### Firebase Realtime DB Fully Removed (rider "Go Online" timeout root cause): Complete & Verified

**Symptom** — clicking **Go Online** in the rider sidebar showed `Unable to change availability right now.` (`frontend/src/shared/layouts/DashboardLayout.tsx:252`). That string is the *fallback* used only when the error carries **no `message`**, i.e. no JSON body at all — a 409/403/422 would have surfaced the backend's own text.

**Root cause (measured, not guessed)** — `POST /api/rider/availability/toggle` performed **2–3 sequential Firebase RTDB HTTP calls** (each `Http::timeout(5)`) *before* returning, while the shared axios client aborted at **10s**:

```text
live timings before the fix: 6.1s / 7.4s / 8.8s / 9.5s   (3 × ~3s RTDB round trips)
axios timeout:               10s  →  ECONNABORTED, no response body  →  generic fallback
```

`FirebaseService` targets `track-tour-cce1e-default-rtdb.firebaseio.com`, which this environment reaches in ~1.7s/401 and regularly times out at 5s (`laravel.log`: `Firebase patch failed: cURL error 28`), so any spike pushed the request past 10s. The DB write had already committed — the rider *was* online while the UI reported failure.

**Decision** — full removal of `FirebaseService` (user decision; consistent with ADR 003, where Socket.IO was already chosen over Firebase):

```text
deleted:  app/Services/FirebaseService.php, config/firebase.php,
          firebase.rules.json, FIREBASE_RULES.md
.env:     FIREBASE_* and VITE_FIREBASE_* (15 lines) removed
```

**Call sites removed (all were best-effort mirrors; MySQL was already authoritative):**

- `RiderController` — `toggleAvailability`, `toggleAvailable`, `switchService` status/location mirrors; unused `RiderLocation` import.
- `AuthController::logout` — `removeRider` / `setOnlineStatus`.
- `NearestRiderService` — constructor dependency, the dead `findNearestFromFirebase()` candidate finder, dispatch `createRiderRequest`/`createBookingRequest` (gated on `firebase.dispatch_enabled`, already `false`), accept/decline/timeout `removeRiderRequest` cleanup (5 sites), `no_rider_available` + accept status mirrors, and the cancellation release mirror (incl. the now-unused `$releasedRiderId` plumbing). `findNearestAvailableRiders()` still resolves **only** from MySQL — unchanged.
- `TripTrackingController` — guide trip start/location/end RTDB nodes; `location_sequence` increment (only consumer was the RTDB payload) and `tourist_uid` / `tracking_path` / `guide.firebase_uid` payload keys.
- `ChatController` — `broadcastToFirebase()` (controller is unrouted; the live message screens use `/tourist/messages`, `/rider/messages`).
- `RiderMapController` — `firebase_config` payload key (no frontend consumer).
- `DeliveryService` — unused constructor dependency.
- `BusinessOwnerGuideController` — `firebase_uid` payload key.

**Kept deliberately:** `users.firebase_uid` column and its migration (nullable, unwritten — dropping it is a separate schema decision); Socket.IO/GPS/dispatch/COD/acceptance-gate architecture untouched.

**Verification**

- **Live endpoint, same rider/token as the diagnosis:** `9.5s → 2.96s (cold) → 0.77s (warm)` per toggle, HTTP 200, status flips correctly. Comfortably inside any client timeout.
- **Full Laravel suite: 337 tests / 1,654 assertions / 0 failures / 7 skipped — GREEN** (Δ = +4 tests vs the 333-checkpoint; the 7 skips are the known environment skips: 4 GD-guarded OCR, `OfferingManagementTest` GD, `TouristApiTest` SQLite HAVING, `RepositoryTest` Haversine).
- **Socket JS suite: 45/45.**
- Test updates: the 11 anonymous `NearestRiderService` subclasses now construct with no arguments (`new class() extends NearestRiderService`), `DeliveryOfferConcurrencyTest` no longer sets `firebase.dispatch_enabled`, and the stale `use App\Services\FirebaseService;` import was dropped from `CodFinancialSettlementTest`. Because the mirrors are gone, those tests no longer fire real outbound HTTP.
- `php -l` clean on `app/` and `tests/`.

**Incidental fix found during the lint sweep:** `app/Http/Controllers/StaffDashboardController.php` had `use Carbon;` next to `use Illuminate\Support\Carbon;` — a PHP fatal ("Cannot use Carbon as Carbon") that broke the file the moment it was loaded. Line removed; `Carbon::today()` now resolves through the `Illuminate\Support\Carbon` import.

**Docs updated:** `README.md` (service section now describes `WebsocketNotifierService`, NearestRiderService bullets corrected), `docs/decisions/003-websocket-not-firebase.md` (amendment recording the removal), `docs/architecture/dispatch-ping-reliability-spec.md` (channel 1 struck out; only WebSocket ping + HTTP polling remain).

**Known deferred items**

- `users.firebase_uid` column retention (schema cleanup, low priority).
- `delivers.location_sequence` is now write-only (its sole consumer was the RTDB payload) — left in place, no migration.

---

### Landing Card Feed — Realtime DB-Backed Filter Tabs: Complete & Verified

**Feature** — the landing page's card grid (White Beach, Tamaraw Falls, …) was a hardcoded `DEFAULT_SPOTS` array, and the filter tabs (All / Tourist Spots / Food / Businesses / Resorts) were inert: `activeTab` was set by the buttons but never used to filter, so every tab rendered the same six fake cards.

- **New public endpoint** `GET /api/landing/cards` (`LandingContentController::cards()`), read from MySQL on every request: active `tourist_destinations` first, then approved `businesses`, newest first, normalised to `{ key, types[], title, location, category, rating, image }`. `types` = filter-tab membership, classified by business category name (`CARD_TABS_BY_CATEGORY`); a `Hotel & Restaurant Combination` lands in both **Food** and **Resorts**, unclassified categories fall back to **Businesses**. Optional `?limit=` (default 200, max 500).
- **Frontend** (`frontend/src/pages/LandingPage.tsx`): `useQuery(['landing-cards'])` with `refetchInterval: 30s` + refetch-on-focus (the app default is 5-min staleTime / no focus refetch, so both are overridden here), `TAB_TYPE` map wired to the five tabs, search still filters client-side, real cover images via `toAssetUrl()`, rating star rendered only when a rating exists, per-tab empty state. `DEFAULT_SPOTS` / `LandingSpot` removed from the page.
- **Known drift, intentional:** the Tourism Office *Landing Content* editor's `spots_json` fields no longer drive this grid (hero + categories still do). Destinations are now managed through Tourism Management → Destinations; the admin endpoint still accepts/stores `landing_spots` untouched.
- **Dev DB state at verification:** `active destinations = 0`, `approved businesses = 7` — so *Tourist Spots* correctly renders its empty state until destinations are created.

**Tests** — new `tests/Feature/LandingCardsTest.php`, 8 tests / 25 assertions: public/no-auth, active-vs-inactive destination, approved-vs-unapproved business, card field shape, tab classification incl. the dual-tab combined hotel, `attraction_type` badge, rating null-vs-4.8, limit bounds.

**23:59 suite flake — fixed (test-only).** An earlier full run produced 13 failures, all `InvalidArgumentException: Restaurant A is currently closed (Opens tomorrow at 12:00 AM)` from `GroupOrderService::createGroup()`. Cause: `Business::isInsidePeriods()` tests `$currentMin < $close` (**close is exclusive**), so fixtures declaring "open 24/7" as `[['00:00','23:59']]` read as **closed during the single minute 23:59 Manila**. The run crossed midnight, landing 13 `createGroup` calls in that minute.

- **Fix:** 11 fixtures changed to `[['00:00','23:59'], ['23:59','00:00']]` — the second period is taken by the existing overnight branch (`open 1439 > close 0`), covering the boundary minute. Verified side effects: the previous-day spillover filter picks the period up but its `isInsidePeriods(..., $isOvernightSet = true)` test (`currentMin < 0`) is a harmless no-op, and no test asserts schedule/availability text.
- **Production deliberately untouched:** making close inclusive would change when real restaurants stop accepting orders — an authoritative business rule, not a test defect.
- **New guard:** `tests/Unit/BusinessHoursBoundaryTest.php`, 3 tests / 8 assertions — proves the old fixture returns `isOpenNow() === false` at a frozen 23:59 Manila (reproduces the flake deterministically), that the new fixture is open at 00:00/08:30/12:00/23:58/23:59, and that `isAcceptingOrders()` — the exact gate `createGroup()` uses — is true at the boundary.

**Regression checkpoint — GREEN:**

```text
Tests:       344 total → 337 passed / 7 skipped / 0 failures
Assertions:  1,654
Duration:    463.83s
23:59 flake reproduced: No
```

Δ vs the previous checkpoint (333 tests / 1,621 assertions / 0 failures / 7 skipped) = +11 tests / +33 assertions = 8 (`LandingCardsTest`) + 3 (`BusinessHoursBoundaryTest`). The 7 skips are the same known environment skips (4 GD-guarded OCR, `OfferingManagementTest` GD, `TouristApiTest` SQLite HAVING, `RepositoryTest` Haversine).

**Independent corroboration of the wall-clock diagnosis:** the immediate post-midnight rerun (before the fixture fix) was already `334 passed / 7 skipped / 0 failures` — it simply never executed during the bad minute.

Socket JS suite: 45/45 (unchanged; not re-run in this checkpoint). Frontend `npm run build` ✓ clean (`tsc` reports no errors in `LandingPage.tsx`; the repo has pre-existing type errors elsewhere that `vite build` does not check).

---

### Rider Auto Accept — First-Ping Auto Acceptance: Complete & Verified

**Problem.** The **Auto accept** tile in the rider status panel was a dead `<button>` — no `onClick`, no state, no column anywhere in the codebase. Tapping it did nothing.

**Decisions (user-confirmed):**
1. *Server-persisted flag + the rider's device does the accepting* — not a localStorage-only flag, and not server-side acceptance inside dispatch (which would mean editing canonical `NearestRiderService`).
2. *Stays armed* — every new ping is taken while the rider is free, not a single one-shot.

**Implementation**

| Layer | Change |
|---|---|
| Schema | `rider_details.auto_accept` — `boolean NOT NULL DEFAULT 0` after `current_service` (`2026_09_23_000001`) |
| Endpoint | `PATCH /api/rider/auto-accept` (`role:rider`) → `RiderController::switchAutoAccept()` — `required\|boolean`, `updateOrCreate` (respects `UNIQUE(user_id)`), returns the stored value |
| Exposure | `UserResource.auto_accept`, so `/api/user`, login, and refresh all carry it |
| Toggle UI | `DashboardLayout.tsx` — the tile now calls the endpoint: `aria-pressed`, active/emerald state, `On`/`Off`/`…`, in-flight guard, inline error + `fetchUser()` reconcile |
| Accepting | `RiderDispatchNotification.tsx` — while the flag is ON and the rider is online, takes the **first ping** (earliest `dispatched_at`) through the *same* `PATCH /rider/dispatch/accept` the manual button uses |

**Architectural decisions**
- **Dispatch does not know the flag exists.** `NearestRiderService` is untouched — candidate eligibility, offer wave, 120s window, COD eligibility, and re-dispatch are unchanged (AGENTS.md §9/§16). Documented in `docs/business-rules/rider-dispatch.md` §5.
- **The toggle is state only.** Acceptance stays the exclusive job of the canonical atomic accept path, so one-active-delivery, expiry, COD eligibility, and 409/422 semantics all apply to an auto-accept exactly as to a tap.
- **No poll loop.** A delivery already attempted once is remembered in a ref `Set`; a rejected attempt (409 claimed / 422 ineligible) degrades to the normal manual offer UI instead of re-firing every 4s.
- **`whenLoaded()` trap.** Laravel's `ConditionallyLoadsAttributes::whenLoaded()` returns `null` when the related row doesn't exist (line 267), so a rider who had never created a `rider_details` row would read `auto_accept: null` ("unknown"). Switched to `when(relationLoaded(...))` so it emits a real `false`, and omits the key entirely when the relation isn't loaded (no N+1).
- Works on every rider page: `RiderDispatchNotification` is mounted at the `/rider` route element (`App.tsx:763`), not inside a single page — including the settings page.
- The rider must be online with the app open — which it already must be for GPS. Closed app ⇒ no auto-accept, identical to a rider who never taps.

**Tests** — new `tests/Feature/RiderAutoAcceptTest.php`, 10 tests / 32 assertions:
guest 401 · non-rider 403 · default off (no `rider_details` row yet) · enable · disable without duplicating the `UNIQUE` row · value survives a fresh request · non-boolean → 422 · missing field → 422 · **enabling never accepts a pending offer** (delivery stays `TripStatus::WAITING`, `rider_id` null, dispatch log `pending`, `rider_status` still `offline`) · **disabling never releases an active delivery** (stays `ASSIGNED` + `busy`).

**Regression checkpoint — GREEN:**

```text
Tests:       354 total → 347 passed / 7 skipped / 0 failures
Assertions:  1,686
Duration:    205.37s
```

Δ vs the previous checkpoint (344 tests / 1,654 assertions / 0 failures / 7 skipped) = **+10 tests / +32 assertions** = exactly `RiderAutoAcceptTest`. The 7 skips are the same known environment skips (4 GD-guarded OCR, `OfferingManagementTest` GD, `TouristApiTest` SQLite HAVING, `RepositoryTest` Haversine).

**Database verification (per §11):** migration ran on the dev DB (`2026_09_23_000001 … DONE`), `SHOW CREATE TABLE rider_details` confirms `` `auto_accept` tinyint(1) NOT NULL DEFAULT 0 `` positioned after `current_service`, and `UNIQUE KEY rider_details_user_id_unique (user_id)` intact.

**Frontend verification:** `npm run build` ✓; oxlint 0 errors (1 pre-existing warning in an untouched effect); the unused `MapPin` import in `RiderDeliveryRequestAlert.tsx` was removed (`tsc` TS6133). Remaining `tsc` errors in `DashboardLayout.tsx:735`, `RiderDashboard.tsx`, `RiderMap.tsx`, `useOsrmRoute.ts`, `RiderActiveTripContext.tsx` are pre-existing and unrelated. Socket JS suite not re-run (no socket changes; 45/45 last known).

**Known minor:** flipping the toggle on device A is picked up by device B on its next `fetchUser()` (socket connect, trip cancel, or error reconcile), not instantly.

**Follow-up fix — false "Failed to update auto accept".** The toggle reported failure even though the write succeeded. Diagnosed by probing the real browser path (`localhost:3000` → Vite proxy → `php artisan serve :8000`): `PATCH /api/rider/auto-accept` answers `200` both direct and through the proxy, and `GET /api/user`, `/rider/dashboard`, `/rider/dispatch/offers` all answer `200`. Root cause was axios' `timeout: 10000` (`api.ts`) against the **single-request-at-a-time** dev server while the rider app polls offers every 4s and posts GPS — an abort has **no `response`**, so the catch fell through to the generic fallback even though MySQL had already committed. Fixed the same way `toggleRiderAvailability` already handles it: explicit `{ timeout: 30000 }`, a distinct no-response message ("The server took too long to respond…") instead of a false failure claim, and `fetchUser()` reconcile so the tile shows whatever the server actually stored.

**Follow-up — Rider Status readout panel.** Added a `role="status"` / `aria-live="polite"` panel between the Go Online toggle and the quick-actions grid: green panel (`bg-[#16803C]`) with white text and a pulsing white dot while online; white panel with **gray** text (`#6B7280`) and a **fading gray** dot (`#9CA3AF`, `animate-pulse`) while offline — grey replacing the initially requested green, per the follow-up instruction; `…` while the availability request is in flight. It derives purely from `riderOnline`, which `toggleRiderAvailability` only ever sets from the server-returned `rider_status`, so it can never disagree with the button above it. The action region was re-labelled `Rider quick actions` — it previously carried the now-misleading `Rider status panel` label.

### Ride-Hailing Service Gating — Transport Bookings Now Acceptable: Complete & Verified

**Reported:** a rider offering Ride Hailing (`rider_details.current_service = 'transport'`) could not accept a transportation booking.

**Root causes — two, both in `TransportationService::createRide()`:**

1. **Ride booking never persisted at all (hard failure).** The ride order item was created with `description` / `price`, but `OrderItem::$fillable` exposes `product_name` / `unit_price` and both columns are `NOT NULL`. Mass assignment silently dropped the unknown keys, so the insert threw `SQLSTATE[HY000] General error: 1364 Field 'product_name' doesn't have a default value` — every ride booking 500'd. `createRide()` also ran unguarded (no transaction), so the `orders` row committed before the failure and would have been left orphaned.
2. **`order_type` was written as `'delivery'` instead of `'transport'`.** The accept gate (`NearestRiderService::validateRiderAcceptance()`) and the re-offer path (`redispatchIfOffered()`) both derive the required service as `order_type === 'transport' ? 'transport' : 'food'`. With `'delivery'`, a non-COD ride demanded `current_service === 'food'`, so a ride-hailing rider's accept resolved to `ineligible`. The same mismatch meant `TransportController::index` / `HistoryController` (`where('order_type','transport')`) never returned rides, and `redispatchIfOffered()` re-offered declined rides to **food** riders.

Note the COD branch of the gate skips the service check entirely (it only checks `available` + active limit), so cash rides behaved differently from GCash/Maya/Card rides — the same `order_type` fix resolves that inconsistency because both branches now agree on the service.

**Fix (minimal, at the authoritative layer):**
- `createRide()` persists `order_type => 'transport'`, writes `product_name` / `unit_price`, and creates order + item + delivery inside one `DB::transaction` so a partial failure can no longer leave an orphaned order. `dispatchToNearest($delivery, 'transport')` stays outside the transaction, unchanged.
- `AutoCancelUndeliveredOrder` widened from `where('order_type','delivery')` to `whereIn('order_type', ['delivery','transport'])` — rides only inherited that protection because they were mislabeled, so the fix must not silently drop it.
- **No schema change and no data migration.**

**Verified unchanged (not weakened):** `validateRiderAcceptance()` service gate, the `dispatchToNearest()` candidate filter, the COD acceptance branch, `SmartDispatchService::scheduleDispatch()` (its `order_type !== 'delivery'` early-return now correctly skips rides, which already dispatch directly and would otherwise have been re-dispatched to **food** riders after payment), the `PaymentController` post-payment dispatch hook, `OrderRefundService` (rides carry `delivery_fee = 0`), and the kitchen/preparation gates.

**Tests** — new `tests/Feature/RideHailingAcceptanceTest.php`, **5 tests / 25 assertions** (real dispatch wave + real atomic accept transaction; only the SQLite-unsafe candidate finders overridden, `WebsocketNotifierService` mocked):
ride persists as `transport` with a valid item + delivery and reaches `notified` · **transport rider is offered AND accepts a GCash ride** · a food rider is offered nothing *and* a forged offer is refused at the accept gate · a transport rider is still refused a food delivery · the ride lists under `?tab=transport` and never `?tab=food`.

**Regression checkpoint — GREEN:**

```text
Tests:       359 total → 352 passed / 7 skipped / 0 failures
Assertions:  1,711
Duration:    244.77s
```

Δ vs the previous checkpoint (354 tests / 1,686 assertions / 0 failures / 7 skipped) = **+5 tests / +25 assertions** = exactly `RideHailingAcceptanceTest`. The 7 skips are the same known environment skips (4 GD-guarded OCR, `OfferingManagementTest` GD, `TouristApiTest` SQLite HAVING, `RepositoryTest` Haversine).

**Database verification (per §11):** `SHOW CREATE TABLE orders` run against the dev MySQL DB — `order_type varchar(255) NOT NULL DEFAULT 'pickup'`, i.e. a column comment (`delivery, pickup, dine_in`), **not** an enum/CHECK, so `'transport'` is storable without DDL. The dev DB holds **0 `TRP-%` rides**, confirmed before and after a rolled-back live probe of the pre-fix code, so there is no legacy data to backfill.

**Known deferred (out of scope):** `createRide()` hardcodes `business_id = 1` and creates ride items without `business_id`, so rides still attach to business 1's order lists/reports. Correcting ride ownership is a separate decision and is not required for service gating.


### `no_rider_available` Dispatch Recovery — Immediate Failures Now Retry: Complete & Verified

**Reported:** a tourist placed a cash order and the rider never received a ping alert.

**Root cause — two stacked problems:**

1. **Zero eligible riders at checkout.** The order was `payment_method = cash`, so the strict COD candidate query ran (`available` + service `food` + a GPS fix **≤5 min old** + **≤5 km** from pickup + active orders < 2). Against the dev riders: rider 14's last `rider_locations` row is **2026-08-26** (28 days stale, ~10.7 km from the pickup) ✗, riders 18/19 have **no location rows at all** ✗, rider 18 is on `transport` ✗ → `eligible MySQL riders {"delivery_id":6,"count":0,"ids":[]}`. With no candidates **no `booking_dispatch_logs` offer row exists**, so `/rider/dispatch/offers` returns `[]` and the socket `order_received_ping` (which only triggers that HTTP refetch) had nothing to show — the rider UI was correct: there was no offer. The same order paid with GCash would have pinged rider 14 (50 km radius, no freshness window).
2. **`no_rider_available` was a terminal dead end.** `ScheduledDispatchProcessor::dueDeliveryIds()` only selected `scheduled` / stale-`dispatching` rows; dispatch-on-ready (`BusinessOwnerOrderController`, `Order::refreshStatusFromItems`) is gated on `=== 'scheduled'`; `SmartDispatchService::dispatchNow()` would have accepted the state but is only reached from order creation and those scheduled-gated sites. Evidence: delivery 6 sat unchanged for a day (`dispatch_attempts = 0`, `dispatch_retry_at = NULL`) even though the processor docblock promised "no rider available → retry". Additionally **no scheduler process was running at all** on Windows (only `artisan serve` + the socket server), so no time-based task fired.

**Fix (minimal — reuses the canonical `ScheduledDispatchProcessor` loop, no new dispatch system, AGENTS §9):**

- `NearestRiderService` parks `dispatch_retry_at = now + retry_after_minutes` at **both** failure sites: the checkout-time no-candidate park in `dispatchToNearest()` and the wave-exhaustion park in `processTimeouts()`.
- `ScheduledDispatchProcessor::dueDeliveryIds()` also selects due `no_rider_available` rows (`dispatch_retry_at` null **or** past — null heals legacy stuck rows like delivery 6; the attempt cap bounds them so they cannot loop forever).
- `processDelivery()` accepts the parked state under the row lock, captures the **pre-claim** state, and restores `no_rider_available` after a still-failing retry so the merchant-visible state stays accurate (`scheduled` rows still return to `scheduled`); `dispatch_failed` now also clears `dispatch_retry_at`.
- Untouched by design: candidate eligibility, COD gates, offer creation, the atomic accept transaction, `SmartDispatchService` claim guards.

**Environment:** `php artisan schedule:work` started in background (Windows has no cron) so `schedule:dispatch`, `orders:auto-reject-waiting`, `orders:auto-cancel-undelivered`, `payments:reconcile-refunds`, `tracking:cleanup-locations`, `documents:check-expired` actually fire. Disclosed before starting: the first tick auto-rejects order **TT-04436** (paid GCash, `acceptance_deadline` expired ~27 h ago) — intended production behavior; the cash orders (`payment_status = pending`) are not matched by auto-reject and were untouched. **Persistence caveat (checkpoint note):** this `schedule:work` runs inside the agent session only — once the session/terminal closes, nothing runs the schedule. For retries (and every other time-based task) to keep firing, run it persistently: Windows Task Scheduler invoking `php artisan schedule:run` every minute, or a dedicated long-lived console on `php artisan schedule:work`. Recorded in `docs/current-status/known-issues.md` → Deployment / Environment Notes.

**Tests** — new `tests/Feature/DispatchNoRiderRetryTest.php`, **6 tests / 41 assertions**, exercising the REAL `SmartDispatchService` + `ScheduledDispatchProcessor` + `NearestRiderService` end-to-end (COD order so the strict gates apply; `Http::fake` keeps the socket bridge out): checkout failure parks a retry timestamp · backoff window respected · a due retry re-claims and stays `no_rider_available` on continued failure · **recovery proof: a rider who comes online later receives the real pending offer** · exhaustion → `dispatch_failed` terminal · legacy `dispatch_retry_at = NULL` row still claimed.

**Regression checkpoint — GREEN:**

```text
Tests:       365 total → 358 passed / 7 skipped / 0 failures
Assertions:  1,752
Duration:    162.50s
```

Δ vs the previous checkpoint (352 tests / 1,711 assertions / 0 failures / 7 skipped) = **+6 tests / +41 assertions** = exactly `DispatchNoRiderRetryTest`. The 7 skips are the same known environment skips (4 GD-guarded OCR, `OfferingManagementTest` GD, `TouristApiTest` SQLite HAVING, `RepositoryTest` Haversine).

**Operational note (how to see a ping):** a rider must be eligible *at dispatch time* — for cash orders a GPS fix ≤5 min old within 5 km of the restaurant pickup; GCash orders accept any location row within 50 km. Keep the rider app open (socket) with Go Online + the matching service type.

**Dev DB data cleanup (dangling offer rows).** While verifying the live retry, `booking_dispatch_logs` was found to contain **15 impossible rows** from an earlier deliveries reseed that did not clear the log: 11 rows point at delivery IDs that no longer exist, and 4 rows (ids 1, 2, 3, 26 — all `dispatched_at = 2026-08-26`) predate their reseeded delivery by weeks (delivery 6 was created 2026-09-22). Because `dispatchToNearest()` skips candidates found in `$alreadyDispatchedRiderIds` (`WHERE delivery_id = ?`), those rows **silently blocked rider 14 from deliveries 2, 4, 5 and 6** — including the very order that produced the "no ping" report. Deleted with `DELETE bdl ... WHERE d.id IS NULL OR bdl.dispatched_at < d.created_at` (19 → 4 rows; the 4 survivors are legitimate: d1, d3, and the real 2026-09-22 offers to riders 18/19 on d5). Deliveries 5 and 6 were then reset (`dispatch_attempts = 0`, `dispatch_retry_at = NULL`) to start a clean window. No production code change was made for this — the data was factually impossible, so the data layer is the correct fix layer (AGENTS §19).

**Retry bound (by design):** each delivery gets `1 + max_retries` = **5 attempts at 5-minute intervals (~25 min)** of eligibility searching, then `dispatch_failed` (terminal). If no rider is eligible within that window, place a fresh order to test — or add the manual merchant/admin **Re-dispatch** action (now formally deferred as a separate product requirement).

**Live end-to-end confirmation (post-cleanup).** With the rider page open and GPS streaming, the retry at **18:54:24** found rider 14 eligible (fresh fix, ≈4.3 km < the 5 km COD radius) and created a **real offer** — `booking_dispatch_logs` id 35, delivery 6 → rider 14. **Corrected the next day after investigation: the socket ping for that offer was never delivered** — every `POST /dispatch` was answering HTTP 500 `eligibleRiders is not defined` (defect recorded below), so the offer reached the rider UI only through the 4-second `/rider/dispatch/offers` poll — proven live by the `timeout` this same endpoint wrote at exactly 18:56:24. It went unaccepted within the 120-second window and was marked `timeout`, whereupon `processTimeouts()` exercised the second new park site and re-parked the delivery (`no_rider_available` + `dispatch_retry_at = 19:01:24`). Because `$alreadyDispatchedRiderIds` permanently skips riders already offered a given delivery (anti-ping-spam, by design), rider 14 will not be re-offered delivery 6; absent a newly eligible rider the delivery walks its bounded 5 attempts to `dispatch_failed` (~19:16) — expected bounded behavior, not a regression. The clean accept-path test from here is a **fresh order while the rider is ready**.

**Socket bridge defect found & fixed — `eligibleRiders` ReferenceError (realtime ping was 100% dead).** Chasing the unanswered question "did the rider actually see offer #35?", `laravel.log` showed every `POST /dispatch` since the rider page opened failing with HTTP 500 `{"message":"eligibleRiders is not defined"}` — including the 18:54:24 ping for offer #35 (`riderId: 14`). Root cause in `socket-server.js` → `startDispatchChallenge()`: `const eligibleRiders` was declared **inside** the `if (!targetRider)` block but referenced at function scope in the `activeTrips.set(...)` trip record → `ReferenceError` whenever execution reached that line, i.e. (a) a preferred rider was honored (block skipped entirely) or (b) the radar scan found ≥1 rider (binding was block-scoped). The `order_received_ping` emit sits *after* that line, so **no realtime ping was ever emitted in those cases**. The bug was masked historically because an *empty* radar takes the early "no eligible riders" `return` before reaching the crash — which is why the 2026-09-22 18:25 bridge call had answered 200. The file was git-clean (unchanged since the initial commit); it surfaced only now because the rider page was finally open and on the radar after the server restart (2026-09-22 22:52). **Fix (approved minimal scope, 2 statements):** hoist `let eligibleRiders = []` to function scope and *assign* (not re-declare) inside the block — re-declaring would have left the preferred path still undeclared and made the radar path store an empty fallback list. Socket server restarted with the same plain `node socket-server.js` command (`.env` self-load supplies the bridge secret). **Verification:** `npm run test:js` → **45/45**; live bridge probe replaying the exact crash payload (`preferredRiderId: 14`) → `200 {"success":true,"message":"Dispatch ping sent."}` with the server console proving the honored path, `Phase C Match`, and `emitting "order_received_ping"` to rider 14's live socket. HTTP polling worked throughout (4 s poll) and was the only channel carrying #35 — consistent with AGENTS §8.7 (socket = transport, HTTP = recovery). **Known test gap:** `startDispatchChallenge` has no unit seam (`socket-server.js` has no exports and binds its ports on import); extracting the trip-challenge decision into a pure module (the `socket-events.js` pattern) would turn this class of scope bug into a regression test — offered as follow-up.




### Dispatch Reliability P0–P3 — Radar Eligibility Consistency, Live-GPS Freshness, 60-Minute Cycle Deadline: Complete & Verified

**Spec:** master rider-dispatch implementation specification, Priorities 0–3 (B1/B2 fixes). Scope confirmed with the user: P0–P3 this round; B2 = **Option C** (live socket radar as the freshness source); ghost COD delivery #3 left unsettled for the user to settle later with the real cash — the B1 fix makes it non-blocking at limit 2.

**Verified failure recap (three stacked causes — delivery #8 / order #13, 2026-09-23 05:51:38):**
1. Rider 14 became `available` 18 s AFTER checkout → primary COD query = 0 eligible riders.
2. The radar fallback then blanket-excluded rider 14 via `getBusyRiderIds()` because unsettled COD delivery #3 still bound them — a rule the primary COD path does NOT apply (it only enforces `cod_active_order_limit = 2`). Inconsistent rules for the same rider.
3. No scheduler process was running → `dispatch_retry_at = 05:56:40` never executed. Additionally `dispatchNow()` returned silently BEFORE `dispatch_started_at` was recorded when business coordinates were null (a second, previously-undocumented dead end: `waiting_for_rider` is a status `dueDeliveryIds()` never selects).

**Fixes**

| Layer | Change |
|---|---|
| **B1** — radar loop in `NearestRiderService::dispatchToNearest()` | Blanket `getBusyRiderIds()` exclusion now applies to **non-COD only** (it mirrors the non-COD primary query's one-active-delivery rule). COD radar candidates go through the same gates as `findNearestEligibleCodRiders()`: approved → available → food service → ≤5 km on **live** coordinates → `passesCodActiveOrderLimit()`. `$isCod` hoisted out of the per-rider loop. |
| **B2 (Option C)** — GPS freshness | MySQL `rider_locations` stays the persistent source with its 5-min gate; the live radar is the freshness **source** when `updatedAt` is within the new `delivery.radar_location_max_age_seconds` (default **120 s**, mirroring `socket-validation.js` `LIMITS.radarStaleMs`). `/status` returns raw unfiltered entries, so Laravel now applies this window itself; null `updatedAt` = never stamped → treated fresh (the entry still must pass every COD gate). |
| **P3** — cycle deadline (§17/§19/§49/§54) | Derived deadline: `orders.dispatch_started_at + delivery.scheduler.dispatch_deadline_minutes` (default **60**, env `DISPATCH_DEADLINE_MINUTES`). Enforced at ONE authoritative layer — the `dispatchToNearest()` entry — so scheduler retries, decline/timeout re-offers (`redispatchIfOffered`) and dispatch-on-ready all inherit it; `ScheduledDispatchProcessor` additionally checks pre-claim (no attempt burned) and post-attempt. |
| **P3** — no silent dead ends | `dispatchNow()` records `dispatch_started_at` BEFORE any coordinate guard and no longer early-returns on null business coordinates; null pickup coordinates park via `parkForRetry()` instead of a bare `return`. |
| **P3** — observable termination | Migration `2026_09_23_000001_add_dispatch_end_fields_to_deliveries_table` adds `deliveries.dispatch_ended_at` + `deliveries.dispatch_end_reason`. Terminal reasons wired at the canonical sites: `rider_accepted` (accept transaction), `order_cancelled` (`cancelDelivery`), `no_rider_accepted` (attempt cap / deadline), `invalid_pickup_coordinates` (derived at terminal time). `failDispatch()` writes terminal state under a `rider_id IS NULL` + not-already-failed guard. |
| Retry window sizing | `delivery.scheduler.max_retries` default 4 → **11** (1 + 11 × 5 min ≈ 60 min) so the retry loop can actually span the deadline instead of dying at ~25 min. Suites that pin `max_retries = 3` are unaffected. |
| Diagnostics (§57/§58) | `[COD Dispatch] delivery=N eligible riders=N riders=[…]` on every attempt; when 0, `logCodExclusionDiagnostics()` evaluates every rider account in PHP and logs per-rider reasons (`gps_stale(60.4min)`, `wrong_service(transport)`, `too_far(…)`, `active_order_limit`, `not_available(…)`, `gps_missing`, `wrong_municipality`, `already_offered`). Radar-loop skips logged as `[COD Dispatch] radar exclusions`. Rider browser: `[Rider] order_received_ping received — fetching dispatch offers` / `[Rider] dispatch offers received N`. |

**Deliberate spec deviation (recorded):** `deliveries.dispatch_expires_at` was **not** repurposed to the 60-minute cycle. It already carries the **wave/offer deadline** — `offerExpiresAt()` bounds offers by it, `AdminMapController` uses `whereNull` as "actively dispatching", and ~10 test fixtures assert its wave semantics — and every wave overwrites it. Repurposing would break working components the same spec says to preserve. The cycle deadline is therefore **derived** from `orders.dispatch_started_at`; all §17 required fields exist (`dispatch_started_at`, `dispatch_expires_at` [wave], `dispatch_retry_at`, `dispatch_ended_at`, `dispatch_end_reason`).

**Tests** — new files, **+16 tests / +138 assertions** (isolated runs):
- `DispatchRadarEligibilityConsistencyTest` **10 / 50** (§62/§63): stale-DB + live-radar offer (the field case) · missing-DB + live-radar offer · stale radar entry not trusted · **below-limit COD rider with one unsettled delivered COD still gets the radar offer** (B1 regression — pre-fix: excluded) · at-limit excluded on radar · above-limit excluded on radar · at-limit excluded on the **primary** path too (consistency) · terminal unrelated delivery stays eligible · non-COD active delivery still excluded on radar (one-active-delivery preserved) · non-COD free rider gets a radar offer (control). The non-COD cases stub only `findNearestAvailableRiders()` — its raw `ACOS/COS/RADIANS` distance SQL is MySQL-only (SQLite cannot run it; every existing non-COD test stubs the same seam) — while the **real radar loop** runs.
- `DispatchDeadlineTest` **6 / 88** (§17/§19/§64): null-coords business parks with retry **and records the cycle anchor** (pre-fix: silent return, no anchor, stranded `waiting_for_rider`) · null-coords → terminal `invalid_pickup_coordinates` at the attempt cap · expired cycle terminated pre-claim by the scheduler with `no_rider_accepted` and **no attempt burned** · direct `dispatchToNearest()` respects the deadline (covers decline/timeout re-offers) · accept records `rider_accepted` + `ended_at` · cancel records `order_cancelled`.
- §64's "retry due + deadline active + rider appears later" remains covered by `DispatchNoRiderRetryTest::test_parked_delivery_recovers_once_a_rider_becomes_eligible` (preserved, green).

**Regression checkpoint — GREEN:**

```text
Tests:       381 total → 374 passed / 7 skipped / 0 failures
Assertions:  1,846
Duration:    144.28s
```

Δ vs the previous checkpoint (365 tests / 1,752 assertions / 0 failures / 7 skipped) = **+16 tests** = exactly the two new files. The 7 skips are the same known environment skips (4 GD-guarded OCR, `OfferingManagementTest` GD, `TouristApiTest` SQLite HAVING, `RepositoryTest` Haversine). Protected suites re-run green before the full run — `DispatchNoRiderRetryTest` + `ScheduledDispatchProcessorTest` + `DeliveryOfferConcurrencyTest` + `RiderBusyReleaseTest` + `OrderSizeDispatchEligibilityTest` + `RideHailingAcceptanceTest` + `CodFinancialSettlementTest` + `CodDeliverySettlementTest` = **56 passed / 454 assertions**: retry loop, offer concurrency/atomic accept, one-active-delivery, order-size gating, ride-hailing and both COD settlement suites untouched-green — **settlement code was not modified** (per instruction; the bug was before rider acceptance). Socket JS suite re-run clean: **46/46 passed / 0 failed** (no `socket-server.js` changes); frontend `npm run build` clean (covers the `RiderDispatchNotification.tsx` logging change).

**Database verification (per §11):** `php artisan migrate --force` → `2026_09_23_000001_add_dispatch_end_fields_to_deliveries_table … DONE` on dev MySQL (`track_tour_db`); `SHOW CREATE TABLE deliveries` shows `` `dispatch_ended_at` timestamp NULL `` after `dispatch_failed_at` and `` `dispatch_end_reason` varchar(255) NULL ``; a zero-row `UPDATE` write probe against both columns was accepted (no data mutated); `deliveries_order_id_unique` was incidentally re-verified when the first probe form hit it. Note: this migration shares the `2026_09_23_000001` numeric prefix with the auto-accept migration — harmless, rows are recorded by full filename and each ran exactly once.

**Live verification of the whole P3 chain (dev environment):**
- §58 diagnostics are live: `[COD Dispatch] exclusion diagnostics {"delivery_id":8,"exclusions":{"14":"gps_stale(60.4min)","18":"wrong_service(transport)","19":"gps_stale(1198.1min)"}}` — "0 eligible riders" now explains itself.
- The original field-failure **delivery #8** was terminated by the running scheduler at the first post-deadline tick: retry due 06:56:08 → `schedule:dispatch` 06:57:02 → `dispatch_failed`, `dispatch_ended_at=06:57:03`, `dispatch_end_reason=no_rider_accepted`, `retry_at=NULL`, attempts stayed **8** (pre-claim, no attempt burned), `offers ever created = 0`. Previously it looped invisibly forever.
- Legacy parked delivery #2 (2026-09-04) stays parked **by design**: its order is `cancelled_by_tourist` → outside `DISPATCHABLE_ORDER_STATUSES` → `dueDeliveryIds()` never selects it.
- `php artisan schedule:work` is running **in this agent session only** (repeat of the persistence caveat): for retries to keep firing after the session closes, use Windows Task Scheduler → `php artisan schedule:run` every minute (recorded in `docs/current-status/known-issues.md`).

**Operational fast-path to see a live ping (spec §56):** scheduler running → settle any delivered-unsettled COD with the real cash (`POST /rider/deliveries/{id}/settle-cod`; delivery #3 left for the user by decision) → rider `available` + rider app open (socket) + GPS fresh ≤5 min within 5 km → place a COD order → expect `eligible riders > 0` → `booking_dispatch_logs` row → `POST /dispatch` 200 → `order_received_ping` → offer card (or the 4 s poll fallback).

**Known deferred (P4–P6):** pickup geofence + explicit pickup confirmation, grouped pickup sequencing + preparation-aware/dynamic routing (preparation-time **ordering** now shipped in the Manual Purchasing Cash + Prep-Time Pickup Routing checkpoint; dynamic re-sequencing and grouped pickup **routing** remain open), and a §22 multi-rider-wave policy review (current wave = simultaneous offers to all eligible candidates within the 120 s window — unchanged this round).

**Probe scripts left in repo root (uncommitted, diagnostics only, safe to delete):** `tmp_cod_probe.php`, `tmp_cod_gate_autopsy.php`, `tmp_cod_why_zero.php`, `tmp_dispatch_end_verify.php`.

---

### Manual Purchasing Cash + Prep-Time Pickup Routing: Reconciliation In Progress

Preserves Tourism Office issuance as a manual action for each COD delivery and routes the rider's pickup leg by restaurant preparation time, with the last pickup as the drop-off origin and visible time/distance/destination.

**1. Manual purchasing cash issuance**
- `PurchasingCashService::initializeForDelivery()` creates or reuses the per-restaurant `cod_purchases` stop rows at rider acceptance; it does not issue cash.
- Tourism Office issuance remains available through the authorized `POST /admin/deliveries/{id}/issue-purchasing-cash` action, with audit logging and duplicate-issuance protection.
- The assigned rider must confirm receipt after issuance. Purchase-stop completion and COD pickup confirmation are both blocked until issuance and receipt are recorded; the `picked_up` ALL-COLLECTED gate is unchanged.

**2. Prep-time pickup ordering + drop-off origin**
- `PurchasingCashService` gains `businessPrepTimes()` (per-business **MAX of that restaurant's `order_items.preparation_time`** snapshot), `pickupStops()` (stops ordered **ascending prep** — shortest prep picked up first), and `pickupOrigin()` (**last stop / longest prep** becomes the pickup-side origin of the drop-off leg, falling back to the delivery's pickup coordinates/address).
- `RiderPurchasingController::purchases()` now returns each stop with `sequence`, `preparation_time`, `pickup_lat/lng`, `pickup_address`, plus a `pickup_origin` block and `dropoff { latitude, longitude, address }` from `deliveries.delivery_*` (business coords/address from `businesses.*`).

**3. Frontend routing by prep order**
- `useOsrmRoute` rewritten as multi-waypoint (`waypoints: [lng,lat][], enabled`) returning `{ points, distanceKm, durationMin }`, keyed by the joined coordinate string (no array-ref dep churn). OSRM base unchanged.
- `RiderMap` builds the pickup leg as **rider → every stop in prep order** and the drop-off leg as **last pickup → destination**; adds a **planned drop-off route** preview during the pickup stage (time + distance + destination address) and ETA labels on the trip-status banner; stop rows show a **sequence badge + ~X min prep**; numbered amber stop markers render in prep order; the rider sees the Tourism Office issuance/receipt state.
- `TouristTransportTracking` updated to the new hook API (`[riderPos, liveTarget]` → `liveRoute.points`); its live-rider live segment behavior is unchanged.

**4. Tests**
- `PurchasingCashFlowTest` and `CodOrderToSettlementFlowTest` now cover manual issuance, rider receipt, collection/pickup gates, and the end-to-end settlement path.
- `GroupItemRejectionRefundTest` verifies the retired item-rejection route returns 404 and that the generic status endpoint rejects `rejected` without mutating paid group items or recording refunds.

**5. Regression checkpoint — COD flow green; known rating-suite failures remain**

```text
Full Laravel suite: 561 passed / 3 failed / 2 skipped
Assertions:        3,080
Targeted COD and item-status suites: 35 passed / 597 assertions / 0 failures
Frontend UI:       128 passed / 18 files / 0 failures
Socket JS:         51 passed / 0 failures
Frontend build:    passed
```

The three full-suite failures remain in the previously documented `TouristConfirmRatingPersistenceTest` rating flow (rating requests receive 422 instead of 200, and the expected persisted delivery rating is absent); they are outside this COD merge change. The two skips were reported by PHPUnit; this run did not enumerate their names. No schema change is required — the existing `cod_purchases` and `deliveries.purchasing_cash*` schema is reused.

**Known deferred (P4–P6)** now: pickup **geofence** + explicit pickup confirmation (P4) and a **multi-rider wave** policy (P6) remain; prep-aware pickup sequencing is now partially delivered (prep-time ordering), with dynamic/grouped pickup **routing** refinements still open (P5).

---

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

### Restaurant Order Redesign — Automatic Preparation Lifecycle: Complete & Verified (2026-09-23)

**Scope:** Restaurants no longer Accept/Reject orders. A delivery order sits in `waiting_restaurant` (*Finding Rider*) until a rider accepts; rider acceptance then auto-transitions the order to `preparing` and arms a countdown derived from owner-configured per-food `preparation_time`, auto-flipping to `ready` at 00:00. Pickup orders start preparation at placement (no rider). Orders with no rider wait indefinitely — never auto-cancelled.

**Implementation summary — backend**

- Removed the order-level accept / reject / accept-all and item-level accept / reject routes and controller methods entirely (per-dish out-of-stock reject/refund flow retired); removed all frontend callers.
- New canonical `PreparationStartService` owns `waiting_restaurant → preparing` (including payment capture moved out of the removed accept endpoints) and `preparing → ready`; row-locked and idempotent.
- Prep-start hooks: `NearestRiderService::handleRiderResponse` (before `DeliveryAssigned`), `FoodController::store`, `GroupOrderService`, `PaymentController::markPayablePaid`; `BusinessOwnerOrderController::startPreparation` delegates to the service.
- Timer math: `effective = max(1, MAX(order_items.preparation_time snapshot) − reduction)`, snapshotted to `orders.preparation_time` / `predicted_preparation_seconds` / `predicted_ready_at`; quantity never multiplies; menu edits never mutate an in-flight timer.
- Priority tips: `restaurant_settings.priority_preparation_reduction_enabled` + per-tier minutes (defaults off), configured via `GET /restaurants/{id}/preparation-settings` and `PATCH /restaurants/{id}/settings/preparation` (owner-only → 403).
- Scheduler: `orders:advance-preparation` every minute (promote eligible waiting orders + complete due timers). `AutoRejectWaitingOrder` and its schedule entry deleted (`never auto-cancel`).
- Dispatch priority: `ScheduledDispatchProcessor::dueDeliveryIds()` orders `COALESCE(orders.rider_tip,0) DESC, deliveries.scheduled_at` (no `SmartDispatchService` rewrite).
- `preparation_time` validation (nullable integer 0–240) on offering/food/menu store+update; exposed through `OfferingResource` / `OrderResource`.
- `Offering`, `OrderItem`, `Order`, `RestaurantSetting` models updated.

**Database verification (done)**

- 3 migrations created, applied to the development database, and verified with `SHOW CREATE TABLE` + a live write probe (probe deleted afterward):
  - `2026_09_23_100000_add_preparation_time_to_offerings_table`
  - `2026_09_23_100001_add_preparation_time_snapshots_to_orders_table`
  - `2026_09_23_100002_add_priority_preparation_reduction_to_restaurant_settings`

**Implementation summary — frontend**

- `STATUS_LABELS` map (`waiting_restaurant → Finding Rider`) applied in `StatusBadge`; backend vocabulary untouched.
- `BusinessOwnerOrders` rewritten: tabs (All, Pending, Preparing, Ready, Picked Up, Out For Delivery, Delivered, Completed, Cancelled), server-side status filter, Preparation countdown column, Priority column; View-only row actions.
- `BusinessOwnerOrderShow`: "Food Preparation" card (Preparation Time, live Time Remaining, Estimated Ready, Priority) + finding-rider guidance; accept/reject mutations removed.
- Shared `PreparationCountdown` component (ticks against server `predicted_ready_at`).
- `TouristFoodCart`: ₱25 / ₱50 / ₱100 tip presets with selection gate (tips feed dispatch priority).
- Preparation Time inputs added to food/menu/offering create + edit forms.

**Tests added / reconciled**

- New: `RestaurantPreparationTimerTest` (11 tests) and `PreparationStartServiceGateTest` (5 tests).
- Reconciled: `RiderAcceptanceGateTest` (accept-driven flows rebased on rider acceptance; `preparing` is now a single rider-acceptance-triggered transition), `RealtimeCompletenessTest` (business-reject realtime bridge test retired — no producer remains), `RestaurantSubOrderItemsLifecycleTest` (restaurant accepts → 404 + auto-start).
- Deleted: `GroupItemRejectionRefundTest` — the entire per-dish reject/refund flow it covered was retired by decision; its invariants (reject never causes preparing, refund integrity) are covered by the removed-endpoint 404 tests and the refund-hardening suite.

**Regression results**

```text
Laravel: 386 passed / 1,937 assertions / 0 failures / 7 skipped (393 total)
         (7 skipped = known environment skips: 5 GD, 2 SQLite-only)
Socket JS: 45/45 pass (tests/js/socket-realtime.test.js carries prior uncommitted additions)
Frontend:  npm run build clean (pre-existing chunk-size warning only)
```

The 5 `PreparationStartServiceGateTest` tests are included in the totals above (+5 tests / +41 assertions vs the 381 / 1,896 pre-gate figure): no test had previously referenced `PreparationStartService` by name, so the §4.2 gate was only reachable indirectly through HTTP — the new file pins the canonical layer every caller funnels through. Two further defects found and fixed while reconciling the retired-route tests: `ScheduledDispatchProcessor::dueDeliveryIds()` used an unqualified `updated_at` (ambiguous after the `leftJoin('orders')` → `deliveries.updated_at`), and `PaymentApiTest` expected a paid pickup order to remain `waiting_restaurant` (reconciled to `preparing` — the gate is delivery-only).

**Architectural decisions**

- Labels are display-only; no DB status renames or vocabulary changes.
- Canonical fields reused (`predicted_ready_at`, `predicted_preparation_seconds`, `preparation_started_at`, `food_ready_at`, `rider_tip`); no new timer table.
- `PreparationStartService` is the single canonical prep lifecycle owner — the minute scheduler is a backstop, not a second implementation.
- Never auto-cancel: riderless orders wait indefinitely (auto-reject removed rather than re-parameterized).

**Known deferred items**

- Admin module (AGENTS §15) and P12.5 wallet backfill remain planned and untouched by this phase.
- Ledger-delivery audit enhancement stays LOW priority (AGENTS §17).

---

### COD Ping Root Causes — GPS Heartbeat, Radar Liveness, Timed-Out Re-Offer, Socket Reconnect: Complete & Verified (2026-09-23)

**Context.** The reported symptom was "the rider never receives the COD order ping." Diagnosis established that Socket.IO **transport was never the failure point** — no offer row existed to ping, and the one offer that did exist (id 37) timed out and could not be reissued. Four independent root causes, all confirmed in code before any change.

**Root causes & fixes**

| # | Root cause | Evidence | Fix |
|---|---|---|---|
| **A** | **MySQL GPS aged out → `gps_stale`.** COD eligibility drops a rider whose latest `rider_locations.recorded_at` is older than `cod_location_max_age_minutes` (5 min). The only MySQL writer was `RiderMap`'s `watchPosition`, which runs only while `/rider/map` is mounted and never fires for a **stationary** rider; socket telemetry is explicitly *zero-DB-write* and cannot help. | `socket-server.js:250`, `RiderMap.tsx:294`, `NearestRiderService.php` (5-min gate) | **Heartbeat in `DashboardLayout`**: while `roleLabel === 'Rider'` and `riderOnline`, POST `/rider/map/location` every **60 s** (`RIDER_LOCATION_HEARTBEAT_MS`). `DashboardLayout` is mounted for every `/rider/*` route, so freshness no longer depends on the map page or on movement. |
| **B** | **Radar entries always stale.** `driver_go_online` is the only thing that stamps radar `updatedAt` for an idle rider — `rider_location_update` is ownership-gated to the *assigned* rider, so a rider with no delivery can never refresh it. `useRiderSocketReceiver` registered **once per connect**, then never again; `isRadarEntryEligible()` drops entries after `LIMITS.radarStaleMs` (120 s), and Laravel's radar fallback applies the same window → every online-but-parked rider aged out after 2 min as `radar_gps_stale`. | `useRiderSocketReceiver.ts`, `socket-validation.js:17`, `socket-server.js:264` | **Periodic re-registration**: re-emit `driver_go_online` every **60 s** (`RADAR_REFRESH_MS`) while connected + online — comfortably inside the 120 s window. |
| **C** | **`already_offered` was permanent.** `alreadyDispatchedRiderIds` matched **every** prior offer row regardless of `response`, so one TIMED-OUT offer excluded that rider from the delivery forever — and `UNIQUE(delivery_id, rider_id)` forbade a second row, leaving **no path back**. A single-candidate town dead-ended while diagnostics reported `already_offered`. | `NearestRiderService.php` (offer filter, wave loop, radar skip, diagnostics) | **Re-offer after timeout**: `response = 'timeout'` rows are re-offerable; the reopen is `BookingDispatchLog::updateOrCreate` (an UPDATE of the one row, never a second insert). Wave sequencing and the state machine are untouched: `pending`/`declined`/`accepted` still block, so live offers are left alone and a decline stays final. Reopening removes **only** the already-offered blocker — all other COD gates still apply. Diagnostics no longer labels a re-offerable rider `already_offered`. |
| **D** | **Socket gave up after 3 attempts.** `reconnectionAttempts: 3` × 2 s exhausted in ~6 s, after which the socket stayed dark until a full page reload — the rider silently vanished from the radar (the observed connect/disconnect cycle). | `useRiderSocketReceiver.ts:86-88` | `reconnectionAttempts: Infinity` + `reconnectionDelayMax: 30000` (backoff). |

**Finding recorded (no change):** `useRiderSocketDispatch.ts` — source of the often-cited 180 s idle telemetry interval, which itself exceeds the 120 s radar window — is **never imported anywhere**. It is dead code; fix B was therefore applied to the live hook (`useRiderSocketReceiver`) instead.

**Tests** — new file, **+5 tests / +31 assertions**:
- `DispatchTimedOutReofferTest` **5 / 31** — timed-out offer reopened for the same rider (row reverted to `pending`, `dispatched_at` re-armed, `dispatch_expires_at` restored) · reopen **reuses the single row** (UNIQUE backstop verified by asserting the same `id`) · `declined` never re-offered · an in-flight `pending` offer is never duplicated nor re-armed · reopening does **not** bypass the other COD gates (rider taken offline → no offer, row stays `timeout`).

**Reconciled test (AGENTS §12 — drift documented):** `DeliveryOfferConcurrencyTest::test_accept_after_offer_expiry_times_out_and_reoffers` asserted that a timed-out rider stays excluded forever. That was the implementation artifact behind the dead end, not a documented rule — `docs/business-rules/rider-dispatch.md` governs **wave sequencing** ("re-offered to the next candidate only once the wave is exhausted; live offers are left alone"), which is preserved. Assertion updated to `pending`, with the reasoning written inline; every other assertion in that test is unchanged (accept still 409-times-out, no rider assigned, fresh rider B still receives the offer).

**Business rule documented:** `docs/business-rules/rider-dispatch.md` now states the timeout-re-offer rule explicitly, including that it stays bounded by the 60-minute dispatch deadline and `1 + max_retries`.

**Regression checkpoint — GREEN:**

```text
Laravel:  391 passed / 1,968 assertions / 0 failures / 7 skipped (398 total)
Socket JS: 45/45 passed / 0 failed
Frontend:  npm run build clean (pre-existing chunk-size warning only)
Lint:      oxlint on both touched frontend files → 0 errors
           (2 pre-existing `set-state-in-effect` warnings in an unrelated menu effect)
```

Δ vs the previous checkpoint (386 passed / 1,937 assertions) = **+5 tests / +31 assertions** = exactly `DispatchTimedOutReofferTest`.

**Architectural decisions**

- Fixes target the **eligibility/liveness** layer only. The spec's separate **PING-honesty** workstream (G1–G6: honest notification state, honest bridge response, ping persistence, retries, Level-3 client ack) is **untouched** and still awaits its checkpoint (`docs/architecture/dispatch-ping-reliability-spec.md`).
- No change to atomic acceptance, delivery ownership, the offer state machine, cancellation, the ALL-COLLECTED gate, COD settlement, `SmartDispatchService`, or Socket.IO infrastructure (spec §9 / AGENTS §9).
- The re-offer is bounded by existing P0–P3 machinery (60-min cycle deadline, `1 + max_retries`, `dispatch_end_reason`) rather than by any new limit.
- The original failure diagnosis stands: **eligibility + offer lifecycle, not the socket transport.** Preserve it for future "rider never got a ping" reports — a transport-level investigation would have missed all four causes.

**Known deferred**

- `dispatch-ping-reliability-spec.md` G1/G3 and its P1–P12 test matrix — awaiting checkpoint agreement.
- `known-issues.md` MED item 4 — offer timeout remains **poll-driven** (`processTimeouts()` has no scheduled runner). Note the interaction: with fix C a timed-out offer now reopens on the next cycle, but the *transition* to `timeout` still waits for a rider poll.
- `useRiderSocketDispatch.ts` left in place as dead code (deletion is a separate cleanup decision).

---

### Rider Availability Toggle — False Failure Was Dev-Server Saturation, Not the API: Complete & Verified (2026-09-23)

**Reported:** every tap on the rider **Go Online / Go Offline** button showed `Unable to change availability right now.` Browser on `http://localhost:3000`, failing **every single tap**.

**Ruled out first (measured, not guessed):**

| Probe | Result |
|---|---|
| `POST /rider/availability/toggle` → direct `:8000` | **200** in 4,014 ms |
| same request → Vite proxy `:3000` | **200** in 2,631 ms |
| Any controller path returning no `message` | none — 409 and 200 both carry one |
| Laravel log entry for the failure | none (only my own failed tinker command) |
| ngrok URL | dead — 404 for `/`, `/login` and `/api/*`, no process, no `:4040` listener |

The endpoint was **healthy on every hop**. The message is `err.response?.data?.message || 'Unable to change availability right now.'`, so it can *only* appear when there is **no response at all** (timeout/abort) or a **non-JSON error body** (`.message` undefined).

**Root cause — single-threaded `php -S` saturation:**

```text
php -S capacity     0.87 req/s   (1,148 ms/request, serialized)
rider-app demand    ~0.9–1.0 req/s
    offers poll 4s → 0.25/s · GPS post 3s → 0.33/s · map queries 10s → 0.3/s · misc
        ↓  demand > capacity
queue grows without bound
        ↓
30 queued requests = 34,451 ms  >  axios timeout 30,000 ms
        ↓
err.response === undefined  →  catch-all message
```

Two factors made it **every** tap rather than intermittent: an axios timeout aborts only the *client* while the server keeps processing the abandoned request, so each failed tap **added** load instead of releasing it; and React Query retries compounded it.

**`PHP_CLI_SERVER_WORKERS` does not work on Windows** — this was the fix originally chosen, and it is a no-op. PHP *receives* the variable (verified `getenv()` returns `4`) but the built-in server never forks (worker forking needs `fork()`): a 12-way burst measured **12,585 ms with it set vs 12,589 ms without**, 1 PID either way. Verified before applying rather than shipped as a silent non-fix.

**Fix — proxy the frontend to XAMPP Apache** (`mpm_winnt`, `ThreadsPerChild 150`), which was already running and already had `php_module` loaded via `conf/extra/httpd-xampp.conf`. Only the Vite proxy target changed; **no Apache config, no frontend URL, no backend code change.**

| Scenario (12 / 30 concurrent through `:3000`) | Before `php -S` | After Apache |
|---|---|---|
| 12-way burst | 13,894 ms | **7,396 ms** |
| 30-way burst (the timeout trigger) | **34,451 ms** → tail > 30 s | **11,614 ms**, 30/30 ok |
| 30-way with an explicit 30 s client timeout | guaranteed timeouts | **16,832 ms, 0 timeouts** |
| Steady-state throughput | 0.87 req/s (**<** demand) | **1.59 req/s** (**>** demand) |

Synthetic 12 × 1 s probe: `php -S` 12,585 ms/1 PID vs Apache **2,639 ms** (`apache2handler`) ≈ 4.8× capacity. The toggle itself now returns `200 available` → `200 offline` through the real browser path in 7,619 ms / 1,316 ms.

**Costly diagnosis gotcha — `frontend/vite.config.js` was the config Vite loads.** Both `vite.config.js` and `vite.config.ts` existed; Vite resolves `.js` first, so a corrected `.ts` was **silently ignored** while `.js` kept proxying to `:8000`. Confirmed by stopping `php -S` and watching the proxy return `502`. **Resolved 2026-09-23:** `.js` had drifted back to `:8000` a second time (re-introducing the `php -S` path that caused the original false toggle failures), so **`vite.config.js` was deleted** — `vite.config.ts` is now the sole config. Deleting the loaded config made Vite 8.1.5 re-resolve **in-process** (same PID, proxy target flipped `php -S` → Apache) with no manual restart; restart Vite if a config edit ever appears to have no effect.

**Demand side surveyed, deliberately left alone:** global React Query is already `retry: 1` / `staleTime: 5 min`, and the rider queries use `retry: false` — there is no retry-storm amplifier. Remaining demand (offers 4 s, GPS 3 s) is spec-mandated dispatch/tracking behaviour, and capacity now exceeds it, so no polling was changed.

**Topology change:** `php artisan serve :8000` stopped and is now **redundant**; the browser → Vite `:3000` → Apache `:80` → `public/`. Apache must be running or API calls return `502`. Revert path: restore `target: 'http://localhost:8000'` in **`vite.config.ts`** (the only config since `vite.config.js` was deleted), restart Vite, restart `php artisan serve` — use only if Apache is unavailable.

**Regression checkpoint — GREEN:**

```text
Laravel:   394 passed / 2,131 assertions / 0 failures / 7 skipped (401 total)
Socket JS: not re-run (no socket changes; 45/45 last known)
Frontend:  npm run build clean (pre-existing chunk-size warning only)
Lint:      oxlint on DashboardLayout.tsx → 0 warnings, 0 errors
```

Δ vs the previous checkpoint (391 passed / 1,968 assertions) = **+3 tests / +163 assertions**, from your `d66992d` commit, not from this change. The 7 skips are the documented environment skips (4 GD OCR, 1 GD offering, SQLite HAVING, SQLite Haversine).

**Architectural decisions**

- Only the **dev-server capacity** layer changed. No change to `toggleAvailability`, the optimistic UI, the offer state machine, dispatch, or Socket.IO.
- The earlier "optimistic UI only, no `PHP_CLI_SERVER_WORKERS`" constraint was honoured for the *slowness* complaint; lifting it was necessary only because this was proven to be a **functional** failure, and the measurement showed that exact knob cannot work on Windows regardless.
- `DashboardLayout` error handling was made self-diagnosing (timeout vs unreachable vs non-JSON `N`) so this failure class is reportable next time instead of collapsing into one string.

**Known deferred**

- ~~Duplicate `frontend/vite.config.ts` — inert but misleading; deletion is a cleanup decision.~~ **Closed 2026-09-23:** the duplicate that actually caused trouble was **`vite.config.js`** (it resolves first and had drifted back to `:8000`), so **`.js` was deleted** and `vite.config.ts` is the sole config.
- `php artisan serve :8000` left stopped; restart it only if reverting the proxy.
- Apache is now a **hard dependency** of the dev frontend (no independent fallback if XAMPP is closed).

---

### Rider "Go Online" — Page-Remount "Refresh" + Stale Proxy Regression: Complete (2026-09-23)

**Reported:** tapping **Go Online / Go Offline** made the page look like it had refreshed (content area blanked, map redrew) and the button sat in a slow "loading" state before flipping.

**Three separate causes:**

1. **Unconditional navigate + keyed outlet = full page remount.** `DashboardLayout.toggleRiderAvailability()` always called `navigate('/rider/map')` — even when already standing on it — and the content outlet is keyed by path: `<Suspense fallback={<div />}><Outlet key={location.pathname + location.search} /></Suspense>`. Any path change unmounts the outgoing page and the **empty fallback renders a blank content area** while the lazy `RiderMap` chunk suspends, which reads exactly as "the page refreshed".
   *Fix:* navigate only when `location.pathname !== '/rider/map'` (both the optimistic and the busy/409 path), and replaced the empty `<div />` fallback with a labelled skeleton (`role="status"`, heading block + `h-[55vh]` panel). A genuine navigation still remounts (intended — that is a page change) but now shows a skeleton instead of white.
2. **`frontend/vite.config.js` had drifted back to `target: http://localhost:8000`.** `.js` resolves before `.ts`, so the whole API was again going through the single-threaded `php -S` — the exact regression that caused the original false "Unable to change availability right now." failures. **Deleted `frontend/vite.config.js`**; `vite.config.ts` (Apache) is now the only config. Removing the loaded file made Vite 8.1.5 re-resolve **in-process** (same PID 1304) and the proxy target flipped `php -S` → Apache with no manual restart, so the open dev session survived. `php -S :8000` now refuses connections (`code=000`) and is dead, as documented above.
3. **Dominant remaining slowness = Laravel boot, not the transport.** OPcache is commented out in `C:\xampp\php\php.ini` (`;zend_extension=opcache`, `;opcache.enable=1`) and no `config`/`route` cache exists (`bootstrap/cache/` holds only `packages.php` + `services.php`). **Not applied — needs explicit approval** (system-level php.ini edit + Apache restart, and `config:cache` changes the config-edit workflow). Recorded in `docs/current-status/known-issues.md` as OPEN.

**Measurements (2026-09-23):**

| Probe | stale `.js` → `php -S` | after deletion → Apache |
|---|---|---|
| 12-way burst through Vite proxy | 5,471 ms | 5,552 ms |
| single `/api/user` via proxy | — | 896 / 1,111 / 932 ms |
| single `/api/user` direct Apache | — | 974 / 803 / 787 ms |
| bare Laravel 404, direct Apache | — | 1,769 / 1,673 / 5,046 / 5,277 / 1,990 ms |

The burst is unchanged by the swap **because Laravel boot (point 3) is now the bottleneck** — the swap still matters because it removes the dead `php -S` path and its unbounded queue.

**Toggle verified through the real proxy path:** `POST /api/rider/availability/toggle` → `2,728 ms "You are now offline."` → `987 ms "You are now online."`, and `rider_details.rider_status` was restored to `available` in MySQL afterwards (demo state untouched).

**Verification:** `npm run build` clean (pre-existing chunk-size warning only); `tsc --noEmit` and `oxlint` → 0 findings on `DashboardLayout.tsx`. No PHP source changed, but the full suite was run anyway for the regression rule:

```text
Laravel: 394 passed / 2,131 assertions / 0 failures / 7 skipped (401 total)
          7 skipped = known environment skips (5 GD, 2 SQLite-only)
```

**Known limitation:** no desktop browser was connected to the session, so the *button-tap* reload could not be observed live — cause 1 explains the blank/remount and cause 2 explains a real document reload whenever either `vite.config.*` was saved (Vite restarts → `location.reload()` on every open tab). Confirm by tapping Go Offline → Go Online and checking DevTools → Network for a `document` request.

### Business Settings — Payment Methods (Cash / Online): Complete (2026-09-24)

The Business Settings **Payments** tab (previously "This section is coming soon.") is now a working payment-preference surface, and orders record **cash vs online** payment exactly as configured.

The `businesses.payment_methods` JSON column existed end-to-end (DB → model cast → `BusinessResource`) but was inert: never editable by the owner, never enforced at checkout, and never rendered. This phase activates the canonical column instead of adding a new settings table.

- **Backend — persistence:** new `PUT /api/business-owner/businesses/{business}/payment-methods` → `BusinessOwnerBusinessManageController::updatePaymentMethods`. Validates `payment_methods` as a non-empty array of `in:cash,gcash,card`, normalizes to lowercase + de-dupes, persists, and returns `BusinessResource` (which already includes `payment_methods`). Mirrors the existing dedicated `/hours`, `/profile`, `/logo` settings endpoints, so payment changes do **not** trigger the re-approval reset that the general `update()` flow applies.
- **Backend — model helper:** `Business::acceptsPaymentMethod(string $method)` next to `isAcceptingOrders()`. **Null/empty `payment_methods` = accepts all methods** (backward-compatible default: existing businesses are unaffected until the owner explicitly restricts).
- **Backend — checkout enforcement** (authoritative layer, both order paths):
  - `FoodController::orderFlat` rejects 422 when the single restaurant does not accept the chosen method.
  - `GroupOrderService::createGroup` rejects 422 for a group checkout when **any** participating restaurant does not accept the chosen method — per-restaurant acceptance is checked, consistent with §4 group checkout rules.
  - Order recording itself already existed (`orders.payment_method` / `group_checkouts.payment_method` = `cash`/`gcash`/`card`) and is unchanged.
- **Backend — latent-bug fix:** `FoodController::orderFlat` used `$validated['business_id']` unconditionally, throwing 500 when no `business_id` was supplied; now `($validated['business_id'] ?? null)` so the offering-owned fallback path works.
- **Frontend:** rewritten `PaymentSettingsSection` split into two sidebar destinations. The Accepted Payment Methods surface (toggle cards for Cash on Delivery / GCash (Online) / Card (Online), at-least-one validation, Save via the dedicated endpoint with success/error Alert feedback, read-only method explanations) now lives on its own **Settings → Payment Methods** sidebar button (`/business-owner/settings?tab=payment-methods`, new `PaymentMethodsSection`). The Payment Tracking table moved to **Finance → Payment Tracking** (`/business-owner/settings?tab=payments`). Dead `PAYMENT_OPTIONS` constant removed; all other settings tabs untouched.
- **Tests:** new `tests/Feature/BusinessPaymentMethodPreferenceTest.php` — **11 tests / 30 assertions**: owner saves + reads back; restrict-to-online; empty/invalid values rejected and not persisted; other-owner 403; tourist RBAC 403; unset = accept-all; single order rejected when method disallowed (and no order row written); single order accepted once enabled (records `payment_method`); group order rejected when one restaurant disallows (no order row); group order accepted when all accept; order records `gcash` vs `cash`.

Architectural decisions:

- **No new table/DDL** — the dormant `businesses.payment_methods` column is the single source of truth, matching AGENTS §19 ("reuse canonical implementation").
- **Default stays permissive** — null list = accept everything, so the enforcement cannot strand an existing business that never configured payment methods.
- **COD / dispatch untouched** — no change to `NearestRiderService`, credit-free COD eligibility, dispatch, or settlement; the business preference only gates which payment methods may be *chosen at checkout*.

Verification:

```text
Targeted: 11 passed / 30 assertions (BusinessPaymentMethodPreferenceTest)
Laravel full suite: 406 passed / 2,163 assertions / 0 failures / 10 skipped
                     skipped = known environment skips (5 GD, 3 SQLite-only, 2 historical)
Frontend: npm run build clean (pre-existing chunk-size warning only)
Lint:     oxlint — no new findings; only the pre-existing unrelated errors/warnings remain
```

### Business Settings — Payment Tracking (Cash / Online): Complete (2026-09-24)

The Payments tab is now a **payment tracking** surface as well as a preference surface. Every order placed with the selected business is listed as a payment record (cash vs online), with the amount received and — once the order settles — the restaurant's own settlement share, recorded in Business Settings under the Payments tab → Payment Tracking.

- **Backend — read-only ledger:** new `GET /api/business-owner/businesses/{business}/payments` → `BusinessOwnerPaymentController::index`. Ownership RBAC on the target business, paginated (max 100/page), optional filters `payment_method` (`cash`/`online`), `order_status`, `search` (order number).
  - Records scope = `orders.business_id = business` **or** any `order_items.business_id = business`, so a restaurant sees its own rows inside a group checkout while never seeing a sibling restaurant's rows (AGENTS §4.4 ownership).
  - Each record carries: order number, group reference, customer, `placed_at`, `payment_method`/`payment_label` (Cash/Online), `payment_status`, `order_status`, `total`, `paid_amount`, and the per-business settlement snapshot (`settlement_number`, `settlement_amount`, `settlement_status`, `settled_at`) pulled from `order_settlements` keyed by `(order_id, business_id)` — the multi-business unique pair.
  - `meta.summary` = all-time aggregates over the same scope: `orders_count`, `total_received`, `cash_count`/`cash_total`, `online_count`/`online_total`, `paid_count`, `settled_amount` (sum of the business's own `order_settlements.restaurant_amount`). Read-only — no mutation of payment or money state.
- **Frontend:** the Payments settings tab now hosts only the live **Payment Tracking** card (sidebar: Finance → Payment Tracking): 4 summary tiles (Total Received, Cash on Delivery, Online Payments, Settled Earnings), a Cash/Online filter select, a record table (order, date, customer, method badge, status, amount, settlement share), and proper loading/empty states. Fetches via `['bo-payments', businessId, filter]` query key. The Accepted Payment Methods toggles moved to Settings → Payment Methods (`tab=payment-methods`). The settings page header title is now dynamic per active tab (Payment Tracking / Payment Methods / Operating Hours, etc.) with the shared subtitle "Configure your business preferences".
- **View action (transaction detail):** each payment-record row has a **View** button opening a read-only transaction modal. The modal fetches `GET /api/business-owner/businesses/{business}/payments/{order}` → `BusinessOwnerPaymentController::show` and renders: order/customer card (placed, type, speed, group ref, contact), the items belonging **only to this business** (filtered by `order_items.business_id` so group-checkout rows never leak a sibling restaurant's items), an amount breakdown (subtotal, delivery fee, rider tip, system fee, discount, total, paid amount, refunded), the delivery card (status, dispatch status, rider, address, delivered at) when present, and the settlement card (number, base, restaurant share, platform share, status, settled at) or a "not settled" note.
- **Tests:** new `tests/Feature/BusinessOwnerPaymentTrackingTest.php` — **12 tests / 59 assertions** (8 list + 4 detail): records + summary math; cash/online filter isolation; settlement amount/status surface; group-checkout records scoped per owning business (with per-business settlement share); other-owner 403; tourist 403; unauthenticated 401; cross-business order isolation; full transaction detail; detail includes settlement; group detail exposes only own business items; non-owner 403 + unowned-order 404.

Architectural decisions:

- **Reuse existing ledgers** — the endpoint is a pure read over `orders` + `order_settlements`; no new tables, no new settlement logic, COD settlement/rider earnings untouched (AGENTS §19).
- **$$ per-business amounts** — settlement figures always use the `(order_id, business_id)` row so group-checkout restaurants see only their own 80% share.
- **No wallet/payout mutation** — this surface is monitoring only; money state changes remain in the canonical settlement/payout services.

Verification:

```text
Targeted: 12 passed / 59 assertions (BusinessOwnerPaymentTrackingTest — 8 list + 4 detail)
Laravel full suite: 440 passed / 2,336 assertions / 0 failures / 7 skipped
                     7 skipped = known environment skips (5 GD, 2 SQLite-only)
Frontend: npm run build clean (pre-existing chunk-size warning only)
Lint:     oxlint — 0 new findings (5 pre-existing unrelated warnings remain)
```

### Tourist Ride-Hailing — Phase 1 (Broken Integration Fix): Complete & Verified (2026-09-24)

Phase 1 of the approved ride-hailing plan (`docs/ride-hailing-plan.md`). The `tourist/transport/*` frontend↔backend contract had drifted: booking produced 404/500 (dead route names, `/tourist/transport/request` vs canonical `/book`), `tripStatus` returned a bare `Order`, and the tracking page consumed a camelCase shape that never existed anywhere in the backend. Scope was MVP (§46) + bug fixes only, per the plan; the canonical `tourist/transport/*` routes were kept (no `/api/rides` aliases), and all four vehicle types remain (motorcycle/tricycle/car/van).

**Backend fixes**

- `TransportationService::createRide()` — **server-authoritative fare** (closes the last open R1 blocker): the fare, distance and duration are re-derived from the canonical coordinates + vehicle type via `estimateFare()` inside `createRide()`, ignoring any client-supplied values. This guards every caller of the service, not just the HTTP `book()` route; an invalid vehicle type now throws instead of producing a ride. `BookTransportRequest` demoted `fare`/`distance_km`/`duration_min` to optional (advisory); `book()` returns the authoritative `fare` in the 201 payload.
- `TransportationService::getRideStatus()` — ride status now derives from the **delivery lifecycle first**; order-level `cancelled`/`completed` remain terminal overrides. Without this, every transport ride read as `searching` forever because `orders.status` stays `pending` for transport until completion. Status map extended: `arrived_pickup → driver_arrived`, `cancelled`, and delivery keys (`assigned/en_route_pickup → arriving`, `picked_up/in_transit/en_route_destination → in_progress`, `arrived_destination/completed → completed`). Eager-loaded `delivery.rider.riderDetail` so the payload's rider block reads fresh data.
- `Tourist/TransportController`:
  - `index()` JSON-only — removed dead `route('tourist.map')` branch (the 500 source).
  - `book()` JSON-only; `redirect` is now a plain string `/tourist/transport/tracking/{id}` (replacing the `RouteNotFoundException` 500); message `"Ride requested! Looking for a nearby rider."`; response includes the authoritative `fare`.
  - `tripStatus()` filters `order_type = 'transport'` and returns the **rich ride-status contract** (id, order_number, status, ride_pin, pickup/destination addresses + lat/lng, vehicle_type/color, passenger_count, payment_method, fare, distance_km, duration_min, eta_minutes, booking_notes, `rider {id, name, rating, contact_number, photo, vehicle_type, vehicle_make, vehicle_model, plate_number} | null`, is_rated, rating, review, created_at/started_at/completed_at/cancelled_at, cancellation_reason, cancellation_fee). Rider fields read from the canonical sources (`UserProfile.mobile_number`, `UserProfile.avatar`, `RiderDetail.vehicle_*` — the old `tracking()` was stale dead code that read non-existent `User` columns).
  - `cancelTrip()` lifecycle guard: allowed only in `searching|arriving|driver_arrived`, else 422; delegates to `cancelRide()` and returns `{status: 'cancelled', cancellation_fee: 0}`.

**Frontend fixes**

- `BookRideSheet.tsx` — posts `/tourist/transport/book` with the canonical payload (`pickup_lat/lng`, `destination_lat/lng`, `destination_address`, `vehicle_type`, `passenger_count`, `fare`, `distance_km`, `duration_min`, `payment_method`, `booking_notes`), parses the estimate `fares[vehicle].fare_text`, navigates to the returned `data.redirect`.
- `TouristTransport.tsx` — rewritten as the booking hub consuming the paginated `GET /tourist/transport` response.
- `TouristTransportTracking.tsx` — aligned to the rich snake_case `tripStatus` contract: `pickup_latitude/longitude` markers, `rider.photo/name/vehicle_type/plate_number/contact_number`, `is_rated`, `started_at/completed_at/cancellation_reason`, `fare/distance_km/duration_min/eta_minutes`, new statuses `searching` + `driver_arrived`, cancellation gated on `searching|arriving|driver_arrived`, clamp progress at 0 for `searching`, ride-PIN verify callout when the driver arrives.

**Tests — `tests/Feature/TouristTransportContractTest.php` (12 tests / 46 assertions)**

JSON `book` → 201 + string redirect + creates transport order/delivery; `book` recomputes the authoritative fare and ignores a client's bogus lower value (and still 201 when the client omits fare fields entirely); `estimate` 200 on canonical field names and 422 on legacy `dest_lat`; `tripStatus` rich payload for owner (incl. `arriving` right after rider accept — regression for the delivery-first precedence fix, and `driver_arrived` on `arrived_pickup` with a ride PIN); `tripStatus` 404 for a non-owner; `cancelTrip` success pre-start (order **and** delivery cancelled, dispatch released, `cancellation_fee: 0`); 422 once the trip starts (`picked_up`) and for a completed trip; ownership 404 enforced. Uses the same mocked-finder harness as `RideHailingAcceptanceTest` so the real dispatch/accept code runs unmocked. `RideHailingAcceptanceTest` re-run green (5/25) — its hard-coded client-fare assertion (150) was reconciled to assert the server-authoritative fare instead (AGENTS §12).

**Regression checkpoint — GREEN:**

```text
Targeted: TouristTransportContractTest 12 passed / 46 assertions
          RideHailingAcceptanceTest    5  passed / 25 assertions
Laravel full suite: 443 passed / 2,350 assertions / 0 failures / 7 skipped
                    7 skipped = known environment skips (5 GD, 2 SQLite-only)
Socket JS: 45/45 passed (tests/js/**; unchanged — no socket files touched)
Frontend:  npm run build clean (pre-existing chunk-size warning only)
```

Δ vs the prior Phase 1 checkpoint (440 passed / 2,336 assertions): this session closes the client-fare gap with +2 contract tests (+2 tests / +10 assertions) and reconciles the old fare assertion in `RideHailingAcceptanceTest`; the `RideHailingAcceptanceTest:314` change adds +4 assertions (order total + commission via `expectedMotorcycleFare()`).

**Architectural decisions**

- Phase 1 is deliberately **integration-only**: dispatch, `NearestRiderService`, COD eligibility/settlement, refunds, payments, and the Socket.IO infra are untouched (acceptance suite proves the backbone).
- No status vocabulary changes — ride statuses map behind the API; `orders.status` continues to use the existing vocabulary with the terminal-override precedence documented in `getRideStatus()`.
- The legacy `tracking()` / `cancel()` / `rate()` controller methods remain as inert dead code (they are not routed anywhere); removing them is a cleanup decision for a later phase, not part of Phase 1.

**Known deferred**

- Phases 3–6 of `docs/ride-hailing-plan.md` (route preview, fare breakdown, live tracking, notifications) not started — awaiting explicit approval per the plan's checkpoint policy.
- The `rateTrip` / `GET transport` filters and mobile edge cases remain unexercised by contract tests (Phase 4/5 scope).

### Tourist Ride-Hailing — Phase 2 (Pickup & Destination Selection): Complete & Verified (2026-09-24)

Phase 2 of the approved ride-hailing plan (`docs/ride-hailing-plan.md`). Adds real destination/pickup selection from the local registry — no external geocoder — and a multi-step booking sheet. Phase 1 contract (`TouristTransportContractTest` 12/46, `RideHailingAcceptanceTest` 5/25) untouched and re-run green.

**Backend**

- `TransportationService::searchLocations(string $q)` → local registry search: active `TouristDestination` (type `attraction`), approved restaurant/accommodation `Business` **with coordinates only** (`restaurant`/`stay` via `isRestaurant()`/`isAccommodation()`), `Municipality`, and `Barangay` (barangay matches its own name **or its parent municipality name** — a tourist searching "Bansud" finds "Poblacion"). Relevance sort: name starts-with first, then name-contains, then address; `limit(20)`. Only records with usable lat/lng.
- `TransportationService::reverseGeocodeLocation(float $lat, float $lng, float $radiusKm = 2.0)` → nearest registered place within 2 km (PHP-side haversine `calculateDistance`), else fallback `{id: null, type: 'custom', name: 'Picked location', address: ''}`.
- `Tourist/TransportLocationController` (thin) + two routes in the tourist group: `GET /tourist/transport/locations/search?q=` and `GET /tourist/transport/locations/reverse-geocode?lat&lng` (invalid coords → 422 via `validate()`). All 8 transport routes verified by `php artisan route:list --path=tourist/transport`.

**Frontend**

- `BookRideSheet.tsx` rewritten as a 3-step modal: **Destination → Pickup → Trip summary**. Live search via `/locations/search`; Leaflet `PinMap` (react-leaflet v5, `useMapEvents` click-to-pin, recentered view) with reverse-geocoded label; "Use current location" (geolocation + reverse label); manual address entry (map pin still needed for fare); recent destinations persisted to `localStorage tracktour_recent_locations` (max 4, deduped). Props contract preserved (`isOpen/onClose/destination/destinationCoords`) + new optional `initialQuery`. Book payload unchanged (canonical `/book`), estimate auto-fires when both ends have coordinates.
- `TouristTransport.tsx` CTA now opens the sheet with `initialQuery` (no more navigate-to-explore).

**Tests — `tests/Feature/TouristTransportLocationContractTest.php` (9 tests / 33 assertions)**

Attraction search returns active destinations; approved restaurant search excludes unapproved diners; approved accommodation maps to `stay`; municipality + barangay results with coords (incl. the parent-municipality barangay match); empty `q` → `[]`; auth 401 required; reverse-geocode resolves the nearest registered place (exact-coords destination) and distance-sorted; far point → `Picked location` fallback; invalid lat/lng → 422. Note: the test file uses an **instance** `User $owner` (created per `setUp`) — a `static` finder would survive `RefreshDatabase` rollbacks across methods and trip the `businesses.owner_id` FK (hit live, fixed).

**Regression checkpoint — GREEN:**

```text
Targeted: TouristTransportLocationContractTest 9 passed / 33 assertions
          TouristTransportContractTest    12 passed / 46 assertions
          RideHailingAcceptanceTest       5  passed / 25 assertions
Laravel full suite: 452 passed / 2,383 assertions / 0 failures / 7 skipped
                    7 skipped = known environment skips (5 GD, 2 SQLite-only)
Socket JS: 45/45 passed (tests/js/**; unchanged — no socket files touched)
Frontend:  npm run build clean (pre-existing chunk-size warning only)
```

**Architectural decisions**

- Location search is registry-only (no external geocoder), matching the plan; `Municipality` provides its own centroid, `Barangay` borrows its municipality centroid (barangays carry no coords).
- Reverse-geocode is a **PHP-side** haversine scan (no raw SQL distance) so the service stays portable over SQLite test runs; 2 km matches the plan radius.
- Dispatch, COD, payments, and Socket.IO infrastructure untouched.

**Known deferred**

- Phase 3+ of `docs/ride-hailing-plan.md` not started — awaiting explicit approval.
- Visual map tiles depend on OSM (no API key); pin UX uses `Picked location` fallback when off-registry.
- `service_fee` ship flag: with `config/delivery.php` default 0 the breakdown renders the base + distance lines only; flipping `DELIVERY_SERVICE_FEE` on is intended for a later phase once billing rails are ready.

### Tourist Ride-Hailing — Phase 3 (Route Preview, Fare Breakdown, Confirmation): Complete & Verified (2026-09-24)

Phase 3 of the approved ride-hailing plan (`docs/ride-hailing-plan.md`). Fare model unchanged (`base_fare + per_km × distance`); adds explicit estimate line items, a config-driven `service_fee` (default 0, not billed in MVP), and an OSRM route-preview polyline with a straight-line fallback. Phase 1/2 contracts untouched and re-run green.

**Backend**

- `estimateFare()` — each vehicle fare block now carries explicit line items `{base_fare, per_km, distance_km, duration_min, distance_fare, fare, total_fare, service_fee, fare_text}`. `total_fare === fare` (bookable amount = base + distance). Top-level `service_fee` added (new `config/delivery.php 'service_fee'`, `DELIVERY_SERVICE_FEE` env, default 0); **not added to `orders.total`** in MVP (createRide unchanged).
- `DeliveryFeeService::routePolyline()` — OSRM full-geometry client via the existing `config('delivery.routing_url')` (`overview=full&geometries=geojson`), decodes coordinates to `[[lat, lng], ...]`, same success/catch pattern as `calculateRouteDistance()`.
- `TransportationService::getRoute()` — returns OSRM polyline + distance + duration (`source: 'osrm'`) when the router responds; otherwise `source: 'straight_line'` (2-point) so the frontend always renders. `TransportationService` now constructor-injects `DeliveryFeeService` (autowired; no manual construction exists anywhere).
- `POST /tourist/transport/route` (validated coords, 422 on missing) → `{polyline, distance_km, duration_min, source}`.

**Frontend (`BookRideSheet.tsx`)**

- Summary step renders a **RoutePreview** Leaflet map: green `#087F3F` polyline when `source: 'osrm'`, grey `#9CA3AF` dashed line when `straight_line`; pickup/destination divIcon pins (same convention as `TouristTransportTracking`); `FitRoute` auto-fit-bounds.
- Itemized **fare breakdown**: Base fare + Distance (`distance_fare`) [+ Service fee only when > 0] = Total (`total_fare`); distance/duration caption retained.
- Route fetched via `useQuery` → `POST /tourist/transport/route` (enabled only when both ends have coordinates); book payload, phase-2 props, and estimate/route contract unchanged.

**Tests — `tests/Feature/TouristTransportRouteContractTest.php` (6 tests / 40 assertions)**

Estimate exposes explicit line items with internal consistency (`total_fare = base_fare + distance_fare`) and top-level `service_fee = 0`; legacy `fare`/`fare_text` keys preserved for Phase 1 consumers (all 4 vehicles); OSRM route decodes GeoJSON (2.5 km / 10 min / `osrm` source with reordered lat/lng polyline); OSRM failure → `straight_line` 2-point fallback with >0 distance; 401 unauthenticated; 422 missing coords. Prior transport suites re-run green — `TouristTransportContractTest`, `TouristTransportLocationContractTest`, `RideHailingAcceptanceTest` — 32 transport tests / 148 assertions total.

**Regression checkpoint — GREEN:**

```text
Targeted: TouristTransportRouteContractTest 6 passed / 40 assertions
          (all transport suites)           32 passed / 148 assertions
Laravel full suite: 458 passed / 2,426 assertions / 0 failures / 7 skipped
                    7 skipped = known environment skips (5 GD, 2 SQLite-only)
Socket JS: 45/45 passed (tests/js/**; unchanged — no socket files touched)
Frontend:  npm run build clean (pre-existing chunk-size warning only)
```

**Architectural decisions**

- OSRM stays a **preview-only** input: `createRide()` still derives the authoritative fare from the haversine distance via `estimateFare()`; the route endpoint never feeds dispatch or pricing. This preserves spec §64 server-authoritative fare and the credit-free dispatch rules.
- Line items are additive, never breaking: legacy `fare`/`fare_text` remain, so Phase 1 consumers (tracking page, hub) work unchanged.
- `DeliveryFeeService` is the canonical OSRM client; `TransportationService` reuses it rather than duplicating the HTTP call.
- Dispatch, COD, payments, and Socket.IO infrastructure untouched.

**Known deferred**

- Phase 4+ of `docs/ride-hailing-plan.md` not started — awaiting explicit approval.
- Real OSRM geometry only appears when the shared `DELIVERY_ROUTING_URL` is reachable; otherwise the dashed `Approximate route` fallback renders.

### Tourist Ride-Hailing — Phase 4 (Live Tracking Map + Active Ride States): Complete & Verified (2026-09-24)

Phase 4 of the approved ride-hailing plan (`docs/ride-hailing-plan.md`, spec §11–22). The ride-tracking screen is rewritten so the map, markers and road-following (OSRM) route line match the food-delivery tracking page exactly, while keeping the ride-hailing status flow (`searching / arriving / driver_arrived / in_progress / completed / cancelled`). Phases 1–3 contracts untouched and re-run green.

**Backend (canonical live-tracking support)**

- `TransportationService::createRide()` now sets `user_id => Auth::id()` on the ride `Order`, so the HMAC trip-token subject resolves to the booking tourist.
- New `app/Services/OrderTrackingService.php` — `customerBlock(Order $order, ?Delivery $delivery): ?array` returns `{delivery_id, room: 'trip:{id}', token, role: 'customer'}` and is **null-safe** (null when no rider, terminal delivery, missing `user_id`, or missing `socket.bridge_secret`).
- `FoodController` order-status block refactored onto the shared service (removed the duplicate private method); `TransportController::tripStatus()` now returns `rider_location` (latest `RiderLocation` for the delivery rider) and the `tracking` block.
- Realtime: the frontend reuses the P11.5 `useCustomerMapSocket` (joins `trip:<deliveryId>` with the HMAC token, consumes `rider_location_stream`); HTTP-polled `rider_location` remains the recovery/fallback. No Socket.IO transport changes.

**Tests — `TouristTransportContractTest` (+4: 16 tests / 67 assertions)**

`createRide` sets `user_id` on the ride order (token subject); `tripStatus` exposes a live tracking block + `rider_location` only after a rider accepts (`socket.bridge_secret` fixture); `tracking` is null while `searching`; `tracking` is null when the bridge secret is missing.

**Frontend**

- New `frontend/src/shared/utils/map-markers.ts` — canonical rider (`#087F3F`) / pickup amber (`#D97706`) / destination red (`#DC2626`) divIcons, extracted so `TouristOrderStatus` (delivery), `RiderMap`, and `TouristTransportTracking` share one definition.
- `TouristTransportTracking.tsx` rewritten (light brand theme, same OSM tiles as the delivery screen):
  - pickup/destination markers + green-arrow rider marker, live rider position from socket telemetry with HTTP `rider_location` fallback.
  - Full-trip route via `POST /tourist/transport/route` — green `#087F3F` OSRM polyline, grey dashed straight-line fallback; live rider→target segment via `useOsrmRoute` (road-following, 200 m min-move, target = pickup while arriving, destination once in progress).
  - Ride-only flow: searching spinner, Assigned→Arriving→In Progress→Completed stepper, driver card (photo/name/rating/plate/call), driver-arrived Verify PIN card, fare/ETA panel, cancelled state card, completed receipt.
  - Cancelled shows the backend-guarded cancel modal (only while `searching|arriving|driver_arrived`), share (Web Share/copy link), safety modal (911 + call driver + report), rating (stars+review), post-trip GCash redirect. Status updates consume `useUserSocketNotifier` (order/delivery/trip events) with the 5 s HTTP poll as the source of truth.
- `TouristTransport.tsx` — active-ride banner deep-links to the tracking screen; booking copy covers all four vehicle types; ride status labels surfaced on the list.
- `MyTrips.tsx` — transport rows now deep-link to `/tourist/transport/tracking/:id`; Active tab filter includes ride statuses `searching`/`driver_arrived`.

**Regression checkpoint — GREEN:**

```text
Targeted: TouristTransportContractTest  16 passed / 67 assertions
          (all transport suites)        32+4 =  36 passed / 148+26 assertions
Laravel full suite: 485 passed / 2,532 assertions / 0 failures / 7 skipped
                    7 skipped = known environment skips (5 GD, 2 SQLite-only)
Socket JS: 45/45 passed (tests/js/**; unchanged — no socket files touched)
Frontend:  npm run build clean (pre-existing chunk-size warning only);
           npm run lint clean for all touched files (pre-existing warnings/errors elsewhere unchanged)
```

(Transport suites re-run green: `TouristTransportContractTest` 16, `TouristTransportLocationContractTest` 9, `TouristTransportRouteContractTest` 6, `RideHailingAcceptanceTest` 5 = 36 tests / 174 assertions.)

**Architectural decisions**

- Ride tracking reuses the delivery map/marker/route primitives and the P11.5 `trip:{deliveryId}` socket room + `OrderTrackingService` token block instead of introducing a separate ride socket system — one canonical live-tracking path.
- OSRM stays a preview/tracking-only input; pricing and dispatch remain server-authoritative (haversine) per spec §64.
- No dispatch, COD, payments, or Socket.IO transport changes; 404/null-safe tracking when no rider or no bridge secret.

**Known deferred**

- Phase 6 (notifications/polish) of `docs/ride-hailing-plan.md` — not started.
- The `no_driver_found` frontend treatment is minimal (cancelled card shows the reason); pre-assignment cancel reason text passes through the existing payload.

### Tourist Ride-Hailing — Phase 5 (Payment, Receipt, Rating Tags): Complete & Verified (2026-09-24)

Phase 5 of the approved ride-hailing plan (`docs/ride-hailing-plan.md` §142–147, spec S80). The rating-tags backend and the ride-aware PayMongo label were already pre-staged from the Phase 1–4 window and pinned by contract tests; this checkpoint completes the missing receipt fare-breakdown fields, the S80 receipt rendering, and the rating tag chips.

**Backend**

- Pre-existing (verified, not rewritten): `rateTrip` at `POST /tourist/transport/trip/{id}/rate` accepts `{rating, review, tags?}`, validates `tags` via `Rule::in(TransportationService::RATING_TAGS)` (max 5 distinct), persists `orders.rating_tags` (migration `2026_09_24_000003_add_rating_tags_to_orders_table`), completed-ride-only + idempotent against double-rating. `tripStatus` already returned `is_rated/rating/review/rating_tags/allowed_rating_tags/payment_status/paid_amount`. `PaymentController::createIntent` already renders the ride-aware `'Ride Fare'` line item for transport orders; `'Food Subtotal'` remains food/group-only.
- New `TransportationService::getFareBreakdown($vehicleType, $totalFare)` — deterministic S80 receipt split with the invariant **base + distance === total**. The distance leg is derived as `total − base` because the booked fare is computed from the unrounded route distance; recomputing `distance × per_km` from the stored rounded distance drifts by sub-cent rounding and broke exact reconciliation (caught live by the new contract test). `service_fee` is config-driven, shown only when > 0, and never part of `orders.total` (MVP).
- `TransportController::tripStatus` — now returns `base_fare`, `distance_fare`, `service_fee`, `estimate_fare` (equal to `fare` in the single-fare MVP; the UI renders the estimate-vs-final explanation row only when they differ).

**Tests — `TouristTransportContractTest` (29 tests / 114 assertions)**

- `test_trip_status_receipt_math_line_items_sum_to_fare` — `base_fare + distance_fare === fare`; `estimate_fare === fare`; `service_fee` matches config and stays out of the total.
- Payment-state + hardening suite — `tripStatus` exposes `payment_status` / `paid_amount` / `rating_tags` / `allowed_rating_tags` (pending → 0 before settlement; reflects the recorded `paid_amount` after). `rateTrip`: 422 before completion, 422 on duplicate, 422 on unknown tag (`Rule::in(TransportationService::RATING_TAGS)`), 404 for a non-owner, persists `rating_tags` and mirrors the food `Review` (pending). `cancelRide` records `cancelled_at`. `createIntent`: transport orders render the single `'Ride Fare'` line item (amount = `orders.total`); a cancelled ride cannot open a new checkout (422). Webhooks: a transport ride's `checkout_session.completed` records `payment_status='paid'` + `paid_amount` WITHOUT entering the kitchen flow (`status` untouched); a webhook delivered after cancellation marks the payment paid but never resurrects the cancelled ride.

**Frontend**

- New `frontend/src/features/tourist/components/TripReceipt.tsx` — S80 receipt: order number + completion date, Base fare, Distance (x km) leg, Service fee (only when > 0), Total, estimate-vs-final gray explanation row (only when they differ), Payment line (hidden for cash; `Paid · amount` vs `Payment pending`).
- New `frontend/src/features/tourist/components/RatingSheet.tsx` — stars + tag chips from `allowed_rating_tags` (Friendly / Safe driving / Clean vehicle / Good communication / Arrived on time) + optional comment + Skip/Submit; submits `{rating, review, tags}`; non-blocking (`is_rated` still suppresses the button).
- `TouristTransportTracking.tsx` — the inline completed-receipt block and the inline rating modal are replaced by the two components; `rateMutation` is now payload-driven; page-level rating state (`rating`/`review`/`ratingTags`) removed (single-sourced inside `RatingSheet`). An inline rating-tag stub that had appeared in the page was reconciled onto `RatingSheet` so the tags UI and its state management are not duplicated.
- No changes to `useOsrmRoute`, dispatch, COD, or payments; the restaurant cash/pickup-sequencing track is untouched.

**Tests — `frontend/tests/ui/tourist-receipt-rating.test.tsx` (7 tests)**

- TripReceipt: breakdown reconciles (Base + Distance = Total); service-fee row renders only when > 0; estimate-vs-final row only when estimate differs; `Paid · amount` after settlement.
- RatingSheet: tag chips render/toggle and the submit payload carries `{rating, review, tags}`; star selection drives the rating; Skip closes without submitting; empty comment submits `review: undefined`.

**Regression checkpoint — GREEN:**

```text
Targeted: TouristTransportContractTest  29 passed / 114 assertions
Laravel full suite: 496 passed / 2,664 assertions / 0 failures / 7 skipped
                    7 skipped = known environment skips (5 GD, 2 SQLite-only)
Socket JS: 45/45 passed (tests/js/** — no socket files touched)
Frontend:  npm run build clean (pre-existing chunk-size warning only);
           npm run test:ui 70 passed / 10 files / 0 failures;
           oxlint clean on all touched files; tsc clean for touched files
Database: migration 2026_09_24_000003_add_rating_tags_to_orders_table applied
          + write-probed (SHOW COLUMNS: rating_tags varchar(500) NULL;
          JSON array round-trips through the model cast)
```

**Architectural decisions**

- Receipt math uses the authoritative booked fare as the source of truth; the distance leg absorbs booking-time rounding rather than risking a receipt that does not add up.
- Rating tags persist on the `orders` row (single `rating_tags` field — approved Phase 5 migration, no separate table). No rider-tip table (AGENTS §5.4: tips are food-only, never part of a ride settlement).
- Payment finalization for rides is decoupled from the food lifecycle: `PaymentController::markPayablePaid()`'s transport branch records `paid_amount`/`payment_status` only — it never flips ride order status, never triggers the prep/dispatch fan-out, and a late webhook after cancellation marks the payment paid without resurrecting the cancelled ride. `createIntent` refuses to open a new checkout for a cancelled ride.
- S80 "optional seats stepper / saved places" (UI-spec phasing list) stay out of scope for this checkpoint — they are not part of the approved plan §142–147.

**Known deferred**

- Phase 6 (notifications + polish) of `docs/ride-hailing-plan.md` — not started.

### Tourist Ride-Hailing — Phase 6 (Notifications + Polish): Complete & Verified (2026-09-24)

Phase 6 of the approved ride-hailing plan (`docs/ride-hailing-plan.md` §151–155, spec S80 / notifications). Ride transitions now surface through the existing canonical `Notification` rows and event pipeline with no new event system, and the driver has a transport-only cancel handler that releases the rider atomically.

**Implementation summary**

- **Ride-aware notifications (tourist):** `SendDeliveryAssignedNotification` writes a `Ride Status Updated` / `ride_status_changed` row ("Your driver {name} is on the way to your pickup location.") for transport orders while leaving the rider row unchanged; `SendDeliveryStatusNotification` gains a ride wording map across `assigned`/`en_route_pickup`/`arrived_pickup`/`picked_up`/`in_transit`/`arrived_destination`/`completed` (food orders keep the existing `Delivery Status Updated` wording and the restaurant-owner row); `SendOrderStatusNotification` maps a transport cancellation to a ride-aware "Your ride has been cancelled." row. Notifications continue to ride the existing `OrderStatusChanged`/`DeliveryAssigned`/`DeliveryStatusChanged` events and `user:{userId}` socket room — no listener duplicates, no bridge changes.
- **Driver-cancelled handler:** `TransportationService::cancelRideByDriver()` — transport-only gate; transaction (`lockForUpdate`) cancels the order (`cancelled` + reason/timestamp) and delivery (`cancelled`, dispatch status cleared), releases the rider to `available`, then fires `OrderStatusChanged` and a best-effort `notifyTripCancelled`. Exposed as `POST /rider/deliveries/{delivery}/cancel-ride` under the rider group: 403 when the caller is not the assigned rider, 422 once pickup has happened. `DeliveryResource` now exposes `order_type` so the UI can gate the control.
- **Frontend:** `RiderDeliveriesActive` renders a "Cancel Ride" action only for transport deliveries still in `assigned`/`arrived_pickup` with an aria-labelled confirm modal (mutation posts the cancel route, refreshes rider + delivery queries). `Delivery.order_type` added to the shared types.
- **Accessibility pass (`TouristTransportTracking`):** aria-label on the icon-only Back and Call controls; `role="dialog"` / `aria-modal="true"` / `aria-labelledby` on the Cancel Ride and Safety modals; Escape closes any open modal (cancel / safety / rating); the toast is `role="status"`. Reconnect recovery requires no change — the 5s HTTP polling fallback already exists.

**Tests added**

- `tests/Feature/TransportRideNotificationsTest.php` (6 tests / 38 assertions): assignment persists a tourist ride notification; driver-cancels-accepted-ride lifecycle (order + delivery cancelled, rider released, tourist cancel notice, `OrderStatusChanged` fired); block-after-pickup 422; non-assigned rider 403; food-delivery rejection 422; transition wording across `arrived_pickup`/`picked_up`/`arrived_destination`.

**Verified checkpoint**

```text
Laravel:  502 passed / 2,702 assertions / 0 failures / 7 skipped
          7 skipped = known environment skips (5 GD, 2 SQLite-only)
Socket JS: 45/45 passed (tests/js/** — no socket files touched)
Frontend:  npm run build clean (pre-existing chunk-size warning only);
           npm run test:ui 70 passed / 10 files / 0 failures;
           oxlint clean on touched files; tsc shows no new errors
Database: no DDL in this phase (notifications + endpoints only)
```

**Regression fixed during verification**

- The Phase 6 listener change initially dropped the generic `$message` resolution for non-transport orders in `SendDeliveryStatusNotification`, surfacing as 20 food/COD/ready-to-deliver suite failures (undefined variable). Restored: the food/customer + restaurant-owner branches resolve `Delivery Status Updated` wording independently of the transport branch. Targeted + full suite re-run green.

**Architectural decisions**

- Ride notifications reuse the existing `Notification` rows + event pipeline (AGENTS §8.1). No new notification event, no new `Notification` discriminator, no bridge/Socket.IO change.
- Driver cancellation travels the canonical `OrderStatusChanged` path (order remains the authoritative ride state) and releases the rider in the same locked transaction to guarantee the one-active-delivery invariant.
- The ride-cancellation message uses the standard `cancelled_by` / `cancellation_reason` / `cancelled_at` order fields the tourist already shows.

**Known deferred**

- None for this phase. Out-of-plan polish (seats stepper, saved places) remains as before; P12.5 wallet backfill and the Admin module plan (§15) are unchanged.

### 🚧 In Progress / Planned

- **P12.5 — Restaurant Wallet Foundation Backfill** (planned, next small phase) — one-time idempotent `wallets:backfill` Artisan command: approved restaurants missing a wallet → `RestaurantWalletService::ensureForBusiness()` → one ₱0 wallet each, no transactions, no funds, no DDL. 5 tests; guards the `delivered-but-unsettled → rider busy → no ping` failure class (rider 14 / delivery #3, 2026-09-23). Plan: `docs/current-status/wallet-backfill-plan.md`
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
├── Services/                # GPS, Transport, Dispatch, Websocket bridge, etc.
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
