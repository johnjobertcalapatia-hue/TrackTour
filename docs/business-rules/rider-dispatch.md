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
  - The `ScheduledDispatchProcessor` runs periodically (every minute).
  - If the 120-second timer expires with no response, the pending offer is marked expired and re-dispatched to the next candidate.
  - If all candidate riders are exhausted, the delivery status marks `no_rider_available` and alerts the operations monitoring queue.

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
