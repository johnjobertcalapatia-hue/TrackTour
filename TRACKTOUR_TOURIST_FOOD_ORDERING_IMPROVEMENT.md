# TrackTour — Tourist Module Improvement Plan
## Food Ordering & Tourism Office-Managed Delivery

> **Based on:** `TOURIST_PROGRESS.md`  
> **Date:** August 15, 2026  
> **Scope:** Tourist food ordering and delivery only

---

## 1. Purpose

This document defines the improvements required to narrow the existing TrackTour Tourist module into a focused **food ordering and delivery system**.

The current Tourist module covers destination discovery, accommodation booking, food ordering, transportation, events, mapping, payments, reviews, messaging, and other tourism functions. The new direction is to prioritize **food ordering and delivery** and move unrelated tourism functions into future modules.

The existing food-ordering foundation should be retained and improved rather than rebuilt from scratch.

---

## 2. Revised System Scope

### Current broad scope

The existing module supports:

- Tourism destination discovery
- Food ordering
- Accommodation booking
- Transportation booking
- Events
- Mapping
- Payments
- Reviews
- Messaging
- Favorites
- Notifications
- Search
- Municipality pages

### Revised MVP scope

The Tourist module should primarily support:

1. Tourist food discovery
2. Food business browsing
3. Menu and food-item browsing
4. Shopping cart
5. Checkout
6. Food ordering
7. Payment
8. Tourism Office-managed delivery
9. Delivery tracking
10. Order history
11. Notifications
12. Reviews and ratings
13. Favorites
14. Tourist profile
15. Food-focused search

---

# 3. Business Scope

TrackTour should no longer attempt to support every possible type of local business.

## 3.1 Food Business Categories

The initial food-business categories should be limited to:

- Restaurant
- Food Hub
- Café
- Food Vendor
- Bakery
- Local Food Business

These businesses can:

- Create and manage their business profile
- Add food items
- Organize food items into categories
- Set prices
- Set availability
- Receive orders
- Accept or reject orders
- Update preparation status
- View order history
- View sales information
- Receive customer reviews

---

# 4. Delivery Organization

## 4.1 Important Architectural Change

Delivery personnel must **not** be treated as independent businesses.

The delivery service is an organization/service established and managed by the **Tourism Office**.

Its purpose is to:

- Support food businesses
- Provide food delivery to tourists
- Create additional livelihood/work opportunities for local residents
- Coordinate delivery personnel
- Monitor delivery operations

### Organizational structure

```text
Tourism Office
       |
       v
Tourism Delivery Organization
       |
       +-------------------+
       |         |         |
    Rider 01  Rider 02  Rider 03
```

---

# 5. Food Ordering Workflow

The primary Tourist workflow should become:

```text
Tourist
   |
   v
Discover Food
   |
   v
Select Food Business
   |
   v
View Menu
   |
   v
Select Food
   |
   v
Add to Cart
   |
   v
Checkout
   |
   v
Select Delivery Address
   |
   v
Select Payment Method
   |
   v
Place Order
   |
   v
Food Business Accepts Order
   |
   v
Food Business Prepares Order
   |
   v
Order Ready for Pickup
   |
   v
Delivery Organization Assigns Personnel
   |
   v
Delivery Personnel Picks Up Order
   |
   v
Out for Delivery
   |
   v
Delivered
   |
   v
Tourist Rates Order
```

---

# 6. Order Status Lifecycle

The existing order tracker should be expanded from:

```text
Order Placed
→ Rider Assigned
→ Picked Up
→ On the Way
→ Delivered
```

to:

```text
PENDING
    ↓
ACCEPTED
    ↓
PREPARING
    ↓
READY_FOR_PICKUP
    ↓
DELIVERY_ASSIGNED
    ↓
PICKED_UP
    ↓
OUT_FOR_DELIVERY
    ↓
DELIVERED
```

## Cancellation states

Support:

```text
CANCELLED_BY_TOURIST
CANCELLED_BY_BUSINESS
CANCELLED_BY_ADMIN
```

Cancellation rules should be enforced according to the current order status.

For example, cancellation should become more restricted once food preparation or delivery has started.

---

# 7. Tourist Experience Improvements

## 7.1 Tourist Dashboard

The current dashboard contains:

