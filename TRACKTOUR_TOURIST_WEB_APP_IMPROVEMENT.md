# TrackTour — Tourist Web App Improvement Specification

## Purpose

This document defines the improved scope of the TrackTour Tourist Web App.

The Tourist Web App is a complete tourism-facing application where tourists can:

1. Explore tourist spots and attractions
2. Order food from registered local food businesses
3. Book/request transportation
4. Reserve resorts and accommodations

The system should focus on tourism-related services rather than becoming a general-purpose marketplace for every type of business.

---

## 1. Core Tourist Functions

```text
Tourist
│
├── Explore Tourist Spots
├── Order Food
├── Book Transportation
└── Reserve Resorts / Accommodation
```

These four functions form the main Tourist Web App.

---

## 2. Core Entities

TrackTour should distinguish between tourism entities, businesses, and Tourism Office-managed services.

### Tourist Spots

Tourist spots are tourism entities, not businesses.

Examples:

- Beaches
- Waterfalls
- Lakes
- Caves
- Mountains
- Viewpoints
- Historical sites
- Cultural attractions
- Nature attractions
- Recreational attractions

They can contain:

- Name
- Description
- Category
- Photos
- Geographic coordinates
- Location
- Operating hours
- Entrance fee where applicable
- Activities
- Amenities
- Rules
- Reviews
- Ratings

### Food Businesses

Keep the business scope focused on:

```text
Food Business
├── Restaurant
├── Food Hub
├── Café
├── Food Vendor
├── Bakery
└── Local Food Business
```

Food businesses can manage:

- Business profile
- Location
- Operating hours
- Menu
- Food categories
- Food items
- Prices
- Availability
- Orders
- Preparation status
- Promotions
- Reviews and ratings

### Resorts and Accommodation

The second major business group is accommodation:

```text
Accommodation
├── Resort
├── Hotel
├── Lodge
├── Inn
└── Homestay
```

Accommodation providers can manage:

- Business profile
- Location
- Photos
- Amenities
- Rooms/accommodation offerings
- Pricing
- Availability
- Reservations
- Booking confirmation
- Booking status
- Cancellation rules
- Reviews and ratings

---

## 3. Transportation Is Not a Business Category

Transportation is an organization/service managed by the Tourism Office.

Its purpose is to:

- Provide tourists with transportation
- Support tourism mobility
- Coordinate local riders
- Create additional livelihood/work opportunities for local residents

```text
Tourism Office
      │
      ▼
Tourism Transportation Organization
      │
      ├── Rider 01
      ├── Rider 02
      ├── Rider 03
      └── Rider 04
```

The Tourism Office can manage:

- Rider registration
- Rider verification
- Rider availability
- Vehicle information
- Service areas
- Rider assignments
- Trip monitoring
- Rider performance
- Trip history
- Ratings

---

## 4. Food Delivery Organization

Food delivery personnel should also be treated as part of a Tourism Office-managed service, not as independent businesses.

```text
Food Business
      │
      │ Food Order
      ▼
Tourism Delivery Organization
      │
      ▼
Delivery Personnel
      │
      ▼
Tourist
```

This can provide additional livelihood opportunities while allowing local food businesses to serve tourists without maintaining their own delivery workforce.

---

## 5. Overall Tourist Experience

TrackTour should connect the four core services into one tourism journey.

```text
Tourist
   │
   ▼
Explore Tourist Spot
   │
   ├── View nearby restaurants
   ├── View nearby resorts
   └── Request transportation
          │
          ▼
       Tourist Spot
          │
          ▼
     Order Food
          │
          ▼
   Food Delivery
          │
          ▼
     Reserve Resort
```

The tourist should be able to move naturally between these services.

---

## 6. Tourist Dashboard

The dashboard should represent the complete tourism experience.

Recommended navigation:

```text
Home
Explore
Food
Bookings
Trips
Favorites
Profile
```

The home dashboard can contain:

- Welcome message
- Search
- Featured tourist spots
- Nearby attractions
- Popular food businesses
- Recommended food
- Nearby resorts
- Current food order
- Active transportation trip
- Current resort booking
- Tourism announcements where applicable

---

## 7. Tourist Spot Exploration

Keep the existing tourist spot functionality.

