# Order Lifecycle & State Machine

## Overview

The TrackTour order lifecycle balances multi-restaurant cart checkouts, immediate rider dispatch, and an automatic, rider-gated preparation countdown. The restaurant has **no accept/reject action** — orders sit in *Finding Rider* until a rider accepts, at which point preparation starts automatically and runs on the restaurant's per-food preparation time.

---

## Complete State Diagram

```text
       [ Tourist Places Order ]
                  │
                  ▼
         pending_payment (if online)
                  │
                  │ (Payment Webhook Verified or COD Selected)
                  ▼
         waiting_restaurant  ← display label: "Finding Rider"
                  │
                  ├───► [ Dispatch Engine Offers Candidates ]
                  │                 │
                  │                 ▼
                  │           rider offered
                  │                 │
                  │                 ▼
                  │     [ Rider Accepts Delivery ]
                  │                 │
                  ◄─────────────────┘
                  │
                  │ PreparationStartService auto-starts
                  │ (pickup orders skip the rider entirely and
                  │  start at placement/payment instead)
                  ▼
              preparing  ← countdown armed:
                  │        predicted_ready_at = now + effective minutes
                  │
                  │ countdown reaches 00:00 — AUTOMATIC
                  │ (no restaurant action required)
                  ▼
                 ready  ← display label: "Ready"
                  │
                  ▼
              picked_up (Rider arrives at restaurant)
                  │
                  ▼
             in_transit (Navigating to tourist)
                  │
                  ▼
        arrived_destination (Rider at tourist location)
                  │
                  ▼
              delivered (Cash collection if COD)
                  │
                  ▼
              completed (Financial settlement)
```

Backend status vocabulary is unchanged; all label mappings are frontend display-only (`STATUS_LABELS` in `frontend/src/shared/constants`).

---

## Detailed Step Walkthrough

### 1. Placement & Payment Gate (`pending_payment`)
- Non-cash orders start at `pending_payment`.
- PayMongo payment authorization / webhook flips the order to `waiting_restaurant`.
- Cash on Delivery orders enter `waiting_restaurant` immediately.

### 2. Finding Rider (`waiting_restaurant`)
- Order creation immediately triggers dispatch (`SmartDispatchService` / scheduled offers, 120-second offer timer).
- Nearest eligible candidate riders receive offers; a rider may receive many offers but may accept only ONE active delivery at a time.
- **The restaurant has no accept or reject action.** The retired order-level accept / reject / accept-all and item-level accept / reject endpoints no longer exist (404).
- Every preparation-reaching endpoint (`start-preparation`, `mark-ready`, item status, kitchen, staff status) returns HTTP 422 while no rider has accepted.
- **Never auto-cancel:** an order that never finds a rider waits indefinitely (the former 10-minute `AutoRejectWaitingOrder` auto-reject was removed by decision).

### 3. Rider Acceptance Gate → Automatic Preparation Start
- First eligible rider accepts: an atomic lock assigns `deliveries.rider_id`, the delivery becomes `assigned`, and other pending offers are revoked.
- `NearestRiderService::handleRiderResponse` calls **`PreparationStartService::startForDelivery`** before `DeliveryAssigned`:
  - `waiting_restaurant → preparing` (row-locked and idempotent — exactly one `OrderStatusChanged`),
  - order items move to `preparing`,
  - the countdown is armed,
  - an `authorized` online payment is captured (`payment_status → paid`); **COD stays `pending`** — cash settles at delivery.
- The minute scheduler `orders:advance-preparation` is the self-healing backstop if the hook ever misses.

### 4. Preparation Countdown (`preparing`)
- Duration is restaurant-defined per food offering (`offerings.preparation_time`, integer 0–240 minutes):

```text
base      = MAX(order_items.preparation_time)   ← snapshot at order time; quantity never multiplies
fallback  = businesses.average_wait_time ?? 15 minutes   (when no item carries a time)
reduction = priority-tip reduction if enabled on restaurant_settings (OFF by default)
effective = max(1, base − reduction)
```

