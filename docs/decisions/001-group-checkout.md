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
3. **Canonical Order (`orders`)**:
   - Exactly one `orders` row is created for the checkout.
   - Each `order_items` row carries its supplying `business_id`.
   - The order owns one subtotal, one delivery fee, one total, one delivery, and one rider.
4. **Restaurant Fulfillment Groups**:
   - Restaurants prepare and mark ready only their own item groups within the canonical order.
   - Fulfillment groups never create child orders, deliveries, riders, or additional delivery fees.

## Consequences
### Positive:
- Significantly improved conversion rate and tourist satisfaction.
- Single payment intent simplifies the customer's banking/e-wallet experience.

### Trade-offs & Mitigations:
- **Partial Failure Handling**: If one merchant rejects an item or runs out of stock, the item-level refund/credit ledger handles that item while the canonical order and shared delivery remain authoritative.