### Explorer

- Search tourist spots
- Category filtering
- Map view
- List view
- Distance
- Ratings
- Photos
- Description
- Location
- Directions
- Nearby services

### Detail Page

```text
Hero Image
Spot Name
Rating
Location
Description
Photos
Activities
Amenities
Rules
Map
Reviews

Nearby:
├── Restaurants
├── Food Hubs
└── Resorts
```

---

## 8. Interactive Map

Retain the existing Leaflet/OpenStreetMap infrastructure.

The map can support:

- Tourist spot markers
- Food business markers
- Resort markers
- Tourist location
- Directions
- Delivery location
- Transportation pickup/destination
- Nearby services

The map should remain a shared tourism feature rather than being limited to food.

---

## 9. Food Ordering

Food ordering remains a major transactional feature.

```text
Tourist
   ↓
Food
   ↓
Select Food Business
   ↓
View Menu
   ↓
Select Food
   ↓
Add to Cart
   ↓
Checkout
   ↓
Select Delivery Location
   ↓
Select Payment
   ↓
Place Order
   ↓
Food Business Accepts
   ↓
Preparing
   ↓
Ready for Pickup
   ↓
Delivery Personnel Assigned
   ↓
Picked Up
   ↓
Out for Delivery
   ↓
Delivered
```

### Order status

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

Cancellation states:

```text
CANCELLED_BY_TOURIST
CANCELLED_BY_BUSINESS
CANCELLED_BY_ADMIN
```

---

## 10. Food Cart and Checkout

The cart should support:

- Food items
- Quantity
- Item notes
- Remove item
- Subtotal
- Delivery fee
- Discounts where applicable
- Total
- Delivery address
- Payment method

For the initial implementation:

```text
One Cart
   ↓
One Food Business
   ↓
One Food Order
```

Checkout should clearly show:

```text
Delivery Information
---------------------
Delivery Address

Order Summary
-------------
Items
Subtotal
Delivery Fee
Discount
Total

Payment
-------
Cash
GCash

[ PLACE ORDER ]
```

The backend must calculate final prices and totals.

---

## 11. Food Delivery Tracking

Retain the existing order tracking functionality.

```text
✓ Order Accepted
✓ Preparing
✓ Ready for Pickup
✓ Delivery Assigned
✓ Picked Up
● Out for Delivery
○ Delivered
```

The tourist can view:

- Order status
- Delivery status
- Delivery location
- Delivery personnel information
- Progress
- Contact option
- Map tracking where available

---

## 12. Transportation Booking

Transportation remains part of the Tourist Web App, but it is provided by the Tourism Office-managed Transportation Organization.

```text
Tourist
   ↓
Transportation
   ↓
Enter Pickup
   ↓
Enter Destination
   ↓
Fare Estimate
   ↓
Request Ride
   ↓
Tourism Transportation Organization
   ↓
Assign Rider
   ↓
Rider Accepts
   ↓
Rider Arrives
   ↓
Trip Starts
   ↓
Trip Completed
```

The tourist should not treat the rider as a business.

### Tourist can view:

- Pickup location
- Destination
- Estimated distance
- Estimated fare
- Vehicle type
- Rider name
- Rider rating
- Vehicle information
- Trip status
- Map location
- Contact option
- Trip history

### Trip status

```text
REQUESTED
↓
ASSIGNED
↓
ARRIVING
↓
IN_PROGRESS
↓
COMPLETED
```

Cancellation:

```text
CANCELLED_BY_TOURIST
CANCELLED_BY_RIDER
CANCELLED_BY_ADMIN
```

---

## 13. Resort / Accommodation Reservation

Resort booking remains a core Tourist feature.

```text
Tourist
   ↓
Explore / Stays
   ↓
Select Resort
   ↓
View Resort
   ↓
View Rooms
   ↓
Check Availability
   ↓
Select Room
   ↓
Enter Stay Details
   ↓
Review Reservation
   ↓
Payment
   ↓
Reservation Confirmed
```

### Resort detail

```text
Resort Header
├── Cover Photo
├── Resort Name
├── Rating
├── Location
└── Contact

Overview
Amenities
Rooms
Rates
Availability
Photos
Reviews
Map
```

### Booking lifecycle

