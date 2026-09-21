# TrackTour Tourist Web App — TikTok-Style UI Improvement Specification

## 1. Purpose

Redesign the TrackTour Tourist Web App as a **mobile-first tourism discovery experience** inspired by TikTok's interaction model, without copying TikTok's branding.

The interface should feel:
- Visual
- Immersive
- Simple
- Fast to browse
- Easy to order or book
- Tourism-focused

It should NOT look like an administrative dashboard or business-management system.

---

## 2. Core Product Direction

TrackTour should feel like:

> **TikTok-style discovery + tourism exploration + food ordering + resort booking + transportation**

The tourist should think:

> **"What should I explore today?"**

not:

> **"Which module do I need to open?"**

---

## 3. Primary Modules

Keep the Tourist Web App to only five primary modules:

```text
TRACKTOUR TOURIST
│
├── 🏠 Home
├── 🔍 Explore
├── 🍴 Food
├── 🏨 Stays
└── 📋 My Trips
```

Do not add permanent primary navigation items for Directory, Transport, Events, Favorites, Reviews, History, Notifications, Messages, or Settings.

These should be secondary features inside the appropriate areas.

---

## 4. Mobile-First Layout

Use a mobile-first layout with:

- Bottom navigation
- Vertical scrolling
- Full-height visual content
- Large touch targets
- Swipe gestures
- Horizontal category chips
- Large images/video
- Floating actions
- Bottom sheets
- Minimal forms
- Minimal text

Even on desktop, preserve a mobile-app composition instead of expanding into an admin dashboard.

---

## 5. Home — TikTok-Style Tourism Feed

Home should be a vertically scrollable discovery feed.

Example:

```text
┌──────────────────────────────┐
│ TrackTour       For You      │
│                              │
│       DESTINATION            │
│       IMAGE / VIDEO          │
│                              │
│                         ♡    │
│                         💬   │
│                         ↗    │
│                         📍   │
│                              │
│ White Beach                  │
│ ⭐ 4.9 · Beach               │
│ Beautiful destination...     │
│                              │
│ [ View Place ]              │
├──────────────────────────────┤
│ 🏠   🔍   🍴   🏨   📋      │
│Home Explore Food Stays Trips│
└──────────────────────────────┘
```

The tourist swipes vertically to discover the next experience.

---

## 6. Feed Content Types

The feed can contain:

### Tourist Spot
- Image/video
- Name
- Location
- Rating
- Short description
- View Place

### Food
- Food image
- Food business
- Food item
- Rating
- Price
- Order Now

### Resort
- Resort image
- Resort name
- Rating
- Location
- Starting price
- View Stay

Content should be visual first and informational second.

---

## 7. Explore

Explore combines:

```text
Explore
│
├── Tourist Spots
├── Food Nearby
└── Resorts Nearby
```

Use:

```text
🔍 Search destinations...

[All] [Places] [Food] [Stays]
```

Keep filters short and horizontally scrollable.

---

## 8. Tourist Spot Experience

Tourist spots are tourism entities, not businesses.

Supported examples:

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

Tourist spot details may include:

- Name
- Photos/video
- Description
- Rating
- Location
- Distance
- Activities
- Amenities
- Rules
- Map
- Directions

Example actions:

```text
[ Directions ]
[ 🚗 Book a Ride ]
```

Nearby:

```text
🍴 Food
🏨 Stays
```

---

## 9. Transportation as a Contextual Action

Transportation must NOT become a sixth primary module.

Transportation is provided by the **Tourism Office-managed transportation organization**.

The tourist should simply see:

> **Book a Ride**

when transportation is relevant.

Flow:

```text
Tourist Spot
     ↓
[ 🚗 Book a Ride ]
     ↓
Pickup Location
     ↓
Destination
     ↓
Fare Estimate
     ↓
Request Ride
     ↓
Tourism Office
     ↓
Rider Assigned
```

The rider organization operates behind the interface.

---

## 10. Ride Booking Bottom Sheet

Use a bottom sheet instead of a large separate module:

```text
┌──────────────────────────────┐
│ ─────────                    │
│ Book a Ride                  │
│                              │
│ 📍 Current location          │
│ ↓                            │
│ 📍 White Beach               │
│                              │
│ Estimated Fare               │
│ ₱150 – ₱200                  │
│                              │
│ [ Request Ride ]             │
└──────────────────────────────┘
```

---

## 11. Food

Food should be a visual discovery and ordering feed.

The tourist can:

- Discover restaurants
- Discover food hubs
- Discover cafés
- Discover local food businesses
- View menus
- Add food to cart
- Checkout
- Pay
- Order
- Track delivery

It should NOT look like a business directory.

Example:

```text
┌──────────────────────────────┐
│ 🍴 Food                      │
│ 🔍 Search food...            │
│                              │
│ [Nearby] [Popular] [Local]  │
│                              │
│       LARGE FOOD IMAGE       │
│                         ♡    │
│                         🛒   │
│                              │
│ Local Food Hub              │
│ ⭐ 4.8                      │
│ Chicken Inasal              │
│ ₱180                        │
│                              │
│ [ Order Now ]               │
└──────────────────────────────┘
```

