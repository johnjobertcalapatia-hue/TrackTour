# Frontend Architecture

## Overview

The TrackTour frontend is built with **React**, **TypeScript**, **Vite**, and **Tailwind CSS**. It delivers specialized experiences for four user personas: Tourists, Business Owners, Riders, and Bansud Tourism Administrators.

---

## Directory Structure & Component Organization

The frontend codebase is organized modularly under `frontend/src/`:

```text
frontend/src/
├── assets/                  # Static assets, branding, and icons
├── components/              # Shared UI components (Modals, Badges, Tables, Inputs)
├── contexts/                # React Context providers (AuthContext, CartContext, SocketContext)
├── hooks/                   # Custom lifecycle and connection hooks
│   ├── useCustomerMapSocket.ts   # Socket.IO client hook for live rider tracking
│   ├── useBusinessSocketNotifier.ts # Kitchen realtime notifier (business:{id} room)
│   ├── useUserSocketNotifier.ts  # Tourist order-status realtime notifier (user:{id} room)
│   └── useGeolocation.ts        # Browser Geolocation API wrapper
├── layouts/                 # App shells for Tourist, Merchant, Rider, and Admin
├── pages/                   # Route-level view components
│   ├── tourist/             # Discovery feed, restaurant menu, multi-cart, order tracking
│   ├── merchant/            # Business profile, menu editor, kitchen prep dashboard
│   ├── rider/               # Delivery radar, active order map, wallet, earnings
│   └── admin/               # Tourism spots, rider approvals, settlement reports
├── services/                # API client modules (Axios instances with auth interceptors)
│   ├── api.ts               # Base Axios client with Bearer token injection
│   └── socket.ts            # Socket.IO client instance and reconnection configs
└── types/                   # TypeScript interfaces and domain enums
```

---

## Persona Experiences

### 1. Tourist Experience
- **Discovery & Content Feed**: TikTok-style immersive visual discovery for Bansud tourism spots, resorts, and featured dishes.
- **Unified Multi-Restaurant Cart**:
  - Tourists can add items from multiple restaurants into a single cart.
  - Cart totals calculate item subtotals, standard/fast delivery fees, rider tips, and platform fees.
  - Checkout flows seamlessly into PayMongo (GCash / Card) or Cash on Delivery.
- **Live Order Tracking**:
  - Interactive Leaflet map displaying destination and assigned rider coordinates.
  - Dual-mode tracking via `useCustomerMapSocket`: live WebSockets with automatic fallback to 4-second HTTP polling.
  - Real-time order progress stepper (`waiting_restaurant` → `rider_assigned` → `preparing` → `picked_up` → `delivered`).

### 2. Business Owner (Merchant) Portal
- **Kitchen Preparation Dashboard**:
  - Incoming orders are displayed with live countdown timers.
  - **Hard Gate Enforcement**: The UI disables "Start Preparing" and "Mark Ready" buttons until a rider has accepted the order delivery.
  - Item-level rejection and partial availability toggles.
- **Financial & Settlement Reports**:
  - Live ledger of Cash on Delivery receivables (`cod_settlements`) showing 80% restaurant share.

### 3. Rider Interface
- **Dispatch Radar**:
  - Modal prompt when a delivery offer arrives, displaying restaurant pickup location, drop-off destination, fee, and tip.
  - 120-second circular countdown timer with sound notifications.
- **Active Trip Navigation**:
  - High-frequency GPS location streaming to Socket.IO.
  - Step-by-step state actions: "Arrived at Store", "Picked Up Order", "Arrived at Customer", "Delivered & Collected Cash".
- **Wallet & Payout Management**:
  - View total credits, reserved credits, and usable balance.
  - View earned commissions, tips, and request formal payout to GCash/Bank.

### 4. Admin / Tourism Office Dashboard
- Master oversight of active deliveries, municipal revenue share (20% platform share), and merchant listings.
- Review and approval workflow for rider payout requests.

---

## State Management & Real-Time Data Flow

- **Auth & Session**: `AuthContext` stores the authenticated user model and Sanctum Bearer token in secure storage, refreshing upon page load.
- **Cart Context**: LocalStorage-persisted cart state grouped by `business_id`, computing combined totals and dispatch options.
- **Real-Time Integration**:
  - Custom React hook `useCustomerMapSocket(deliveryId, token)` connects to `socket-server.js` (`:3001`).
  - Listens to `rider_location_stream` and `trip_completed` events.
  - If token expires or connection fails 5 times, it falls back to polling `GET /api/orders/{order}/status`.
