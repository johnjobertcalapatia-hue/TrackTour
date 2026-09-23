# Payment & Refund Business Rules

## 1. Supported Payment Rails

TrackTour supports two primary payment channels:
1. **PayMongo Gateway**: Online payment via GCash, Maya, GrabPay, and Visa/Mastercard credit/debit cards.
2. **Cash on Delivery (COD)**: Physical cash collected by the assigned rider upon arrival, governed by the [Rider Credit Reserve](rider-wallet.md).

---

## 2. Payment Intent & Group Checkout Billing

- When a tourist checks out, the backend creates a payment session via `PaymongoService`.
- The payment is attached to the canonical `Order`.
- For multi-restaurant **Group Checkouts**, one PayMongo payment intent or one COD agreement covers the single order total:
  $$\text{total} = \text{subtotal} + \text{one delivery fee} + \text{fast\_delivery\_tip} + \text{system\_fee\_total}$$
  - The tourist pays once.
  - Upon confirmation, the canonical order transitions from `pending_payment` to `waiting_restaurant`.

---

## 3. Webhook Idempotency & Provider Verdicts

Online payment confirmations arrive via asynchronous PayMongo webhooks (`PaymentController::handleWebhook`).

### Protection Measures:
1. **Event Deduplication**:
   - Webhook events are inserted into `payment_webhook_events` under a database `UNIQUE(event_id)` constraint.
   - If PayMongo replays the same webhook event, the database blocks duplicate execution.
2. **Verdict State Machine (`canApplyProviderVerdict`)**:
   - Once a payment is `paid`, late `failed` or duplicate notifications are rejected.
   - Once an order is paid, it cannot be downgraded or resurrected to pending.

---

## 4. Refund Architecture & Guarantees

Refund processing is governed by `PaymentRefundProcessor` and `OrderRefundService`:

### Single-Restaurant Order Cancellation:
- If a paid order is cancelled before kitchen preparation, the system issues an API call to PayMongo's refund endpoint.
- **Strict Verification**: The order is **only** marked `refunded` when PayMongo returns a synchronous status of `SUCCESS` or sends a verified `refund.succeeded` webhook.
- If the gateway fails, the payment status remains `paid` with a `pending_refund` flag, and is retried via the scheduled command `payments:reconcile-refunds`.

### Multi-Restaurant Group Orders:
- Because PayMongo captures the group checkout as a single consolidated charge, item-level cancellations are credited via the local refund ledger (`refunds` table) rather than splitting the provider payment intent.
