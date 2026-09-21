# Payment Tests

## Overview

Payment tests cover payment creation, webhook idempotency, refund paths, COD settlement, rider credit, and earnings/payout integrity.

**Related rules**: AGENTS.md §5 (COD Financial Rules), §6 (Payment Architecture), §7 (Refund Architecture)

---

## Test Files

### `PaymentApiTest`
- Payment intent creation for order/booking/group_order
- Webhook callback processing
- Idempotent webhook handling (P11.4)
- Group order payment with system fee line items

### `PaymentIdempotencyTest` (13 tests / 59 assertions)
- Same webhook twice = one effect + single event row
- Concurrent duplicate event-id insert blocked by UNIQUE backstop
- Already-committed event = no-op
- Three distinct events for one payment converge with single finalization
- Paid cannot be downgraded by late `payment.failed`
- Failed -> retry-paid stays possible
- Refunded/pending-refund cannot be resurrected (webhook and checkAndConfirm)
- Duplicate provider intent rejected at DB
- Duplicate `checkAndConfirm` applies once
- Webhook transaction rollback (crash leaves no event row, redelivery succeeds)
- Legacy no-event-id payloads deduped by type+resource

### `RefundPathHardeningTest` (15 tests / 83 assertions)
- Success finalizes refunded
- Provider failure keeps payment paid + order unrefunded + failed ledger
- Pending -> `pending_refund`
- Succeeded/failed webhooks resolve state idempotently
- Duplicate webhooks / duplicate requests never duplicate financial effects
- Late `failed` never downgrades `refunded`
- Already-refunded & in-flight reject re-refund (no provider call)
- Reconciliation finalizes success / reverts failure / leaves unreachable pending
- Cancelled-order finals (fail => never marked refunded, success => marked refunded)

### `CodDeliverySettlementTest` (2 passed / 70 assertions)
- Reserve -> settle -> idempotent
- Credit deduction happens exactly once
- Settlement allocation: 80% restaurant / 20% Tourism Office

### `CodFinancialSettlementTest` (10 tests / 112 assertions)
- 80/20 split (configurable via `COD_PLATFORM_FEE_PERCENT`)
- Base == reserved == financed
- Single deduction (no double-debit)
- Cash not a remittance + earnings separation
- Idempotency: one row/order + UNIQUE backstop
- Insufficient credit blocks everything
- Cancellation books nothing
- Multi-restaurant independence
- Config-driven split (10% override through live path)
- Fast-delivery tip exclusion from settlement base

### `FastDeliveryTipTest` (9 tests / 37 assertions)
- Missing/under/over tip rejected on single and group orders
- Tip in order total
- Standard delivery ignores tips
- Group tip split across child orders
- Tip reaching rider earnings on prepaid completion and COD settlement

### `GroupItemRejectionRefundTest`
- Group item rejection records local refund ledger
- `refunded_amount` correctly tracked

### `CompletionConsistencyTest` (3 tests)
- Rider completes => order completed with `completed_at`
- Prepaid never regresses
- COD delivered sets correct payment/delivery status

### `RiderPayoutTest` (7 tests / 18 assertions)
- Available = earned + unlocked (pending excluded)
- Request locks earnings
- Locked earnings never reappear (no double-draw)
- Approve -> mark-paid locks forever
- Reject & cancel release earnings
- Request with nothing available throws 409

---

## Key Invariants Verified

| Invariant | Enforcement |
|-----------|-------------|
| Payment state never downgrades | `Payment::canApplyProviderVerdict` state machine |
| Webhook exactly-once | `payment_webhook_events` UNIQUE `provider_event_id` + transaction |
| Refund provider-authoritative | `PaymentRefundProcessor` never marks refunded until PayMongo SUCCESS |
| COD settlement single deduction | `RiderCredit::finalize()` + `CodSettlement` ledger |
| Settlement base integrity | `cod_credit_reserved == rider_financed_amount` |
| No duplicate provider payments | UNIQUE `provider_payment_id`, UNIQUE `provider_source_id` |
| Rider earnings idempotent | UNIQUE `(rider_id, order_id, status)` |
| Payout no double-spend | UNIQUE `rider_earning_id` on pivot |

---

## Payment Lifecycle

```
Tourist places order
    ↓
Payment intent created (pending)
    ↓
PayMongo checkout / COD
    ↓
┌──────────────┬──────────────┐
│ Online       │ COD          │
│ (webhook)    │ (cash to rider)│
└──────┬───────┴──────┬───────┘
       ↓              ↓
   paid            paid (cash)
       ↓              ↓
   Order ready    settleCodDelivery
       ↓              ↓
   ...            finalizeCredits (debit)
                  CodSettlement (80/20)
                  recordEarning
                  order completed
```

---

## Running

```bash
# PHP payment tests
php artisan test --filter=Payment|Refund|Cod|FastDeliveryTip|GroupItemRejection|CompletionConsistency|RiderPayout

# Full suite
php artisan test
```
