# TrackTour — OpenCode Development Instructions

## 1. Project

TrackTour is a tourism promotion and food-delivery web application for Bansud, Oriental Mindoro.

The system includes:

- Tourism destinations
    
- Tourism businesses
    
- Hotels and resorts
    
- Restaurants and food hubs
    
- Food ordering
    
- Food delivery
    
- Rider dispatch
    
- Rider wallet / credits
    
- PayMongo payments
    
- COD
    
- Rider GPS tracking
    
- Realtime delivery tracking
    
- Tourism Office administration
    

---

## 2. Project Structure

The project contains:

- `track-tour-api/` — Laravel backend
    
- `track-tour-frontend/` — React frontend
    
- `docs/` — TrackTour engineering documentation and project memory
    

The `docs/` directory is also used as the Obsidian knowledge base.

Before implementing a significant change:

1. Read the relevant existing code.
    
2. Read the relevant documentation in `docs/`.
    
3. Identify the current canonical service/controller/route.
    
4. Reuse the existing architecture whenever possible.
    
5. Do not create duplicate implementations when a canonical implementation already exists.
    

---

## 3. Technology Stack

### Frontend

- React
    
- Vite
    
- Tailwind CSS
    

### Backend

- Laravel
    
- REST API
    
- Laravel Sanctum
    
- Role-based access control
    

### Database

- MySQL
    

### Payments

- PayMongo
    
- GCash
    
- Cash on Delivery
    

### Maps

- Leaflet
    

### Realtime

- Node.js
    
- Socket.IO
    
- WebSockets
    

---

# 4. Critical Architecture Rules

These rules are authoritative unless an explicit architectural decision changes them.

## 4.1 Group Checkout

A tourist can have food from multiple restaurants in one cart.

The tourist experiences this as one checkout.

The backend creates:

- one `group_checkouts` record
    
- one `orders` record per restaurant
    
- order items belonging to that restaurant's order
    
- one independent delivery per restaurant order
    
- an independent rider for each delivery
    

Example:

```text
Group Checkout
│
├── Order A
│   ├── Restaurant A items
│   └── Delivery A
│       └── Rider A
│
└── Order B
    ├── Restaurant B items
    └── Delivery B
        └── Rider B
```

Never create one `orders` row per item.

Each restaurant has one independent restaurant order containing its own items.

Restaurant fulfillment is independent.

If Restaurant A has no rider, Restaurant A must not block Restaurant B from proceeding.

---

## 4.2 Rider Acceptance Gates Food Preparation

This is a mandatory business rule.

A restaurant must NOT begin preparing an order until a rider has successfully accepted that restaurant's delivery.

Correct lifecycle:

```text
Tourist places order
        ↓
Restaurant order created
        ↓
Delivery created
        ↓
Rider dispatched/offered
        ↓
Rider accepts delivery
        ↓
Restaurant may prepare
        ↓
Restaurant marks items/order ready
        ↓
Rider picks up
        ↓
Delivery
        ↓
Completed
```

Without an accepted rider:

```text
No accepted rider
      ↓
Preparation request = 422
```

This rule applies to every preparation path, including:

- business-owner order acceptance
    
- start preparation
    
- mark ready
    
- accept all
    
- order status updates
    
- item status updates
    
- kitchen endpoints
    
- staff order-status endpoints
    

Do not introduce a new preparation path that bypasses this rule.

The authoritative check should use the existing delivery/order relationship and rider-assignment logic.

---

## 4.3 One Active Delivery Per Rider

A rider may receive multiple delivery offers.

A rider may accept only ONE active/ongoing delivery at a time.

```text
Rider
 ├── Offer A
 ├── Offer B
 └── Offer C

Can receive all offers
        ↓
Can accept only ONE
```

This must be enforced by the backend/database, not only by the frontend.

Use:

- transactions
    
- row locks where required
    
- unique constraints
    
- atomic acceptance checks
    

When a rider successfully accepts one delivery, other pending offers may be cancelled/re-offered according to the existing dispatch implementation.

Never weaken the one-active-delivery rule to make a frontend flow work.

---

## 4.4 Delivery Ownership

Once a rider accepts a delivery:

```text
Delivery
   ↓
Accepted Rider
```

The delivery must remain bound to that rider unless the delivery is legitimately released/reassigned by the canonical dispatch flow.