- Discover
- Destinations
- Food
- Stays
- Events

The revised dashboard should prioritize food.

### Recommended navigation

```text
Home
Food
Orders
Favorites
Profile
```

### Recommended dashboard sections

```text
Welcome / Greeting
        ↓
Food Search
        ↓
Food Categories
        ↓
Nearby Food Businesses
        ↓
Popular Food
        ↓
Recommended Food Businesses
        ↓
Recent Orders
```

---

# 8. Food Discovery

The existing food browsing functionality should remain but become the primary discovery experience.

## Food page

Features:

- Search food
- Search food businesses
- Food category filters
- Availability filter
- Open-now filter
- Rating filter
- Distance filter
- Popularity sorting
- Nearest sorting
- Rating sorting

## Food business card

Display:

- Business image/logo
- Business name
- Food category
- Rating
- Number of reviews
- Distance
- Open/closed status
- Delivery availability
- Estimated delivery information
- View Menu action

---

# 9. Food Business Detail

The existing `TouristBusinessShow.tsx` should be simplified for food businesses.

### Recommended sections

```text
Business Header
├── Cover Image
├── Logo
├── Business Name
├── Rating
├── Open/Closed
├── Delivery Availability
└── Location

Menu
├── Category
├── Food Item
├── Price
├── Availability
└── Add to Cart

Reviews

Business Information
```

The existing category-specific behavior should no longer prioritize hotel, attraction, or transport behavior in the food-ordering MVP.

---

# 10. Food Item Detail

`TouristFoodShow.tsx` should support:

- Food image
- Food name
- Description
- Price
- Availability
- Food category
- Business name
- Quantity
- Optional notes
- Add to cart

If customization is required later, it can support:

```text
Size
Add-ons
Extras
Special Instructions
```

---

# 11. Shopping Cart Improvements

`TouristFoodCart.tsx` should support:

- Food item list
- Quantity controls
- Remove item
- Item subtotal
- Order subtotal
- Delivery fee
- Discounts/promotions if applicable
- Grand total
- Business information
- Delivery address
- Payment method
- Order notes

### Important rule

A cart should not combine food items from multiple businesses unless multi-business ordering is deliberately implemented.

For the initial MVP:

```text
One Cart
    ↓
One Food Business
    ↓
One Order
```

This simplifies preparation, delivery assignment, payment, and order tracking.

---

# 12. Checkout

Checkout should clearly show:

```text
DELIVERY ADDRESS
----------------
Tourist's selected address

ORDER SUMMARY
-------------
Food subtotal
Delivery fee
Discount
TOTAL

PAYMENT
-------
Cash
GCash

[ PLACE ORDER ]
```

The tourist should be able to review the complete order before submission.

---

# 13. Payment

The existing PayMongo/GCash integration should be retained.

Current functionality includes:

- Payment intent creation
- GCash checkout
- Payment callback
- Payment status
- Payment records

The revised system should keep this functionality focused on food orders.

### Payment relationship

```text
Order
  |
  +--- Payment
          |
          +--- Cash
          |
          +--- GCash
```

Payment status should be separate from order status.

Example:

```text
Order Status:
PREPARING

Payment Status:
PAID
```

---

# 14. Delivery Assignment

The delivery assignment process should be managed by the Tourism Delivery Organization.

### Recommended flow

```text
Order READY_FOR_PICKUP
        |
        v
Delivery Organization
        |
        v
Find Available Delivery Personnel
        |
        v
Assign Delivery
        |
        v
Delivery Personnel Notified
        |
        v
Delivery Personnel Accepts
        |
        v
Pickup
```

The tourist does not manually select a delivery person.

---

# 15. Delivery Personnel Information

The Tourist should only see information necessary for the delivery.

Example:

```text
Delivery Personnel

Juan D.
★★★★★ 4.9

Vehicle: Motorcycle
Plate: XXXX

Status: On the way

[ Call ]
[ Track Delivery ]
```

Sensitive or unnecessary personnel information should not be exposed.

---

# 16. Delivery Tracking

`TouristOrderStatus.tsx` should retain the live tracking concept.

Recommended display:

```text
Order #TRK-1023

✓ Order Accepted
✓ Preparing
✓ Ready for Pickup
✓ Delivery Assigned
✓ Picked Up
● Out for Delivery
○ Delivered
```

