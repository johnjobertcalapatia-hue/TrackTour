# TrackTour — IPO Conceptual Framework

**TrackTour: Tourism Promotion and Food Delivery System for Bansud, Oriental Mindoro**

The Input–Process–Output (IPO) model describes how TrackTour converts raw data into processed information and action, from the moment a tourist browses destinations to the completion of a delivered order and post-delivery financial settlement.

---

```text
┌──────────────────────────────┐
│          INPUT              │
│  (Data/Resources the        │
│   system accepts)           │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│         PROCESS             │
│  (System operations that    │
│   transform the input)      │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│          OUTPUT             │
│  (Result of processed       │
│   information/action)       │
└──────────────────────────────┘
```

---

## 1. INPUT

The raw data and resources entered or selected by the system users.

### Tourist / Customer
- Personal account details (name, email, password, mobile number)
- Delivery address and GPS pickup/drop-off location
- Destination inquiries and tourism-related searches
- Selected destinations, tourism spots, and business listings viewed
- Food / product selections added to cart (possibly from multiple restaurants)
- Order quantity, special instructions, and notes
- Payment method choice (GCash via PayMongo, Credit/Debit Card, or Cash on Delivery)
- Checkout confirmation and order placement
- Fast delivery tip selection (₱20–₱100) when fast delivery is requested
- Real-time order tracking requests

### Restaurants / Tourism Businesses
- Business registration and profile details
- Business documents for verification (permit, DTI/SEC, etc.)
- Menu / product catalog and pricing
- Available stock and operating hours
- Order acceptance and item status updates (preparing, ready)

### Riders
- Rider registration and profile details
- Required identification documents (valid ID, license, etc.)
- Online / offline availability status
- Live GPS location, speed, heading, and accuracy data
- Delivery offer acceptance / rejection
- Proof of COD cash receipt and delivery completion confirmation

### Tourism Office Administrator
- Admin login credentials and role permissions
- Verification/approval decisions for riders and businesses
- Monitoring of riders, deliveries, and live maps
- Settlement, payout, and financial monitoring queries
- Operational reports and audit requests

### Sustaining Inputs (System)
- Municipality data: Bansud, Oriental Mindoro tourism destinations and businesses
- Payment gateway data (PayMongo payment and refund webhook events)
- Realtime location streams via Socket.IO/WebSockets
- Server and connection resources

---

## 2. PROCESS

The operations, computations, and business rules applied to the input data.

### Authentication & Role Management
- User registration, login, and token issuance (Laravel Sanctum)
- Role-based access control (tourist, restaurant, rider, tourism_office admin)
- RBAC gating on all admin and staff functions

### Tourism Promotion & Discovery
- Processing of destination, business, and restaurant searches and filters
- Presentation of tourism registry and promotion content

### Ordering & Group Checkout
- Grouping cart items across multiple restaurants into one checkout
- Generating one `group_checkouts` record and one canonical `orders` record
- Computing order totals, delivery fee, and optional fast-delivery tip
- Validating inventory, pricing, and checkout integrity

### Smart Dispatch
- Matching an order with an eligible rider based on proximity, service class, and availability
- Broadcasting delivery offers to candidate riders
- Atomic acceptance handling enforcing **one active delivery per rider**
- Rejecting preparation requests until the rider has accepted (rider acceptance gate)
- Tracking 60-minute dispatch deadlines and dispatch end reasons

### Delivery & Realtime Tracking
- Processing live GPS updates with rate limiting and trip-token authentication
- Broadcasting rider location and status to authorized rooms (rider, business, tourist)
- Reflecting status transitions: pending → accepted → preparing → ready → picked_up → in_transit → arrived_destination → delivered → completed

### Payment Processing & Financial Settlement
- PayMongo payment creation, webhook processing with idempotency
- Security checks against invalid state downgrades (paid → pending, etc.)
- COD handling: rider keeps physical cash; no credit wallet is reserved
- COD settlement allocation: 80% Restaurant / 20% Tourism Office
- Rider earnings computation (delivery fee + eligible tip)
- Refund lifecycle processing (pending → succeeded / failed, retry & reconciliation)

### Monitoring, Reporting & Audit
- Aggregation of operational KPIs (orders, deliveries, riders, revenue)
- Verification/approval workflows for rider and business documents
- Audit log recording of significant administrative actions
- Report generation and data export

---

## 3. OUTPUT

The processed results, information, and actions delivered back to users.

### Tourist / Customer
- Account, dashboard, and order history views
- Tourism destination and business listings with details
- Order confirmation with itemized receipt (items, fees, tip, total)
- Payment reference and receipt (GCash/PayMongo/COD)
- Realtime rider location and order status tracking (preparing, ready, on the way)
- Delivery completion confirmation and COD payment acknowledgment

### Restaurants / Tourism Businesses
- Incoming order notifications with itemized order details
- Notifications of accepted rider and permission-to-prepare signal
- Visibility of order and item statuses for fulfillment
- Settlement records and payout visibility

### Riders
- Delivery offers with projected earnings
- Assigned delivery details (pickup route, drop-off, fee, tip)
- Live navigation status and terminal delivery confirmations
- Earnings and payout records

### Tourism Office Administrator
- Dashboard with operational KPIs and statistics
- Live rider availability and delivery monitoring (read-only map)
- Verified rider, business, and tourism registry
- COD settlement, rider earnings, payout, payment, and refund views
- Financial and operational reports and audit trail

### System Outputs
- Authoritative order, delivery, and settlement records
- Realtime events delivered to authorized socket rooms
- Payment and refund confirmations from PayMongo
- Audit logs and report exports
- Consistent database state preserving all business invariants

---

## 4. Summary

| Input | Process | Output |
|---|---|---|
| Tourist details, cart, payment choice, address | Group checkout, order creation, payment | Order confirmation, receipt, tracking |
| Rider availability & GPS location | Smart dispatch, acceptance gate, tracking | Rider assignment, live delivery status |
| Restaurant menu & order status | Fulfillment, preparation gating | Ready-for-pickup signal, settlement |
| Business/rider documents | Verification & approval workflow | Verified profiles, audit trail |
| Payment webhook events | Idempotent payment/refund processing | Protected payment state, receipts |
| COD cash, fees, tips | Settlement allocation 80/20 | Restaurant + Tourism Office shares |
| Admin monitors/report actions | Aggregation & audit logging | Dashboards, reports, audit history |

The IPO flow guarantees that **every system output is the direct result of processing verified inputs through enforced business rules** — from one-click ordering across multiple restaurants to a single shared delivery, an accepted rider, and a correctly settled financial record.