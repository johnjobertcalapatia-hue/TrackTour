# ADR 002: One Order & One Delivery Per Restaurant

## Status
**Accepted & Implemented**

## Context
When handling multi-merchant carts, several data modeling alternatives were evaluated:
- **Alternative A**: A single monolithic order containing all items from all restaurants, with a single rider traveling to multiple restaurants sequentially.
- **Alternative B**: One order record per item.
- **Alternative C**: An intermediate `restaurant_orders` table layered between `orders` and `order_items`.
- **Alternative D**: One `orders` record per restaurant, each with an independent `deliveries` record and independent rider.

## Decision
We chose **Alternative D**:
1. **The `orders` table models the restaurant-level order.**
2. Under a group checkout, each restaurant receives its own independent `orders` row.
3. Each restaurant order has exactly one `deliveries` record (`UNIQUE(deliveries.order_id)`).
4. Each delivery is dispatched to an **independent rider**.

## Rationale
- **Food Temperature & Quality**: Requiring one rider to visit multiple restaurants in series results in cold food, unpredictable cooking delays across kitchens, and customer dissatisfaction.
- **Fault Isolation**: If Restaurant A takes 30 minutes or rejects an order, Restaurant B is completely unaffected. Restaurant B can accept, have its rider assigned, cook, and deliver independently.
- **Simplicity**: Preserves existing database relations (`Order` has many `OrderItems`, `Order` has one `Delivery`) without introducing redundant abstractions like `restaurant_orders`.

## Consequences
- Requires independent dispatch queues and multiple available riders during group orders.
- Dispatched riders are permanently bound to their specific sub-order delivery.
