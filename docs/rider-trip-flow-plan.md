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