- The effective minutes are snapshotted on `orders.preparation_time` / `predicted_preparation_seconds` / `predicted_ready_at`, so later menu edits never mutate an in-flight order's timer.
- Priority-tip reduction tiers are owner-configured minutes (example defaults: Normal = 0, ₱25 = −5, ₱50 = −10 style tiers; endpoint `PATCH /business-owner/restaurants/{id}/settings/preparation`, owner-only → 403 otherwise).
- At **00:00** the scheduler flips `preparing → ready` automatically (`food_ready_at`, item `ready_at`) and broadcasts `OrderStatusChanged`. Item-level and `mark-ready` endpoints remain available as operator overrides; when every active item reaches `ready` the order flips `ready` as well.

### 5. Pickup & Transit (`ready` → `picked_up` → `in_transit`)
- Rider arrives at the restaurant, verifies contents, updates to `picked_up`.
- Rider begins navigation to the tourist (`in_transit`); a realtime GPS stream broadcasts live coordinates to the tourist map.

### 6. Delivery & Final Settlement (`arrived_destination` → `delivered` → `completed`)
- Rider arrives at the destination and hands the food to the tourist.
- COD: the rider collects physical cash and **keeps it** — COD is credit-free (no rider wallet, no reserved credit).
- Settlement base = `order.rider_financed_amount` → restaurant **80%** / Tourism Office **20%** (`CodSettlementService`), performed exactly once.
- Rider earnings = delivery fee + eligible tip, booked to `rider_earnings`.
- Order transitions to the immutable terminal status `completed`.

### Pickup (non-delivery) orders
- No rider is involved. The rider gate in `PreparationStartService` is delivery-only: preparation starts at order placement/payment through the same service, and the countdown arms immediately.

---

## Frontend Display Labels (display-only — DB vocabulary unchanged)

| DB status | UI label |
|---|---|
| `waiting_restaurant` | Pending / Finding Rider |
| `preparing` | Preparing |
| `ready` | Ready |
| `picked_up` | Picked Up |
| `in_transit` | Out for Delivery |
| `delivered` | Delivered |
| `completed` | Completed |
| `cancelled` | Cancelled |
| `rejected` | Rejected (system/customer/rider logic only) |

---

## Cancellation & Timeout Policies

- **No merchant auto-reject**: `AutoRejectWaitingOrder` and its schedule entry were removed — riderless orders wait indefinitely (`never auto-cancel`).
- **Undelivered Abandonment (`AutoCancelUndeliveredOrder`)**: paid delivery orders exceeding 60 minutes without delivery are auto-cancelled and refunded.
- Customer/system cancellation paths remain (`cancelled_by_tourist`, `rejected`).

---

## Authoritative Code

| Concern | Canonical implementation |
|---|---|
| Prep start / auto-ready | `app/Services/PreparationStartService.php` |
| Minute backstop | `app/Console/Commands/AdvancePreparationOrders.php` (`orders:advance-preparation`, every minute in `routes/console.php`) |
| Rider-acceptance hook | `app/Services/NearestRiderService::handleRiderResponse()` |
| Owner prep settings | `app/Http/Controllers/BusinessOwnerPreparationController.php` |
| Dispatch priority | `app/Services/ScheduledDispatchProcessor::dueDeliveryIds()` — `rider_tip DESC` |

---

## Tests

- `tests/Feature/RestaurantPreparationTimerTest.php` — removed endpoints → 404, rider-acceptance start + countdown, MAX-snapshot math without quantity multiplication, menu-edit immutability, reduction off-by-default, tier math + RBAC, auto-ready due/not-due idempotency, pickup start without rider, scheduler promotion of stranded orders, auto-reject command removal, offering `preparation_time` CRUD validation.
- `tests/Feature/PreparationStartServiceGateTest.php` — service gate: delivery-only rider requirement, idempotent start, scheduler recovery, authorized-payment capture.
- `tests/Feature/RiderAcceptanceGateTest.php` — reconciled to rider-acceptance-driven preparation (single-trigger `preparing` transition, removed endpoints, COD-stays-pending, prepaid capture).
