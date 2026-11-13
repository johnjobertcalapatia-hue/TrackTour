# Rider Dispatch & Offer Escalation — Stage 1 Audit and Transition Plan

Status: **Stage 1 approved 2026-11-07 — all recommendations D1–D10 accepted.**
The §2 cancel-vs-accept defect is fixed at the start of Stage 2 (live defect).
No dispatch, payment or schema code was changed in Stage 1.
Date: 2026-11-07

This plan evolves the existing dispatch engine (`NearestRiderService` +
`ScheduledDispatchProcessor` + `SmartDispatchService`) into the requested
flow:

1. Up to 4 sequential 60-second targeted offers.
2. Then the manual Available Deliveries board.
3. A 1-hour deadline, after which the order is cancelled with a 100% refund.
4. Tourist cancellation before assignment refunds 97.5%.

It is a **controlled evolution, not a second dispatch system** (AGENTS.md
§9, §16).

---

## 1. Current behaviour vs required behaviour

| Area | Today (verified in code) | Required | Gap |
| --- | --- | --- | --- |
| Offer fan-out | `dispatchToNearest()` pings up to **5 riders at once** per wave (MySQL nearest, then socket-radar fallback). | **One** targeted rider at a time. | Replace wave fan-out with a single targeted offer. |
| Offer duration | `DISPATCH_TIMEOUT_SECONDS = 120`. | **60 s** per targeted offer. | Configurable `offer_seconds = 60`. |
| Attempts | Unlimited waves, plus a scheduler retry every 5 min (max 11) until the deadline. | **4** targeted attempts, then the manual board. | Count attempts; switch phase after 4. |
| Re-offering | Timed-out riders are **re-offered** in a later wave (`reofferableRiderIds`). | Never select the same rider again for the same order (targeted phase). | Exclude every prior targeted rider. |
| Timer authority | `processTimeouts()` runs **only when a rider polls** (`/rider/dispatch/pending-request`, `/offers`, `/board`). No scheduled job advances expired offers. | Server-controlled timers. | Add a sub-minute scheduled worker (Laravel 12.69 supports `everyFiveSeconds()`). |
| Manual board | Already exists: open, unassigned deliveries within 25 km are claimable (`claimOpenDelivery`, first accept wins under the row lock). Offer page and exclusive review hold added 2026-11-07. | Shown only **after** 4 failed targeted offers (or when no targeted rider remains); sorted nearest → farthest to the **first pickup**. | Gate board visibility by phase; sort by distance. |
| Pickup sequence | `PurchasingCashService::routeStops()` orders stops by **ascending preparation time**. Stops are seeded only **after acceptance** (`ensureStops`). | **Farthest from the tourist first**, then farther → nearer; computed **before** rider search. | New ordering rule plus pre-dispatch computation. |
| Rider search origin | `deliveries.pickup_latitude/longitude` = the order's own business (`SmartDispatchService::scheduleDispatch`). | Nearest rider to the **first pickup** (the farthest restaurant). | Set the delivery pickup point to stop 1 before dispatch. |
| Distance | Rider ranking uses straight-line (haversine). `DeliveryFeeService::calculateRouteDistance()` (OSRM, network call, with fallback) exists. | Road distance "when available". | See decision D4. |
| 1-hour deadline | Exists: `dispatchCycleDeadline()` = `orders.dispatch_started_at + 60 min`. On expiry `failDispatch()` sets `dispatch_status = dispatch_failed`, but **the order is NOT cancelled or refunded**. `routes/console.php` documents the decision: *"Never auto-cancel: orders that never find a rider wait indefinitely."* | Cancel the order and refund 100% at 60 min from **placement**. | Reverses a documented decision (D5). Anchor on placement. |
| Post-assignment timeout | `AutoCancelUndeliveredOrder` cancels and refunds paid orders **assigned** more than 60 min ago and still undelivered. | Not in scope; keep it. | None. |
| Tourist cancellation | `FoodController::cancelOrder` allowed while `pending_payment` / `waiting_restaurant`; full refund (`refunds.deduction_rate = 0`). | Allowed only **before rider acceptance**; 2.5% charge; refund 97.5%. | New gate plus partial refund (D7, D8). |
| Partial refunds | `PaymentRefundProcessor::initiateRefund($payment, $amount, …, $originalAmount)` already supports an arbitrary amount and records `refund_deduction`. Provider-authoritative and idempotent (P11.3/P11.4). | 97.5% / 100% refunds through the existing processor. | Reuse; no new payment system. |
| Notifications | Socket: `order_received_ping`, `delivery_offer_cancelled`. Tourist: `OrderAutoCancelled`, `OrderStatusChanged`. | Offer expired / moved to board / taken / cancelled; tourist "finding a rider…" messages. | Extend existing events only. |