```text
PENDING
↓
CONFIRMED
↓
IN_PROGRESS
↓
COMPLETED
```

Cancellation:

```text
CANCELLED
```

---

## 14. Payments

Retain the existing PayMongo/GCash integration.

Payments should remain separate from service status.

```text
Food Order
   └── Payment

Resort Booking
   └── Payment

Transportation Trip
   └── Payment
```

Do not assume payment status and order/booking/trip status are the same.

---

## 15. Favorites

Favorites should support:

```text
Favorite Tourist Spots
Favorite Food Businesses
Favorite Resorts
```

---

## 16. Reviews and Ratings

Reviews should support completed tourist experiences.

### Tourist Spot

- Overall rating
- Comment

### Food Business

- Overall
- Food quality
- Service
- Delivery

### Resort

- Overall
- Cleanliness
- Service
- Amenities
- Value

### Transportation

- Overall
- Rider/service

---

## 17. Search

Search should support:

```text
Search
├── Tourist Spots
├── Food Businesses
├── Food Items
└── Resorts
```

Transportation should generally be accessed through the Transportation service instead of being treated as a searchable business.

---

## 18. Notifications

### Food

- Order Accepted
- Order Preparing
- Delivery Assigned
- Picked Up
- Out for Delivery
- Delivered

### Transportation

- Ride Requested
- Rider Assigned
- Rider Arriving
- Trip Started
- Trip Completed

### Resort

- Booking Submitted
- Booking Confirmed
- Booking Reminder
- Booking Cancelled

### Tourism

- Important Tourism Announcement

---

## 19. Tourist History

Organize history by service:

```text
History
├── Food Orders
├── Transportation Trips
└── Resort Bookings
```

Tourist spot visits do not need transactional history unless visit registration or ticketing is introduced later.

---

## 20. Tourist Profile

Retain:

- Name
- Email
- Phone
- Municipality
- Barangay
- Profile photo
- Account status
- Saved addresses
- Preferences where needed

The profile should support information required for food delivery, transportation pickup, resort reservations, and tourist identification.

---

## 21. Business Scope

Do not add unrelated business categories.

```text
BUSINESSES
│
├── FOOD
│   ├── Restaurant
│   ├── Food Hub
│   ├── Café
│   ├── Food Vendor
│   └── Bakery
│
└── ACCOMMODATION
    ├── Resort
    ├── Hotel
    ├── Lodge
    ├── Inn
    └── Homestay
```

---

## 22. Tourism Office Scope

```text
TOURISM OFFICE
│
├── Tourist Spots
├── Food Business Registration / Monitoring
├── Resort / Accommodation Registration / Monitoring
├── Transportation Organization
│   └── Riders
└── Delivery Organization
    └── Delivery Personnel
```

The exact administrative permissions can be refined according to the Tourism Office requirements.

---

## 23. Entity Distinction

| Entity | Type | Purpose |
|---|---|---|
| Tourist Spot | Tourism Entity | Destination/attraction |
| Restaurant | Business | Sells food |
| Food Hub | Business | Sells food |
| Café | Business | Sells food |
| Food Vendor | Business | Sells food |
| Bakery | Business | Sells food |
| Resort | Business | Provides accommodation |
| Hotel | Business | Provides accommodation |
| Rider | Tourism Organization Personnel | Provides transportation |
| Delivery Personnel | Tourism Organization Personnel | Delivers food |
| Tourist | System User | Uses tourism services |
| Tourism Office | Organization/Administrator | Manages tourism services |

---

## 24. Recommended Tourist Navigation

Desktop:

```text
HOME
EXPLORE
FOOD
TRANSPORT
STAYS
ORDERS / BOOKINGS
FAVORITES
PROFILE
```

Mobile can prioritize:

```text
Home
Explore
Food
Bookings
Profile
```

Transportation and other actions remain accessible through the appropriate service pages.

---

## 25. Frontend Organization

Recommended structure:

```text
features/tourist/
│
├── dashboard/
│   └── TouristDashboard.tsx
│
├── explore/
│   ├── TouristExplore.tsx
│   ├── TouristExploreMap.tsx
│   ├── TouristExploreShow.tsx
│   └── TouristBusinessShow.tsx
│
├── food/
│   ├── TouristFood.tsx
│   ├── TouristFoodShow.tsx
│   ├── TouristFoodCart.tsx
│   └── TouristOrderStatus.tsx
│
├── transport/
│   ├── TouristTransport.tsx
│   └── TouristTransportTracking.tsx
│
├── accommodation/
│   ├── TouristBooking.tsx
│   └── TouristBookingShow.tsx
│
├── favorites/
│   └── TouristFavorites.tsx
├── history/
│   └── TouristHistory.tsx
├── reviews/
│   └── TouristReviews.tsx
├── notifications/
│   └── TouristNotifications.tsx
├── search/
│   └── TouristSearch.tsx
└── profile/
    └── TouristProfile.tsx
```

---

## 26. Backend Organization

The existing controller separation can be retained:

```text
Tourist/
├── TouristController
├── ExploreController
├── FoodController
├── BookingController
├── TransportController
├── FavoriteController
├── ReviewController
├── HistoryController
├── NotificationController
└── TouristProfileController
```

Event-related functionality and other future tourism features can remain separate from the core four Tourist services.

---

## 27. Service Layer

Recommended responsibilities:

```text
TouristService
    Dashboard and discovery aggregation

OrderService
    Food ordering

BookingService
    Resort reservations

TransportationService
    Transportation requests and trips

DeliveryAssignmentService
    Food delivery assignment

NearestRiderService
    Location-based rider assignment where applicable

PaymongoService
    Payments

NotificationService
    Notifications

FirebaseService
    Push/realtime functionality
```

Transportation assignment and food delivery assignment should remain conceptually separate even if they use similar location logic.

---

## 28. Database Concept

The existing database can be reused while aligning relationships with the revised scope.

```text
users
│
├── tourists
├── business owners
├── riders
├── delivery personnel
└── tourism office staff

businesses
│
├── food businesses
└── accommodation businesses

tourist_destinations
│
└── tourist spots

offerings
│
├── food items
└── rooms/accommodation offerings

orders
│
└── order_items

bookings
│
└── booking_items

transport trips
│
└── rider assignment

delivery
│
└── delivery personnel assignment

payments
favorites
reviews
notifications
```

---

## 29. Transaction Separation

Do not combine all tourism transactions into one generic flow.

TrackTour has three major transaction types:

```text
FOOD
Order
   ↓
Delivery

ACCOMMODATION
Booking
   ↓
Reservation

TRANSPORTATION
Trip
   ↓
Rider Assignment
```

This makes the system easier to maintain and explain.

---

## 30. API Structure

### Discovery

```http
GET /api/tourist/dashboard
GET /api/tourist/explore
GET /api/tourist/explore/search
GET /api/tourist/explore/{business}
GET /api/tourist/explore/map
```

### Food

```http
GET /api/tourist/food
GET /api/tourist/food/{offering}
POST /api/tourist/food/order
GET /api/tourist/food/orders
GET /api/tourist/food/order/{order}
GET /api/tourist/food/order/{order}/status
POST /api/tourist/food/order/{order}/cancel
POST /api/tourist/food/order/{order}/rate
```

### Transportation

```http
GET /api/tourist/transport
POST /api/tourist/transport/estimate
POST /api/tourist/transport/book
GET /api/tourist/transport/trip/{id}/status
POST /api/tourist/transport/trip/{id}/cancel
POST /api/tourist/transport/trip/{id}/rate
```

### Accommodation

```http
GET /api/tourist/booking
GET /api/tourist/booking/{business}
POST /api/tourist/booking/{business}
GET /api/tourist/booking/{booking}
POST /api/tourist/booking/{booking}/cancel
```

### Supporting

```http
GET /api/tourist/favorites
POST /api/tourist/favorites/toggle

GET /api/tourist/reviews

GET /api/tourist/notifications
PATCH /api/tourist/notifications/{id}/read
PATCH /api/tourist/notifications/read-all

GET /api/tourist/history

GET /api/tourist/profile
PUT /api/tourist/profile
```

---

## 31. Features to Preserve

Based on the existing Tourist module, preserve:

- Tourist Dashboard
- Location-based discovery
- Interactive Leaflet map
- Tourist spot explorer
- Business detail pages
- Food ordering
- Shopping cart
- Order tracking
- Accommodation booking
- Transportation booking
- GCash/PayMongo payment integration
- Favorites
- Reviews and ratings
- Search
- Notifications
- Tourist profile
- Combined history

These features already exist in the current Tourist implementation and should be refined rather than unnecessarily removed.

---

## 32. Features to Deprioritize

These should not be the main focus of the current Tourist implementation:

```text
AI Recommendations
Itinerary Planner
Weather Integration
Offline Mode
Social Media Sharing
Multi-language Support
Tour Guide Booking
Advanced General Messaging
```

They can remain future enhancements.

---

## 33. Technical Improvements

The existing project documentation identifies these areas for improvement:

- localStorage-based cart synchronization
- Hardcoded municipality coordinates
- Inconsistent date formatting
- Missing loading skeletons
- Missing error retry logic
- Inconsistent React error handling
- Incomplete backend validation
- API rate limiting
- Search optimization

These should be addressed according to development priority.

---

## 34. Security

All Tourist services should enforce:

- Authentication
- Role authorization
- Ownership checks
- Backend validation
- Server-side price calculation
- Payment verification
- Booking ownership verification
- Order ownership verification
- Trip ownership verification
- Secure delivery information
- Secure rider information

The frontend must never be trusted as the source of final prices, booking amounts, fares, or authorization.

---

## 35. Development Priority

### Phase 1 — Tourism Discovery

```text
Tourist Dashboard
Tourist Spots
Map
Food Businesses
Resorts
Search
```

### Phase 2 — Food Ordering

```text
Food Menu
Food Detail
Cart
Checkout
Payment
Order Creation
```

### Phase 3 — Food Delivery

```text
Delivery Organization
Delivery Personnel
Assignment
Pickup
Tracking
Completion
```

### Phase 4 — Transportation

```text
Transport Request
Fare Estimation
Rider Assignment
Trip Tracking
Trip Completion
```

### Phase 5 — Resort Reservation

```text
Resort Discovery
Room Details
Availability
Reservation
Payment
Booking Confirmation
```

### Phase 6 — Shared Features

```text
Favorites
Reviews
Notifications
History
Profile
```

### Phase 7 — Hardening

```text
Validation
Authorization
Testing
Error Handling
Security
Performance
```

---

## 36. Final TrackTour Tourist Scope

```text
                         TOURIST
                            │
            ┌───────────────┼────────────────┐
            │               │                │
            ▼               ▼                ▼
       TOURIST SPOTS      FOOD           RESORTS
            │               │                │
         Explore         Order            Reserve
         Discover        Pay              Book
         Map             Delivery         Stay
            │               │                │
            └───────────────┼────────────────┘
                            │
                            ▼
                     TRANSPORTATION
                            │
                     Request Ride
                            │
                            ▼
                    Tourism Office
                       Rider Service
```

---

## 37. Final Project Definition

> **TrackTour is a web-based tourism platform that enables tourists to explore local tourist spots, order food from registered local food businesses, request transportation through a Tourism Office-managed rider organization, and reserve resorts or accommodations. The platform connects tourists with tourism destinations and tourism-related services while supporting local businesses and creating additional livelihood opportunities through Tourism Office-managed transportation and delivery services.**

---

## 38. Core Principle

TrackTour should **not** become a platform for every kind of business.

The scope should remain:

```text
TOURIST SERVICES
├── Tourist Spots
├── Food Ordering
├── Transportation
└── Resort Reservation

BUSINESS TYPES
├── Food Businesses
└── Resorts / Accommodation

TOURISM OFFICE SERVICES
├── Transportation Organization
└── Delivery Organization
```

---

## 39. Target Tourist Journey

The Tourist Web App should allow a tourist to complete a connected tourism journey:

```text
1. Discover a tourist spot
        ↓
2. View its location and information
        ↓
3. Find nearby food
        ↓
4. Order food
        ↓
5. Track food delivery
        ↓
6. Request transportation
        ↓
7. Travel to the destination
        ↓
8. Find a resort
        ↓
9. Check room availability
        ↓
10. Reserve a room
        ↓
11. Review completed services
```

This should be the guiding user journey for the improved Tourist Web App.
