# E2E & Realtime Tests

## Overview

End-to-end and realtime tests verify the cross-cutting delivery lifecycle: order placement through completion, realtime event flow, socket behavior, reconnect recovery, and consumer isolation.

**Related rules**: AGENTS.md §8 (Realtime Architecture), §12 (Testing Rules), §13 (Regression Rule)

---

## Backend End-to-End Test Files

### `RestaurantSubOrderItemsLifecycleTest`
- Group checkout: items grouped per restaurant
- Sub-order deliveries created at `waiting_restaurant`
- Per-restaurant dispatch and acceptance
- Rider binding through readiness

### `ConcurrencyLockTest` (7 tests / 28 assertions)
- Full dispatch + terminal-state guards under concurrency
- Double-accept, one-delivery-per-order, dispatchNow guard
- Cancel idempotency + no resurrection
- COD settle-once, one-live-payout

### `RiderAcceptanceGateTest` (6 tests / 78 assertions)
- Endpoint-level full lifecycle: 422 until accept -> authorized after
- Multi-restaurant independence with two riders

### `ReadyToDeliveredOrderSyncTest`
- HTTP rider status sync: delivery status -> order status
- Verifies `SyncOrderStatusFromDelivery` map

### `CompletionConsistencyTest`
- Rider completes => order completed with `completed_at`
- Prepaid never regresses
- COD delivered flush sets correct statuses

### `GroupedOrderDeliveryLifecycleTest`
- Group checkout -> independent deliveries per restaurant
- Full lifecycle through delivery services

---

## Node.js Socket Tests (`npm run test:js`)

### `socket-token.test.js` (10 tests)
- HMAC trip token minting/verification parity
- Byte-identical parity between Node and PHP (`TripTokenService`)
- Token structure `{v, deliveryId, role, sub, exp}`
- Expiry / tamper rejection

### `socket-validation.test.js` (15 tests)
- Bounds, freshness, rider identity, teleport speed guard
- Rejects Null Island `(0,0)` everywhere
- Rejects stale/invalid GPS fixes

---

## Realtime Scenarios to Cover (P11.5)

- [ ] Duplicate events are no-ops
- [ ] Reconnect recovers state via HTTP/API (WebSocket is not authoritative)
- [ ] Unauthorized consumers rejected server-side
- [ ] Multi-restaurant/group-order isolation of rooms
- [ ] Terminal-state cleanup (delivered/completed/cancelled stops broadcasts)
- [ ] Business `business:{id}` room receives `DeliveryAssigned` on accept
- [ ] Rider receives restaurant prepared/ready realtime
- [ ] Tourist receives order status changes
- [ ] Cancellation bridged to socket server and transient state evicted
- [ ] GPS integrity preserved across reconnect

---

## HTTP Recovery / Fallback

WebSocket is a realtime delivery mechanism, not the source of truth.

Recovery chain:

```
Disconnect / server restart
    ↓
HTTP/API polling (4s fallback)
    ↓
Authoritative MySQL/Laravel state
    ↓
Rejoined authorized room
```

Frontend fallbacks currently implemented:
- `useMerchantSocketNotifier.ts` — 4-second HTTP poll for pending deliveries
- `useCustomerMapSocket.ts` — location-poll fallback + reconnect (attempts 5, delay 2000ms)

---

## Consumer Isolation Model

A client receives only events it is authorized to receive (server-enforced, never client-filtered):

```
business:{businessId}
rider:{riderId}
user:{userId}
trip:{deliveryId}
```

---

## Running

```bash
# Node socket tests
npm run test:js

# PHP full regression suite
php artisan test

# Target lifecycle suites
php artisan test --filter=RestaurantSubOrder|ReadyToDelivered|CompletionConsistency|GroupedOrder|ConcurrencyLock|RiderAcceptanceGate
```

## Regression Reporting Format

After every phase:

```
Tests
Assertions
Failures
Skipped
```

Exit criterion: **0 failures**, skipped tests explicitly documented.