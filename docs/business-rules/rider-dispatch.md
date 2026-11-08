# Rider Dispatch Business Rules

## Business Owner Assignment Boundary

Business owners do not manually select or assign riders. The backend dispatch
pipeline offers deliveries to eligible riders, and the rider's canonical offer
acceptance flow binds the rider to the delivery. Business owners continue to
manage their own order preparation and readiness; delivery assignment and rider
ownership remain part of the shared dispatch lifecycle.

## 1. Nearest Rider Dispatch Engine

Rider dispatch is orchestrated by `NearestRiderService` and `SmartDispatchService`. When an order is created, the system locates candidate riders based on proximity, online status, and credit eligibility.

### Candidate Eligibility Criteria
A rider is eligible for a dispatch offer if and only if:
1. `rider_status === 'available'` (online and not currently executing a trip).
2. Has fresh GPS coordinates recorded within the system.
3. For **Cash on Delivery (COD)** orders: holds sufficient usable wallet balance to cover the order's financed amount (`subtotal + system_fee`).
4. Does not already hold an active delivery (`COD_ACTIVE_STATUSES`).

---

## 2. One Active Delivery Per Rider

> **A rider may receive multiple delivery offers simultaneously, but may accept only ONE active delivery at a time.**

### Behavior:
- A rider on standby can see offers for Order A and Order B.
- When the rider clicks **Accept** on Order A:
  1. An atomic database transaction acquires an exclusive lock on both the delivery row and rider row (`lockForUpdate()`).
  2. The system verifies the rider is still available and unassigned.
  3. Delivery is bound to the rider (`rider_id` assigned).
  4. Rider status transitions to `busy`.
  5. The rider's other outstanding offers are canceled and returned to the dispatch pool for other riders.
  6. Any subsequent attempt by this rider to accept Order B will be rejected with HTTP **409 Conflict** or **422 Unprocessable Entity**.

---

## 3. Offer Timing & Re-Dispatch

- **Offer Window**: Each dispatched offer is given a **120-second timeout** (`DISPATCH_TIMEOUT_SECONDS = 120`).
- **Decline Handling**:
  - If a rider manually declines an offer, the system logs the response in `booking_dispatch_logs`.
  - The system immediately dispatches the delivery to the next nearest eligible rider.
- **Timeout Handling**:
  - Two separate components handle two different things — do not conflate them:

    ```text
    ScheduledDispatchProcessor (via DispatchScheduledDeliveries, every minute)
        → scheduled deliveries becoming due (delivery.dispatch_status = 'scheduled')
        → parked no_rider_available deliveries whose dispatch_retry_at is due
           (or NULL — legacy rows; the attempt cap bounds them)

    NearestRiderService::processTimeouts()
        → rider-offer timeouts (booking_dispatch_logs.response: pending → timeout)
    ```

  - `processTimeouts()` has **no scheduled runner**. Its only call sites are rider HTTP polls (`RiderDispatchController::offers()` and `pendingRequest()`), so offer expiry is **poll-driven**: an expired offer row remains `pending` until some rider polls. Tracked in `docs/current-status/known-issues.md` (MED).
  - If the 120-second timer expires with no response, the pending offer is marked `timeout`; the delivery is re-offered to the next candidate only once the current offer wave is exhausted (live offers are left alone).
  - A `timeout` offer is **re-offerable to the same rider** on a later cycle: no response is not a refusal, and `UNIQUE(delivery_id, rider_id)` means the reopen is an UPDATE of the existing row back to `pending` (never a second row). A `declined` offer is final and is never re-offered. Re-opening removes only the already-offered blocker — every other gate (approved, available, service, GPS freshness, distance, active-order limit) still applies, and each cycle stays bounded by the 60-minute dispatch deadline and `1 + max_retries`. Without this, one missed ping permanently excluded that rider from the delivery and a single-candidate town dead-ended.
  - If all candidate riders are exhausted, the delivery status marks `no_rider_available` and alerts the operations monitoring queue.
  - `no_rider_available` is **not terminal**: both failure sites (`dispatchToNearest()` at checkout, `processTimeouts()` after a fully exhausted offer wave) park `dispatch_retry_at = now + retry_after_minutes`, and the `ScheduledDispatchProcessor` re-runs the same canonical pipeline when that time is due — bounded by `1 + max_retries` attempts, then `dispatch_failed` (terminal, `dispatch_retry_at` cleared). While retries continue the merchant-visible status stays `no_rider_available`. This closed a real defect: an order placed while no rider was eligible (e.g. COD gates: GPS older than 5 minutes or farther than 5 km from the pickup) was previously stranded forever with zero re-dispatch paths.

---

## 4. Order Size Classification & Dispatch Safeguards

To prevent overloading motorcycles, orders are classified at checkout by `OrderSizeClassifier`:

| Metric | Threshold | Classification | Dispatch Action |
|---|---|---|---|
| Total Item Quantity | < 12 items | `normal` | Immediate dispatch |
| Total Item Quantity | ≥ 12 items | `large` | Dispatched with warning flag for review |
| Unique Line Items | < 6 lines | `normal` | Immediate dispatch |
| Unique Line Items | ≥ 6 lines | `large` | Dispatched with warning flag for review |

### Design Decision:
Large orders are flagged (`orders.size_class = 'large'`) to notify dispatchers, but are **not** hard-blocked from dispatch. If a merchant cancels or rejects items and the count drops below the thresholds, the classifier automatically reverts the tag to `normal`.

---

## 5. Auto Accept (Rider Preference — Not a Dispatch Rule)

`rider_details.auto_accept` (default **OFF**) is a rider preference toggled through `PATCH /api/rider/auto-accept`.

- **Dispatch does not know it exists.** `NearestRiderService` never reads the flag: candidate eligibility, the offer wave, the 120-second window, COD eligibility, and re-dispatch behave exactly as documented above.
- **While it is ON**, the rider's open device accepts the **first ping it receives** (earliest `booking_dispatch_logs.dispatched_at`) by calling the same canonical `PATCH /api/rider/dispatch/accept` the manual button calls.
- Because acceptance stays on that endpoint, every server-side rule still applies unchanged: **one active delivery per rider** (atomic accept), offer expiry, COD eligibility, and 409/422 outcomes.
- A rejected auto-attempt — 409 (already claimed / already on a trip) or 422 (ineligible) — falls back to the normal manual offer UI and is **not retried for that same delivery**, so the 4-second offer poll can never loop.
- The rider must be online and the app open (it must be open anyway for GPS tracking). Closing it means no auto-accept, exactly like a rider who never taps.
- Toggling the flag is **state only**: it never accepts an offer, never assigns a delivery, and never moves `rider_status`. Pinned by `tests/Feature/RiderAutoAcceptTest.php`.

## 6. Exclusive Offer Review Hold (2026-11-07)

The first rider to open an offer reserves it while they decide.

- `POST /rider/deliveries/{id}/review` gives that rider an exclusive hold
  for `delivery.offer_review_seconds` (default 90 s, env
  `RIDER_OFFER_REVIEW_SECONDS`).
- The review page shows **no timer** (decision 2026-11-07). While it is
  open it renews the hold every 30 s (`PATCH /rider/deliveries/{id}/review`).
  An abandoned page stops renewing and the hold lapses; a live hold is never
  stolen.
- While the hold is live, other riders:
  - see "Another rider is reviewing this offer" on the list and the offer
    page;
  - get no customer drop-off or items;
  - cannot accept, through any path: board claim, ping accept, the ping
    popup or auto-accept. All of these return 409 "Another rider is
    reviewing this offer. Try another delivery."
- The reviewer accepts, or chooses "Find other offers" / Decline, which
  releases the hold (`DELETE /rider/deliveries/{id}/review`). Leaving the
  page releases it as well.
- Holds expire on their own, so an abandoned screen never blocks an order.
  Re-opening an offer (POST) keeps the original expiry; only the open page's
  heartbeat extends it.
- A rider holds at most one offer; opening another releases the first.
- Authority: `deliveries.review_rider_id` and `review_expires_at`, written
  under the delivery row lock (`OfferReviewService`). Both accept paths in
  `NearestRiderService` check `isHeldByOther()` inside their existing
  delivery lock.
  - The ping of a blocked rider stays `pending`, so it can still be
    accepted after the hold ends.
  - A successful assignment clears the hold.
- After another rider accepts, the offer stays listed for 10 minutes as
  "Already accepted by another rider" (read-only, no customer details) for
  riders who could see it.

## 7. Sequential Targeted Dispatch — food (2026-11-07)

Food deliveries are no longer broadcast to every rider. Full record:
docs/dispatch-escalation-plan.md §7.

1. The pickup sequence is planned first: the farthest restaurant from the
   tourist is stop 1. The rider search is centred on stop 1.
2. Offers go to **one** nearest eligible rider at a time for **30 s**
   (server-owned). A reject, or no answer, moves to the next nearest eligible
   rider. A rider is never offered the same order twice, and eligibility is
   re-checked before each offer.
3. After **4** unsuccessful targeted offers, or when no eligible targeted
   rider remains, the delivery moves to the manual Available Deliveries
   board (`dispatch_phase = manual`). Until then it is **not** on the board,
   and other riders cannot claim it (enforced server-side). On the board:
   - every eligible rider in range sees it, including riders who declined
     the targeted offer;
   - it is sorted per rider, nearest first, by distance to the first
     pickup;
   - once accepted it disappears for everyone else (Stage 3, 2026-11-08).
4. Acceptance is the existing atomic accept. Cancelled orders can never be
   accepted. One active delivery per rider is unchanged.
5. The dispatch-cycle deadline (60 min) is enforced by the 5-second worker
   (`dispatch:process-offer-timeouts`).

Transport (ride-hailing) keeps the simultaneous wave (decision D1).