Swipe vertically to discover more food.

---

## 12. Food Business Scope

Keep business categories focused:

```text
Food Business
├── Restaurant
├── Food Hub
├── Café
├── Food Vendor
├── Bakery
└── Local Food Business
```

Do not expand into unrelated business categories.

---

## 13. Food Ordering Flow

```text
Food
 ↓
Food Business
 ↓
Menu
 ↓
Food Item
 ↓
Cart
 ↓
Checkout
 ↓
Payment
 ↓
Order
 ↓
Preparation
 ↓
Delivery Assignment
 ↓
Delivery
 ↓
Completed
```

Minimize the number of screens required to complete an order.

---

## 14. Food Delivery

Food delivery personnel are part of a Tourism Office-managed delivery organization.

```text
Food Business
      ↓
Food Order
      ↓
Tourism Delivery Organization
      ↓
Delivery Personnel
      ↓
Tourist
```

The tourist sees the delivery service and status, not the administrative organization behind it.

---

## 15. Food Order Tracking

Use a simple visual tracker:

```text
✓ Accepted
✓ Preparing
✓ Ready
✓ Rider Assigned
● Out for Delivery
○ Delivered
```

Avoid administrative tables.

---

## 16. Stays

Stays focuses on resorts and accommodations.

Tourists can:

- Discover resorts
- Browse rooms
- View amenities
- Check availability
- View pricing
- Reserve
- Pay
- View booking

Example:

```text
┌──────────────────────────────┐
│ 🏨 Stays                     │
│                              │
│ Where do you want to stay?  │
│                              │
│ 📅 Check-in   📅 Check-out  │
│                              │
│ [ Search Stays ]             │
│                              │
│       RESORT PHOTO           │
│                         ♡    │
│                         ↗    │
│                         📍   │
│                              │
│ Sunrise Beach Resort        │
│ ⭐ 4.8                      │
│ From ₱2,500 / night         │
│                              │
│ [ View Stay ]               │
└──────────────────────────────┘
```

Swipe to discover additional resorts.

---

## 17. Accommodation Scope

Keep accommodation focused on:

```text
Accommodation
├── Resort
├── Hotel
├── Lodge
├── Inn
└── Homestay
```

Final supported categories can be adjusted according to project requirements.

---

## 18. My Trips

Consolidate transactional activity into one module.

```text
My Trips
│
├── Active
├── Upcoming
└── Completed
```

Example:

```text
┌──────────────────────────────┐
│ My Trips                     │
│ [Active] [Upcoming] [Done]  │
│                              │
│ 🍴 Food Order                │
│ Restaurant                  │
│ Preparing                   │
│ [ Track Order ]             │
│                              │
│ 🏨 Resort                    │
│ Sunrise Beach Resort        │
│ Confirmed · Aug 20–22       │
│                              │
│ 🚗 Ride                      │
│ Rider arriving              │
│ [ Track Ride ]              │
└──────────────────────────────┘
```

Do not create separate permanent modules for Orders, Bookings, Transport History, and History.

---

## 19. Profile

Profile contains secondary account features:

```text
Profile
│
├── Personal Information
├── Favorites
├── Reviews
├── Notifications
├── Saved Places
└── Settings
```

These should not consume primary navigation space.

---

## 20. Bottom Navigation

Use only:

```text
┌──────────────────────────────┐
│ 🏠    🔍    🍴    🏨    📋  │
│Home  Explore Food  Stays Trips
└──────────────────────────────┘
```

The active item should have a subtle TrackTour brand indicator.

---

## 21. Desktop Behavior

The app is web-based but should remain mobile-first.

On desktop:

- Center the main content
- Preserve a mobile-like composition
- Avoid stretching cards across the entire screen
- Avoid large admin sidebars
- Keep the feed visually focused
- Preserve bottom navigation or a compact equivalent

Do not convert the desktop layout into a traditional admin dashboard.

---

## 22. Visual Direction

Recommended TrackTour palette:

```text
Primary:
TrackTour Tropical Green

Secondary:
Ocean Blue

Accent:
Sun Yellow / Warm Orange

Background:
Soft White / Very Light Blue

Text:
Deep Navy

Cards:
White
```

Use brand colors selectively.

Prioritize photography and visual storytelling.

---

## 23. Photography

Photography is a primary UI element.

Prioritize:

- Tourist spot photos
- Food photos
- Resort photos
- Local scenery
- Destination videos

Avoid interfaces dominated by:

- Tables
- Empty white containers
- Dense text
- Forms
- Administrative statistics
- Business-management controls

---

## 24. Card Design

Prefer:

```text
IMAGE

Place / Business Name
⭐ Rating
📍 Distance
Short description

[ View ]
```

Avoid displaying unnecessary administrative metadata such as:

- Owner
- Internal status
- Business records
- Administrative IDs
- Management actions

The tourist should see information relevant to making a travel decision.

---

## 25. Search

Use one simple search style:

