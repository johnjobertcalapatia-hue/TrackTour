# Backend Architecture

## Overview

The TrackTour backend is powered by **Laravel 12** running on **PHP 8.2**, with a **MySQL** relational database. It is structured around RESTful APIs, domain service layers, strict database transaction boundaries, and row-level pessimistic locking.

---

## Architectural Layers

```text
HTTP Request
     │
     ▼
[Routing & Middleware] ─── Sanctum Auth, RoleVerification (`role:tourist`, `role:rider`, etc.)
     │
     ▼
[Form Requests / Validation] ── Data sanitization, type constraints, coordinate bounds
     │
     ▼
[Controllers] ── Thin controllers implementing `ApiResponse` traits
     │
     ▼
[Domain Services] ── Pure business logic, transactional boundaries, locking
     │
     ├── GroupOrderService          ── Multi-restaurant checkout orchestrator
     ├── NearestRiderService        ── Proximity dispatch, offer management, accept/decline
     ├── SmartDispatchService       ── Scheduling, timeout processing, dispatching
     ├── CodSettlementService       ── 80/20 revenue split, settlement ledgering
     ├── TripTokenService           ── HMAC-SHA256 tracking token minting
     ├── PaymentRefundProcessor     ── PayMongo integration, refund reconciliation
     └── RiderPayoutService         ── Ledger-first batching, double-draw barriers
     │
     ▼
[Eloquent Models & DB Transactions] ── Strict ACID transactions, `lockForUpdate()`, DB UNIQUE keys
     │
     ▼
MySQL Database (InnoDB)
```

---

## Key Domain Services

### 1. `GroupOrderService`
- Coordinates multi-vendor checkouts.
- Translates one tourist cart into one `group_checkouts` record, multiple child `orders` records (one per restaurant), and child `order_items`.
- Automatically initializes child `deliveries` records in `waiting_restaurant` status to kick off rider dispatch immediately upon checkout.

### 2. `NearestRiderService`
- **Proximity Search**: Queries available riders within configurable radius bounds using the Haversine formula.
- **Offer Lifecycle**: Inserts `booking_dispatch_logs` and transitions `deliveries.dispatch_status` to `notified`.
- **Atomic Acceptance**: Enforces the **One Active Delivery** invariant inside an atomic transaction:
  ```php
  DB::transaction(function () use ($deliveryId, $riderId) {
      $delivery = Delivery::where('id', $deliveryId)->lockForUpdate()->first();
      $rider = Rider::where('id', $riderId)->lockForUpdate()->first();
      
      // Verify rider is not already holding an active trip
      // Reserve COD credit if payment method is cash
      // Assign rider and update status
  });
  ```

### 3. `SmartDispatchService`
- Manages dispatch scheduling and timeout processing.
- Handles automated failover when riders decline or let the 120-second offer expire, finding the next eligible candidate.

### 4. `CodSettlementService`
- Governs Cash on Delivery accounting.
- Splits the financed food total (subtotal + system fee) 80% to the restaurant and 20% to the Tourism Office upon delivery completion.
- Inserts auditable `cod_settlements` records backed by unique indexes.

### 5. `TripTokenService`
- Issues cryptographically signed HMAC-SHA256 tokens used by tourists and riders to join Socket.IO trip rooms.
- Prevents cross-order surveillance and unauthorized GPS streaming.

### 6. `PaymentRefundProcessor` & `OrderRefundService`
- Manages PayMongo refund lifecycles.
- Enforces strict verification: an order is **never** marked `refunded` unless the payment gateway confirms `SUCCESS`.
- Handles webhook-based refund reconciliation and scheduled retries.

### 7. `RiderPayoutService`
- Ledger-first withdrawal management.
- Riders request payouts of earned commissions and tips.
- Prevents double-draw attacks using database unique constraints on the payout-earning pivot table (`UNIQUE(rider_earning_id)`).

---

## Concurrency & Database Integrity Patterns

TrackTour avoids eventual-consistency bugs and race conditions through database-level primitives:

1. **Pessimistic Row Locking (`lockForUpdate`)**:
   - Used on critical state transitions: rider acceptance, delivery completion, COD credit reservation, and payout creation.
   - Prevents two riders from claiming the same order simultaneously.
   - Prevents a rider from accepting multiple concurrent deliveries.

2. **Database Unique Index Backstops**:
   - `UNIQUE(deliveries.order_id)`: Guarantees an order can never have more than one delivery record.
   - `UNIQUE(booking_dispatch_logs.delivery_id, booking_dispatch_logs.rider_id)`: Prevents duplicate concurrent offers to the same rider for the same delivery.
   - `UNIQUE(rider_earnings.rider_id, rider_earnings.order_id, rider_earnings.status)`: Prevents double-crediting of rider earnings.
   - `UNIQUE(payment_webhook_events.event_id)`: Ensures PayMongo webhooks are processed exactly once.
   - `UNIQUE(rider_payout_rider_earning.rider_earning_id)`: Guarantees an earning can never be attached to multiple payouts.

---

## Authentication & Authorization

- **Sanctum**: Token-based authentication for single-page applications and mobile API clients.
- **Role Middleware**: Endpoints are strictly partitioned using role-based middleware:
  - `role:tourist`: Cart, checkout, order placement, customer map tracking.
  - `role:business_owner`: Business management, menu CRUD, order preparation gating.
  - `role:rider`: GPS updates, dispatch response, delivery status, wallet & payouts.
  - `role:admin`: Platform reporting, user verification, payout approvals.