Map:

```text
Food Business
      |
      | Rider
      v
Delivery Location
```

The current Leaflet/OpenStreetMap infrastructure can be reused.

---

# 17. Order History

`TouristHistory.tsx` should be simplified to focus on food orders.

Each order should show:

- Order number
- Business
- Date
- Items
- Total
- Payment status
- Order status
- View details
- Reorder where appropriate
- Rate order where completed

Example:

```text
#TRK-1023
Lola's Kitchen
3 items
₱450.00

Delivered
[ View Order ]
[ Rate Order ]
```

---

# 18. Reviews and Ratings

The existing multi-dimensional review system should be adapted for food ordering.

Recommended ratings:

```text
Overall Rating
Food Quality
Service
Delivery
```

Optional:

```text
Would Recommend
Comment
```

Reviews should be associated with the completed order and/or food business according to the final database design.

---

# 19. Favorites

Favorites should focus on food.

Allow tourists to save:

- Food businesses
- Food items

Recommended sections:

```text
Favorite Food Businesses
Favorite Food
```

---

# 20. Notifications

Notifications are important for the order lifecycle.

Examples:

```text
Order Accepted
Order Preparing
Order Ready for Pickup
Delivery Personnel Assigned
Order Picked Up
Out for Delivery
Order Delivered
Order Cancelled
Payment Successful
```

---

# 21. Search

The existing global search should be narrowed for the MVP.

Search:

- Food businesses
- Food items
- Food categories

Recommended search:

```text
Search restaurants, food hubs, or food...
```

Search results should prioritize food-related entities.

---

# 22. Messaging

The existing messaging implementation is partial.

For the first food-ordering MVP, general messaging should not be a major dependency.

If messaging is retained, make it order-contextual:

```text
Order
   |
   +--- Contact Food Business
   |
   +--- Contact Delivery Personnel
```

Full real-time messaging can remain a future enhancement.

---

# 23. Map Usage

The existing Leaflet map should be retained only where it directly supports food ordering.

Useful map functions:

- Show food businesses
- Show tourist delivery location
- Show delivery route/location where appropriate
- Select delivery location
- Calculate distance where needed

The map should not currently be used to build a broad tourist attraction discovery system.

---

# 24. Tourist Pages — Revised

## Keep

```text
TouristDashboard.tsx
TouristFood.tsx
TouristFoodShow.tsx
TouristFoodCart.tsx
TouristOrderStatus.tsx
TouristProfile.tsx
TouristNotifications.tsx
TouristFavorites.tsx
TouristReviews.tsx
TouristSearch.tsx
TouristHistory.tsx
PaymentCallbackPage.tsx
```

## Simplify

```text
TouristExplore.tsx
TouristExploreMap.tsx
TouristBusinessShow.tsx
TouristDirectory.tsx
```

These should become food-focused.

## Move to Future Modules

```text
TouristBooking.tsx
TouristBookingShow.tsx
TouristTransport.tsx
TouristTransportTracking.tsx
TouristEvents.tsx
TouristEventsShow.tsx
TouristMunicipality.tsx
```

## Optional / Later

```text
TouristMessages.tsx
```

---

# 25. Revised Tourist Navigation

Recommended desktop/mobile navigation:

```text
HOME
FOOD
ORDERS
FAVORITES
PROFILE
```

Additional actions can be placed in secondary menus:

```text
Notifications
Help
Settings
Logout
```

---

# 26. Backend Changes

The existing Tourist controllers should be narrowed.

## Keep

```text
TouristController
FoodController
FavoriteController
ReviewController
HistoryController
NotificationController
TouristProfileController
```

## Simplify / Refactor

```text
ExploreController
```

It should primarily support food-business discovery.

## Move Out of Food MVP

```text
BookingController
TransportController
EventController
EventShowController
```

These should remain available for future modules if the project still needs them, but they should not drive the current Tourist MVP.

---

# 27. Services

## Keep

```text
TouristService
OrderService
PaymongoService
FirebaseService
NotificationService
```

## Refactor

```text
NearestRiderService
```

Rename/rework its responsibility around **delivery personnel assignment**, rather than transportation ride booking.

Possible future name:

```text
NearestDeliveryPersonnelService
```

or:

```text
DeliveryAssignmentService
```

The second is preferable because assignment may later consider more than physical distance.

---

# 28. Database Improvements

The current schema already contains:

```text
orders
order_items
payments
delivery
riders
rider_details
rider_locations
```

These should be reviewed and aligned with the new delivery organization.

## Recommended conceptual model

```text
users
   |
   +--- tourists
   |
   +--- business owners
   |
   +--- delivery personnel
   |
   +--- tourism office staff
```

### Food

```text
businesses
   |
   +--- business_categories
   |
   +--- offerings
          |
          +--- offering_categories
```

### Ordering

```text
orders
   |
   +--- order_items
   |
   +--- payments
   |
   +--- delivery
```

### Delivery

```text
delivery
   |
   +--- delivery_personnel
   |
   +--- assignment
   |
   +--- pickup
   |
   +--- delivery location
   |
   +--- delivery status
```

---

# 29. Delivery Data Model

The exact database structure should be reviewed before implementation, but conceptually the delivery record should contain:

```text
delivery
├── order_id
├── delivery_personnel_id
├── pickup_location
├── delivery_location
├── status
├── assigned_at
├── accepted_at
├── picked_up_at
├── delivered_at
├── current_latitude
├── current_longitude
└── timestamps
```

The delivery record should reference the **Tourism Office-managed delivery personnel**, not a business.

---

# 30. Revised API Structure

The food API should become the main Tourist API group.

### Food Discovery

```http
GET /api/tourist/food
GET /api/tourist/food/{offering}
GET /api/tourist/food/businesses
GET /api/tourist/food/categories
```

### Cart / Order

```http
POST /api/tourist/food/order
GET /api/tourist/food/orders
GET /api/tourist/food/order/{order}
POST /api/tourist/food/order/{order}/cancel
```

### Delivery Tracking

```http
GET /api/tourist/food/order/{order}/status
GET /api/tourist/food/order/{order}/delivery
```

### Rating

```http
POST /api/tourist/food/order/{order}/rate
```

### Supporting APIs

```http
GET /api/tourist/favorites
POST /api/tourist/favorites/toggle

GET /api/tourist/notifications
PATCH /api/tourist/notifications/{id}/read

GET /api/tourist/profile
PUT /api/tourist/profile

GET /api/tourist/history
```

---

# 31. Remove Duplicate Order Creation Paths

The current API has:

```http
POST /tourist/food/order
POST /tourist/food/{business}/order
```

The initial MVP should preferably have **one canonical order creation endpoint**.

Recommended:

```http
POST /api/tourist/food/order
```

The request should contain the business, cart items, address, payment method, and order details.

This avoids inconsistent order creation logic.

---

# 32. Cart Architecture Improvement

The current document identifies a technical debt:

> localStorage-based cart not synced with backend.

For the MVP, decide explicitly between:

### Option A — Server-side cart

```text
Tourist
  ↓
Backend Cart
  ↓
Cart Items
  ↓
Checkout
```

Recommended if tourists can switch devices or need persistent carts.

### Option B — Local cart

```text
Browser
  ↓
localStorage
  ↓
Checkout
```

Simpler, but less reliable.

For a production-oriented capstone, **server-side cart is preferable** if implementation time permits.

---

# 33. Validation Improvements

The current document identifies inconsistent backend validation.

All food-order operations should have backend validation.

Important validations:

### Order

- Business exists
- Food item exists
- Food item belongs to selected business
- Food item is available
- Quantity is valid
- Delivery address exists
- Payment method is valid
- Tourist is authorized to place the order

### Cancellation

- Order belongs to authenticated tourist
- Order is cancellable
- Order is not already completed/cancelled

### Rating

- Order belongs to tourist
- Order is delivered
- Order has not already been rated

---

# 34. Error Handling

Standardize API errors.

Example:

```json
{
  "success": false,
  "message": "The food item is no longer available.",
  "errors": {}
}
```

Frontend should provide:

- Loading states
- Empty states
- Error states
- Retry actions
- Success feedback

---

# 35. Realtime and Polling

The existing implementation uses polling for order and trip status.

For food ordering:

```text
Order status
→ poll every 10 seconds
```

can remain for the MVP.

