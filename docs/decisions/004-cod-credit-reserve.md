# ADR 004: Cash on Delivery (COD) Credit Reserve

## Status
**Accepted & Implemented**

## Context
Cash on Delivery (COD) remains the predominant payment method for domestic tourists and local consumers in provincial municipalities in the Philippines.

However, COD introduces acute financial counterparty risk:
- The rider collects physical cash from the tourist.
- The platform and restaurant are at risk if the rider absconds with the cash or delays remittance.
- Manual end-of-day cash reconciliation creates accounting overhead and disputes.

## Decision
We implemented the **Rider Credit Reserve** architecture:
1. **Pre-Funded Wallets**:
   - Riders maintain a prepaid credit balance with the Bansud Tourism Office.
2. **Atomic Credit Reservation**:
   - Upon accepting a COD delivery, the system locks wallet credits equal to the financed food total (`subtotal + system_fee`).
   - If the rider does not have sufficient unencumbered credits, the dispatch offer cannot be accepted.
3. **Automated Settlement on Handover**:
   - Upon marking the delivery `delivered`, the rider keeps 100% of the customer's cash.
   - The platform finalizes and deducts the locked credits from the rider's wallet.
   - `CodSettlementService` allocates the funds: 80% to the restaurant and 20% to the Tourism Office platform account.

## Consequences
### Positive:
- **Zero Credit Risk**: The platform and restaurants are 100% guaranteed their funds before the rider even arrives at the restaurant.
- **No Daily Cash Remittance Hassle**: Riders never need to physically travel to the Tourism Office or restaurant to remit cash.
- **Auditability**: Every transaction is tracked in `rider_credit_transactions` and `cod_settlements`.

### Trade-offs:
- Riders must maintain sufficient credit balance to accept COD deliveries.
- Requires admin workflows for topping up rider wallets upon receiving rider bank/cash deposits.
