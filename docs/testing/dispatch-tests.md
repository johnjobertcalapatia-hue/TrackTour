# Dispatch Tests

## Overview

Dispatch tests verify the rider-dispatch lifecycle: scheduling, offering, acceptance, timeout, decline, concurrency, and multi-restaurant independence.

**Related rules**: AGENTS.md §4.3 (One Active Delivery Per Rider), §4.4 (Delivery Ownership), §9 (Dispatch Rules)

---

## Test Files

### `ScheduledDispatchProcessorTest`
- Tests `SmartDispatchService::scheduleDispatch` and `dispatchNow`
- Verifies dispatch scheduling, duplicate prevention, and timeout behavior

### `OrderSizeDispatchEligibilityTest` (9 tests / 27 assertions)
- Normal vs large order classification
- Configurable thresholds (`DELIVERY_LARGE_ORDER_ITEM_QUANTITY`, `DELIVERY_LARGE_ORDER_LINE_ITEMS`)
- Cancelled/rejected item exclusion (shrunk orders revert to `normal`)
- Large orders still dispatchable (flag-only, not hard-blocked)

### `ConcurrencyLockTest` (7 tests / 28 assertions)
- Double-accept: two riders claim same delivery → only one wins
- One-delivery-per-order: UNIQUE `deliveries.order_id` backstop
- `dispatchNow` single-claim guard
- Rider 409 after auto-cancel (no ghost earning)
- Cancel idempotency + no resurrection
- COD settle-once (single payment + single earning)
- One-live-payout 409 then released

### `OneActiveDeliveryTest`
- Rider with active delivery cannot accept another
- Atomic acceptance enforcement via DB transaction + row lock

### `RiderAcceptanceGateTest` (6 tests / 78 assertions)
- 422 on every prep endpoint until acceptance, then authorized immediately
- Order `accepted` but rider null still blocked
- Only the offered rider may claim
- Multi-restaurant independence (A prepares while B waits)
- Permanent delivery-rider binding (no cross-restaurant claims)
- Decline re-offers to next eligible rider without duplicate offer
- `no_rider_available` blocks forever

### `RestaurantSubOrderItemsLifecycleTest`
- Multi-restaurant sub-order dispatch at `waiting_restaurant` creation
- Rider A claims sub-order A, rider B claims sub-order B
- Each delivery stays bound to its accepted rider through readiness
- Per-sub-order deliveries exist in `notified` state at creation

### `GroupedOrderDeliveryLifecycleTest`
- Group checkout creates independent deliveries per restaurant
- Each delivery dispatched and accepted independently

### `FastDeliveryTipTest` (9 tests / 37 assertions)
- Fast delivery with tip: dispatched and accepted normally
- Standard delivery ignores tip

---

## Key Invariants Verified

| Invariant | Enforcement |
|-----------|-------------|
| One active delivery per rider | DB transaction + `lockForUpdate` + UNIQUE constraints |
| One delivery per order | UNIQUE `deliveries.order_id` |
| One offer per rider per delivery | UNIQUE `(delivery_id, rider_id)` on `booking_dispatch_logs` |
| Rider acceptance gates preparation | `Order::hasAcceptedRider()` checked at every prep endpoint |
| Atomic acceptance | Row lock on delivery + rider, CAS-style check |

---

## Dispatch Lifecycle

```
Order placed (waiting_restaurant)
    ↓
SmartDispatchService::scheduleDispatch
    ↓
Delivery created (dispatch_status: notified)
    ↓
Rider receives offer
    ↓
┌──────────┬──────────┐
│ Accept   │ Decline  │
│ (lock)   │ (re-offer)│
└────┬─────┴────┬─────┘
     ↓          ↓
  Assigned   Next rider
     ↓
Restaurant may prepare
```

---

## Running

```bash
# PHP dispatch tests
php artisan test --filter=Dispatch|Concurrency|OneActive|AcceptanceGate|OrderSize|RestaurantSubOrder|GroupedOrder

# Full suite
php artisan test
```
