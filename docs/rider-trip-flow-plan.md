# Rider Trip Flow — End-to-End Plan (2026-11-08)

The product owner's rider flow, from targeted ping to review, compared with
the code, with approved decisions and stages. Each stage ends with targeted
tests, the full suite, DB verification and docs.

## Flow (product owner)

1. A COD grouped order (several restaurants) is placed. The rider already
   holds Tourism Office purchasing cash.
2. The farthest restaurant from the tourist is the first pickup. The rider
   nearest to it is pinged first: 30 s, accept / reject / no answer means
   reject. The offer goes to the next rider, up to 4 riders, then the
   Available Deliveries page.
3. Accepting on the page opens the map with a route to the first restaurant.
4. Start: a tilted, heading-up navigation view centred on the rider, with a
   Google-style marker above the Go Online button. Overview / Navigation
   buttons sit above the map-type button.
5. At each restaurant: within 50 m. "Ready" means the restaurant already
   received the rider's payment. A "Confirm pickup" alert appears. On
   confirm, the route moves to the next restaurant and the collected
   restaurant's marker disappears. Repeat.
6. After the last pickup, the route runs from the last restaurant to the
   tourist. The tourist watches the rider live.
7. At the drop-off, within 50 m: the rider photographs the delivered food
   and confirms delivered. **Confirming means the tourist paid him** (COD
   cash).
8. The tourist reviews: stars for the food and the rider. Ratings boost the
   food's popularity.

## Status against the code (audit 2026-11-08)

| Step | Status |
| --- | --- |
| COD purchasing cash issued by the Tourism Office | ✅ exists |
| Farthest-first sequence, nearest rider, 30 s, ×4, then board | ✅ dispatch Stage 2; 🟡 board gating = dispatch Stage 3 |
| Accept on page → map → route to restaurant | ✅ 2026-11-08 (+ placeholder-position defect fixed) |
| Navigation view (tilt, heading-up, start, marker) | ❌ Stage C |
| Overview / Navigation toggle | ❌ Stage C |
| Pickup gate: 50 m + items ready | ✅ exists (`tracking.pickup_radius_meters`, `PickupSequenceService::confirmability`) |
| "Ready" requires the restaurant to have been paid (COD) | ❌ Stage B |
| Confirm-pickup alert, reroute to next stop | ✅ exists; 🟡 hide collected-stop markers = Stage C |
| Route from last pickup to tourist; tourist live tracking | ✅ exists |
| Drop-off 50 m + photo; confirm = tourist paid | ✅ **Stage A (done)** |
| Tourist reviews food + rider | ✅ exists |
| Ratings boost popularity | ❌ Stage D |

## Decisions (approved 2026-11-08)

| # | Decision |
| --- | --- |
| 1 | **The rider's photo replaces the tourist confirmation.** Within 50 m (judged from the rider's own fresh saved GPS) plus a photo completes a food delivery. COD is settled for exactly the cash due in the same step. The tourist confirm-delivery endpoint is retired. |
| 2 | **COD: the restaurant confirms payment first.** The rider arrives (≤ 50 m) and pays; the restaurant taps "Payment received". Only then can the items be Ready, which fires the rider's Confirm-pickup alert. Prep timers can't make an unpaid COD stop ready. |
| 3 | **Tilt: a 3D CSS perspective on the current Leaflet map** in Navigation view (heading-up, rider low-centre). No switch to MapLibre. |
| 4 | **Popularity: ratings + sales.** Average stars (with a minimum review count) plus units sold; the bestseller flag is a tie-breaker. |

## Stages

| Stage | Scope | Status |
| --- | --- | --- |
| A | Delivery completion with proof: 50 m + photo; COD cash recorded; tourist confirm retired; tourist sees the photo | ✅ done 2026-11-08 |
| B | COD "Payment received" before ready (restaurant action, rider at ≤ 50 m), ready gate, timer guard, rider pickup flow | ✅ done 2026-11-08 |
| C | Rider Overview / Navigation views, Start button, 3D tilt + heading-up, Google-style marker above Go Online, hide collected-stop markers | ✅ done 2026-11-08 |
| D | Rating-based "Popular" ranking on the tourist Food page | ✅ done 2026-11-08 |
| E | Dispatch Stage 3: board only after 4 targeted offers; sorted by distance to the first pickup | ✅ done 2026-11-08 (dispatch-escalation-plan.md §8) |

## Stage A record (2026-11-08)

- `POST /rider/deliveries/{d}/complete` (multipart `photo`, image ≤ 8 MB):
  - the rider must own the delivery and the food must be picked up
    (`picked_up` / `in_transit` / `arrived_destination`);
  - the rider's latest saved GPS fix must be at most 120 s old and within
    `tracking.dropoff_radius_meters` (50 m) of the delivery address;
  - transport rides are excluded (unchanged).
- `NearestRiderService::completeDeliveryByRider()`, in one transaction under
  the delivery lock:
  - `delivered`, confirmed by the rider; proof path, time and distance
    stored;
  - COD: `markCodDelivered` plus the existing `settleCodDelivery(cash_due)`
    (settlement, cash Payment, earnings, completed);
  - prepaid: the existing completion steps.
  - A refused completion deletes the uploaded photo.
- Retired: tourist `POST /tourist/food/order/{o}/confirm-delivery` (422 with
  guidance, no state change). The rider's `PATCH status=delivered` for food
  is still refused, now with "take a photo" guidance.