---

## 2. Confirmed defect found during the audit (fix first)

**A rider can accept, and be assigned to, an order the tourist already
cancelled.**

Probe (temporary test, deleted after running):
- Steps: a pending ping exists, the tourist cancels, then the rider accepts.

```
AFTER CANCEL: order=cancelled_by_tourist delivery={"status":"waiting","dispatch_status":"notified","rider_id":null} offer=pending
ACCEPT: HTTP 200 {"success":true,"message":"Delivery accepted.", ... "assigned":true}
AFTER ACCEPT: delivery={"status":"assigned","rider_id":3}
```

Causes:
1. `cancelOrder` (single-restaurant path) never calls
   `cancelDeliveryForOrder()`, so the delivery and its pending offers survive.
2. The ping-accept path (`handleRiderResponse` → `validateRiderAcceptance`)
   does not re-check order status. The board claim path does, via
   `orderIsDispatchable`.
3. Cancel takes no lock, so it can also race an accept.

Fix (start of Stage 4, or earlier if approved):
- Cancel under the delivery row lock and withdraw every pending offer.
- Make every accept path refuse a non-dispatchable order inside its existing
  lock.
- Add a regression test for "rider accepts at the same time the tourist
  cancels".

A related gap: between rider acceptance and the next
`AdvancePreparationOrders` run, the order stays `waiting_restaurant`. That
means a tourist can currently cancel **after** a rider accepted, with a full
refund. The new rule ("before rider acceptance only") closes this by gating
on `deliveries.rider_id IS NULL` under the lock.

---

## 3. Decisions needed from the product owner

| # | Question | Recommendation |
| --- | --- | --- |
| D1 | Does the sequential flow apply to **ride-hailing (transport)** too, or only food delivery? | ~~Food delivery only.~~ **Revised 2026-11-11: rides use it too.** A booking is offered to the rider nearest the tourist's pickup, one at a time, and after the 4th unsuccessful offer it moves to Available Bookings. |
| D2 | On the manual board, may riders who **rejected or timed out** a targeted offer still see and accept it? | Yes. The no-repeat rule applies to targeted offers; the board is open to every eligible rider. |
| D3 | Keep the **exclusive review hold** (90 s, built 2026-11-07) on the manual board, and the 10-minute **"Already accepted by another rider"** cards? The spec says offers "disappear" once accepted and others get an "unavailable" message. | Keep the review hold (it is compatible with first-accept-wins). Replace the 10-minute taken cards with immediate removal plus an "offer no longer available" message, to match the spec. |
| D4 | Rider ranking by **road distance**? OSRM is an external network call (about 5 s timeout each). | Rank candidates by straight-line distance, then confirm the top candidates with OSRM road distance when it responds within a short timeout. Fall back to straight-line. Pickup sequence (≤ 4 restaurants) uses OSRM with fallback. |
| D5 | Reverse the documented "never auto-cancel unassigned orders" decision: cancel and refund 100% at 60 min. | Yes, as specified. Order → existing `cancelled` status; reason code `no_rider_found`; delivery `dispatch_end_reason = no_rider_found`. |
| D6 | The 1-hour clock starts at **successful placement**. For GCash: when payment is confirmed (order enters `waiting_restaurant`). For COD: at checkout. Confirm? | Yes. Record `orders.dispatch_deadline_at` once at placement so retries can't move it. |
| D7 | The **2.5% tourist cancellation charge**. The spec itself requires confirming it is allowed by the PayMongo agreement and Philippine consumer-protection rules, and showing it before payment. | Implement behind a config flag (`refunds.tourist_cancel_before_assignment_rate`, default `0.025`). Show it on checkout before paying and in the cancel confirmation. **You confirm legal/provider clearance before go-live.** |
| D8 | Who keeps the ₱25 (2.5%)? Tourism Office revenue, or kept in the payment record only? | Record it on the refund as `refund_deduction` with reason `tourist_cancelled_before_assignment`. It is reported as Tourism Office revenue only if you confirm. |
| D9 | **Group checkouts** paid at group level: existing child refunds are recorded locally without a provider call. Should 100% / 97.5% refunds of a whole group go through PayMongo against the group payment? | Yes: provider refund on the group payment for whole-checkout cancellation/expiry. Child-level partial behaviour unchanged. |
| D10 | Sub-minute scheduler: production must run `php artisan schedule:work` (or cron plus `schedule:run` every minute with sub-minute tasks). Confirm the deployment (Railway) runs a long-lived scheduler process. | Add a dedicated scheduler service on Railway. Keep the poll-triggered `processTimeouts()` as a safety net. |

