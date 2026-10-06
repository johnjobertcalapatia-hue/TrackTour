# Delivery Offer & Atomic Acceptance Architecture

> **Status: IMPLEMENTED & VERIFIED** (P11.8 — Simultaneous Rider Offers & Atomic Acceptance,
> plus the COD Purchasing-Cash Flow).
> This document is the contract for the offer/acceptance concurrency boundary. Every concrete
> value below (table, column, state, HTTP code, payload) reflects the shipped code, not an
> aspiration. Line numbers are a snapshot as of the P11.8 checkpoint and may drift.

**Canonical code:** `app/Services/NearestRiderService.php` (`dispatchToNearest`,
`handleRiderResponse`, `offerExpiresAt`, `offerIsExpired`, `expireOffer`,
`rejectAcceptOutcome`, `validateRiderAcceptance`),
`app/Http/Controllers/Rider/RiderDispatchController.php` (`offers`, `accept`).
**Related docs:** `docs/business-rules/rider-dispatch.md` (eligibility, one-active-delivery,
offer window), `docs/decisions/001-group-checkout.md`.

---

## 1. Purpose

Prevent duplicate or invalid rider assignments.

> **One delivery → one active rider assignment.**

If Rider A accepts first, Riders B and C must not be able to claim the same delivery; their
requests return **HTTP 409 Conflict** and create no second assignment.

```text
Delivery Created
      ↓
Find Eligible Riders
      ↓
Send Offers / PING  ──→  Rider A, Rider B, Rider C
      ↓
One Rider Accepts
      ↓
ATOMIC ACCEPTANCE
      ↓
 ┌────────────────────┐
 │ Offer valid?       │
 │ Not expired?       │  all inside ONE transaction
 │ Delivery unassigned│  under row locks
 │ Rider eligible?    │
 └─────────┬──────────┘
           ↓
     Create Assignment
           ↓
   Cancel Other Offers   (post-commit — see §6)
           ↓
   Purchasing Cash Flow
```

---

## 2. Data Model (what "assignment" and "offer" actually are)

There is **no `assignments` table** and **no `offer.status = EXPIRED` state**. The draft
architecture doc used conceptual names; the real ones are:

| Concept | Real storage |
|---|---|
| Offer | `booking_dispatch_logs` row (`delivery_id`, `rider_id`, `dispatched_at`, `responded_at`) |
| Offer state | `booking_dispatch_logs.response` — `pending`, `accepted`, `declined`, `cancelled`, `timeout` |
| Assignment | `deliveries.rider_id` + `deliveries.status = 'assigned'` + `deliveries.assigned_at` |
| Expiry timestamp | derived: `offerExpiresAt()` (not a stored column) |

**Expiry writes `timeout`, not `expired`.** The column comment in
`2026_07_10_104745_create_booking_dispatch_logs_table.php` is
`pending, accepted, declined, timeout`; `cancelled` is written by the winner-cancels-loser paths.

**Per-offer expiry** (`NearestRiderService:1122-1133`):

```text
offerExpiresAt = min( log.dispatched_at + DISPATCH_TIMEOUT_SECONDS(120),
                      delivery.dispatch_expires_at )        // the wave deadline
offerIsExpired = offerExpiresAt <= now()
```

**Database backstops** (from `2026_09_20_000001_add_concurrency_guards.php`):

```text
UNIQUE deliveries.order_id                                → one delivery per order
UNIQUE booking_dispatch_logs(delivery_id, rider_id)        → one offer per rider per delivery
```

Rider-side backstop (AGENTS §4.3, one active delivery per rider) is enforced on the rider row
under `lockForUpdate()` in the same transaction.

---

## 3. Atomic Acceptance — the critical boundary

`handleRiderResponse($deliveryId, $riderId, 'accepted')`:

```text
[pre-lock]  offerIsExpired?  ──→ expireOffer()   (cheap freshness check, no locks)
BEGIN TRANSACTION
    lock delivery row  (lockForUpdate)
        rider_id !== null?            → already_assigned
    lock rider row     (lockForUpdate)             ← one-active-delivery rule
    lock offer row     (lockForUpdate)
        response !== 'pending'?       → offer_gone
        offerIsExpired?               → write response='timeout' → offer_expired
        rider already active?         → already_active
        validateRiderAcceptance()?    → ineligible    (else continue)
    write  booking_dispatch_logs.response = 'accepted'
    write  deliveries.rider_id, status='assigned', assigned_at, dispatch_status=NULL
    write  rider_details.rider_status = 'busy'
    COD?  PurchasingCashService::initializeForDelivery()   ← cod_purchases created here
COMMIT
    cancel this rider's other offers
    cancel the losing riders' offers (+ socket delivery_offer_cancelled)
    notifyTripAssigned / DeliveryAssigned event / Firebase
```

Checks 1–8 from the draft map onto this as follows:

| # | Draft check | Implemented as | Failure |
|---|---|---|---|
| 1 | Offer exists | `lockForUpdate()->find($log->id)` | `offer_gone` → 409 |
| 2 | Offer belongs to the delivery | `delivery_id` is the lookup key (`findOrFail($deliveryId)` + log's own `delivery_id`) | 404/409 |
| 3 | Offer belongs to the rider | `handleRiderResponse` resolves the log for that rider; no log → `conflict` | 409 |
| 4 | Offer still pending | `response !== 'pending'` re-check **under lock** | `offer_gone` → 409 |
| 5 | Not expired | `offerIsExpired` **inside** the lock (plus pre-lock fast path) | `offer_expired` → 409 |
| 6 | Delivery not already assigned | `rider_id !== null` re-check under lock | `already_assigned` → 409 |
| 7 | Rider eligible/available | `validateRiderAcceptance()` (account approved; COD: `available` + under active-order limit; non-COD: online/available on the pinged service) | `ineligible` → **422** |
| 8 | Assignment creatable | same transaction; `UNIQUE` backstops are the final barrier | rollback, no partial assignment |

**Important — 409 vs 422 split** (the draft doc did not mention 422):
`RiderDispatchController:149` → `$code = ! empty($result['conflict']) ? 409 : 422`.

- **409 Conflict** = out-of-date/stale claim: `offer_gone`, `already_assigned`, `not_found`,
  `offer_expired`, `already_active`, no pending offer at all.
- **422 Unprocessable** = the rider is simply not eligible right now (`ineligible`).

**Ordering note (deviation from the draft's pseudo-code):** the draft drew
"cancel other pending offers" *before* `COMMIT`. The code cancels **after** commit
(`NearestRiderService:860-861`). This is safe: the loser's accept re-reads
`deliveries.rider_id` under the row lock, so it gets `already_assigned` (409) regardless of
whether the loser's offer row has been cancelled yet. Cancellation is cleanup + UI truth, not
the concurrency barrier.

---

## 4. Response Contract (actual payloads)

`ApiResponse::errorResponse()` returns **only** `success` + `message`. The service-level flags
(`conflict`, `timeout`, `already_assigned`, `already_active`, `next_dispatched`) are **not**
forwarded to HTTP clients today — see §11.

**Success** — `PATCH /api/rider/dispatch/accept` → **200**

```json
{
  "success": true,
  "message": "Delivery accepted.",
  "data": { "success": true, "message": "Delivery accepted!", "assigned": true }
}
```

**Already assigned** — **409**

```json
{ "success": false, "message": "This delivery was already accepted by another rider." }
```

**Expired offer (Scenario H)** — **409**

```json
{ "success": false, "message": "Request timed out." }
```

**Offer no longer available** — **409** `"This delivery request is no longer available."`
**Already on an active delivery** — **409** `"You already have an active delivery. Complete it before accepting another."`
**No pending dispatch request** — **409** `"No pending dispatch request found."`
**Not eligible** — **422** `"You are no longer eligible for this delivery."`

There is **no `code` field** and no `OFFER_EXPIRED` / `DELIVERY_ALREADY_ASSIGNED` identifier in
the API today. See §11.

**Offers listing** — `GET /api/rider/dispatch/offers` → `{ success, message, data: { offers: [...] } }`.
It runs `processTimeouts()` first and filters out any offer whose `expiresIn <= 0`, so a client
can only ever see live offers.

---

## 5. Scenario H — Accept After Expiry

**Given** an offer with `response = 'pending'` whose `offerExpiresAt` has passed, **when** the
rider accepts:

- **409 Conflict**, message `Request timed out.`
- **No assignment**: `deliveries.rider_id` stays `NULL`
- Offer becomes `response = 'timeout'`, `responded_at = now()`
- If the wave is now empty and the delivery still unclaimed, it is **re-offered** to a fresh
  wave (`redispatchIfOffered`) and the response carries `next_dispatched: true` at service level

Covered by `DeliveryOfferConcurrencyTest::test_accept_after_offer_expiry_times_out_and_reoffers`.

**Frontend timers are UI only.** The authoritative check is backend-side and runs twice: a
cheap pre-lock check and a re-check inside the locked transaction. A client with a frozen or
manipulated timer cannot accept a stale offer.

---

## 6. Cancel Other Offers

After a successful acceptance:

```text
Rider A → accepted
Rider B → cancelled     (+ socket event delivery_offer_cancelled → rider:{B})
Rider C → cancelled
```

Two distinct cancellations happen, both after commit:

- `cancelOtherPendingOffers($riderId, $deliveryId)` — withdraws **this rider's other** offers
  (one-active-delivery rule); those other deliveries are re-offered only if still unclaimed.
- `cancelOtherRidersOffersForDelivery($deliveryId, $riderId)` — withdraws the **losers'** offers
  on the claimed delivery.

A cancelled offer later accepted → `response !== 'pending'` → `offer_gone` → **409**.

---

## 7. Purchasing Cash Flow & ALL COLLECTED Gate

```text
RIDER ASSIGNED  (cod_purchases stops created inside the accept transaction)
      ↓
Tourism Office issues purchasing cash   POST /admin/deliveries/{delivery}/issue-purchasing-cash
      ↓
Rider confirms receipt                  POST /rider/deliveries/{delivery}/purchasing-cash/receive
      ↓
Per stop: bought → collected            (row-locked, one row per delivery+business)
      ↓
ALL COLLECTED  ── gate ──→  picked_up
      ↓
Deliver to tourist → COD payment → delivered → settle-cod → completed
```

**Gate implementation** (`RiderDeliveryController:96-100`, `:141-146`): when moving a **COD**
delivery to `picked_up`, inside the delivery row-lock transaction the controller verifies every
`cod_purchases` stop for the delivery is `collected`. If not:

```text
HTTP 422  { "success": false,
            "message": "Collect food from every restaurant before leaving the pickup area." }
```

Notes vs the draft:

- The gate is at the **`picked_up` transition**, not at "tourist/completion stage".
- It is **COD-only** (`isCodDelivery`) — prepaid deliveries have no purchasing-cash ledger.
- It returns **422**, not 409.
- Other transition errors are distinct: forbidden → 403, invalid status transition → **409**.

---

## 8. COD Settlement — Arrived ≠ Settled

Reaching the tourist is **not** settlement. Actual terminal sequence:

```text
all collected → picked_up → in_transit → arrived_destination
      → rider confirms delivered      (deliveries.status = 'delivered')
      → POST /rider/deliveries/{delivery}/settle-cod
            → cod_settlements row (status = 'settled', 80/20 split)
            → order.status = 'completed'
```

`SETTLED` is **not** an order or delivery status (AGENTS §10 vocabulary). It is
`cod_settlements.status = 'settled'` (with `paid` as the later state). The delivery's own
terminal states are `delivered` / `completed`; the order's is `completed`.

---

## 9. Required Invariants

| # | Invariant | Enforced by |
|---|---|---|
| 1 | One assignment per delivery | `deliveries.rider_id` re-checked under `lockForUpdate`; `UNIQUE deliveries.order_id` backstop |
| 2 | Exactly one winning rider | single locked transaction; losers see the committed winner |
| 3 | Expired offers cannot win | `offerIsExpired()` pre-lock + under lock → 409 |
| 4 | Cancelled offers cannot win | `response !== 'pending'` re-check → 409 |
| 5 | Assigned delivery cannot be re-claimed | `rider_id !== null` → `already_assigned` → 409 |
| 6 | Failed acceptance creates no assignment | whole accept body is one transaction → rollback |
| 7 | Successful acceptance cancels remaining offers | `cancelOtherPendingOffers` + `cancelOtherRidersOffersForDelivery` (+ socket notify) |
| 8 | One active delivery per rider | rider row lock + `activeBindingsQuery` (AGENTS §4.3) |
| 9 | All collected before leaving pickup | COD `picked_up` gate → 422 |

---

## 10. Concurrency Test Matrix

Scenario letters below are those used **in the test file** (`makeBusiness()` labels). The
earlier draft matrix had two duplicate pairs (B ≡ E, D ≡ H) and its letters A–F did not
correspond to the test file's letters; the mapping is corrected here.

| Ref | Condition | Expected | Covered by |
|---|---|---|---|
| — | All eligible riders pinged at once | one `pending` offer per rider, `dispatch_status = notified` | `test_dispatch_offers_to_every_eligible_rider_in_a_single_wave` |
| A | Two riders hold pending offers; first accepts, second accepts | winner assigned; loser **409** + offer `cancelled` + socket notify | `test_first_accepted_offer_wins_and_loser_gets_conflict_and_cancelled` |
| B | Rider holds two offers, picks one; later re-accepts the withdrawn one | first succeeds; withdrawn offer cancelled + re-offered to another rider; second accept **409** (covers *cancelled offer → 409*) | `test_rider_chooses_one_offer_and_the_other_is_withdrawn_and_reoffered` |
| C | Three riders offered, one wins | losers `cancelled` + each notified over socket | `test_three_riders_each_offered_and_losers_cancelled_and_notified` |
| D | Rider never offered (or offer already consumed) attempts accept | **409**, no assignment; winner unaffected | `test_stale_offer_accept_after_claim_returns_conflict` |
| E | Offline / wrong-service riders in the candidate set | never receive an offer | `test_offline_and_non_matching_riders_are_not_offered` |
| F | HTTP recovery: read offers, accept, re-read | only live offers listed; both riders' lists clear after accept | `test_http_offers_endpoint_lists_only_live_offers_and_clears_after_accept` |
| G | Double-click accept over HTTP | first 200, second **409**, exactly one `accepted` offer row | `test_double_click_accept_first_wins_second_conflicts` |
| H | Accept after `offerExpiresAt` | **409**, `timeout`, no assignment, fresh wave re-offered | `test_accept_after_offer_expiry_times_out_and_reoffers` |

Supporting suites: `ConcurrencyLockTest` (genuine row-lock overlap → `already_assigned`,
one-delivery-per-order `UNIQUE` barrier, COD settle-once),
`OneActiveDeliveryTest`, `RiderAcceptanceGateTest`,
`PurchasingCashFlowTest` (issuance, per-stop progression, ALL-COLLECTED gate, end-to-end demo).

**Honest coverage notes**

- Scenario G is a rapid **sequential double-submit** over HTTP, not two truly parallel requests;
  real lock contention is exercised in `ConcurrencyLockTest`.
- The **422 `ineligible`** branch of `validateRiderAcceptance()` has no dedicated test in
  `DeliveryOfferConcurrencyTest` (eligibility is only tested at *offer* time, scenario E).
  This is a known gap, tracked for a future hardening pass.

---

## 11. Open Decision — Machine-Readable Error Codes

The draft spec showed:

```json
{ "success": false, "code": "OFFER_EXPIRED", "message": "…" }
```

**Not implemented.** Today an HTTP client can only distinguish 409 reasons by parsing the
`message` string, because `errorResponse()` drops the service flags. Making the reason
machine-readable is a deliberate **API change** (add a stable `code` to `ApiResponse` or forward
`conflict`/`timeout`/`already_assigned`), and it would need its own tests. It is intentionally
left open rather than documented as existing behavior.

---

## 12. Summary

The delivery-offer/acceptance layer is the concurrency boundary of the COD flow. The shipped
rules:

1. Every eligible rider is offered simultaneously; only one can win.
2. The winner is decided in **one transaction under delivery + rider + offer row locks**.
3. Expired, cancelled, stale, or already-consumed offers → **409**, never an assignment.
4. Ineligibility → **422** (distinct from conflict).
5. Losing/other offers are cancelled after commit and pushed over the socket.
6. Only then does the delivery enter the purchasing-cash flow, the ALL-COLLECTED gate
   (**422** until every stop is collected, COD only), and finally settlement
   (`cod_settlements.status = 'settled'`), which — arriving at the tourist does not equal.