- UI:
  - rider "You've Arrived" alert: rear-camera photo, preview and Retake;
    Confirm Delivered stays disabled until a photo is taken; a COD hint
    explains that confirming means paid in cash;
  - tourist My Orders: "Order received" removed ("Your rider will confirm
    delivery on arrival");
  - Order details shows the proof photo (`delivery_proof_url`).
- Migration `2026_11_08_000001_add_delivery_proof_to_deliveries` adds
  `delivery_proof_path`, `delivery_proof_at` and
  `delivery_proof_distance_m`. Applied to dev MySQL and verified (SHOW CREATE
  TABLE, write probe rolled back). The storage link is present.
- Tests:
  - `TouristConfirmDeliveryTest` was rewritten for the new contract (9);
  - 5 suites were reconciled to the rider-proof flow via
    `Tests\Concerns\CompletesDeliveriesWithProof`;
  - frontend: alert photo flow, My Orders, proof photo on details.
  - Final: Laravel 829 passed, 2 skipped (known environment skips), 0 failures (5,171 assertions); frontend 441 passed; build clean.

## Stage B record (2026-11-08): COD "paid before ready"

**Rule.** For a COD delivery, a restaurant's food may only become READY after
the **restaurant** confirms it received the rider's payment for its stop.

**One authority.** `App\Services\CodPickupPaymentGuard` (`appliesTo`,
`unpaidBusinessIds`, `assertCanMarkReady`). It is enforced in three layers so
no path can bypass it:
1. **Model guards.** `Order::saving` and `OrderItem::saving` refuse any save to
   `ready` while payment is pending. This covers the owner, kitchen and staff
   API/web paths and any future path that saves through the models.
2. **Explicit pre-checks** before the two bulk item updates that skip model
   events (kitchen order status, owner mark-ready), so nothing is
   half-written.
3. **The preparation timer** (`PreparationStartService::completePreparation`)
   readies only the items of paid restaurants. The order stays `preparing`
   until every restaurant is paid. `completeIfDue()` readies at once when a
   payment is confirmed after the timer ran out.

`App\Exceptions\CodPaymentPendingException` renders a 422 for API clients
(with `unpaid_business_ids`) and a redirect with errors for web clients.

**The restaurant's confirmation** is stored separately from the rider's
purchase ledger: new `cod_purchases.payment_confirmed_at` and
`payment_confirmed_by`. The rider's own "Bought ✓" (status purchased) never
unlocks ready.
- Owner: `POST /business-owner/orders/{order}/cod-payment-received
  {business_id?}`. `business_id` is required only when the owner runs several
  restaurants in the order.
- Staff: `POST /staff/orders/{order}/cod-payment-received`, scoped to the
  staff member's business.
- `CodPaymentConfirmationService`, under the cod_purchase row lock:
  - COD delivery, rider assigned, delivery in the pickup stage;
  - the restaurant has items in the order;
  - **the rider has checked in at this restaurant** (pickup-stop
    `arrived_at`, which requires ≤ 50 m);
  - idempotent. The rider's ledger is set to `purchased` if still pending.

**Rider side.**
- Pickup-stop payload: `payment_confirmed` (null for prepaid) and reason
  `waiting_payment`.
- `confirmStop` (both the arrival/confirm flow and the legacy "mark
  collected") refuses with "Pay the restaurant first and wait for it to
  confirm 'Payment received'."
- Even food made ready before this rule (or by bulk/legacy paths) can't be
  collected unpaid.

**Restaurant UI** (`BusinessOwnerOrderShow`):
- the COD panel shows "Waiting for the rider to arrive and pay", then "The
  rider is at your restaurant. Collect ₱X, then confirm" with a **Payment
  received** button, then "Payment received ✓";
- the item and order **Mark Ready** buttons are disabled with an explanation
  until payment is confirmed;
- server errors are now shown.

**Also fixed (AGENTS.md §4.2).** `StaffDashboardController::updateOrderStatus`
(web) allowed `preparing`/`ready` without an accepted rider. It now has the
same gate as the API path.

**Migration.** `2026_11_08_000002_add_restaurant_payment_confirmation_to_cod_purchases`,
applied to dev MySQL. Verified with SHOW CREATE TABLE, an FK probe (1452
rejected), and a valid write rolled back.

**In-flight dev data.** COD orders already in progress need the restaurant to
tap "Payment received" before their food can be marked ready or collected.

**Tests.**
- `CodPaidBeforeReadyTest` (10). It covers:
  - every ready path refused while unpaid (owner item/order/mark-ready,
    kitchen order/item, direct model saves);
  - confirmation only after rider check-in, scoped per restaurant (another
    owner 403, an outsider 403), and idempotent;
  - the rider's ledger can't unlock ready;
  - no confirmation outside the pickup stage or for prepaid orders;
  - rider pickup waits for confirmation (incl. legacy-ready food);
  - the timer readies only paid restaurants, and a later payment readies at
    once;
  - prepaid orders are unaffected.
- Reconciled to the rule (AGENTS.md §12):
  - CodOrderToSettlementFlow: e2e restructured to the new order — refused
    early, then per stop arrive → pay → confirm → ready → collect, through
    the real endpoint;
  - PickupSequenceFlow: real endpoint after rider arrival;
  - PurchasingCashFlow, CodDeliverySettlement, CodFinancialSettlement,
    RealtimeCompleteness, RestaurantSubOrderItemsLifecycle,
    RiderAcceptanceGate: via `Tests\Concerns\ConfirmsCodRestaurantPayments`.
- Frontend: owner COD panel + Ready locks, rider reason label.
- Final: Laravel 839 passed, 2 skipped (known environment skips), 0 failures (5,259 assertions); frontend 444 passed; build clean.

## Stage C record (2026-11-08): Overview / Navigation views (frontend only)

- **View buttons** above the map-type button (`RiderMapViewToggle`):
  **Overview** (route icon) and **Navigation view** (arrow). The active one is
  green. Stack, top to bottom: Overview, Navigation, Map type, My location.
- **Overview:** the flat, north-up bird's-eye view. The whole current route leg
  is framed. Tapping Overview re-frames it (overview key includes a signal).
- **Start** (blue, shown once per trip leg while a route is visible) switches
  to the Navigation view and asks for compass access on iOS.
- **Navigation view:**
  - heading-up: the road ahead points up (`useNavigationBearing`, shared with
    the tourist map; GPS course while moving);
  - **3D tilt:** `rotateX(50°)` under a 1000 px perspective on the rotated
    map plane, which is sized 1.9× the screen diagonal so no blank corner
    shows;
  - a soft horizon fade, tinted per map type;
  - street-level zoom; dragging off; zoom about the centre.
- **Position puck:** Google-style (blue dot, white ring, ground halo, heading
  chevron), drawn as a screen overlay so it stays upright. It sits 30 px above
  the Go Online button, horizontally centred (`navPuckScreenOffset`).
  `planeOffsetForScreenY` inverts the perspective projection, so the shared
  `NavigationCamera` keeps the rider's real position exactly under the puck.
- **Route consumption:** only the remaining route is drawn (`routeProgress`),
  in both views.
- **Collected restaurants** disappear from the map. The delivery-level pickup
  pin is hidden while per-restaurant stops are shown, and after pickup.
- **Shared:** `NavigationCamera` moved from `TouristExploreMap` to
  `shared/components/map/NavigationCamera.tsx` (unchanged behaviour; the
  tourist map imports it).
- **Defect fixed while testing:** `RiderMap.sendLocation` depended on the
  `useMutation` result, a new object every render, so the GPS watch was torn
  down and re-requested on every render (battery/network churn; an
  instant-answer GPS looped forever). `mutate` is now read through a ref, so
  the watch is set up once.
- **Tests:**
  - `rider-navigation-view.test.ts` (5): the perspective inverse, puck
    placement and fallbacks;
  - `rider-map-view-modes.test.tsx` (5): button order above the map type,
    overview framing + Start, Start → tilted navigation with puck, Overview
    re-frame (no repeat Start), collected stops hidden.
  - Frontend 454 passed; build clean. No backend change.
- **Tunable:** `NAV_TILT_DEG`, `NAV_PERSPECTIVE_PX`, `NAV_TILT_SIZE_FACTOR`
  and `NAV_PUCK_GAP_PX` in `features/rider/navigation-view.ts`. Not visually
  verified on a device in this session.
- **Free look (2026-11-08):** the rider can drag the map to explore while in
  the Navigation view (it was locked to the rider before).
  - The first drag (over 6 px; taps and two-finger pinches don't count) puts
    the camera in free look: it stops following, the map's bearing is frozen,
    the fixed puck gives way to the rider marker on the map, and the wheel
    zooms around the screen centre.
  - "My location" (no longer shown pressed) ends free look and goes back to
    the rider at street zoom.
  - A drag becomes a map pan by undoing the tilt (`planePointForScreen`) and
    the rotation, so the map stays under the finger. In Chromium the error
    was 0–4 px at bearings 0/35/120/270.
  - Opt-in through `NavigationCamera`'s `onFreeLookChange`. The tourist map
    is unchanged.
  - **Defect fixed:** Leaflet focuses its container on every press. Inside
    the `overflow:hidden` map area, that focus scrolled the oversized
    navigation map by about 80 px. `.rider-map-area` now uses
    `overflow: clip`.
  - Tests: `navigation-camera.test.tsx` +8, `rider-map-view-modes.test.tsx`
    +1, `rider-navigation-view.test.ts` +1. Frontend 496 passed; build clean.
- **Google-Maps-style explore (2026-11-09)** replaces the free look above.
  - **Gestures:**
    - One-finger or mouse drag pans. The spot grabbed stays under the finger
      (forward, back, sideways).
    - Two fingers: pinch zooms around the fingers, twist rotates, slide pans.
    - Right-drag or Ctrl+drag rotates on desktop.
  - **Mouse wheel and trackpad:** smooth fractional zoom, always around the
    rider. Their marker never moves while scrolling, whether following or
    exploring (product decision).
  - **Following vs exploring:**
    - While following, a pinch only zooms and the rider stays under the puck.
    - A twist over 12° or a slide over 40 px turns it into exploring.
    - Any pan or twist enters free look. The bearing then belongs to the
      rider's gesture (`onBearingChange`).
  - **Compass button:** shown in the Navigation view; its red needle points
    north. Tapping it:
    - while following, toggles north-up and heading-up;
    - while exploring, turns the map to face north.
  - **One view button:** it always offers the other view (Navigation view ⇄
    Overview).
  - **Accuracy:** gestures place the spot grabbed at the start rather than
    moving step by step. Leaflet rounds the view to whole pixels on every
    change. With step-by-step zooming, a 60-event pinch ended 30 px off; it is
    now 0–1 px (Chromium, real `NavigationCamera`, touch through CDP).
  - **Zoom snapping:** `zoomSnap` is 0 while navigating (smooth zoom). Zoom
    rounds back to a whole level for the Overview.
  - **Rotation easing:** the rotator's 0.45 s turn easing is off during a
    gesture (`map-rotator--gesture`).
  - **Tests:**
    - `navigation-camera.test.tsx`: 16 tests, rewritten;
    - `rider-map-view-modes.test.tsx`: 11 tests (view button flip, compass,
      twist);
    - frontend 518 passed; build clean.

## Stage D record (2026-11-08): ratings + sales rank "Popular" food

- **Score** (`app/Services/FoodPopularityService.php`), stored in
  `offerings.popularity_score` (decimal 8,3, indexed):
  `25 × bayesian_rating + 10 × ln(1 + sold)`, where
  `bayesian_rating = (count × avg + 3 × 3.5) / (count + 3)`.
  - A single 5-star review is pulled toward a neutral 3.5★, so it can't jump
    over a consistently rated dish.
  - `ln` keeps one bulk order from dominating: five 5-star sales outrank one
    unrated 40-unit order.
- **Same definitions as the dish cards.** `stats()` moved out of
  `FoodController::index`, which now uses it, so "sold" and the food rating
  are computed once:
  - sold = delivered or completed units;
  - rating = approved dish reviews, else older whole-order food ratings.
- **Updates:**
  - `ReviewObserver` re-scores the order's dishes on review create, update
    (including moderation approval) and delete; only approved reviews count.
    Scoring errors are reported, never thrown into a review write.
  - `food:recompute-popularity` runs every 10 minutes (`routes/console.php`)
    for sales.
- **Sort:** the default "Popular" sort is
  `popularity_score DESC, bestseller DESC, sort_order, id`. The bestseller
  flag is now a tie-breaker. Price and newest sorts are unchanged.
- **Database:** migration `2026_11_08_000003_add_popularity_score_to_offerings`
  applied with `--path` and checked with `SHOW CREATE TABLE`
  (`popularity_score decimal(8,3) NOT NULL DEFAULT 0.000` plus
  `offerings_popularity_score_index`). The first refresh on dev scored 85
  dishes.
- **Tests:** `FoodPopularityRankingTest` (7). It covers:
  - ratings beating the bestseller flag;
  - ratings vs a bulk order;
  - the one-review guard;
  - pending reviews ignored until approved, approval re-scoring at once,
    deletion reverting;
  - the refresh counting delivered sales only, and idempotent;
  - the 10-minute schedule;
  - other sorts unchanged.
- The existing food stats, dish review and food detail tests are unchanged
  and pass.

## Record (2026-11-10): trip buttons only work once their conditions are met

**Rule (user decision).** Every rider action on the trip page waits for its
conditions, shows them as a ✓ / ✗ list under the button, and stays disabled
until all are met:

| Action | Conditions |
|---|---|
| Confirm Arrival (restaurant) | the rider's turn in route order; within 50 m of the restaurant |
| Confirm Pick Up | arrived; restaurant confirmed "Payment received" (COD only); food ready; still within 50 m |
| I've Arrived (tourist) | all food picked up; within 50 m of the delivery address |
| Confirm Delivered | within 50 m of the delivery address; delivery photo submitted |

**Defect fixed (server).** `PATCH /rider/deliveries/{id}/status` →
`arrived_destination` had no distance check, so "I've Arrived" worked from
anywhere. Food deliveries now need the rider's own fresh saved GPS fix
(≤ `tracking.proof_location_max_age_seconds`) within
`tracking.dropoff_radius_meters` (50 m) of the delivery address — the same
source as the pickup arrival and the delivery proof. Rides are unaffected;
re-confirming an already arrived delivery stays allowed.

**UI.** `trip-steps.ts` (`stopConditions`, `dropoffArrivalConditions`,
`deliveryConditions`) + `RiderTripStatus` checklists; distances from the
device's live GPS ("turn on your location" when unknown). The server stays
authoritative for every gate.

**Tests.** `DropoffArrivalGateTest` (4); three flow tests now place the rider
at the drop-off before arriving (`riderIsAtDropoff`); rider trip page tests
(+6). Full suites: Laravel 873 passed, 2 skipped; frontend 579 passed; build
clean.

### Follow-up (2026-11-10): invalid GPS fix, popup gate

Production delivery #14 (TT-54788) could not be completed: "you are
12948945 m away". The rider's latest saved fix was (12.9604387, **0.0**) — a
reading missing its longitude (emulated / overridden location), accepted
because the previous fix was 133 s old, just outside the 120 s teleport-guard
window (kept on purpose so one bad fix can't block real ones forever).

- Server: `POST /rider/map/location` and trip tracking refuse a fix with an
  exact 0 latitude or longitude (422, never saved).
- App: `isUsableGpsFix` (`features/rider/gps.ts`) — the rider map, the online
  heartbeat and the trip context never use or send such a fix; the map shows
  "Your device reported an invalid location…".
- The arrival popup's **Confirm Delivered** now waits for the same conditions
  as the trip page (within 50 m by live GPS + submitted photo), shared
  `TripConditions` list.
- Distances in server messages and checklists read "1.5 km" / "12,949 km".

Tests: `InvalidGpsFixTest` (3), km wording in `DropoffArrivalGateTest`,
popup gate (+1), `rider-gps-fix` (2). Full suites: Laravel 876 passed,
2 skipped; frontend 582 passed; build clean.

## Record (2026-11-10): COD order paid online mid-way

**Rule (user decision).** An order paid online has already paid the
restaurant: the restaurant does **not** confirm a rider payment. It only marks
its food Ready; the rider then confirms the pickup. Only a still-unpaid COD
order keeps the "Payment received" step.

**Defect fixed.** Orders checked out online were already exempt (every COD
step keys off `payment_method === 'cash'` through
`NearestRiderService::isCodDelivery`). The gap: a COD order the tourist pays
online from the To Pay tab ("Complete payment") after it is already under
way. `PaymentController::markPayablePaid` skipped orders in
`accepted/preparing/ready`, so the PayMongo payment never reached the order:
it stayed `cash / pending`, the restaurant still had to confirm a rider
payment and the rider would have collected the cash a second time. Orders in
`picked_up/in_transit/arrived_destination/delivered` were worse: they were
reset to `waiting_restaurant` and dispatched again.

**Fix.** For an order (or a group checkout's order) already under way
(`accepted, preparing, ready, picked_up, in_transit, arrived_destination`), a
paid online payment now records `paid_amount`, `payment_method` (gcash) and
`payment_status = paid` only. Status, acceptance window and delivery are left
alone (no second dispatch). `delivered` orders are no longer reset. The
payable's authoritative-paid-once guard (P11.4) is unchanged. Being no longer
cash, the restaurant purchase rows, purchasing cash, "Payment received" gate
and the rider's cash collection all drop away automatically.

**Tests.** `CodOrderPaidOnlineTest` (4): a multi-restaurant COD order paid
online while preparing lets both restaurants mark Ready directly (no
`restaurant_purchases`, `paymentConfirmation` null, no new delivery, status
kept); an unpaid COD order still gets the 422; an order paid online while
in transit keeps `in_transit`; a group checkout paid online mid-way records
the payment on the canonical order.

Full Laravel suite after the fix: 863 passed, 2 skipped (known environment
skips), 0 failures (5,434 assertions). No schema change.

## Stage E record (2026-11-08)

Dispatch Stage 3 (the manual board) is recorded in
`docs/dispatch-escalation-plan.md` §8.

Full suites after D + E:
- Laravel 851 passed, 2 skipped (known environment skips), 0 failures (5,337 assertions);
- frontend 457 passed;
- build clean.

## Rider diagnostics and self-repair (2026-11-10)

**Request.** When something goes wrong mid-trip, the rider runs Diagnostics,
the system repairs what it safely can, and the rider repeats the step.

**Backend.** `RiderDiagnosticsService`, exposed as
`GET /api/rider/diagnostics` (read-only checks) and
`POST /api/rider/diagnostics/repair` (optional `latitude` / `longitude` from
the phone; throttled 10/min; rider role only).

| Check | Repaired automatically | Never bypassed (explained instead) |
|---|---|---|
| Account | — | not approved → contact the Tourism Office |
| Location | saved fixes with 0 lat/lng deleted; the phone's fix saved when the normal plausibility rule (`tracking.plausibility_window_seconds`, `max_speed_kph`) accepts it | an impossible jump → "try again in about N seconds" |
| Status | `busy` with no live delivery → `available`; live delivery but not `busy` → `busy` | — |
| Trip (food, pickup stage) | missing pickup stops rebuilt (`PickupSequenceService::ensureStops`); every stop confirmed but still `arrived_pickup` → moved on through `PickupDeliveryTransitionService::pickUp` (row lock, COD collection check, `DeliveryStatusChanged` emitted) | pending stop + rider too far → "Go back to X: you are N away, must be within 50 m"; food not ready, "Payment received", the 50 m radii, one-active-delivery |

More than one live delivery is reported, not repaired (the Tourism Office
releases the extra one). Every repair is written to `activity_logs`
(`action = rider_self_repair`).

**Frontend.** The Diagnostics tile on the rider map opens
`RiderDiagnosticsSheet`: phone checks (internet, GPS permission, usable fix)
plus the server checks. "Fix problems" (or "Re-sync" when everything is fine)
sends a fresh usable fix, calls the repair, updates the map position and
invalidates every `rider*` query so stale buttons and errors reload. Trip
error messages (global alert, trip status page) carry a "Run diagnostics"
link that opens the sheet.

**Tests.** Laravel `RiderDiagnosticsTest` (11, incl. coarse fix not saved): RBAC, healthy rider, stale
busy reported then released (GET changes nothing), live delivery → busy,
zero fixes cleared + device fix saved, impossible jump not saved, zero device
fix never saved, stuck `arrived_pickup` moved on with event + log, pending
pickup never skipped (rider sent back), missing stops rebuilt. Frontend
`rider-diagnostics-sheet` (8).

**Follow-up (same day): silent location refusals.** Testing TT-62973 with
DevTools Sensors showed the map at the restaurant while the checklist said
"10.6 km away". The server had refused the fixes without telling the app:
`low_accuracy` (Sensors default accuracy 150 m; moving fixes need ≤ 50 m) and
`implausible_movement` (a second TrackTour tab on the same login kept saving
the laptop's real position, so the 10.6 km jump to the override failed the
120 s / 150 km/h check). Changes:
- the rider map shows a warning with a "Run diagnostics" link when the server
  answers either reason (`locationSyncWarning` in `features/rider/gps.ts`);
- Diagnostics sends the phone's accuracy and applies the same ≤ 50 m rule
  (it no longer saves a fix the map endpoint would refuse); the phone GPS
  check warns about coarse fixes; the jump message names the other-tab cause.
The teleport guard itself is unchanged: a simulated jump still waits 2 minutes.

Full suites: Laravel 889 passed, 2 skipped (known environment skips),
0 failures (5,536 assertions); frontend 606 passed; build clean. No schema
change.

## Order → delivery scenario run (2026-11-10)

`tests/Feature/OrderDeliveryScenariosTest.php` (12 scenarios, real HTTP
endpoints, as the tourist / restaurant / rider apps call them):

1. GCash, one restaurant, end to end, with the wrong step tried at every
   stage: unpaid order never offered; restaurant cannot prepare before a rider
   accepts; double Accept harmless; skipping ahead refused; arrival >50 m
   refused; Confirm Pickup before the food is ready refused, then works once
   Ready (the TT-62973 case); double Confirm Pickup refused; "I've arrived" far
   from the tourist refused; completion needs the photo; double Confirm
   Delivered refused (one earning); rider freed; Diagnostics finds nothing.
2. Two restaurants, one rider: route order enforced, trip cannot leave after
   the first stop, second stop waits for its food, one earning.
3. Tourist cancel before acceptance withdraws the offer (stale Accept → 409);
   cancel after acceptance refused; another tourist cannot cancel (403).
4. Decline → next rider offered.
5. One active delivery per rider.
6. Only the assigned rider can move the trip (other rider / tourist 403).
7. Bad locations mid-trip: 0-axis fix 422, teleport and coarse fixes not
   saved, Diagnostics never saves a teleport and leaves the trip alone.
8. Payments: a repeated paid webhook dispatches once; a payment after the
   tourist cancelled never revives the order (single and group).

**Bugs found and fixed:**
- **Late payment revived a cancelled order** (`PaymentController::markPayablePaid`):
  a GCash payment arriving after the tourist cancelled the unpaid order put it
  back to `waiting_restaurant` and dispatched a rider. Closed orders
  (`cancelled`, `cancelled_by_tourist`, `rejected`, `refunded`) now only record
  the money and are refunded after commit through the existing
  provider-authoritative flow (`OrderRefundService::refundPaidOrder`; group
  children via `refundPaidGroupChild`); no dispatch.
- **Teleport guard skipped within the same second**
  (`RiderMapController::movementIsPlausible`, mirrored in
  `RiderDiagnosticsService`): 0 s elapsed was treated as "no information", so
  any jump posted in the same second (e.g. a second tab on the same login) was
  saved. Now judged as 1 s.

Not bugs (by design, documented in their own tests): any eligible rider may
claim an unclaimed delivery from the board (first accept wins,
`RiderOpenDeliveryClaimTest`); a fix within 100 m of the restaurant
auto-arrives the trip (server geofence).

Full Laravel suite: 901 passed, 2 skipped (known environment skips),
0 failures (5,692 assertions). No schema change.

### COD and 4-restaurant grouped scenarios (same day)

Grouped orders in the scenarios are now **4 restaurants × 2 items** (one
canonical order, 8 items, one delivery, one rider). Added:

- grouped GCash, 4 restaurants: route order enforced, a half-ready restaurant
  (1 of 2 dishes) blocks its pickup, trip waits for all 4, one earning with
  the tip, no COD settlement;
- COD, one restaurant, fast tip: no "Payment received" / cooking before the
  rider accepts and arrives; double "Payment received" harmless; pickup
  locked until paid + ready; no settle before delivery; completion records
  one cash payment = order total, one 80/20 settlement on the rider-financed
  base (fee and tip excluded), earnings = fee + tip; double taps book nothing;
- grouped COD, 4 restaurants: each restaurant confirms only its own payment
  and only while the rider is there; the next one is locked; 4 purchases,
  4 settlements summing to the financed amount, one cash payment = grand
  total;
- COD ownership (other owner / rider / tourist → 403);
- COD paid online mid-trip: no payment step, no cash, no settlement;
- grouped COD cancelled before acceptance: no money trail;
- grouped COD with one restaurant dropped (tourist cancels its 2 items)
  before acceptance.

**Bug found and fixed — cancelled items stayed on the COD bill.** Item
cancellation only recorded `cancelled_quantity` (+ a refund when paid). On an
unpaid order nothing is refunded, so the money fields kept the cancelled food:
the rider's cash due was the original total, the rider was routed to the
dropped restaurant with a ₱20.50 purchase (its leftover service-fee share),
and its cancelled items were set to `preparing` on acceptance. Fix:
- `OrderRefundService::refundCancelledItem`: a fully cancelled line becomes
  `cancelled`; an unpaid order is re-priced from the active quantities with
  the checkout formulas (`Order::calculateSystemFee`,
  `calculateRiderFinancedAmount`; quoted delivery fee and tip kept), and the
  group totals follow (one canonical order per group);
- `PurchasingCashService::routeStops`: skips lines with nothing to collect;
- `CodSettlementService::businessBases`: no base / fee share for a restaurant
  with nothing left (fee split among the rest; bases still sum to the
  financed amount).
Open product question: the quoted multi-stop delivery fee is kept when a
restaurant is dropped.

Scenario file: 18 tests. Full Laravel suite: 907 passed, 2 skipped (known
environment skips), 0 failures (5,905 assertions). No schema change.


## Rider municipality and the COD cash advance (2026-11-11)

**Bug:** the rider sign-up (`POST /api/register`, `AuthController::register`) never saved a municipality, and `RiderRegisterPage` never asked for one. Every rider had `users.municipality_id = NULL`. `RiderCashFundService` lists and authorises riders only within the Tourism Office's own municipality (by design), so the office saw "No riders in this municipality yet" and could not issue COD cash to anyone.

**Fix:**
- Sign-up: `RegisterRequest` requires `municipality_id` (exists) for riders; `AuthController` saves it on `users.municipality_id` and the rider's profile. `RiderRegisterPage` has a required Municipality dropdown (from `GET /municipalities`).
- The office can change it: `PUT /api/admin/riders/{rider}/municipality` (admin only, audit `rider.municipality_updated`), shown on the rider's detail page with a "Not set" warning.
- Riders page: a **COD Cash Advance** card issues today's cash per rider through the existing `POST /admin/riders/{id}/cash-fund/advances` (idempotent) and shares the Rider Cash page's query, so both pages show the same records.
- Dev data: the 2 existing riders (ids 5, 8) were set to Bansud, each logged as `rider.municipality_updated`.
- Tests: `RiderMunicipalityTest` (6); rider sign-up payloads in `RiderRegistrationOtpTest`, `RiderIdentityUniquenessTest`, `OtpAttemptLimitTest` now send a municipality; `frontend/tests/ui/admin-riders-cash-advance.test.tsx` (3), `rider-municipality.test.tsx` (2). Full suite 920 passed / 2 skipped; frontend 624 passed.

## Rider records page (2026-11-11)

Admin → Riders: clicking a rider row (or the name) opens the rider's page, which now starts with **Rider records** for a chosen day (default today, Asia/Manila):

- **Status:** rider status now, service, and the current (non-closed) delivery with COD / Online.
- **Deliveries:** completed that day and all time, split COD vs online (order `payment_method` `cash`/`cod` = COD, same rule as `NearestRiderService::isCodDelivery`), rides, cancelled.
- **Earnings:** from `rider_earnings` (`total_earning` = commission + tip), split by the order's payment method. `rider_earnings.delivery_fee` is the fee the tourist paid and is not summed as earnings.
- **COD cash (the day):** straight from `RiderCashFundService::adminDailyReceipt`: office cash issued / used / still with the rider, COD cash collected, the rider's own verified money used (reimbursed at remittance), what the rider keeps (fee + tips), net remittance and what the office pays the rider. Hidden with the reason when the rider is outside the office's municipality; marked as a preview while the daily COD policy is inactive.
- **Cash out online:** `RiderPayoutService::getAvailableEarnings` (available), pending/approved and paid payouts, last 10 payouts.
- **Recent deliveries:** last 25 with type, COD/Online, status, COD cash due and earning.

Endpoint `GET /api/admin/riders/{rider}/records?date=` (admin only, read-only; `RiderRecordsService`). Tests: `AdminRiderRecordsTest` (8, incl. "reading changes no money state"), `frontend/tests/ui/admin-rider-records.test.tsx` (5, incl. row click).

**Open question found while building this (not changed):** food deliveries store `rider_commission = 40.00` (`SmartDispatchService`), so `rider_earnings.total_earning` and cash-out pay the rider ₱40, while the daily COD receipt (`RiderCashFundService`) counts `rider_earnings.delivery_fee` (the full fee the tourist paid, e.g. ₱197.20) as the rider's delivery-fee entitlement deducted from the COD remittance. The two disagree. Also, once the daily COD policy is active, COD-delivery earnings are kept from the cash at remittance, but `RiderPayoutService` lets the rider also cash out those same earnings online. Both need a product decision before the policy is activated.

## My Destination (2026-11-11)

Rider dashboard → **My Destination**: the rider picks a preferred end point (search, or tap / drag a pin; named, e.g. "Home") and turns it on. While on, dispatch offers the rider only jobs (food and rides) on the way:

- **Rule (decided):** every pickup and the drop-off are within `delivery.destination_mode.corridor_km` (2 km) of the straight route from the rider's current position to the destination, and the drop-off leaves the rider closer to the destination. Straight-line geometry only (no routing calls), so dispatch is not slowed. No known rider position = not offered.
- **Auto off (decided):** on arrival within `arrival_radius_m` (300 m), checked on every accepted location fix (`POST /rider/map/location` returns `destination_ended`), or after `duration_minutes` (180). The app re-checks every minute and tells the rider once when it ended by itself.
- **Scope (decided):** offers only (`targetedCandidates`, `dispatchToNearest` MySQL lists and the socket-radar fallback, exclusion reason `off_destination_route`). The Available Deliveries board still lists every nearby job; rows say "On your way" / "Off your route" (`on_your_way`).
- Data: `rider_details.destination_label / _latitude / _longitude / _set_at / _expires_at` (migration `2026_11_11_000002`, applied with `--path`). API: `GET|PUT|DELETE /api/rider/destination`; place search `GET /api/rider/locations/search` (same search as ride booking). Service: `RiderDestinationService`.
- Tests: `RiderDestinationModeTest` (14), `frontend/tests/ui/rider-destination.test.tsx` (5).

## Ride bookings: nearest rider first, then Available Bookings (2026-11-11)

- **Dispatch:** rides now use the same sequential targeted dispatch as food (`SequentialDispatchService`), replacing the simultaneous wave (decision D1 revised in `docs/dispatch-escalation-plan.md`). The ride's pickup is the tourist's location, so the rider nearest the tourist gets the first ping; a decline or timeout moves it to the next nearest rider (never the same rider twice); after the 4th unsuccessful offer (`delivery.sequential.max_attempts`) the booking moves to the manual board (`dispatch_phase = manual`) = **Available Bookings**.
- **Lists by service:** `GET /rider/deliveries/pending` (Available Bookings / Available Deliveries) and the map board (`/rider/dispatch/board`) list only the rider's chosen service: Ride Hailing riders see ride bookings only, Food Delivery riders food orders only. Accepting was already limited to the rider's service.
- **Booking offer page:** a ride (which carries one "Ride: Motorcycle (1 pax)" line item) was shown as a food delivery ("Delivery Offer", "Food items", "Delivery fee ₱0.00"). The offer payload now has `order_type` and `ride` {vehicle_type, passenger_count, fare, distance_km, duration_minutes, booking_notes} (`RiderOfferPresenter::ride`, from the booking's delivery notes; fare = order total), and the list card and offer page read as a booking: vehicle, trip distance, estimated time, ride fare, passengers, payment, passenger pickup, drop-off, Accept / Decline Booking. No food items.
- Tests reconciled (AGENTS.md §12): `DeliveryOfferConcurrencyTest` — "transport still offers every rider in a single wave" became "transport offers the nearest rider first, one at a time", plus a new 4-declines → manual board test; the losers-cancelled contract now creates its offers directly (dispatch no longer creates simultaneous offers). New: `RiderOpenDeliveryClaimTest` service-filter tests (list + map board); `rider-deliveries-pending.test.tsx` booking card + booking offer page.

## Cash ride bookings: accept, pickup, completion and the ride trip screen (2026-11-11)

Found while testing booking TRP-6AF362EB5E076 (cash, motorcycle):

1. **Accept answered 409.** Claiming a cash ride ran the COD *food* purchase setup and inserted a `cod_purchases` row with `business_id = 0`; the FK refused it, the claim rolled back and the API reported a conflict. Every cash ride was unacceptable (tests only booked GCash rides). Fix: `PurchasingCashService::isCod()` is false for `order_type = transport` (a ride buys no food), so no purchase rows and no daily-advance link.
2. **"Passenger On Board" refused** with "Collect food from every restaurant before leaving the pickup area." `isFullyCollected()` returned false when a delivery had no purchase rows. Fix: a delivery with nothing to buy (a ride) counts as collected; a COD food order without rows still counts as not collected.
3. **Ride completion.** Rides never use the food photo endpoint (`/complete` answers "Rides are completed from the trip screen"). A ride ends with status `delivered` and, for cash, `settle-cod` with the fare (already the server behaviour). New context action `onCompleteRide(cashCollected)` does both.
4. **UI read as food.** The arrival popup and the Trip Status page now have a ride version: Booking #…, km • ~min • vehicle • passengers; steps 1 Booking Accepted → 2 Pick Up Passenger (I've Arrived at Pickup within 100 m → Passenger On Board) → 3 On the Way (I've Arrived within 50 m) → 4 Complete Ride ("Collect ₱fare in cash", Fare Collected · Complete Ride; online: Complete Ride); Ride Information (your earnings, ride fare, payment); Contact Passenger. `/rider/map/location` deliveries now carry `order_type`, `order_total`, `is_cod`.

Verified end to end on the backend: `OrderDeliveryScenariosTest::test_cash_ride_booking_runs_end_to_end` (book → accept → arrive → on board → in transit → arrived → delivered → fare settled: one cash payment = fare, no `cod_purchases`, no restaurant 80/20 settlement, one rider earning, rider available). Plus `RiderOpenDeliveryClaimTest::test_a_cash_ride_booking_is_claimable_and_creates_no_restaurant_purchase` (fails with the old code: 409), `rider-trip-status.test.tsx` (6 ride tests), `global-rider-alert-gate.test.tsx` (2 ride tests).

**Follow-ups (same day):**
- Rider map: the Order details sheet and the trip chip speak of rides for a booking ("Booking details", "Booking #TRP-…", pickup = passenger, "Drop-off", ride status words; chip "On the Way" / "Complete Ride" / "Ride Completed"). `/rider/map/location` deliveries also carry `order_number`. Test: `rider-order-info-sheet-ride.test.tsx`.
- "Complete Ride" got "Delivery must be PICKED UP before moving to DELIVERED": the app saw the rider at the drop-off while the server still had the ride `picked_up` (the rider's location saves were refused as an implausible jump, so the server never auto-arrived). `onCompleteRide` now sends `arrived_destination` first (repeatable; rides have no server drop-off radius gate), then `delivered`, then the cash fare. The 409 wording now says where the trip is: "This trip is PICKED UP, so it cannot move to DELIVERED yet." Test: `OrderDeliveryScenariosTest::test_cash_ride_completes_straight_from_picked_up`.
- The food photo step still flashed after "Complete Ride": when the ride ended the trip disappeared, the arrival message animated out with no trip, so `isRide` read false and the food layout ("Take a photo of the tourist receiving the food", camera button) showed for the exit. `GlobalRiderAlert` now remembers ride/food for the last trip, never draws the photo step while closing, and the "cash not settled" panel speaks of the passenger and fare for rides. Tests: two in `global-rider-alert-gate.test.tsx`. (Backend confirmed booking TRP-6AF362EB5E076 completed with no proof photo.)

## Saved location: honest checklists and a 5-second refresh (2026-11-11)

- **Honest checklists.** TT-23255: the popup said "Within 50 m (you are 0 m away)" ✓ while the server answered "you are 10.6 km away": the device GPS jumped 10.6 km (DevTools override) and the server's teleport guard refused to save it for 2 minutes (accepted at 02:50:18). The trip context now keeps `locationRefusal` (reported by the map stream, the heartbeat and the fresh fix before an action); every location-gated checklist (food drop-off arrival + proof, ride pickup + drop-off) adds "✗ Location saved (waiting: it jumped too far… / GPS not precise enough…)" and the button waits. Test: `global-rider-alert-gate.test.tsx`.
- **Every 5 seconds (decision).** The rider app sends its current location every 5 s on every rider page while online (`RIDER_LOCATION_INTERVAL_MS`, `gps.ts`; previously 60 s heartbeat / 30 s on a trip, plus the map stream at most every 3 s and only on GPS change). The map stream, the heartbeat and the fresh fix share one clock (no double sends); the heartbeat now uses high-accuracy GPS and sends the accuracy. Server: `tracking.checkpoint_seconds` 60 → 5; a moving rider (> 5 m) still gets a new point, a rider standing still refreshes the latest point's `recorded_at` in place instead of adding a row every 5 s (keeps `rider_locations` small; 30-day cleanup unchanged). Tests reconciled (AGENTS.md §12) in `GpsIntegrityTest` (stationary refresh in place; no write inside the 5 s window); new `rider-location-every-5s.test.tsx`.

## Rider History (2026-11-11)

The page read `customer_name` / `total_amount`, which `GET /rider/deliveries/completed` never sent (raw Delivery rows), so every row showed "—" and ₱0.00; it showed the delivery id (#13) instead of the order number; rides were mixed into Deliveries; the Ride Hailing tab ("Rider Hailing") was a placeholder; and it paged one 15-row API page on the client.

- API: `?type=food|ride` (422 otherwise); each row now has `order_number`, `type`, `customer_name`, `business_name` (food), addresses, `payment_method`, `is_cod`, `total_amount` (what the customer paid / the fare) and `earning` (the rider's `rider_earnings`, never COD cash), `completed_at` — the old fields (`id`, `order_id`, addresses, `status`, `updated_at`) stay for the Completed Deliveries page. Repository `getCompletedDeliveries(..., $type)`.
- Page: Deliveries and **Ride Hailing** tabs, each paged on the server; compact 3-column table that fits a phone (number + short date / customer + restaurant or route / payment badge + total or fare + "Earned ₱…"), fixed column widths with truncation; the previous tab's rows never flash under the other tab.
- Tests: `OrderDeliveryScenariosTest::test_cash_ride_booking_runs_end_to_end` (history row, type split, 422), `frontend/tests/ui/rider-history.test.tsx` (3).

## Secure rider cashout (2026-11-11)

Policy: **No verified transaction, no rider earnings. No verified earnings, no cashout. No Tourism Office approval, no payout.** Built on the existing payout architecture (no parallel tables): `rider_payouts` = cashout requests, `rider_payout_rider_earning` = the exact earnings in a request (UNIQUE per earning: never paid twice), `rider_earnings` UNIQUE(rider, order, status) (no duplicate earnings), one live request per rider (`active_payout_key`). The earning → order → payment / delivery chain is reconstructable, so no `rider_earning_sources` table was added.

- **Eligibility (`RiderEarningVerifier`):** server-recorded earning; genuine, not closed order; paid **online** (cash / COD earnings are kept from the cash collected and never cashed out online — this also closes the "COD earnings paid twice" gap); a provider-confirmed (PayMongo) paid payment, not refunded; delivery / trip assigned to this rider and completed; not in another live/paid cashout. The rider's Available amount counts only earnings passing every check; cash and not-yet-verifiable amounts are shown separately.
- **States (existing names kept, AGENTS §10):** `pending` (= pending review) → `under_review` (held; rider can no longer cancel) → `approved` (staff password; the server re-verifies every earning and blocks if any fails) → `paid` (staff password + GCash reference [UNIQUE], exact amount, recipient number/name, date, proof image stored privately) — or `rejected` (reason required) / `failed` (reason + password; earnings return). `payout_processing` is not a separate state: approved means "send the GCash transfer". TrackTour never sends money.
- **Controls:** mark-paid only from approved (it was previously allowed from pending); two-person rule — at or above `payouts.two_person_threshold` (₱5,000) the payer must not be the approver; no self-approval; every transition locks the payout row; each request keeps an `items_snapshot` of its references (kept after a rejection releases them); every step writes a financial `activity_logs` entry (shown as the audit trail).
- **Screens:** Admin → **Cashouts** (`/admin/cashouts`): filters (Open / To pay / Paid / Rejected / Failed / All), rider + GCash destination (flags a name mismatch), transaction breakdown with every check per earning, approve / reject / confirm payment / failed forms, payment record with proof, audit trail. Rider → Earnings: **Cash out online earnings** card (verified total, cash and held explanations, request with optional amount + GCash number/name, open request status, cancel while pending, history with GCash reference / reasons).
- Data: migration `2026_11_11_000003` (applied with `--path`). API: `POST /admin/payouts/{id}/start-review|approve|reject|mark-paid|mark-failed`, `GET /admin/payouts/{id}/proof`; rider `POST /rider/payouts/request` now requires `gcash_number` (09XXXXXXXXX) and `account_name`.
- Tests: `SecureCashoutTest` (10); payout fixtures in `RiderPayoutTest`, `ConcurrencyLockTest`, `AdminFoundationTest`, `AdminRiderRecordsTest` reconciled (AGENTS §12) to build the verified source chain (`tests/Concerns/MakesVerifiedEarnings`) and to pass the reason / password / evidence the new rules require; `frontend/tests/ui/cashouts.test.tsx` (7).
- **Not built (deliberately):** two-person *approval* (implemented as separation of duties at payment confirmation instead), a separate `financial_audit_logs` table (ActivityLog `type=financial` is append-only from the app), and automated GCash transfers (by policy).

## Admin Cashout Investigation page (2026-11-11)

The cashout screen was split into a queue and a dedicated investigation page ("the screen that protects the Tourism Office's money"). Read-only additions; approval and payment rules above are unchanged.

- **Queue (`/admin/cashouts`):** four tiles — pending requests (count; under-review count beneath), awaiting review (₱, pending + under review), approved not yet paid (count; ₱ to send), paid today (₱, Asia/Manila day, by `paid_at`/`paid_amount`). Tabs Pending / Under Review / Approved / Paid / Rejected, plus Failed and All so no request is hidden. A row opens the investigation page.
- **Investigation (`/admin/cashouts/:id`):** a warning strip at the top (red: an earning fails verification, a financial check fails; gold: no earlier paid cashout went to this GCash number, the account name differs from the rider).
  - **A. Rider identity:** account, email (verified?), mobile, municipality, member since; the GCash destination; the GCash numbers used on earlier requests (asked / paid counts, last used). There is no saved, verified rider GCash account yet, so the history is derived from past cashout destinations.
  - **B. Earnings breakdown:** each earning with customer paid, provider reference, checks passed / which failed, amount; "Investigate" opens its records.
  - **C. Original records** (`GET /admin/payouts/{payout}/earnings/{earning}`, limited to earnings in that request): tourist account (guest flagged), order + items + restaurants (or ride booking: vehicle, passengers, pick-up / drop-off, distance, fare), payments (provider, reference, status, refunds), rider assignment + dispatch log (who was offered and how they answered), pickup confirmations, delivery / trip completion (who confirmed, drop-off photo and its distance), earning computation (`rider_commission + tip = total_earning`, flagged if it does not add up) and the 7 verifier checks.
  - **D. Financial verification:** customers charged vs provider confirmed vs earnings in the request; lifetime online earnings, paid out before, other open requests, remaining unpaid after this one; four checks (provider = charged; earnings < payments; request = its earnings; payouts ≤ lifetime online earnings).
  - **E. Approval and payout:** step indicator (Review → Approve → Pay in GCash) and the existing start-review / approve / confirm-payment / reject / failed forms, kept as separate actions; audit trail beside it.
- API: `GET /admin/payouts/summary` (registered before `/payouts/{payout}`), `GET /admin/payouts/{payout}/earnings/{earning}`; `GET /admin/payouts/{id}` adds `rider.member_since`, `rider.email_verified`, `gcash_history`, `new_destination`, `financial`; verifier `source` adds `customer_paid`, `gateway_amount`.
- Tests: `SecureCashoutTest` +5 (summary per stage and RBAC; GCash history + new-number flag + financial figures; food investigation; ride investigation; investigation limited to the request's earnings + RBAC). `frontend/tests/ui/cashouts.test.tsx` rewritten for the queue + investigation page (9).
- Next (rider side, not built): Online Earnings overview, Transactions, Cashout Requests history, and a saved GCash account with change history — the last needs a new record and should be agreed before it is built.