---

## 4. Target design (reusing existing tables)

**Order level vs offer level stay separate** (spec §8): a rider rejecting
an offer never changes the order.

Order: `waiting_restaurant` → (rider accepted) → existing flow,
or `cancelled` (`no_rider_found`), or `cancelled_by_tourist`.
No new order statuses.

Delivery `dispatch_status` (existing column, logical states mapped):

| Logical state | Value |
| --- | --- |
| `searching_for_rider` | `dispatching` (existing) |
| `targeted_offer` | `notified` (existing), with `targeted_attempts` 1–4 |
| `manual_available` | `waiting_for_rider` (existing, already in `OPEN_DISPATCH_STATUSES`) |
| `assigned` | `rider_id` set (existing) |
| `expired` | `dispatch_failed` + `dispatch_end_reason = no_rider_found` |

Offer (`booking_dispatch_logs.response`, existing): `pending`, `accepted`,
`declined` (= rejected), `timeout`, `cancelled`, plus `superseded` (new
value: withdrawn because the order was assigned, cancelled or expired).

Schema additions (migrations applied with `--path`, verified with
`SHOW CREATE TABLE` and live probes):

| Table | Columns | Purpose |
| --- | --- | --- |
| `booking_dispatch_logs` | `attempt_no` tinyint NULL, `phase` (`targeted`) NULL, `expires_at` timestamp NULL | Server-owned per-offer deadline; attempt audit. Existing UNIQUE(delivery_id, rider_id) = unique attempt per rider and order. |
| `deliveries` | `targeted_attempts` tinyint default 0, `current_offer_id` FK NULL | **One active targeted offer per order**: set and cleared only under the delivery row lock; offers are created only when it is NULL. |
| `orders` | `dispatch_deadline_at` timestamp NULL | Fixed 1-hour deadline from placement (D6). |
| `refunds` | `reason_code` string NULL | `no_rider_found` / `tourist_cancelled_before_assignment`. |

Existing protections kept:
- one active delivery per rider;
- atomic accept under delivery and rider locks;
- the review hold;
- UNIQUE(deliveries.order_id);
- `payment_webhook_events` provider-event uniqueness;
- refund idempotency.

---

## 5. Stages (each ends with targeted tests, full suite, DB verification and docs)

