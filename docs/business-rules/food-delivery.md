# Food Delivery Business Rules

## 1. Group Checkout

The tourist sees **one checkout experience** even when the cart contains food from multiple restaurants.

The group checkout represents the tourist's overall checkout transaction.

Example:

```text
Tourist Cart

Restaurant A
├── Burger ₱100
└── Fries ₱50

Restaurant B
└── Chicken ₱150
```

The tourist completes **one group checkout**.

The backend then separates the cart into independent restaurant-level orders.

---

## 2. Backend Structure

The canonical structure is:

```text
group_checkouts
│
├── order #1 → Restaurant A
│   ├── order item → Burger
│   ├── order item → Fries
│   └── delivery
│       └── rider
│
└── order #2 → Restaurant B
    ├── order item → Chicken
    # Food Delivery Business Rules

    ## 1. Group Checkout

    The tourist sees **one checkout experience** even when the cart contains items from multiple restaurants.

    One completed tourist checkout creates exactly:

    ```text
    1 group_checkout
    1 order
    1 delivery
    1 assigned rider
    1 delivery fee
    ```

    The group checkout is the payment and checkout context. The `orders` row is the canonical food-delivery order for the entire checkout.

    Example cart:

    ```text
    Restaurant A
    ├── Burger ₱100
    └── Fries ₱50

    Restaurant B
    └── Chicken ₱150
    ```

    This becomes one order, not one order per restaurant:

    ```text
    Group Checkout #GC-001
        │
        ▼
    Order #1001
    ├── Burger → Restaurant A
    ├── Fries  → Restaurant A
    └── Chicken → Restaurant B
        │
        ▼
    Delivery #501 → Rider #25
    ```

    The tourist pays one delivery fee for the order. The rider makes multiple restaurant pickups and one final delivery to the tourist.

    ---

    ## 2. Backend Structure

    The canonical relationship is:

    ```text
    group_checkouts
        │
        ▼
    orders
        │
        ├── order_items → Restaurant A
        ├── order_items → Restaurant B
        ├── subtotal
        ├── one delivery_fee
        ├── one total
        ├── one order status
        ├── one delivery
        │       └── one assigned rider
        └── one tourist destination
    ```

    Every `order_items` row must identify its restaurant through `business_id` or the existing canonical business relationship. This is the restaurant boundary for pricing, authorization, preparation, readiness, and pickup. It does not create another order or delivery.

    The order owns the aggregate checkout values:

    * all order items
    * subtotal and system fee
    * one delivery fee
    * fast-delivery tip, when applicable
    * total and payment status
    * one order status
    * one delivery and rider assignment

    Restaurant-level fulfillment is represented by grouping the order's items by `business_id` and tracking their item/status state. It must not be represented by duplicate `orders` rows.

    ---

    ## 3. Do Not Create `restaurant_orders`

    There must NOT be a separate:

    ```text
    restaurant_orders
    ```

    table for this architecture.

    The existing `orders` table is the canonical order table. `order_items.business_id` identifies which restaurant supplies each item.

    Do not add a child order table merely to represent restaurant fulfillment. If an internal fulfillment grouping is needed, it must remain subordinate to the single canonical order and must not create another delivery, rider assignment, delivery fee, or payment obligation.

    ---

    ## 4. Do Not Create One Order Row Per Restaurant or Item

    The backend must not create an `orders` row for every restaurant or item in a checkout.

    Incorrect:

    ```text
    Group Checkout
    ├── Order #101 → Restaurant A → Delivery A → Rider A
    └── Order #102 → Restaurant B → Delivery B → Rider B
    ```

    Also incorrect:

    ```text
    orders
    ├── Burger
    ├── Fries
    └── Chicken
    ```

    Correct:

    ```text
    Group Checkout
    └── Order #1001
      ├── Burger  → Restaurant A
      ├── Fries   → Restaurant A
      └── Chicken → Restaurant B
        └── Delivery #501 → Rider #25
    ```

    The cardinality rule is:

    ```text
    1 tourist checkout
      ↓
    1 order
      ↓
    many order_items
      ↓
    1 delivery
      ↓
    1 rider
    ```

    This applies whether the order contains one restaurant or several restaurants.

    ---

    ## 5. Restaurant-Level Fulfillment Within One Order

    Restaurants still fulfill only their own items, but fulfillment is a subdivision of the single order.

    Example:

    ```text
    ORDER #1001
    │
    ├── Restaurant A fulfillment
    │   ├── Burger → preparing
    │   └── Fries  → ready
    │
    ├── Restaurant B fulfillment
    │   └── Chicken → preparing
    │
    └── Shared delivery
      └── Rider #25 collects from A, then B
    ```

    Each restaurant may independently:

    * view only its own order items
    * accept or reject its items according to the existing workflow
    * prepare its items after the shared rider gate is satisfied
    * mark its items ready
    * hand its ready items to the shared assigned rider

    A restaurant's item status must not overwrite another restaurant's item status. The order-level status is derived from or updated by the canonical item/order lifecycle, while the restaurant boundary is enforced through `business_id` authorization.

    Restaurant readiness may differ:

    ```text
    Restaurant A → ready
    Restaurant B → preparing
    Restaurant C → ready
    ```

    The shared rider waits for the required pickups according to the canonical fulfillment flow. This is not permission to create a second delivery or assign a second rider.

    ---

    ## 6. Rider Acceptance Gate

    Rider acceptance belongs to the **whole order delivery**, not to an individual restaurant.

    Restaurant acceptance does not authorize food preparation. The required sequence is:

    ```text
    1. One order is created
         ↓
    2. One delivery is created
         ↓
    3. Dispatch offers the delivery to eligible riders
         ↓
    4. One rider atomically accepts the delivery
         ↓
    5. The order has an accepted rider
         ↓
    6. Each restaurant may prepare its own items
         ↓
    7. Each restaurant marks its items ready
         ↓
    8. The rider makes all required restaurant pickups
         ↓
    9. The rider delivers the one order to the tourist
         ↓
    10. The delivery and order are completed
    ```

    The accepted-rider check is a hard backend business rule. It is evaluated from the shared order-to-delivery relationship and applies to every preparation-capable path.

    ---

    ## 7. Preparation Gate

    Before the shared rider accepts:

    ```text
    delivery.rider_id = NULL
    ```

    No restaurant may transition its items or the order into active preparation. Attempts to start preparation, mark items preparing/ready, accept all for preparation, or update an order into a preparation state before rider acceptance must be rejected by the backend.

    After the shared rider accepts:

    ```text
    delivery.rider_id = accepted_rider
    ```

    All participating restaurants may prepare their own items, subject to their existing authorization and item-status rules. Rider acceptance unlocks preparation; it does not automatically start preparation and does not mark any item ready.

    The frontend must not be the only enforcement mechanism. The gate applies consistently across business-owner, kitchen, staff, item-status, order-status, and related preparation endpoints.

    ---

    ## 8. Accepted Rider and Delivery Ownership

    Once a rider successfully accepts the shared delivery:

    ```text
    order.delivery.rider_id = accepted_rider
    ```

    Acceptance must be atomic. Concurrent offers may exist, but only one rider may claim the delivery and a rider may accept only one active delivery at a time.

    The delivery remains bound to the accepted rider through all restaurant pickups and the final tourist delivery unless a valid canonical cancellation or reassignment flow explicitly releases it. One restaurant must never replace the shared rider with another rider merely because it has different fulfillment timing.

    The database must enforce the important cardinalities and race protections, including one delivery per order, one accepted rider per delivery, and the established one-active-delivery-per-rider rule.

    ---

    ## 9. Rider and Restaurant Fulfillment Independence

    Restaurant fulfillment is independent at the **item-group** level, not at the delivery level.

    ```text
    Shared Order #1001
        │
        ├── Restaurant A items → own preparation/readiness
        ├── Restaurant B items → own preparation/readiness
        └── Restaurant C items → own preparation/readiness
        │
        └── one shared rider and delivery
    ```

    The accepted rider unlocks preparation for the participating order. A restaurant cannot assign its own rider, create its own delivery, or satisfy the gate through a different delivery. One restaurant's item status must not authorize another restaurant to mutate items it does not own.

    Restaurant A may be ready while Restaurant B is still preparing, but the shared delivery remains one delivery and the canonical pickup/completion flow determines when the rider proceeds.

    ---

    ## 10. Multi-Restaurant Example

    Suppose a tourist checks out:

    ```text
    Restaurant A
    ├── Burger ₱100
    └── Fries ₱50

    Restaurant B
    └── Chicken ₱150

    Restaurant C
    └── Dessert ₱80
    ```

    The backend creates:

    ```text
    Group Checkout #GC-001
    └── Order #1001
      ├── Burger  → business_id A
      ├── Fries   → business_id A
      ├── Chicken → business_id B
      ├── Dessert → business_id C
      ├── delivery_fee = ₱80
      └── Delivery #501
        └── Rider #25
    ```

    Before Rider #25 accepts:

    ```text
    Restaurant A → preparation blocked
    Restaurant B → preparation blocked
    Restaurant C → preparation blocked
    ```

    After Rider #25 accepts Delivery #501:

    ```text
    Restaurant A → may prepare its items
    Restaurant B → may prepare its items
    Restaurant C → may prepare its items
    ```

    The rider then performs:

    ```text
    Rider #25
    ├── pickup from Restaurant A
    ├── pickup from Restaurant B
    ├── pickup from Restaurant C
    └── one delivery to the tourist
    ```

    The tourist is charged the one order delivery fee of ₱80, not one delivery fee per restaurant. No restaurant receives a second order row, delivery row, or rider assignment.

    ---

    ## 11. Payment, COD, and Completion Rules

    The single order is the financial and completion unit for the checkout.

    ### Online payment

    One PayMongo payment covers the order total:

    $$
    \mathrm{total} = \text{subtotal} + \text{system fee} + \text{one delivery fee} + \text{fast-delivery tip}
    $$

    The provider remains authoritative. Webhook processing is idempotent, duplicate provider events are database-protected, and paid/refunded states cannot be downgraded or resurrected by late notifications.

    ### Cash on Delivery

    The rider accepts the shared order only when the established usable-credit check can finance the order's settlement base:

    $$
    \mathrm{settlement\ base} = \text{order subtotal} + \text{order system fee}
    $$

    The reserved amount is the same amount finalized from rider credit at completion. The rider keeps the physical COD cash. COD cash is not rider credit, rider earnings, or a remittance liability.

    The COD settlement allocation is recorded once for the single order using the configured split (currently 80% restaurant share and 20% Tourism Office share). The delivery fee and eligible fast-delivery tip remain rider earnings and are not part of the COD restaurant/Tourism Office settlement base. Credit finalization must not be duplicated by a second settlement path.

    ### Completion and cancellation

    The shared delivery and the canonical order must converge on completion. Terminal delivery states include `delivered`, `completed`, and `cancelled`. Cancellation or failed fulfillment must release any COD reserve and create the appropriate provider-authoritative refund or local item/refund ledger effect without inventing a second order or delivery.

    ---

    ## 12. Core Invariants and Canonical Flow

    The following rules must always remain true:

    ### Invariant 1 — One Order Per Tourist Checkout

    ```text
    1 group_checkout → 1 canonical order
    ```

    ### Invariant 2 — Items Retain Restaurant Ownership

    ```text
    1 order → many order_items
    order_item.business_id → supplying restaurant
    ```

    ### Invariant 3 — No `restaurant_orders` Table

    Restaurant fulfillment is grouped from the canonical order's items. It does not create child orders.

    ### Invariant 4 — One Delivery, Rider, and Delivery Fee

    ```text
    1 order → 1 delivery → 1 accepted rider
    1 order → 1 delivery fee
    ```

    ### Invariant 5 — Shared Rider Acceptance Gates Preparation

    ```text
    no accepted rider → all preparation prohibited
    accepted rider    → participating restaurants may prepare
    ```

    ### Invariant 6 — Restaurant Item Fulfillment Is Isolated

    Each restaurant may mutate and fulfill only its own items. Its item status must not alter another restaurant's items.

    ### Invariant 7 — Delivery Ownership Is Stable

    Once accepted, the shared delivery remains bound to that rider unless the canonical cancellation/reassignment flow releases it.

    ### Invariant 8 — Backend Authority

    Database-backed Laravel state is authoritative. The frontend and Socket.IO/WebSocket layer must not decide order status, delivery status, rider assignment, payment, COD settlement, or rider availability.

    The complete flow is:

    ```text
    Tourist cart
      ↓
    One group checkout
      ↓
    Create one order with all order items
      ↓
    Create one delivery with one delivery fee
      ↓
    Dispatch rider offers
      ↓
    One rider accepts atomically
      ↓
    Restaurant item groups prepare independently
      ↓
    Restaurants mark their own items ready
      ↓
    Rider picks up from each restaurant
      ↓
    Rider delivers one order to the tourist
      ↓
    Delivery and order complete
    ```

    ---

    ## 13. Realtime and Recovery Rule

    Realtime mechanisms may notify authorized clients about state changes, but they are delivery mechanisms rather than sources of truth.

    Events may be sent to the appropriate business, rider, tourist, and trip rooms for the shared order and delivery. Room authorization must be enforced server-side. Restaurant consumers receive only their own item/order view; the assigned rider and tourist receive the shared delivery state.

    After a WebSocket disconnect, server restart, or network interruption, the frontend must recover the current order, item, delivery, and rider state through HTTP/API requests. Socket.IO memory must never be required to preserve authoritative state, and terminal completion/cancellation must stop inappropriate tracking and live broadcasts.