Firebase/FCM can be used for notifications.

Later, real-time WebSocket/event broadcasting can replace polling if needed.

---

# 36. Security

Food ordering should enforce:

- Tourist authentication
- Role authorization
- Order ownership checks
- Business ownership checks
- Delivery assignment authorization
- Payment verification
- Server-side price validation
- Server-side total calculation
- Input validation
- File upload validation
- Rate limiting

Never trust prices or totals sent directly by the React client.

The backend should recalculate:

```text
subtotal
+ delivery fee
- discount
= total
```

---

# 37. Recommended Development Priority

## Phase 1 — Food Discovery

```text
Food businesses
Food categories
Food items
Search
Business details
Food details
```

## Phase 2 — Cart & Checkout

```text
Cart
Delivery address
Order summary
Payment method
Order creation
```

## Phase 3 — Restaurant Order Processing

```text
Accept order
Reject order
Preparing
Ready for pickup
```

## Phase 4 — Delivery Organization

```text
Delivery personnel
Availability
Assignment
Pickup
Delivery
```

## Phase 5 — Tourist Tracking

```text
Order status
Delivery status
Map
Delivery personnel information
```

## Phase 6 — Post-Order

```text
Order history
Reviews
Ratings
Favorites
Notifications
```

## Phase 7 — Hardening

```text
Validation
Authorization
Error handling
Testing
Performance
Security
```

---

# 38. Features That Should Be Future Modules

These should not be part of the current food-ordering MVP:

```text
Accommodation Booking
Transportation Booking
Tourist Spot Booking
Tourism Events
Itinerary Planner
AI Recommendations
Weather
Tour Guide Booking
Offline Mode
Social Sharing
Multi-language Support
```

The existing project can retain the code/specifications for these features, but they should be treated as future expansion rather than current requirements.

---

# 39. Revised Project Definition

TrackTour's focused Tourist module should be defined as:

> **A tourism-focused food ordering and delivery platform that connects tourists with registered local food businesses and coordinates food delivery through a Tourism Office-managed delivery organization. The system enables tourists to discover food businesses, browse menus, place orders, make payments, monitor order progress, track deliveries, and provide ratings and feedback.**

---

# 40. Target MVP Architecture

```text
                         TRACKTOUR
                            |
                     TOURISM OFFICE
                            |
              +-------------+-------------+
              |                           |
       FOOD BUSINESS                 DELIVERY
       MANAGEMENT                  ORGANIZATION
              |                           |
              |                     Delivery Personnel
              |                           |
              v                           |
          FOOD ITEMS                      |
              |                           |
              +------------+--------------+
                           |
                         ORDERS
                           |
                         TOURIST
                           |
              +------------+-------------+
              |            |             |
             Cart       Payment       Tracking
              |            |             |
              +------------+-------------+
                           |
                        Delivery
                           |
                           v
                         Tourist
```

---

# 41. Final Improvement Goal

The existing Tourist module should transition from a **general tourism super-platform** into a focused food-service module.

### Before

```text
Tourism
├── Tourist Spots
├── Restaurants
├── Resorts
├── Hotels
├── Food Ordering
├── Transportation
├── Events
├── Booking
├── Mapping
├── Messaging
├── Recommendations
└── Other Tourism Features
```

### After

```text
TrackTour — Food Ordering & Delivery
│
├── Tourist
│   ├── Food Discovery
│   ├── Food Businesses
│   ├── Menus
│   ├── Cart
│   ├── Checkout
│   ├── Orders
│   ├── Delivery Tracking
│   ├── Favorites
│   ├── Reviews
│   ├── Notifications
│   └── Profile
│
├── Food Businesses
│   ├── Restaurant
│   ├── Food Hub
│   ├── Café
│   ├── Food Vendor
│   └── Bakery
│
└── Tourism Office
    └── Delivery Organization
        └── Delivery Personnel
```

## Key Principle

**Do not rebuild the existing Tourist module from zero.**

Reuse the current food-ordering components, API structure, payment integration, notification system, map infrastructure, reviews, and authentication. Refactor or hide features that belong to future tourism modules.

The primary goal is to make the existing implementation **smaller, clearer, more maintainable, and directly aligned with the food-ordering and Tourism Office-managed delivery objective**.
