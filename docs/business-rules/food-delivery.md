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
    └── delivery
        └── rider
```

### Relationship

```text
Group Checkout
    │
    ├── Order A
    │   ├── Order Items
    │   └── Delivery A
    │       └── Rider A
    │
    └── Order B
        ├── Order Items
        └── Delivery B
            └── Rider B
```

The group checkout is the parent checkout experience.

Each `orders` row represents **one restaurant's portion of the group checkout**.

Each restaurant order has its own:

* restaurant/business
* order items
* subtotal
* applicable delivery fee
* total
* order status
* delivery
* assigned rider

---

## 3. Do Not Create `restaurant_orders`

There must NOT be a separate:

```text
restaurant_orders
```

table.

The existing `orders` table is the canonical restaurant-level order table.

Do not introduce another table simply to represent the restaurant portion of a group checkout.

---

## 4. Do Not Create One Order Row Per Item

The backend must NOT create one `orders` row for every item.

Incorrect:

```text
orders
├── Burger
├── Fries
└── Chicken
```

Correct:

```text
orders
├── Order #1 → Restaurant A
│   ├── Burger
│   └── Fries
│
└── Order #2 → Restaurant B
    └── Chicken
```

Therefore:

```text
1 restaurant
    ↓
1 order
    ↓
many order_items
```

For a multi-restaurant checkout:

```text
1 group_checkout
    ↓
many restaurant-level orders
    ↓
many order_items
```

---

## 5. Independent Restaurant Fulfillment

Each restaurant order is fulfilled independently.

For example:

```text
Group Checkout
│
├── Restaurant A
│   └── Order A → Rider A
│
└── Restaurant B
    └── Order B → Rider B
```

Restaurant A must not be blocked because Restaurant B has not received a rider.

Likewise, Restaurant B must not be blocked because Restaurant A is still preparing.

Each restaurant order has its own:

* rider assignment
* preparation state
* ready state
* pickup state
* delivery state
* completion state

The group checkout may therefore contain restaurant orders at different stages.

---

# 6. Rider Acceptance Gate

Restaurant acceptance does **not** authorize food preparation.

A restaurant may acknowledge or accept an order, but preparation must remain blocked until a rider has successfully accepted that restaurant's delivery.

The required sequence is:

```text
1. Order created
       ↓
2. Dispatch starts
       ↓
3. Rider receives delivery offer
       ↓
4. Rider accepts delivery
       ↓
5. Restaurant may begin preparation
       ↓
6. Restaurant prepares food
       ↓
7. Restaurant marks all items ready
       ↓
8. Rider picks up food
       ↓
9. Rider delivers food
       ↓
10. Delivery completed
```

The rider acceptance is therefore a **hard business-rule gate**.

---

## 7. Preparation Gate

Before rider acceptance:

```text
delivery.rider_id = NULL
```

The restaurant must not transition the order into an active preparation state.

Attempts to begin preparation before rider acceptance must be rejected by the backend.

The frontend must not be the only enforcement mechanism.

The backend must enforce the rule across all relevant preparation/status endpoints.

---

## 8. Accepted Rider

Once the offered rider successfully accepts:

```text
delivery.rider_id = accepted_rider
```

The restaurant order is then eligible to enter preparation.

The acceptance must be atomic so that two competing riders cannot both successfully claim the same delivery.

The delivery remains bound to the rider who successfully accepted it.

---

## 9. Rider and Restaurant Independence

A rider accepting Restaurant A's delivery does not authorize Restaurant B to prepare.

Example:

```text
Restaurant A
    ↓
Rider A accepts
    ↓
Restaurant A may prepare

Restaurant B
    ↓
No rider accepted
    ↓
Restaurant B remains blocked
```

Each restaurant order evaluates its own delivery and rider state.

---

## 10. Multi-Restaurant Example

Suppose a tourist checks out:

```text
Restaurant A
├── Burger ₱100
└── Fries ₱50

Restaurant B
└── Chicken ₱150
```

The backend creates:

```text
Group Checkout #GC-001

Order #101
Restaurant A
├── Burger
├── Fries
└── Delivery #201
    └── Rider #12

Order #102
Restaurant B
├── Chicken
└── Delivery #202
    └── Rider #27
```

If Rider #12 accepts Delivery #201:

```text
Restaurant A
→ may prepare
```

But if Delivery #202 has no accepted rider:

```text
Restaurant B
→ must not prepare
```

Restaurant A can therefore proceed independently while Restaurant B waits for rider assignment.

---

# 11. Core Invariants

The following rules must always remain true.

### Invariant 1 — One Order Per Restaurant

```text
group_checkout
    → one orders row per restaurant
```

### Invariant 2 — Multiple Items Belong to the Same Restaurant Order

```text
order
    → many order_items
```

### Invariant 3 — No `restaurant_orders` Table

The `orders` table is the canonical restaurant-level order representation.

### Invariant 4 — One Delivery Per Restaurant Order

```text
order
    → delivery
```

The delivery is associated with that specific restaurant order.

### Invariant 5 — Rider Acceptance Gates Preparation

```text
no accepted rider
    → preparation prohibited
```

```text
accepted rider
    → preparation permitted
```

Rider acceptance unlocks preparation; it does not automatically mean that the restaurant has started preparing the food.

### Invariant 6 — Restaurant Fulfillment Is Independent

One restaurant's delivery state must not authorize or block another restaurant's preparation.

### Invariant 7 — Delivery Ownership

Once a rider successfully accepts a delivery, that delivery remains bound to the accepted rider unless a valid cancellation/reassignment flow explicitly changes the assignment.

---

# 12. Canonical Flow

The complete food-delivery flow is:

```text
Tourist
  ↓
Cart
  ↓
Group Checkout
  ↓
Create one Order per Restaurant
  ↓
Create Order Items
  ↓
Create Delivery per Restaurant Order
  ↓
Dispatch Rider
  ↓
Rider Offer
  ↓
Rider Accepts
  ↓
Restaurant Preparation Unlocked
  ↓
Restaurant Prepares
  ↓
All Items Ready
  ↓
Rider Pickup
  ↓
In Transit
  ↓
Arrived at Destination
  ↓
Delivered
  ↓
Delivery Completed
```

For multiple restaurants, this flow runs **independently for each restaurant order** while remaining under the same group checkout.

---

# 13. Architectural Rule

The database and backend are the authoritative source of truth for food-delivery state.

The frontend must not be trusted to enforce business rules.

Realtime mechanisms such as WebSocket/Socket.IO may notify clients about changes, but they must not become the authoritative source for:

* order state
* delivery state
* rider assignment
* rider availability
* payment state
* settlement state

A WebSocket disconnect must not change or invalidate the underlying order or delivery state.

HTTP/API recovery must remain available when realtime communication is unavailable.