For multi-restaurant orders:

```text
Order A → Delivery A → Rider A
Order B → Delivery B → Rider B
```

Rider A must never become the rider for Delivery B simply because both belong to the same group checkout.

Restaurant A's preparation gate must resolve only from Restaurant A's accepted rider.

---

# 5. COD Financial Rules

## 5.1 Rider Credit vs COD Cash

These are different financial concepts.

```text
COD Cash
    =
physical cash paid by tourist to rider

Rider Credit
    =
TrackTour wallet balance used to finance COD settlement

Rider Earnings
    =
delivery fee + eligible tip
```

The rider keeps the physical COD cash.

The rider does NOT remit the COD cash to TrackTour under the current architecture.

Do not treat COD cash as rider earnings.

Do not deduct rider payout from rider credit.

Do not deduct COD cash from rider earnings.

---

## 5.2 Protected Rider Reserve

The protected reserve is:

```text
₱200
```

It is NOT:

- usable delivery credit
    
- COD financing credit
    
- `reserved_credit`
    
- deductible for COD settlement
    

Usable credit is calculated according to the established rider-credit implementation.

Do not modify the protected-reserve rule without an explicit architectural decision.

---

## 5.3 COD Settlement

For COD settlement:

```text
Tourist
   ↓
Cash
   ↓
Rider keeps cash

Rider Credit
   ↓
Settlement deduction
   ↓
Restaurant + Tourism Office
```

The settlement base must be the actual rider-financed/reserved amount.

Authoritative invariant:

```text
delivery.cod_credit_reserved
    =
order.rider_financed_amount
    =
actual rider-credit deduction
    =
restaurant share + Tourism Office share
```

Current split:

```text
Restaurant = 80%
Tourism Office = 20%
```

Examples:

```text
₱100  → Restaurant ₱80  + Tourism Office ₱20
₱500  → Restaurant ₱400 + Tourism Office ₱100
₱1000 → Restaurant ₱800 + Tourism Office ₱200
```

Do not deduct rider credit twice.

The existing `RiderCredit::finalize()` already performs the rider-credit deduction. New settlement functionality must not duplicate that deduction.

---

## 5.4 Fast Delivery Tip

Standard delivery:

```text
No fast-delivery tip
```

Fast delivery:

```text
Required tip: ₱20–₱100
```

The tip:

- is included in the original GCash payment
    
- is paid in cash to the rider for COD
    
- belongs to rider earnings
    
- is not part of the COD restaurant/Tourism Office settlement base
    
- cannot be added after delivery
    

Do not create a separate rider-tip table unless an explicit architecture decision requires it.

---

# 6. Payment Architecture

PayMongo is the provider authority for payment/refund outcomes.

Never assume a payment or refund succeeded merely because an API request was initiated.

## 6.1 Payment Idempotency

Webhook processing must be idempotent.

The authoritative webhook event identifier is the provider event ID where available.

The database provides the final duplicate-protection backstop.

Existing architecture includes:

```text
payment_webhook_events
        ↓
UNIQUE provider_event_id
```

Duplicate provider events must become harmless no-ops.

Do not replace database uniqueness with only:

```text
if ($alreadyProcessed)
```

---

## 6.2 Payment State Protection

Do not allow invalid state downgrades.

Examples:

```text
paid → pending       ❌
paid → failed        ❌
refunded → paid      ❌
pending_refund → paid ❌
```

Legitimate multiple payment attempts are allowed.

Do not add a blanket `(payable_type, payable_id)` unique constraint unless the architecture explicitly changes.

The existing authoritative-paid transition must remain protected by its locking/idempotency logic.

---

# 7. Refund Architecture

Refunds are provider-authoritative and idempotent.

Correct behavior:

```text
Refund requested
       ↓
PayMongo
       ↓
 ┌─────────────┐
 │             │
SUCCESS       FAILURE
 │             │
 ↓             ↓
refunded    pending_refund
              ↓
        retry/reconcile
```

Never mark a payment as `refunded` before provider confirmation.

Provider failure must remain retryable.

Supported refund lifecycle handling includes:

- `refund.pending`
    
- `refund.succeeded`
    
- `refund.failed`
    
- `refund.updated`
    

Refund events must have no-downgrade behavior.

The scheduled refund reconciliation process must re-query provider state.

Never blindly flip `pending_refund` to `refunded` or `failed`.