```text
🔍 Search places, food, resorts...
```

Search results can include:

```text
Tourist Spots
Food
Resorts
```

Transportation should not appear as a searchable business category.

---

## 26. Filters

Keep filters minimal.

Explore:

```text
[All] [Places] [Food] [Stays]
```

Food:

```text
[Nearby] [Popular] [Local]
```

Stays:

```text
[Resorts] [Hotels] [Budget] [Popular]
```

Use horizontally scrollable chips rather than large filter panels.

---

## 27. Empty States

Do not use large empty administrative containers.

Example:

```text
        🍴

   Nothing nearby yet

Try another location or
remove some filters.

[ Clear Filters ]
```

Where possible, offer another discovery action.

---

## 28. Notifications

Notifications should be accessible from the top-right notification icon or Profile.

They are not a primary module.

Examples:

- Food order accepted
- Food is being prepared
- Rider assigned
- Rider arriving
- Resort booking confirmed
- Food out for delivery
- Trip completed

---

## 29. Favorites

Favorites should be accessible through the heart action and Profile.

Tourists can favorite:

- Tourist spots
- Food businesses
- Resorts

---

## 30. Reviews

Reviews should be contextual and available after completed experiences.

Examples:

```text
Food Order → Rate Food
Ride → Rate Rider
Resort Stay → Rate Resort
Tourist Spot → Review Place
```

Reviews should not be a primary navigation item.

---

## 31. Main UX Principle

Use:

```text
Discover
   ↓
View
   ↓
Act
```

instead of:

```text
Navigate
   ↓
Open Module
   ↓
Search
   ↓
Manage
   ↓
Submit
```

Examples:

```text
Tourist Spot
   ↓
View
   ↓
Book Ride
```

```text
Food
   ↓
View
   ↓
Order
```

```text
Resort
   ↓
View
   ↓
Reserve
```

---

## 32. Recommended Components

```text
TouristFeed
TouristFeedItem
TouristSpotCard
FoodCard
ResortCard
FloatingActions
CategoryChips
BottomNavigation
SearchBar
BottomSheet
RideBookingSheet
OrderStatus
TripCard
```

Keep components focused on the tourist experience rather than administrative management.

---

## 33. Frontend Structure

Recommended structure:

```text
features/tourist/
│
├── home/
│   ├── TouristHome.tsx
│   └── TouristFeed.tsx
│
├── explore/
│   ├── TouristExplore.tsx
│   ├── TouristSpotShow.tsx
│   └── TouristMap.tsx
│
├── food/
│   ├── TouristFood.tsx
│   ├── FoodShow.tsx
│   ├── FoodCart.tsx
│   └── FoodOrder.tsx
│
├── stays/
│   ├── TouristStays.tsx
│   ├── ResortShow.tsx
│   └── ResortBooking.tsx
│
├── trips/
│   ├── MyTrips.tsx
│   └── TripDetails.tsx
│
└── profile/
    └── TouristProfile.tsx
```

---

## 34. Primary Interaction Model

The primary interaction should be:

```text
Vertical Swipe
      ↓
Discover Content
      ↓
Tap Content
      ↓
View Details
      ↓
Perform Action
```

Actions:

```text
View Place
Order Now
Reserve
Book a Ride
Get Directions
Favorite
```

---

## 35. Final Tourist App Architecture

```text
                         TRACKTOUR
                            │
                          TOURIST
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
          ▼                 ▼                 ▼
        HOME             EXPLORE             FOOD
          │                 │                 │
     Discovery Feed     Tourist Spots      Food Feed
          │                 │                 │
          │            Nearby Food        Order Food
          │            Nearby Stays           │
          │                 │                 │
          └─────────────────┼─────────────────┘
                            │
                            ▼
                          STAYS
                            │
                         Reserve
                            │
                            ▼
                       MY TRIPS
                            │
                 ┌──────────┼──────────┐
                 │          │          │
                Food       Ride       Stay
```

---

## 36. Final Navigation

The primary navigation is locked to:

```text
🏠 Home
🔍 Explore
🍴 Food
🏨 Stays
📋 My Trips
```

No additional primary modules should be added unless a future requirement clearly justifies them.

---

## 37. Final Product Definition

> **TrackTour is a mobile-first tourism web application designed around visual discovery. Tourists can swipe through destinations, discover local food, explore resorts, order meals, reserve accommodation, and request Tourism Office-managed transportation. The interface prioritizes destinations, photography, food, places, and simple actions instead of administrative modules and business-management interfaces.**

---

## 38. Final Design Rule

> **The tourist should see the experience, not the system behind the experience.**

The Tourist should see:

```text
🏝️ Place
🍴 Food
🏨 Stay
🚗 Ride
```

The Tourist should NOT be presented with:

```text
Business Directory
Transport Management
Delivery Management
Business Categories
Administrative Records
System Modules
```

Those belong to the administrative and business-facing parts of TrackTour.

The Tourist Web App should remain **simple, visual, immersive, mobile-first, and TikTok-inspired in interaction**, while retaining TrackTour's own tourism branding and functionality.