| Stage | Work | Key tests |
| --- | --- | --- |
| **2** | Pickup sequence farthest → nearest (OSRM with fallback), computed before dispatch, and the delivery pickup point set to stop 1. Sequential targeted offers: one rider, 60 s, server `expires_at`, at most 4 attempts, no repeat rider, eligibility re-checked before each offer, a reject advances immediately. Scheduled worker every 5 s for timeouts. Ping popup uses server `expires_at`. | Rider 1 accepts; R1 rejects and R2 accepts; R1 goes offline or loses eligibility mid-offer (skipped); no eligible rider (goes straight to the board); never two active targeted offers; farthest-first sequence for 3 restaurants. |
| **3** | Manual board fallback: visible only after 4 failed attempts or when no targeted candidate remains. Sorted per rider by distance to the first pickup. Card copy per spec: "0.8 km to first pickup · Restaurant C · 3 items · 2 pickup stops". Removed when accepted, cancelled or expired. | Four rejects / four timeouts move it to the board; two riders accept the same board offer (one wins, the other gets 409 and "no longer available"); sorting differs per rider location; one active delivery enforced. |
| **4** | 1-hour expiry worker: lock, verify there is no rider, cancel the order (`no_rider_found`), withdraw offers, notify the tourist, start a 100% refund. Tourist cancellation before assignment under lock: withdraw offers. **Includes the §2 defect fix.** | Expiry at 60:00; rider accepts just before the deadline (not cancelled); tourist cancels during a targeted offer and during the board phase; rider accepts at the same moment as the tourist cancels (exactly one outcome wins). |
| **5** | Refunds via `PaymentRefundProcessor`: 100% for `no_rider_found` (no deduction); 97.5% for `tourist_cancelled_before_assignment` (decimal arithmetic, cents rounding). Charge shown at checkout and before cancel confirmation. COD has no provider refund. Group-payment handling (D9). Tourist "finding a rider (up to 1 hour)…" message. | ₱1,000 → ₱1,000 refunded; ₱1,000 → ₱25 charge and ₱975 refunded; duplicate PayMongo webhook is a no-op; no double refund on concurrent expiry and cancel; COD cancellation has no refund call. |

Preserved unchanged:
- COD purchasing cash;
- the settlement 80/20 split;
- the rider acceptance gate for food preparation;
- payout architecture;
- GPS/socket security;
- the multi-restaurant single-order model.

---

## 6. Risks

- **Throughput:** sequential offers mean that four riders who ignore a
  request delay the manual board by up to 4 minutes (by design). Rejections
  shorten this.
- **Scheduler dependency:** without a running scheduler, offers only advance
  on rider polls. Keep that path as a fallback and alert on stale offers.
- **OSRM availability:** public OSRM is rate-limited. All routing has a
  straight-line fallback and must never block dispatch.
- **Behaviour change for live riders:** riders currently see simultaneous
  offers; they will now see individual 60 s offers. Announce before
  deployment.

---

## 7. Stage 2 checkpoint — pickup sequence + sequential targeted offers (2026-11-07)

**Product decisions received during Stage 2**
- Targeted offer popup: **30 seconds** (replaces 60). A reject, or no decision
  in 30 s, passes the offer to the next nearest eligible rider. The countdown
  is server-owned (`booking_dispatch_logs.expires_at`); the popup counts down
  from the server's `expires_in`.
- The offer **review page has no visible timer**. It renews the rider's
  exclusive review hold every 30 s while open (`PATCH
  /rider/deliveries/{id}/review`) and releases it on leave. An abandoned page
  stops renewing, and the hold lapses after 90 s. A live hold is never
  stolen.

**Defect fix (audit §2), done first**
- `FoodController::cancelOrder` cancels under the delivery and order row
  locks:
  - refused once a rider has accepted;
  - otherwise the order is cancelled and `cancelDeliveryForOrder()` runs,
    for single-restaurant orders too.
- `NearestRiderService::cancelDelivery` withdraws every pending offer
  (`cancelled`), clears the live offer and review hold, and notifies the
  riders (`order_cancelled`).
