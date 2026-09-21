# ADR 001: Multi-Restaurant Group Checkout

## Status
**Accepted & Implemented**

## Context
Tourists visiting Bansud often wish to order regional delicacies, snacks, and meals from multiple dining establishments (e.g., local kakanin from one hub and main courses from another) in a single dining session. 

Traditional single-restaurant delivery apps force the user to complete checkout, pay, and track orders separately for each merchant. This creates severe UX friction, duplicate delivery fees, and cart abandonment.

## Decision
We implemented a **Group Checkout** architecture:
1. **Single Frontend Experience**:
   - The tourist cart aggregates items across different businesses.
   - The tourist enters delivery details once and authorizes payment in a single transaction (one PayMongo charge or one unified COD agreement).
2. **Umbrella Parent Record (`group_checkouts`)**:
   - Stores the high-level group total, customer reference, and overall checkout lifecycle.
3. **Independent Sub-Orders (`orders`)**:
   - A distinct child `orders` row is created for each merchant represented in the cart.
   - Sub-orders carry their respective merchant ID, item list, subtotal, and delivery fee.

## Consequences
### Positive:
- Significantly improved conversion rate and tourist satisfaction.
- Single payment intent simplifies the customer's banking/e-wallet experience.

### Trade-offs & Mitigations:
- **Partial Failure Handling**: If one merchant rejects an item or runs out of stock, refunding a child order requires custom ledger accounting because the parent payment was charged as a single block. This is resolved by store-credit ledger records (`refunds` table) for child cancellations.