Never issue duplicate provider refunds.

---

# 8. Realtime Architecture

MySQL/Laravel is the authoritative source of truth.

WebSocket/Socket.IO is a realtime delivery mechanism.

```text
MySQL / Laravel
       ↓
Authoritative state
       ↓
Realtime event
       ↓
Socket server
       ↓
Authorized room
       ↓
React UI
```

The socket server must NOT become authoritative for:

- order status
    
- delivery status
    
- rider availability
    
- payment status
    
- COD settlement
    
- rider credit
    
- payouts
    

The socket server may maintain transient:

- rooms
    
- active socket connections
    
- temporary trip state
    

---

## 8.1 Realtime Order Events

Important order/delivery transitions should be emitted from the authoritative transition point.

Use the existing canonical events where possible, especially:

```text
OrderStatusChanged
DeliveryAssigned
```

Do not create duplicate event systems when an existing event can represent the transition.

---

## 8.2 Realtime Consumer Isolation

A client must receive only events it is authorized to receive.

Conceptual rooms:

```text
business:{businessId}
rider:{riderId}
user:{userId}
trip:{deliveryId}
```

Authorization must be enforced server-side.

Never rely on React filtering alone.

---

## 8.3 Rider → Restaurant

When a rider successfully accepts:

```text
Rider accepts
      ↓
DeliveryAssigned
      ↓
business:{businessId}
      ↓
Restaurant/Kitchen
```

The restaurant should receive a realtime indication that an accepted rider exists and preparation may proceed.

HTTP polling remains the recovery/fallback mechanism.

---

## 8.4 Restaurant → Rider

Restaurant state changes should reach the assigned rider.

Especially:

```text
Restaurant → preparing
Restaurant → ready
```

The rider must receive the ready-for-pickup state without requiring manual refresh.

---

## 8.5 Restaurant → Tourist

Tourists should receive realtime order-status changes such as:

```text
preparing
ready
picked_up
in_transit
arrived_destination
delivered
```

HTTP remains available for state recovery.

---

## 8.6 Rider → Tourist GPS

Existing rider tracking uses Socket.IO/WebSockets.

Canonical location payload:

```text
{
    rider_id,
    delivery_id,
    latitude,
    longitude,
    accuracy,
    speed,
    heading,
    recorded_at
}
```

Tracking must:

- require authorization
    
- validate the trip token
    
- enforce rate limits
    
- reject invalid payloads
    
- preserve GPS integrity states
    
- stop broadcasting after terminal completion/cancellation
    

Offline GPS gaps must not automatically be classified as spoofing.

---

## 8.7 Reconnect Recovery

WebSocket is not the authoritative state.

After:

```text
disconnect
server restart
network interruption
```

the frontend must be able to recover current state through HTTP/API.

The system must not depend on Socket.IO RAM surviving a server restart.

---

## 8.8 Terminal States

Terminal delivery states include:

```text
delivered
completed
cancelled
```

Once a delivery reaches a terminal state:

- stop active tracking
    
- stop inappropriate live broadcasts
    
- clean transient socket state
    
- notify authorized clients
    
- allow frontend to return to the correct non-tracking state
    

Socket cleanup must never be responsible for the authoritative database state.

---

# 9. Dispatch Rules

Use the existing canonical dispatch architecture.

Do not rewrite `SmartDispatchService` unless a proven defect requires it.

Rider eligibility includes the established requirements such as:

- online
    
- available
    
- no active delivery
    
- valid rider account
    
- valid required documents
    
- appropriate service eligibility
    
- sufficient usable credit for COD
    

A rider may receive offers but can accept only one active delivery.

Offer acceptance must be atomic.

---

# 10. Order Status Rules

Do not globally rename or normalize status values without an explicit migration plan.

Existing status vocabulary includes:

```text
pending_payment
pending
waiting_restaurant
accepted
preparing
ready
picked_up
in_transit
arrived_destination
delivered
completed
cancelled
cancelled_by_tourist
rejected
refunded
```

Before adding a new status:

1. Search the entire backend.
    
2. Search the frontend.
    
3. Search tests.
    
4. Search database constraints/enums.
    
5. Search documentation.
    
6. Determine whether an existing status already represents the state.
    

Avoid introducing duplicate meanings.

---

# 11. Database Integrity

Database constraints are part of the business rules.

