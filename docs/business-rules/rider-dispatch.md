# Rider Dispatch Business Rules

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
