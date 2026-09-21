# Order Lifecycle & State Machine

## Overview

The TrackTour order lifecycle balances multi-restaurant cart checkouts, immediate rider dispatch, and mandatory preparation gates.

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
         waiting_restaurant
                  │
                  ├───► [ Dispatch Engine Dispatches Candidates ]
                  │                 │
                  │                 ▼
                  │           rider offered
                  │                 │
                  │                 ▼
                  │     [ Rider Accepts Delivery ]
                  │                 │
                  ◄─────────────────┘
                  │ (Gated: hasAcceptedRider() == true)
                  ▼
              preparing (Kitchen starts cooking)
                  │
                  ▼
           ready_for_pickup
                  │
                  ▼
               picked_up (Rider arrives at restaurant)
                  │
                  ▼
              in_transit (Navigating to tourist)
                  │
                  ▼
              delivered (Arrival, cash collection if COD)
                  │
                  ▼
              completed (Financial settlement, credit finalize)
```

---

## Detailed Step Walkthrough

### 1. Placement & Payment Gate (`pending_payment`)
- Non-cash orders start at `pending_payment`.
- PayMongo payment authorization / webhook flips order to `waiting_restaurant`.
- Cash on Delivery (COD) orders start directly at `waiting_restaurant`.

### 2. Dispatch Scheduling & Candidate Offer (`waiting_restaurant`)
- Order creation immediately triggers `SmartDispatchService::scheduleDispatch`.
- Nearest candidate riders receive dispatch offers (120-second timer).
- **Restaurant cannot cook yet**: `acceptOrder` or `startPreparation` attempts return HTTP 422.

### 3. Rider Acceptance Gate
- First eligible rider accepts the offer.
- Atomic lock assigns `deliveries.rider_id` and marks delivery `assigned`.
- For COD, credit is reserved in the rider's wallet.
- Other pending offers for this delivery are revoked.
- Order now satisfies `Order::hasAcceptedRider()`.

### 4. Kitchen Preparation (`preparing` → `ready_for_pickup`)
- Restaurant merchant is now authorized to prepare food.
- Merchant starts preparation (`preparing`).
- When cooked, merchant marks food ready (`ready_for_pickup`).

### 5. Pickup & Transit (`picked_up` → `in_transit`)
- Rider arrives at the restaurant.
- Rider verifies order contents and updates status to `picked_up`.
- Rider begins navigation to customer (`in_transit`). Real-time GPS stream broadcasts live coordinates to the tourist map.

### 6. Delivery & Final Settlement (`delivered` → `completed`)
- Rider arrives at destination and hands food to tourist.
- If COD: Rider collects physical cash.
- Delivery status transitions to `delivered`.
- Platform executes financial settlement:
  - Prepaid: Rider commission + tip recorded in `rider_earnings`.
  - COD: Reserved credits finalized and deducted; 80% credited to restaurant, 20% to Tourism Office; earnings booked.
- Order transitions to immutable terminal status: `completed`.

---

## Cancellation & Timeout Policies

- **Merchant Inactivity (`AutoRejectWaitingOrder`)**:
  - If an order remains unaccepted or riderless past the acceptance deadline (10 minutes), the system automatically cancels the order and issues a full refund.
- **Undelivered Abandonment (`AutoCancelUndeliveredOrder`)**:
  - Active deliveries exceeding 60 minutes without status progression are flagged for operations intervention and auto-cancellation, releasing any locked COD credit reserves.
