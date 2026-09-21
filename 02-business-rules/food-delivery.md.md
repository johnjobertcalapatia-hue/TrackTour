# Food Delivery Business Rules

## Group Checkout

The tourist sees one checkout experience even when the cart
contains food from multiple restaurants.

Example:

Restaurant A
- Burger ₱100
- Fries ₱50

Restaurant B
- Chicken ₱150

The tourist pays through one group checkout.

## Backend Structure

The backend creates:

group_checkouts
├── order #1 → Restaurant A
│   ├── order item
│   ├── order item
│   └── delivery
│       └── rider
│
└── order #2 → Restaurant B
    ├── order item
    └── delivery
        └── rider

## Important

Do NOT create:

restaurant_orders

Do NOT create:

one order row per item.

The `orders` table represents the restaurant-level order.

## Restaurant Preparation

Restaurant acceptance does NOT mean preparation can begin.

The rider must first accept the delivery.

Required sequence:

1. Order created
2. Dispatch starts
3. Rider receives offer
4. Rider accepts
5. Restaurant can prepare
6. Restaurant prepares food
7. Restaurant marks all items ready
8. Rider picks up
9. Rider delivers
10. Delivery completed

Related: - [[Food Delivery]] - [[Order Lifecycle]] - [[Rider Wallet]] - [[Realtime Architecture]] - [[COD]]