- The ping-accept path refuses a cancelled delivery, or one with no
  dispatchable order, inside its existing lock (409 "This order is no longer
  available.").

**Pickup sequence**
- `PickupSequencePlanner`: the restaurant farthest from the tourist comes
  first, then farther to nearer.
  - Road distance (OSRM) is used when enabled, with a straight-line fallback.
  - Planned **before** the row lock in `SmartDispatchService::dispatchNow` /
    `dispatchGroupNow`; inside the lock only the straight-line plan runs.
- Saved in `deliveries.pickup_sequence`. The delivery's pickup point becomes
  stop 1, so the rider search is centred on the first pickup.
- `PurchasingCashService::routeStops` follows the planned order (previously
  ascending preparation time), so stops, purchasing cash and the pickup
  route all agree.

**Sequential targeted dispatch**
- Implemented in `SequentialDispatchService`, the food branch of
  `NearestRiderService::dispatchToNearest()`. Transport kept the wave until D1 was revised on 2026-11-11; it is now sequential too.
  Every existing trigger reaches it: checkout, scheduler, decline, the
  timeout worker, and a late accept.
- Rules, all under the delivery row lock:
  - one rider at a time; 30 s; at most 4 attempts;
  - never the same rider twice (UNIQUE delivery/rider);
  - eligibility re-queried before every offer;
  - one live targeted offer per delivery (`current_offer_id`).
- Candidates come from the same MySQL/COD eligibility queries plus the
  socket-radar fallback. The radar loop was extracted into `radarCandidates()`,
  which the transport wave also uses.
- Road ranking (D4): the top 3 candidates are re-ranked by OSRM before the
  lock, only when the caller holds no transaction. Inside the lock, eligibility
  is fresh and only the order is reused.
- After 4 unsuccessful offers, or with no eligible targeted rider:
  `dispatch_phase = manual`, `dispatch_status = waiting_for_rider` (the
  existing open/claimable state). The retry scheduler no longer re-parks it.
- Server timers: new `dispatch:process-offer-timeouts` command, scheduled
  `everyFiveSeconds()` with `withoutOverlapping()`.
  - It runs `processTimeouts()`, which now honours per-offer `expires_at` and
    re-checks the offer under the lock.
  - It also runs `expireOverdue()`, which keeps the existing 60-minute
    `dispatch_failed` deadline for targeted/manual deliveries. Stage 4
    extends this to cancellation and refund.
  - Rider polls still run `processTimeouts()` as a safety net.
- Offer state vocabulary: an order cancellation withdraws offers as the
  existing `cancelled` value. No new `superseded` value was needed.

**Schema**
- Migration `2026_11_07_000003_add_sequential_dispatch_columns`, applied
  with `--path` to dev MySQL:
  - `deliveries`: `dispatch_phase`, `targeted_attempts`, `current_offer_id`
    (FK `booking_dispatch_logs`, ON DELETE SET NULL), `pickup_sequence`
    (json);
  - `booking_dispatch_logs`: `attempt_no`, `phase`, `expires_at`.
- Verified with SHOW CREATE TABLE. Live probes, all rolled back:
  - bad `current_offer_id` → 1452;
  - repeat rider/order offer → 1062 (existing unique key);
  - a valid targeted write succeeds.

**Tests**
- New: `SequentialDispatchTest` (14) covers:
  - nearest-only offer with a 30 s server deadline;
  - rider 1 accepts immediately; rider 1 rejects and rider 2 accepts;
  - 4 rejects and 4 timeouts lead to the manual board, with no 5th offer;
  - no repeat rider; no eligible rider leads to the manual board;
  - an offline or suspended rider is skipped;
  - never two live offers;
  - farthest-first sequence centres the search; road distance and its
    fallback;
  - cancel withdraws offers; the accept guard; no cancel after acceptance.
- Also new: `DispatchDeadlineTest` (+2 expiry tests) and a heartbeat test in
  `RiderDeliveryOfferTest`.
- Reconciled (AGENTS.md §12, each annotated in the test). These encoded the
  replaced behaviour:
  - `DeliveryOfferConcurrencyTest`: food single-wave → nearest only; the
    losers-cancelled wave moved to transport; expiry → no re-offer of the
    same rider.
  - `DispatchNoRiderRetryTest`: the food retry loop → manual board; legacy
    parked rows migrate into sequential dispatch; the transport retry is
    unchanged.
  - `DispatchRadarEligibilityConsistencyTest`: the shared helper now
    expects "no eligible rider" to mean the manual board. Exclusions are
    unchanged.
  - `DispatchSocketPingContractTest`: one targeted ping, the next on reject;
    no candidate → manual board.
  - `DispatchTimedOutReofferTest`: a timed-out rider is not re-targeted but
    can claim from the board.
  - `DispatchDeadlineTest`: board expiry runs through the worker.
  - `GroupPickupRouteTest`: the fixture now simulates GCash payment before
    dispatch (as production does); comments updated to the farthest-first
    rule.
- Frontend: `rider-deliveries-pending.test.tsx` has no review timer,
  heartbeat renewal, and lost-hold recovery (12 tests). Popup fallback is
  30 s.

- Laravel: 829 passed, 2 skipped (known environment skips), 0 failures (5,188 assertions). Frontend: 416 passed. Build clean.

**Deferred to Stage 3:** while a targeted offer is live, the delivery is
still listed on Available Deliveries for nearby riders (pre-existing
behaviour). Stage 3 restricts the board to the manual phase and sorts it by
distance to the first pickup. **Done 2026-11-08, see §8.**

## 8. Stage 3 record (2026-11-08): manual board after targeted offers

**Board visibility** (`DeliveryRepository::getPendingDeliveries`)
- A delivery with `dispatch_phase = targeted` is not on the open board.
- Only the rider holding the live targeted offer sees it, through their own
  pending offer.
- In the manual phase (after 4 offers, or when no eligible rider remains)
  it is listed for every rider in range (25 km). That includes riders who
  declined or timed out (D2).
- Deliveries with no phase (transport, legacy) keep the old behaviour.

**Claims refused server-side** (`NearestRiderService::deliveryIsClaimable`)
- A direct board claim on a targeted-phase delivery is refused, not just
  hidden.
- The targeted rider still accepts through their own offer (unchanged
  path).
- The offer page applies the same rule: `GET /offer` returns 404 to other
  riders.

**Sorting, per rider**
- The rider's own targeted offers come first.
- Then the board, nearest first, by straight-line distance from the rider's
  latest GPS fix to the first pickup. `deliveries.pickup_*` is stop 1, set
  by `PickupSequencePlanner`.
- Rows without a distance (no GPS fix) go last, oldest first.
- The rider location is read once per request (it used to be read once per
  row).

**Card line**
- The board now returns `pickup_distance_km` and `pickup_stops`.
- `RiderDeliveriesPending` shows "0.8 km to first pickup · Restaurant C · 3
  items · 2 pickup stops" (`boardSummaryLine`).

**Removal (D3)**
- An offer another rider won leaves the board immediately. The 10-minute
  "Already accepted by another rider" board cards are gone.
- A rider who still has the offer page open is told "Already accepted by
  another rider" there (`GET /offer` → `availability: taken`, unchanged).
- Offers won during the targeted phase never appear to riders who weren't
  offered them.
- Cancelled and expired (60-minute deadline) deliveries drop off, because
  they are no longer waiting or open.

**Tests**
- `SequentialDispatchTest` +5:
  - targeted phase: only the targeted rider sees or claims it;
  - after 4 declines every rider sees it, and a decliner can claim it;
  - the per-rider sort plus the card facts;
  - two riders racing for a board offer: one wins, the other gets 409, the
    offer leaves the loser's board and the offer page says taken; one active
    delivery is enforced;
  - cancelled and expired offers leave the board.
- `RiderDeliveryOfferTest`: two board assertions reconciled to D3. Taken
  offers are no longer listed; the offer-page "taken" assertions are kept.
- Frontend:
  - `board-summary-line.test.ts` (3);
  - the card-line assertion in `rider-deliveries-pending.test.tsx`.

**Suites**
- Laravel 851 passed, 2 skipped (known environment skips), 0 failures (5,337 assertions);
- frontend 457 passed;
- build clean.
- No migration.

**Still pending**
- Stage 4: the 1-hour expiry gives a 100% refund.
- Stage 5: tourist cancel before assignment carries a 2.5% charge; group
  payment refunds.
