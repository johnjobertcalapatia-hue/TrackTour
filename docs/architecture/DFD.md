# TrackTour — Data Flow Diagram (DFD)

> Current as of the post-dispatch-reliability checkpoint (2026-09-23).
> Sources: `routes/api.php`, `app/Services/*`, models in `app/Models`, `docs/architecture/*`.

Mermaid notation: rounded boxes = processes, cylinders `[( )]` = data stores,
boxes = external entities, arrow labels = data flows.

---

## 1. Context Diagram (DFD Level 0)

The system boundary is the **TrackTour platform** (Laravel API + React frontend + Socket.IO bridge).
MySQL is the trusted store; PayMongo is the only third-party authority for payment/refund outcomes.

```mermaid
flowchart LR
    Tourist([Tourist])
    Rider([Rider])
    BusinessOwner([Business Owner / Staff])
    TourismOffice([Tourism Office Admin])

    subgraph SYS["TrackTour Platform"]
        P0["0. TrackTour System"]
    end

    PayMongo([PayMongo / GCash])
    DB[(MySQL)]

    Tourist -- orders / payments / tracking / bookings --> P0
    P0 -- menu, status, live GPS --> Tourist

    Rider -- GPS / dispatch responses / trip status / COD cash --> P0
    P0 -- offers / trips / earnings / payouts --> Rider

    BusinessOwner -- menu / order acceptance / preparation --> P0
    P0 -- new orders / accepted-rider gate / settlements --> BusinessOwner

    TourismOffice -- approvals / governance / monitoring --> P0
    P0 -- dashboards / reports / audit log --> TourismOffice

    P0 -- payment intents / refund requests --> PayMongo
    PayMongo -- payment.paid / refund.* webhooks --> P0

    P0 <--> DB
```

---

## 2. Level 1 DFD — Major Processes

```mermaid
flowchart TB
    Tourist([Tourist])
    Rider([Rider])
    BusinessOwner([Business Owner / Staff])
    TourismOffice([Tourism Office Admin])
    PayMongo([PayMongo / GCash])
    Scheduler([Scheduler])

    subgraph P["TrackTour Platform"]
        P1["1.0 Food Ordering / Group Checkout"]
        P2["2.0 Delivery & Rider Dispatch"]
        P3["3.0 Restaurant Preparation"]
        P4["4.0 Payments (GCash / COD) & Refunds"]
        P5["5.0 COD Cash Settlement"]
        P6["6.0 Rider Earnings & Payouts"]
        P7["7.0 Realtime GPS Tracking"]
        P8["8.0 Admin Governance & Monitoring"]

        D1[(order_items)]
        D2[(orders)]
        D3[(group_checkouts)]
        D4[(deliveries)]
        D5[(booking_dispatch_logs)]
        D6[(payments)]
        D7[(payment_webhook_events)]
        D8[(refunds)]
        D9[(cod_settlements)]
        D10[(order_settlements)]
        D11[(restaurant_wallets)]
        D12[(rider_earnings)]
        D13[(rider_payouts)]
        D14[(rider_locations)]
        D15[(activity_logs)]
        D16[(businesses / offerings / users)]
        D17[(delivery_pickup_stops / trip_logs)]
    end

    Tourist -- request order / group order --> P1
    P1 --> D3
    P1 --> D2
    P1 --> D1
    D2 --> P1

    P1 -- create delivery --> P2
    P2 --> D4
    P2 -- offers --> Rider
    Rider -- accept / decline / trip status --> P2
    P2 --> D5
    P2 -- accepted rider gate --> P3

    P3 -- prepare / ready --> D1
    P3 --> D2
    P3 -- ready-for-pickup --> P2

    Tourist -- payment intent / COD choice --> P4
    P4 -- create session --> PayMongo
    PayMongo -- webhooks --> P4
    P4 --> D6
    P4 --> D7
    P4 --> D8
    P4 -- paid flag --> D2

    Rider -- settle COD cash --> P5
    P5 --> D9
    P5 --> D10
    P5 --> D11
    P5 -- cash payment --> D6

    P5 -- delivery completed --> P6
    P6 --> D12
    P6 --> D13
    P6 -- earnings / payout status --> Rider
    P6 -- approve payout --> TourismOffice

    Rider -- GPS stream --> P7
    P7 --> D14
    P7 -- Live GPS --> Tourist
    P7 --> D17

    Scheduler -- auto-cancel / timed dispatch / refund reconcile --> P2
    Scheduler --> P4
    TourismOffice -- approvals / monitoring --> P8
    P8 --> D16
    P8 -- read-only aggregates --> D2
    P8 --> D9
    P8 --> D12
    P8 --> D13
    P8 --> D15
    P8 -- dashboards / audit / reports --> TourismOffice
```

---

## 3. Level 2 — Key Process Details

### 3.1 Ordering & Group Checkout (`1.0`)

One `group_checkouts` → one canonical `orders` → N `order_items` (each tagged with `business_id`)
→ one `deliveries` → one rider. Never an `orders` row per restaurant.

```mermaid
flowchart LR
    Tourist([Tourist])
    P1A["1.1 Select offerings<br>(single / multi-restaurant cart)"]
    P1B["1.2 Place order"]
    P1C["1.3 Quote delivery fee"]
    P1D["1.4 Create payment / COD order"]

    D[(order_items)]:::store
    E[(orders)]:::store
    F[(group_checkouts)]:::store

    Tourist --> P1A --> P1B
    P1B -- snapshot price --> D
    P1B --> E
    P1B -- group only --> F
    P1B -- fetch fee config --> P1C
    P1C --> P1B
    P1B -- create delivery later --> P1D

    classDef store fill:#e1f0fa,stroke:#2f6f9f
```

