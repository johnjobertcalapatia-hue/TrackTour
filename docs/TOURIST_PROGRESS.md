# TrackTour - Tourist Module: Progress, Features & Designs

> **Last Updated:** August 15, 2026
> **Project:** Bansud Tourism Management Portal
> **System Name:** TrackTour

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Design System](#3-design-system)
4. [Implemented Features](#4-implemented-features)
5. [Frontend Pages](#5-frontend-pages)
6. [Backend Architecture](#6-backend-architecture)
7. [Database Schema](#7-database-schema)
8. [API Endpoints](#8-api-endpoints)
9. [Authentication & Authorization](#9-authentication--authorization)
10. [Current Progress Summary](#10-current-progress-summary)
11. [Not Yet Implemented](#11-not-yet-implemented)
12. [Known Issues & Limitations](#12-known-issues--limitations)

---

## 1. Project Overview

TrackTour is a multi-role tourism platform connecting tourists with local businesses, riders, and the Tourism Office in Bansud, Oriental Mindoro. The platform provides a complete digital travel experience including destination discovery, accommodation booking, food ordering, transportation services, and interactive mapping.

### Core Value Propositions
- **Discovery:** Location-based business and attraction recommendations
- **Booking:** Accommodation reservations with real-time availability
- **Food Ordering:** Restaurant menu browsing with delivery via local riders
- **Transportation:** On-demand tricycle/motorcycle booking with live tracking
- **Payments:** GCash integration via PayMongo
- **Navigation:** Interactive Leaflet.js maps with OpenStreetMap

---

## 2. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Backend | Laravel (PHP) | 12 |
| Frontend | React | 19 |
| Build Tool | Vite | 8 |
| Styling | Tailwind CSS | 4 |
| State/Data | TanStack React Query | v5 |
| Forms | react-hook-form + Zod | — |
| Maps | Leaflet.js + OpenStreetMap | — |
| Database | MySQL (via XAMPP) | — |
| Auth | Laravel Sanctum | Token-based |
| Realtime | Firebase Cloud Messaging + Realtime DB | — |
| Payments | PayMongo (GCash channel) | — |
| Notifications | Firebase FCM + Laravel Notifications | — |

---

## 3. Design System

### Color Palette: "Emerald & Amber" Theme

The palette evokes **trust** (Emerald) and **warmth/hospitality** (Amber).

| Usage | Role | Tailwind Class | Hex Code |
|-------|------|----------------|----------|
| **Primary** | Actions, Success, Live Status | `emerald-600` | `#059669` |
| **Secondary** | Pending, Attention, Warnings | `amber-500` | `#F59E0B` |
| **Surface** | Card Backgrounds | `white` | `#FFFFFF` |
| **Background** | Page Base | `gray-50` | `#F9FAFB` |
| **Typography** | Body Text | `gray-800` | `#1F2937` |

### Card Component (`.app-card`)

```css
bg-white border border-gray-200 rounded-2xl shadow-sm
```

### Status Badges

- **Approved:** `bg-emerald-50 text-emerald-700 border border-emerald-200`
- **Pending:** `bg-amber-50 text-amber-700 border border-amber-200`

### Visual Hierarchy

- **Header:** `text-3xl` for page titles
- **Stat Grids:** `grid-cols-1 md:grid-cols-4` responsive pattern
- **Actions:** Dedicated `Quick Actions` card grouping

### Animations

- Ken Burns effect on hero banners
- Fade-in-up transitions
- Slide-up animations
- Float and glow effects

---

## 4. Implemented Features

### 4.1 Tourist Dashboard (`TouristDashboard.tsx`)

The main home screen with tabbed hero banner sections:

| Tab | Content |
|-----|---------|
| Discover | General overview of nearby tourism services |
| Destinations | Tourist spots and attractions |
| Food | Local restaurants and food hubs |
| Stays | Hotels, resorts, and accommodations |
| Events | Upcoming tourism events and festivals |

**Dashboard Modules:**
- Featured businesses carousel
- Trending restaurants
- Popular resorts
- Upcoming events section
- Nearby businesses (Haversine distance)
- Top attractions
- Travel inspiration
- Seasonal recommendations (Summer, Rainy, Christmas, Holy Week)

---

### 4.2 Location-Based Discovery

**Interactive Map (`TouristExploreMap.tsx`):**
- Full-screen Leaflet.js map with OpenStreetMap tiles
- Three map layers: Street, Dark (CartoDB), Satellite (Esri)
- User geolocation button
- Business markers with popup details
- Category filter chips
- Fullscreen toggle
- Detail sidebar on marker click

**Haversine Distance Calculation:**
- Real-time distance computation from user location
- Sort businesses by proximity
- "Nearby" section on dashboard

---

### 4.3 Tourist Spot Explorer (`TouristExplore.tsx`)

Browse approved businesses by category with:

| Feature | Details |
|---------|---------|
| Search | Debounced real-time queries |
| Quick Filters | Open Now, Highly Rated, Promotions, New, Nearest |
| Sort Options | Popular, Rating, Newest, Alphabetical, Reviews, Nearest |
| Display | Grid of business cards with ratings, open/closed status, distance |

---

### 4.4 Business Detail Page (`TouristBusinessShow.tsx`)

Rich business profile with:

- Hero image with Ken Burns animation
- Business logo and rating display
- Tabbed content: Menu / Reviews / Photos / Info
- Category-specific behavior (restaurant vs hotel vs attraction vs transport)
- Floating call/directions action bar
- Add-to-cart functionality for food businesses

---

### 4.5 Food Ordering System

#### Browse Food (`TouristFood.tsx`)
- Search and category filter
- Grid of food item cards with images, prices, ratings
- Availability badges (available/sold out)

#### Food Detail (`TouristFoodShow.tsx`)
- Individual food item view
- Quantity picker modal
- Add to cart action

#### Shopping Cart (`TouristFoodCart.tsx`)
- Quantity controls per item
- Subtotal calculation
- Payment method selection (Cash or GCash)
- Checkout with PayMongo integration

#### Order Status Tracking (`TouristOrderStatus.tsx`)

5-step progress stepper:
```
Order Placed → Rider Assigned → Picked Up → On the Way → Delivered
```

Features:
- Live tracking map area
- Order details and delivery addresses
- Rider info with phone call button
- Timeline view
- Cancel/rate modals
- Auto-polls every 10 seconds

---

### 4.6 Accommodation/Room Booking

**Booking Flow (`TouristBooking.tsx`):**
- Browse hotels, resorts, inns, homestays
- View offerings/services
- Create bookings with booking number generation

**Booking Status Lifecycle:**
```
pending → confirmed → in_progress → completed/cancelled
```

**Booking List:**
- Paginated view
- Status badges
- Check-in/out dates
- Amounts displayed

---

### 4.7 Rider/Transport Booking

#### Transport Browser (`TouristTransport.tsx`)
- Filter by vehicle type (tricycle, motorcycle, etc.)
- Show provider, route, fare, estimated time
- Availability indicators

#### Fare Estimation
- Distance-based fare calculation
- Vehicle type multiplier
- Pre-booking cost preview

#### Live Trip Tracking (`TouristTransportTracking.tsx`)

4-step status stepper:
```
Assigned → Arriving → In Progress → Completed
```

Features:
- Full-screen Leaflet map with pickup/destination markers
- Rider info card with phone call
- Fare breakdown display
- 4-digit verification PIN for security
- Cancel/rate/GCash pay modals
- Auto-polls every 5 seconds

---

### 4.8 Payment Integration (GCash via PayMongo)

**Payment Service (`payment.ts`):**
- `createPaymentIntent()` — Supports order/booking types, gcash/card methods
- `getPaymentStatus()` — Check payment status
- `redirectToCheckout()` — Redirect to GCash checkout

**Payment Flow:**
1. Tourist initiates checkout
2. PayMongo payment intent created
3. Redirect to GCash
4. Payment callback handler (`PaymentCallbackPage.tsx`)
5. Order/booking status updated

**Payment Records:**
- Polymorphic payments (applies to both orders and bookings)
- Stored in `payments` table with provider metadata

---

### 4.9 Favorites/Saved Places (`TouristFavorites.tsx`)

- Toggle favorites on businesses (polymorphic)
- Saved places grid view
- Remove from favorites
- Favorites influence dashboard recommendations

---

### 4.10 Reviews & Ratings (`TouristReviews.tsx`)

Multi-dimensional rating system:
- Overall star rating (1-5)
- Food rating
- Service rating
- Cleanliness rating
- Atmosphere rating
- Value rating
- "Would recommend" flag
- Visit type tracking
- Review status (pending → approved)

---

### 4.11 Search System (`TouristSearch.tsx`)

- Global search with recent searches (sessionStorage)
- Popular search suggestions
- Search across businesses, municipalities, and events
- Debounced real-time results
- Results grid with images and ratings

---

### 4.12 Notifications (`TouristNotifications.tsx`)

- Notification inbox
- Mark individual as read
- Mark all as read
- Unread count badge in header

---

### 4.13 Messaging (Partial) (`TouristMessages.tsx`)

- Message listing
- Unread count
- Send message (basic implementation)
- Firebase Realtime DB for chat

---

### 4.14 Events (`TouristEvents.tsx`)

- Tourism events listing (published, future events)
- Individual event detail pages (`TouristEventsShow.tsx`)

---

### 4.15 Profile Management (`TouristProfile.tsx`)

- View and edit profile (name, email, phone, municipality, barangay)
- Profile photo upload
- Account status display
- Logout functionality
- Zod form validation

---

### 4.16 History (`TouristHistory.tsx`)

- Combined booking and order history
- Paginated listing

---

### 4.17 Business Directory (`TouristDirectory.tsx`)

- Advanced filtering options
- Category, municipality, open-now, rated, promotions, newest, nearest, alphabetical

---

### 4.18 Municipality Pages (`TouristMunicipality.tsx`)

- Municipality-specific business listings
- Local tourism information

---

## 5. Frontend Pages

### Complete Page Inventory

| File | Description | Status |
|------|-------------|--------|
| `TouristDashboard.tsx` | Main home screen with tabbed hero | ✅ Complete |
| `TouristExplore.tsx` | Browse businesses by category | ✅ Complete |
| `TouristExploreMap.tsx` | Full-screen interactive Leaflet map | ✅ Complete |
| `TouristExploreShow.tsx` | Business detail exploration view | ✅ Complete |
| `TouristBusinessShow.tsx` | Rich business profile page | ✅ Complete |
| `TouristFood.tsx` | Browse food items from restaurants | ✅ Complete |
| `TouristFoodShow.tsx` | Individual food item detail | ✅ Complete |
| `TouristFoodCart.tsx` | Shopping cart for food orders | ✅ Complete |
| `TouristOrderStatus.tsx` | Live order status tracker | ✅ Complete |
| `TouristBooking.tsx` | Paginated booking list | ✅ Complete |
| `TouristBookingShow.tsx` | Individual booking detail | ✅ Complete |
| `TouristTransport.tsx` | Browse transport options | ✅ Complete |
| `TouristTransportTracking.tsx` | Live trip tracking | ✅ Complete |
| `TouristFavorites.tsx` | Saved/favorited businesses | ✅ Complete |
| `TouristHistory.tsx` | Combined booking/order history | ✅ Complete |
| `TouristProfile.tsx` | Profile management form | ✅ Complete |
| `TouristSearch.tsx` | Global search page | ✅ Complete |
| `TouristNotifications.tsx` | Notification inbox | ✅ Complete |
| `TouristMessages.tsx` | Messaging/Chat interface | ⚠️ Partial |
| `TouristEvents.tsx` | Tourism events listing | ✅ Complete |
| `TouristEventsShow.tsx` | Event detail page | ✅ Complete |
| `TouristDirectory.tsx` | Business directory | ✅ Complete |
| `TouristMunicipality.tsx` | Municipality listings | ✅ Complete |
| `TouristReviews.tsx` | Tourist's review history | ✅ Complete |
| `PaymentCallbackPage.tsx` | PayMongo callback handler | ✅ Complete |

**Total:** 25 frontend pages (24 complete, 1 partial)

### Layout

| File | Description |
|------|-------------|
| `TouristLayout.tsx` | Shell layout with sticky header, bottom mobile nav, desktop horizontal nav, floating chat FAB |

---

## 6. Backend Architecture

### Controllers (13 Tourist Controllers)

| Controller | Purpose |
|-----------|---------|
| `TouristController.php` | Dashboard data aggregation |
| `ExploreController.php` | Business exploration, search, directory |
| `FoodController.php` | Food browsing, ordering, status |
| `BookingController.php` | Accommodation browsing, booking creation |
| `TransportController.php` | Transport options, fare estimation, ride booking |
| `FavoriteController.php` | Toggle and list favorites |
| `ReviewController.php` | User reviews management |
| `HistoryController.php` | Combined booking/order history |
| `NotificationController.php` | Notification management |
| `MessageController.php` | Messaging (basic) |
| `EventController.php` | Tourism events listing |
| `EventShowController.php` | Event detail |
| `TouristProfileController.php` | Profile view/edit |

### Services (8+ Tourist Services)

| Service | Purpose |
|---------|---------|
| `TouristService.php` | Core business logic, dashboard data, search |
| `BookingService.php` | Booking management |
| `OrderService.php` | Food order management |
| `TransportationService.php` | Fare calculation, ride creation with PIN |
| `NearestRiderService.php` | Haversine-based nearest rider dispatch |
| `PaymongoService.php` | PayMongo GCash integration |
| `FirebaseService.php` | FCM push notifications, Realtime DB |
| `NotificationService.php` | Notification management |

### Form Requests (7 Validators)

| Request | Validates |
|---------|-----------|
| `UpdateTouristProfileRequest` | Name, email, mobile, address |
| `CreateBookingRequest` | Booking creation fields |
| `CreateOrderRequest` | Food order fields |
| `BookTransportRequest` | Transport booking fields |
| `RateTransportRequest` | Transport rating fields |
| `CreateReviewRequest` | Review creation fields |
| `ToggleFavoriteRequest` | Favorite toggle fields |

---

## 7. Database Schema

### Tourist-Specific Tables

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `tourists` | user_id, first_name, last_name, dob, nationality, bio, preferences (JSON) | Tourist profile |
| `tourist_destinations` | municipality_id, category_id, name, slug, description, lat/lng, images (JSON), amenities (JSON) | Tourist attractions/spots |

### Transaction Tables

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `bookings` | booking_number, business_id, customer info, status, check-in/out dates, guests, amounts | Accommodation reservations |
| `booking_items` | booking_id, offering_id, quantity, unit_price | Booking line items |
| `orders` | order_number, business_id, customer info, order_type, status, amounts | Food and transport orders |
| `order_items` | order_id, offering_id, quantity, unit_price | Order line items |
| `payments` | payable_type/payable_id, user_id, amount, method, provider, status | Payment records |

### Interaction Tables

| Table | Purpose |
|-------|---------|
| `favorites` | Polymorphic favorites (businesses/spots) |
| `reviews` | Business reviews with multi-dimensional ratings |
| `notifications` | User notifications |
| `chat_rooms` / `chat_messages` | Messaging system |
| `trip_logs` | Rider trip tracking data |

### Supporting Tables

| Table | Purpose |
|-------|---------|
| `users` | All system users with role field |
| `businesses` | Business profiles with location |
| `business_categories` | Business type categories |
| `municipalities` | Geographic municipality data |
| `barangays` | Sub-municipality areas |
| `offerings` | Products/services (menu items, rooms) |
| `offering_categories` | Offering categories |
| `promotions` | Active business promotions |
| `tourism_events` | Tourism events/festivals |
| `tourism_categories` | Tourism destination categories |
| `riders` / `rider_details` / `rider_locations` | Rider profiles and GPS |
| `delivery` | Delivery tracking for food orders |

---

## 8. API Endpoints

All tourist routes are protected by `role:tourist` middleware under prefix `/api/tourist`.

### Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tourist/dashboard` | Dashboard data aggregation |

### Explore
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tourist/explore` | Explore businesses |
| GET | `/tourist/explore/search` | Search suggestions |
| GET | `/tourist/explore/categories` | Categories for map |
| GET | `/tourist/explore/directory` | Full directory |
| GET | `/tourist/explore/{business}` | Business detail |
| GET | `/tourist/explore/municipality/{municipality}` | Municipality page |

### Food Ordering
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tourist/food` | List food items |
| GET | `/tourist/food/{offering}` | Food item detail |
| POST | `/tourist/food/order` | Place flat order |
| POST | `/tourist/food/{business}/order` | Place order by business |
| GET | `/tourist/food/order/{order}/status` | Order status |
| POST | `/tourist/food/order/{order}/cancel` | Cancel order |
| POST | `/tourist/food/order/{order}/rate` | Rate completed order |

### Bookings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tourist/booking` | List bookings |
| GET | `/tourist/booking/{business}` | Business offerings |
| POST | `/tourist/booking/{business}` | Create booking |

### Transport
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tourist/transport` | Transport options |
| POST | `/tourist/transport/estimate` | Fare estimate |
| POST | `/tourist/transport/book` | Book a ride |
| GET | `/tourist/transport/trip/{id}/status` | Trip status |
| POST | `/tourist/transport/trip/{id}/cancel` | Cancel trip |
| POST | `/tourist/transport/trip/{id}/rate` | Rate trip |

### Events
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tourist/events` | Events list |
| GET | `/tourist/events/{id}` | Event detail |

### Favorites
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tourist/favorites` | List favorites |
| POST | `/tourist/favorites/toggle` | Toggle favorite |

### Reviews
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tourist/reviews` | User's reviews |

### Messages
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tourist/messages` | Messages |
| GET | `/tourist/messages/unread-count` | Unread count |
| POST | `/tourist/messages` | Send message |

### Notifications
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tourist/notifications` | Notifications |
| PATCH | `/tourist/notifications/{id}/read` | Mark read |
| PATCH | `/tourist/notifications/read-all` | Mark all read |

### History
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tourist/history` | Booking + order history |

### Profile
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tourist/profile` | View profile |
| PUT | `/tourist/profile` | Update profile |

**Total API Endpoints:** 37

---

## 9. Authentication & Authorization

### Authentication
- Laravel Sanctum token-based authentication
- Login/logout via API
- Token stored in frontend (React state/localStorage)

### Role-Based Access Control (RBAC)

**`CheckRole` Middleware:**
- Validates `$request->user()->role` against allowed roles
- Aborts with 403 if unauthorized

**User Roles:**
- `tourist` — Default role for tourists
- `business_owner` — Business managers
- `rider` — Delivery/transport providers
- `staff` — Tourism office staff
- `admin` — System administrators

**Tourist Route Protection:**
```php
Route::middleware('role:tourist')->prefix('tourist')->group(function () {
    // All tourist routes here
});
```

### Account Status
- `CheckAccountStatus` middleware validates account status (approved/pending)
- Non-tourist users receive 403 when accessing tourist endpoints

---

## 10. Current Progress Summary

### Feature Completion Status

| Feature | Status | Notes |
|---------|--------|-------|
| Tourist Dashboard | ✅ Complete | Tabbed hero, seasonal recommendations |
| Location-Based Discovery | ✅ Complete | Leaflet map, Haversine distance |
| Tourist Spot Explorer | ✅ Complete | Search, filter, sort |
| Business Detail Page | ✅ Complete | Multi-tab, category-specific |
| Food Ordering | ✅ Complete | Cart, checkout, tracking |
| Accommodation Booking | ✅ Complete | Booking lifecycle |
| Transport/Rider Booking | ✅ Complete | Fare estimation, live tracking |
| Payment Integration | ✅ Complete | GCash via PayMongo |
| Favorites | ✅ Complete | Polymorphic, toggle |
| Reviews & Ratings | ✅ Complete | Multi-dimensional ratings |
| Search | ✅ Complete | Debounced, multi-entity |
| Notifications | ✅ Complete | Read/unread management |
| Messaging | ⚠️ Partial | Basic send/receive |
| Events | ✅ Complete | Listing and detail |
| Profile Management | ✅ Complete | Edit, photo upload |
| History | ✅ Complete | Combined view |
| Business Directory | ✅ Complete | Advanced filtering |
| Municipality Pages | ✅ Complete | Local listings |

### Quantitative Summary

| Metric | Count |
|--------|-------|
| Frontend Pages | 25 |
| Backend Controllers | 13 (+1 API) |
| Tourist-Specific Models | 5 |
| Supporting Models | 30+ |
| API Endpoints | 37 |
| Database Migrations | 10 (tourist-specific) |
| Services | 8+ |
| Form Requests | 7 |
| PHPUnit Tests | 10 |

---

## 11. Not Yet Implemented

Based on the specification (`tourist-dashboard.md`) and codebase analysis:

| Feature | Status | Priority |
|---------|--------|----------|
| **Itinerary Planner** | ❌ Not Started | High |
| AI-Powered Recommendations | ❌ Not Started | Medium |
| Weather Integration | ❌ Not Started | Low |
| Emergency Contact System | ❌ Not Started | Medium |
| Multi-Language Support | ❌ Not Started | Low |
| Offline Mode | ❌ Not Started | Low |
| Social Media Sharing | ❌ Not Started | Low |
| Tour Guide Booking | ❌ Not Started | Medium |
| Real-time Chat (Full) | ⚠️ Partial | High |
| Push Notification Opt-in | ⚠️ Partial | Medium |

---

## 12. Known Issues & Limitations

### Current Limitations

1. **Messaging:** Basic implementation only — no real-time WebSocket updates
2. **Offline Support:** No service worker or caching strategy
3. **Image Optimization:** No lazy loading or WebP conversion
4. **Testing:** Only 10 PHPUnit tests for tourist module
5. **Error Handling:** Inconsistent error boundaries in React
6. **Form Validation:** Some endpoints lack backend validation
7. **Rate Limiting:** No API rate limiting implemented
8. **Search Indexing:** No Elasticsearch/Meilisearch — relies on MySQL LIKE queries

### Technical Debt

- localStorage-based cart (not synced with backend)
- Some hardcoded municipality coordinates
- Inconsistent date formatting across pages
- Missing loading skeletons on some pages
- No error retry logic on failed API calls

---

## Appendix A: File Structure

```
Capstone Project 1/
├── app/
│   ├── Http/
│   │   ├── Controllers/
│   │   │   ├── Tourist/          # 13 tourist controllers
│   │   │   └── Api/              # REST API controllers
│   │   ├── Middleware/            # CheckRole, CheckAccountStatus
│   │   └── Requests/Tourist/     # 7 form request validators
│   ├── Models/                   # 59 Eloquent models
│   ├── Services/                 # 19 service classes
│   └── Repositories/             # Repository interfaces
├── frontend/
│   └── src/
│       ├── features/tourist/
│       │   ├── pages/            # 25 page components
│       │   └── components/       # (shared components)
│       └── shared/
│           ├── layouts/          # TouristLayout.tsx
│           └── services/         # payment.ts, api.ts
├── database/
│   ├── migrations/               # 85+ migrations
│   └── seeders/                  # TouristSeeder.php
├── routes/
│   └── api.php                   # Tourist routes at line 132
├── tests/
│   └── Feature/
│       └── TouristApiTest.php    # 10 PHPUnit tests
└── docs/
    ├── tourist-dashboard.md      # Full specification (1245 lines)
    ├── DESIGN_SYSTEM.md          # Color palette & UI guidelines
    └── TOURIST_PROGRESS.md       # This document
```

---

## Appendix B: Test Coverage

**File:** `tests/Feature/TouristApiTest.php`

| Test Case | Description |
|-----------|-------------|
| `test_tourist_can_access_dashboard` | Verify dashboard endpoint returns 200 |
| `test_tourist_can_access_explore` | Verify explore endpoint returns 200 |
| `test_tourist_can_search` | Verify search functionality |
| `test_tourist_can_list_food` | Verify food listing |
| `test_tourist_can_toggle_favorite` | Verify favorite toggle |
| `test_tourist_can_list_favorites` | Verify favorites listing |
| `test_tourist_can_list_reviews` | Verify reviews listing |
| `test_tourist_can_list_notifications` | Verify notifications |
| `test_tourist_can_list_history` | Verify history listing |
| `test_tourist_can_access_profile` | Verify profile access |
| `test_non_tourist_cannot_access_tourist_routes` | Verify 403 for non-tourist roles |

---

*This document provides a comprehensive overview of the Tourist module's current state. For detailed specifications, refer to `docs/tourist-dashboard.md`. For UI guidelines, refer to `docs/DESIGN_SYSTEM.md`.*