Use database-level protection for important invariants.

Existing important protections include:

- unique delivery per order
    
- unique rider offer per delivery/rider
    
- unique payment provider references
    
- unique payment webhook event IDs
    
- payout allocation protections
    
- COD settlement uniqueness
    

Do not remove a database constraint simply to make a test pass.

If a migration must be applied manually because the development database does not have a migrations table:

1. Inspect the current schema.
    
2. Check for duplicate/conflicting data.
    
3. Apply the required schema change.
    
4. Verify with `SHOW CREATE TABLE`.
    
5. Run a live constraint probe where appropriate.
    
6. Run the affected tests.
    
7. Run the full suite.
    
8. Document the result.
    

---

# 12. Testing Rules

Every significant change must include automated tests.

Tests should cover:

- normal success
    
- invalid state
    
- unauthorized access
    
- duplicate requests
    
- concurrent requests
    
- cancellation
    
- retry
    
- multi-restaurant behavior
    
- financial side effects
    
- realtime isolation where applicable
    

Do not weaken production logic merely to satisfy an outdated test.

If a test encodes behavior that conflicts with the current authoritative architecture:

1. Identify the drift.
    
2. Confirm the intended business rule.
    
3. Reconcile the test.
    
4. Document why it changed.
    

---

# 13. Regression Rule

Before declaring a phase complete:

```text
Targeted tests
      ↓
Full test suite
      ↓
Database verification where applicable
      ↓
Documentation update
      ↓
Checkpoint
```

The full suite must have:

```text
0 failures
```

Skipped tests must be explicitly understood/documented.

Always report:

```text
Tests
Assertions
Failures
Skipped
```

---

# 14. Existing Development Checkpoints

Verified project checkpoints:

```text
P10  — 248 tests / 1,035 assertions / 0 failures / 2 skipped

P11.1 — COD financial settlement
      — COMPLETE

P11.2 — Rider acceptance gate
      — COMPLETE
      — 264 tests / 1,227 assertions / 0 failures / 2 skipped

P11.3 — Refund hardening
      — COMPLETE
      — 279 tests / 1,310 assertions / 0 failures / 2 skipped

P11.4 — Payment idempotency
      — COMPLETE & VERIFIED
      — 292 tests / 1,369 assertions / 0 failures / 2 skipped

P11.5 — Realtime completeness
      — COMPLETE & VERIFIED
      — 300 tests / 1,447 assertions / 0 failures / 2 skipped

P11.6 — Acceptance-gate regression
      — COMPLETE & VERIFIED
      — 305 tests / 1,479 assertions / 0 failures / 2 skipped

P11.7 — Final system verification
      — COMPLETE & VERIFIED
      — 305 tests / 1,479 assertions / 0 failures / 2 skipped (Laravel)
      — 43/43 socket JS tests
```

Current development phase:

```text
Admin — Tourism Office Governance & Monitoring (Phases 1–7)
```

---

# 15. Admin Module Scope

The delivery/dispatch/payment/realtime phase (P11.1 → P11.7) is complete. The next build phase is the **Admin module**: a Tourism Office governance/monitoring surface built in phases 1→7, each ending on a tested checkpoint.

Required work plan:

```text
Admin Phase 1 — Foundation (Dashboard, Layout, RBAC, Audit Log, Stats)
    [ ] Audit existing admin-related controllers, routes, middleware,
        frontend pages and the tourism_officials role
    [ ] Identify canonical admin identity + permissions
    [ ] Dashboard: key operational KPIs (read-only aggregates)
    [ ] Shared Admin layout (sidebar/nav) consistent with existing
        frontend architecture
    [ ] RBAC middleware + role gating on admin API routes
    [ ] Audit log model/migration + audit trail recording
    [ ] KPI/stats API endpoints (orders, deliveries, riders, revenue)
    [ ] Tests: RBAC, audit logging, stats accuracy, unauthorized access
    [ ] Run complete regression suite
    [ ] Update docs/PROGRESS.md (Phase 1 checkpoint)

Admin Phase 2 — Rider Management
    [ ] Rider directory: list/search/filter riders
    [ ] Rider detail: profile, documents, availability history
    [ ] Verify/approve rider documents (monitor → verify → approve)
    [ ] Rider account status visibility
    [ ] Tests: RBAC, approval workflow, document verification

Admin Phase 3 — Rider Operations Monitoring
    [ ] Live rider availability/online map (read-only)
    [ ] Active deliveries & dispatch visibility
    [ ] Delivery history lookup
    [ ] Realtime monitoring via existing socket consumers (authorized room)
    [ ] Tests: monitoring data accuracy, realtime isolation

Admin Phase 4 — Financial Monitoring
    [ ] COD settlements dashboard (restaurant 80 / tourism office 20)
    [ ] Rider credit & protected reserve visibility (never mutable)
    [ ] Payments, refunds, payouts read-only views
    [ ] System-fee / COD receivable reporting
    [ ] Tests: financial totals accuracy, no mutation of money state

Admin Phase 5 — Business Management
    [ ] Business directory: list/search/filter businesses
    [ ] Business detail: profile, status, order activity
    [ ] Approval/verification workflow for businesses
    [ ] Tests: business approval RBAC, detail accuracy

Admin Phase 6 — Tourism Management
    [ ] Tourism destinations & businesses registry
    [ ] Tourism spot/destination detail + promotion status
    [ ] Editorial/promotion management
    [ ] Tests: registry CRUD RBAC, promotion accuracy

Admin Phase 7 — Reports & Audit
    [ ] Operational reports (order/delivery volume, fulfillment)
    [ ] Financial reports (settlements, payouts, COD receivables)
    [ ] Rider payout & earnings reports
    [ ] Full audit-trail explorer with filters
    [ ] Export (CSV/PDF) where the stack supports it
    [ ] Tests: report math, filter correctness, RBAC
```

Do not rebuild the existing Socket.IO/GPS architecture.

---

# 16. Do Not Regress Completed Architecture

Unless a proven defect requires it, do not rewrite:

- COD settlement
    
- rider credit deduction
    
- protected reserve
    
- rider acceptance gate
    
- SmartDispatchService
    
- payment idempotency
    
- refund processor
    
- rider payout architecture
    
- GPS token security
    
- existing Socket.IO infrastructure
    

Prefer targeted fixes over architectural rewrites.

---

# 17. Deferred Low-Priority Item

The following is intentionally deferred:

```text
rider_credit_transactions.delivery_id
```

Currently the ledger records `order_id`.

Because:

```text
deliveries.order_id = UNIQUE
```

the delivery is deterministically reconstructable from the order.

Additionally:

```text
cod_settlements.delivery_id
```

already provides an explicit settlement-level delivery reference.

Treat this as a LOW-priority audit enhancement.

Do not expand unrelated financial work merely to add this field.

---

# 18. Documentation Rules

After every completed phase:

1. Update `docs/PROGRESS.md`.
    
2. Update the relevant section of `docs/P11-recon.md` when applicable.
    
3. Record:
    
    - implementation summary
        
    - tests added
        
    - final test count
        
    - database verification
        
    - known deferred items
        
    - architectural decisions
        
4. Do not claim a phase is verified if the database/schema portion was not actually verified.
    

The documentation is part of the engineering record and must remain synchronized with the implementation.

---

# 19. OpenCode Working Rule

Before changing code:

```text
READ
 ↓
AUDIT
 ↓
IDENTIFY CANONICAL PATH
 ↓
PLAN MINIMAL CHANGE
 ↓
IMPLEMENT
 ↓
TEST
 ↓
FULL SUITE
 ↓
DOCUMENT
```

Never blindly rewrite an existing subsystem.

When an existing implementation already satisfies a requirement, verify it with tests rather than replacing it.

When a defect is found, fix the smallest authoritative layer that prevents the defect from occurring across all callers.

When uncertain about an architectural rule, stop and inspect:

- existing code
    
- tests
    
- `docs/PROGRESS.md`
    
- `docs/P11-recon.md`
    

before introducing a new behavior.

# 20. Current Priority

Complete:

```text
Admin Module Phase 1 — Foundation
```

Starting regression checkpoint:

```text
305 tests
1,479 assertions
0 failures
2 skipped
43/43 JS socket tests
```

Admin Phase 1 must establish the canonical Tourism Office governance surface: shared admin layout, RBAC gating on admin API routes, audit-trail recording, and read-only operational KPIs — while preserving the existing financial, dispatch, preparation-gate, payment, refund, payout, GPS, and realtime architecture (monitor/verify/approve/audit only).