### 3.2 Delivery Dispatch & Rider Acceptance (`2.0`)

Dispatch by distance/eligibility via `SmartDispatchService` → `NearestRiderService`.
Acceptance is atomic (row locks + one-active-delivery DB guard). Restaurant preparation is
**gated** until `deliveries.rider_id` is set.

```mermaid
flowchart TB
    Order["Delivery created<br>(COD: at order; GCash: after paid)"]
    Elig{"Eligibility:<br>approved, online/available,<br>no active delivery"}
    Offer["2.1 Notify nearest rider<br>(120 s window)"]
    Accept{"2.2 Rider accepts?"}
    DispatchNow["2.3 Assign delivery → rider busy<br>emit DeliveryAssigned"]
    Reoffer["2.4 Re-offer next nearest"]
    Done["No rider → no_rider_available<br>(scheduler retries / auto-cancel)"]
    Prep["Restaurant gate opened"]

    Order --> Elig --> Offer
    Offer --> Accept
    Accept -- yes --> DispatchNow --> Prep
    Accept -- decline / timeout --> Reoffer --> Offer
    Reoffer -- none left --> Done

    DispatchNow --> D1[(deliveries)]:::store
    Offer --> D2[(booking_dispatch_logs)]:::store

    classDef store fill:#e1f0fa,stroke:#2f6f9f
```

### 3.3 Payment & Refund Outcomes (`4.0`)

Outcomes are **provider-authoritative** and idempotent via
`payment_webhook_events.provider_event_id` UNIQUE. No state downgrades.

```mermaid
flowchart LR
    Tourist([Tourist])
    P4A["4.1 Create intent / session"]
    PayMongo([PayMongo / GCash])
    P4B["4.2 Verify signature + dedupe webhook"]
    P4C["4.3 Mark payable paid"]
    P4D["4.4 Refund request"]
    P4E["4.5 Refund outcome (pending/succeeded/failed)"]

    D1[(payments)]:::store
    D2[(payment_webhook_events)]:::store
    D3[(refunds)]:::store

    Tourist --> P4A --> PayMongo
    PayMongo -- payment.paid / payment.failed --> P4B
    P4B --> D2
    P4B --> P4C
    P4C --> D1
    P4C -- paid flag --> D4[(orders)]:::store
    P4D --> PayMongo
    PayMongo -- refund.pending/succeeded/failed/updated --> P4E --> D3

    classDef store fill:#e1f0fa,stroke:#2f6f9f
```

### 3.4 COD Settlement, Earnings & Payouts (`5.0` / `6.0`)

COD is credit-free (no rider wallet). Rider keeps the cash. 80/20 split booked from
`order.rider_financed_amount` once per order. Earnings = delivery fee + tip only.

```mermaid
flowchart LR
    Rider([Rider])
    P5A["5.1 Settle COD (single transaction)"]
    P5B["5.2 Record cash payment (paid)"]
    P5C["5.3 CodSettlementService split<br>R 80% / TO 20%"]
    P5D["5.4 OrderSettlementService → restaurant wallet"]
    P5E["5.5 recordEarning (fee + tip)"]
    P6A["6.1 Rider requests payout"]
    P6B["6.2 Admin approves → paid"]

    S1[(cod_settlements)]:::store
    S2[(order_settlements)]:::store
    S3[(restaurant_wallets)]:::store
    S4[(rider_earnings)]:::store
    S5[(rider_payouts)]:::store

    Rider --> P5A --> P5B --> P5C
    P5C --> S1
    P5C --> P5D --> S2 --> S3
    P5C --> P5E --> S4
    S4 --> P6A --> S5
    P6B --> S5

    classDef store fill:#e1f0fa,stroke:#2f6f9f
```

---

## 4. Data Store Map

| Store | Contents | Invariants |
|---|---|---|
| `group_checkouts` | Group totals, payment status | one per group order |
| `orders` | Canonical order + financial columns | `deliveries.order_id` UNIQUE |
| `order_items` | Items carrying `business_id`, status, timestamps | per-item prep status |
| `deliveries` | Trip lifecycle, dispatch state, `rider_id` | UNIQUE per order / per group |
| `booking_dispatch_logs` | Offer lifecycle per delivery+rider | TTL 120 s, next-rider re-offer |
| `payments` | Morph payable, method, provider, status | provider ref UNIQUE; no downgrades |
| `payment_webhook_events` | Idempotency backstop | `provider_event_id` UNIQUE |
| `refunds` | Refund ledger | `provider_refund_id` UNIQUE |
| `cod_settlements` | One 80/20 split per order | `order_id` UNIQUE |
| `order_settlements` | Common earning settlement | `order_id` UNIQUE |
| `restaurant_wallets` + txn | Business earning ledger | `business_id` UNIQUE; immutable txns |
| `rider_earnings` | Fee + tip per delivery | UNIQUE (rider, order, status) |
| `rider_payouts` + pivot | Payout lifecycle | one live payout per rider; earning once |
| `rider_locations` / `trip_logs` | GPS checkpoints, polyline | integrity-bounded updates |
| `activity_logs` | Admin audit trail | append-only |
| `businesses` / `offerings` / `users` | Catalog + actors + roles/approvals | approvals govern access |