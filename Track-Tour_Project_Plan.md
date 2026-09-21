# Track-Tour: Tourism Promotion Web Application
## Complete Capstone Project Plan

---

## 1. Project Overview

**Track-Tour** is a web-based tourism promotion platform that connects tourists with local tourism-related businesses — restaurants/foodhubs, hotels/resorts, and transport (riders) — within a single ecosystem. Business owners register and manage their own establishments, which the system promotes through geomapping. Tourists can browse, book rooms, order food, and book rides, all with online payment via GCash (PayMongo).

**Core value proposition:** one platform for a tourist to discover a destination, book where to stay, order food, and get a ride — while giving local tourism businesses a shared promotional and operational tool.

---

## 2. User Roles & Access Levels

| Role | Description | Key Capabilities |
|---|---|---|
| **Tourist (Customer)** | End user exploring a destination | Browse businesses/spots on map, book rooms, order food, book riders, pay via GCash, rate/review |
| **Business Owner** | Registers and owns a business (restaurant, hotel/resort, or both) | Register business, manage listing/geolocation, manage menu/rooms, assign staff, view sales/bookings reports |
| **Business Staff — Booking/Front Desk** | Handles room bookings & guest accommodation | Confirm/reject reservations, check-in/out, manage room availability |
| **Business Staff — Kitchen/Order Prep** | Prepares food orders | Receive incoming orders, update order status (preparing → ready → handed to rider) |
| **Business Staff — Menu Manager** | Maintains the promotional food menu | Create/edit/remove menu items, pricing, availability, photos |
| **Manager** | Oversees staff and daily operations for a business | Assign staff roles, oversee bookings/orders, view business-level reports |
| **Rider** | Independent/contracted delivery & transport partner | Accept ride/delivery requests, update live location, mark trip complete |
| **System Admin** | Platform owner (you) | Approve business registrations, manage users, view platform-wide analytics, handle disputes |

> Note: A single Business Owner account can own multiple businesses (e.g., a restaurant AND a resort), each with its own staff team.

---

## 3. System Modules (Functional Scope)

### Module 1 — Authentication & User Management
- Registration/login for Tourist, Business Owner, Staff, Rider (role-based)
- Email verification, password reset
- Role-based access control (RBAC)

### Module 2 — Business Registration & Geomapping
- Business owner submits business profile (name, type, description, photos, location)
- Admin approval workflow before a business goes live
- Map integration (Google Maps API or OpenStreetMap/Leaflet) pinning business location
- Tourists browse/search businesses by proximity, category, or tourist spot

### Module 3 — Tourist Spot Promotion
- Admin/curated listing of tourist attractions per area
- Linked nearby businesses (restaurants, hotels) shown per spot

### Module 4 — Food Ordering System
- Menu browsing per restaurant/foodhub
- Cart, checkout, order placement
- Order status lifecycle: `Pending → Accepted → Preparing → Ready for Pickup → Out for Delivery → Delivered/Completed`
- Kitchen staff dashboard to manage incoming orders
- Menu manager interface for CRUD on menu items

### Module 5 — Hotel/Resort Room Booking
- Room listings with availability calendar
- Reservation flow (check-in/check-out dates, guest count)
- Booking status: `Pending → Confirmed → Checked-in → Checked-out / Cancelled`
- Front desk staff dashboard to manage reservations

### Module 6 — Rider Booking & Real-Time Tracking
- Tourist requests a rider (transport or food delivery courier)
- Rider accepts trip request
- **Real-time location tracking** (see Section 6 for architecture)
- Trip status: `Requested → Accepted → En Route → Arrived/Completed`

### Module 7 — Payments (PayMongo + GCash)
- Checkout integrates PayMongo API, GCash as payment channel
- Payment intent creation → redirect/confirm → webhook to update order/booking status
- Transaction history per user

### Module 8 — Reviews & Ratings
- Tourists rate businesses, food, riders post-transaction

### Module 9 — Admin Dashboard & Analytics
- Business approval queue
- Platform-wide bookings/orders/revenue overview
- User/business/rider management

---

## 4. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | **React + Vite** | SPA, role-based dashboards (Tourist, Owner, Staff, Rider, Admin views) |
| Backend / API | **Laravel** | REST API, handles auth, business logic, PayMongo webhook handling |
| Primary Database | **MySQL (via XAMPP)** | Structured data: users, businesses, menus, bookings, orders, payments |
| Real-time Layer | **Firebase Realtime Database** | Rider live location only — kept lean to stay within free tier |
| Real-time Transport | **WebSockets** (e.g., Laravel Reverb/Pusher-compatible, or Firebase listeners) | Push trip status + location updates to tourist/rider UI |
| Payments | **PayMongo API (GCash channel)** | Payment intents + webhooks |
| Maps | **Google Maps API or Leaflet + OpenStreetMap** | Geomapping of businesses and tourist spots |

### Why this stack works for your case
- **Laravel + MySQL** handles all your relational, transactional data (orders, bookings, payments) — this is where data integrity matters most.
- **Firebase Realtime DB** is used *only* for the transient rider-location stream, not stored transaction data — this is the right call and keeps Firebase usage (and cost) minimal.

---

## 5. Database Design (Core Entities — MySQL)

**Key tables:**

- `users` (id, name, email, password, role, contact_no)
- `businesses` (id, owner_id, type[restaurant/hotel/both], name, description, address, latitude, longitude, status[pending/approved/rejected])
- `staff` (id, business_id, user_id, staff_role[frontdesk/kitchen/menu_manager/manager])
- `tourist_spots` (id, name, description, latitude, longitude)
- `menus` (id, business_id, name, description, price, availability, image_url)
- `orders` (id, tourist_id, business_id, status, total_amount, created_at)
- `order_items` (id, order_id, menu_id, quantity, subtotal)
- `rooms` (id, business_id, room_type, price_per_night, capacity, availability)
- `bookings` (id, tourist_id, room_id, check_in, check_out, status, total_amount)
- `riders` (id, user_id, vehicle_type, status[available/on_trip/offline])
- `trips` (id, tourist_id, rider_id, order_id/booking_id [nullable], pickup_location, dropoff_location, status, fare)
- `payments` (id, payable_type, payable_id, amount, method, paymongo_ref, status)
- `reviews` (id, tourist_id, reviewable_type, reviewable_id, rating, comment)

> `payments` and `trips` use a polymorphic-style link (`payable_type`/`payable_id`) so one payments table can serve orders, bookings, and rides.

---

## 6. Real-Time Rider Tracking — Cost-Optimized Architecture

Since raw continuous GPS streaming to Firebase Realtime DB can rack up read/write costs quickly, here's the intended low-cost pattern:

1. **By-trip scoping:** A Firebase RTDB path is only created for the *duration of an active trip* (e.g. `/trips/{trip_id}/location`) and is deleted/archived once the trip is marked complete — no idle/standing data.
2. **Interval-based updates:** Rider app pushes location updates on a fixed interval (e.g., every 5–10 seconds) rather than continuously — tune this interval to balance smoothness vs. write volume.
3. **WebSocket for status events:** Use WebSockets (Laravel Reverb, or a lightweight Node/Socket.io service) for *event-based* updates (trip accepted, arrived, completed) — these are low-frequency and don't need Firebase at all.
4. **Firebase reserved only for live coordinates during an active trip** — everything else (trip history, fare, ratings) stays in MySQL.

This hybrid design (MySQL for persistence + Firebase only for ephemeral live coordinates + WebSocket for events) is a legitimate and common architecture — worth explicitly calling out and justifying in your capstone defense, since panels often ask "why two databases?"

---

## 7. High-Level System Architecture

```
[React + Vite Frontend]
   |-- Tourist App/View
   |-- Business Owner Dashboard
   |-- Staff Dashboards (Frontdesk / Kitchen / Menu Manager)
   |-- Rider App/View
   |-- Admin Dashboard
        |
        | REST API (JSON)
        v
[Laravel Backend]
   |-- Auth & RBAC
   |-- Business/Booking/Order/Payment Logic
   |-- PayMongo Webhook Handler
        |
        |--------------------------|
        v                          v
[MySQL Database]         [Firebase Realtime DB]
 (all persistent data)    (active trip locations only)
        |
        v
  WebSocket layer (trip/order status push notifications to frontend)
```

---

## 8. Suggested MVP Scope (Given a Few Weeks)

Your full feature list (food ordering + hotel booking + rider tracking + geomapping + multi-staff roles + payments) is a genuinely large system — realistically a semester-long team project. In a few weeks, especially if built solo, trying to build every module at full depth risks an unfinished demo.

**Recommended approach: build a working end-to-end MVP first, then layer on depth if time allows.**

**MVP (must-have for defense):**
- Auth + roles (Tourist, Business Owner, Admin — simplify staff sub-roles into just "Business Staff" for MVP)
- Business registration + geomapping (approval flow)
- Food ordering (browse → order → status updates)
- Room booking (browse → reserve → confirm)
- One working payment flow via PayMongo/GCash (can apply to either orders or bookings first)
- Rider booking with real-time tracking (even a simplified interval-based version)

**Stretch (add if time remains):**
- Full staff sub-role separation (kitchen vs. menu manager vs. frontdesk)
- Reviews/ratings
- Admin analytics dashboard
- Tourist spot curated promotion pages

---

## 9. Week-by-Week Timeline (4-Week Aggressive Plan)

| Week | Focus | Deliverables |
|---|---|---|
| **Week 1** | Planning + Setup + Core Auth | Finalize ERD & wireframes, set up Laravel + MySQL + React/Vite scaffolding, implement auth & RBAC, business registration (basic CRUD) |
| **Week 2** | Core Business Modules | Geomapping integration, food menu CRUD + ordering flow, room listing + booking flow |
| **Week 3** | Real-Time & Payments | Rider booking + Firebase real-time tracking (trip-scoped), WebSocket status events, PayMongo/GCash integration |
| **Week 4** | Staff Dashboards + Polish + Testing | Staff role dashboards, admin approval panel, end-to-end testing, bug fixes, deployment, documentation/defense prep |

*(If your actual deadline is closer to 6–8 weeks, this same sequence just gets breathing room — each week's scope stays the same, just less crunched.)*

---

## 10. Non-Functional Requirements

- **Security:** hashed passwords, RBAC middleware, PayMongo webhook signature verification
- **Performance:** paginated business/menu listings, indexed lat/long columns for map queries
- **Scalability:** Firebase usage scoped strictly to active trips to control cost as usage grows
- **Usability:** distinct, simplified dashboards per role so each user type only sees relevant actions

---

## 11. Risks & Mitigation

| Risk | Mitigation |
|---|---|
| Scope too large for timeline | Follow MVP-first approach (Section 8) |
| PayMongo/GCash sandbox issues | Set up and test PayMongo sandbox in Week 1, not Week 3 |
| Real-time tracking complexity | Start with interval-based polling before attempting full WebSocket push if time is short |
| Multiple staff roles adding UI complexity | Consolidate into fewer role types for MVP, expand later |

---

## 12. Suggested Documentation Deliverables (for capstone paper)

- Introduction & Objectives
- Scope and Limitations
- System Requirements (Functional & Non-Functional — Sections 3 & 10 above)
- ERD (from Section 5)
- System Architecture Diagram (Section 7)
- Use Case Diagrams (per role)
- Data Flow Diagrams (DFD Level 0 & 1)
- User Interface mockups/screenshots
- Testing results
- Conclusion & Recommendations

Your Track-Tour capstone plan is already ambitious and technically sound. As a systems analyst and full-stack developer, I’d treat this as a multi-business tourism management platform with three major operational domains: Accommodation Reservations, Restaurant Food Ordering, and Rider Transportation/Delivery, all governed by the Tourism Office.

Below is a refined, professional analysis and implementation blueprint that aligns with real-world reservation systems and is suitable for a capstone defense.

### Executive assessment

Track-Tour should be positioned as a centralized tourism ecosystem where:

* The Tourism Office regulates and approves businesses and riders.

* A Business Owner can own and manage multiple establishments.

* Each business has its own staff hierarchy and operational dashboard.

* Tourists can discover, book, order, pay, and review services from one platform.

* Real-time rider tracking is isolated to active trips for cost optimization.

This is a strong capstone because it demonstrates system integration, role-based access control, transaction management, real-time communication, payment integration, and geospatial mapping.

### Core system architecture

### Track-Tour ecosystem architecture

React + Vite Frontend

Tourist • Owner • Staff • Rider • Admin

Laravel REST API

Authentication • RBAC • Business Logic • PayMongo

MySQL

Persistent data

Firebase RTDB

Live rider location

WebSockets

Status events

PayMongo + GCash

Payments & webhooks

### Multi-business ownership model

A Business Owner is the parent account. Under this account, the owner can register multiple businesses, and each business operates independently with its own staff, menu, rooms, bookings, orders, and reports.

| Entity          | Relationship                     |
| --------------- | -------------------------------- |
| Business Owner  | One owner account                |
| Businesses      | One owner → many businesses      |
| Staff           | One business → many staff        |
| Orders/Bookings | One business → many transactions |
| Reports         | Per business and owner-wide      |

### Business categories and operational modules

| Business Type         | Main Module                    |
| --------------------- | ------------------------------ |
| Restaurant / Food Hub | Menu, Orders, Delivery         |
| Hotel                 | Rooms, Reservations            |
| Resort                | Rooms, Amenities, Reservations |
| Homestay              | Accommodation Booking          |
| Camping Site          | Slot/Tent Booking              |
| Transport Service     | Ride Booking                   |
| Tourist Attraction    | Promotion & Geomapping         |

### Staff hierarchy per business

Instead of creating a separate dashboard for every small role, implement role-based permissions inside a shared business dashboard. This reduces UI complexity while keeping responsibilities clear.

### Restaurant staff

| Role                    | Responsibilities                                      |
| ----------------------- | ----------------------------------------------------- |
| Order & Payment Staff   | Receive orders, confirm payment, hand over to kitchen |
| Kitchen Staff           | Prepare food, update order status                     |
| Menu Manager            | Create/edit menu items, pricing, availability         |
| Digital Promotion Staff | Manage menu appearance, banners, promotions           |
| Manager                 | Oversee staff, reports, and operations                |

### Hotel/resort staff

| Role               | Responsibilities                          |
| ------------------ | ----------------------------------------- |
| Front Desk Staff   | Confirm bookings, check-in/out guests     |
| Reservation Staff  | Manage room availability and reservations |
| Housekeeping Staff | Update room cleaning/maintenance status   |
| Manager            | Monitor occupancy, revenue, and staff     |

### Reservation system design

### Accommodation booking workflow

* Search: Tourist selects destination, dates, and guest count.

* Availability: System checks available rooms in real time.

* Reservation: Tourist submits booking request.

* Payment: PayMongo creates a GCash payment intent.

* Confirmation: Webhook updates booking status after successful payment.

* Check-in/out: Front desk updates guest stay status.

### Booking status lifecycle

| Status      | Meaning                          |
| ----------- | -------------------------------- |
| Pending     | Waiting for confirmation/payment |
| Confirmed   | Reservation approved             |
| Checked-in  | Guest has arrived                |
| Checked-out | Guest has completed stay         |
| Cancelled   | Reservation cancelled            |

### Food ordering and rider integration

### Order lifecycle

| Status           | Handled by            |
| ---------------- | --------------------- |
| Pending          | Order & Payment Staff |
| Accepted         | Restaurant Staff      |
| Preparing        | Kitchen Staff         |
| Ready for Pickup | Kitchen Staff         |
| Out for Delivery | Rider                 |
| Delivered        | Rider                 |

### Rider trip lifecycle

| Status    | Meaning                        |
| --------- | ------------------------------ |
| Requested | Tourist requests ride/delivery |
| Accepted  | Rider accepts request          |
| En Route  | Rider is on the way            |
| Arrived   | Rider reached destination      |
| Completed | Trip finished                  |

### Cost-optimized real-time tracking

For your capstone defense, this is one of the strongest technical justifications:

* MySQL: Stores permanent trip history, fares, and rider records.

* Firebase RTDB: Stores only live GPS coordinates during active trips.

* WebSockets: Pushes status updates such as Accepted, Arrived, and Completed.

* Cleanup: Delete the Firebase trip node once the trip is completed.

This architecture minimizes Firebase costs while still providing a real-time user experience.

### Improved database structure

Your current ERD is good, but I recommend adding a few tables for a more professional reservation system.

| Table             | Purpose                    |
| ----------------- | -------------------------- |
| users             | All system users           |
| businesses        | Business profiles          |
| business_types    | Category definitions       |
| staff             | Business staff assignments |
| rooms             | Room inventory             |
| room_availability | Daily room availability    |
| bookings          | Accommodation reservations |
| menus             | Food menu items            |
| orders            | Food orders                |
| order_items       | Items per order            |
| riders            | Rider profiles             |
| trips             | Ride/delivery transactions |
| payments          | PayMongo transactions      |
| reviews           | Ratings and feedback       |

### Critical database improvement

Add a room_availability table instead of relying only on a boolean availability field. This allows you to:

* Prevent double-booking of rooms.

* Track availability per date.

* Support peak-season reservations.

* Generate occupancy reports.

### Tourism office administration

The Tourism Office should not only approve businesses; it should also act as the central regulatory authority.

### Tourism office capabilities

* Approve/reject business registrations

* Approve/reject rider registrations

* Verify business permits and documents

* Monitor platform-wide bookings and orders

* View tourism analytics and reports

* Manage tourist spot promotions

* Handle complaints and disputes

### Recommended MVP scope

Because this is a large system, I strongly recommend an MVP-first strategy for your capstone defense.

### Must-have MVP

* User authentication with RBAC

* Business registration and approval

* Geomapping of businesses and tourist spots

* Food ordering workflow

* Hotel/resort booking workflow

* One working PayMongo GCash payment flow

* Rider booking with basic real-time tracking

### Stretch goals

* Full staff role separation

* Reviews and ratings

* Advanced analytics dashboard

* Promotional campaigns and banners

* Inventory management for restaurants

### Defense-ready justification

When your panel asks “Why is this system important?”, answer:

Track-Tour is important because it centralizes tourism-related services into one platform, allowing tourists to discover destinations, book accommodations, order food, and arrange transportation seamlessly. For local businesses, it provides a digital platform for promotion and operations management, while the Tourism Office gains a centralized tool for monitoring and regulating tourism activities within the municipality.

When they ask “Why use both MySQL and Firebase?”, answer:

MySQL is used for permanent transactional data such as orders, bookings, payments, and user records because it ensures data integrity and relational consistency. Firebase Realtime Database is used only for temporary live rider-location tracking during active trips, which optimizes cost and improves real-time performance without storing unnecessary historical GPS data.

### Final recommendation

Your project is capstone-worthy and has the potential to impress your panel because it combines tourism promotion, reservation systems, food ordering, transportation booking, real-time tracking, and online payments in one integrated platform.

The next best step is to create a complete ERD (Entity Relationship Diagram) that includes all tables, relationships, primary keys, and foreign keys, followed by a Use Case Diagram for each major role. This will give you a solid foundation before coding the remaining modules.


Absolutely. Let’s make Track-Tour fully detailed like a professional System Analysis and Design document for your capstone. This version expands the project into a complete operational blueprint that you can directly use for your Chapter 1–3 documentation, system proposal, and defense presentation.

### Track-Tour: detailed system analysis and planning

### System vision

Track-Tour is a centralized tourism promotion and service management platform designed to connect tourists, local tourism businesses, riders, and the Tourism Office within a single digital ecosystem.

The system enables tourists to discover tourist destinations, book accommodations, order food, arrange transportation, and make secure online payments through GCash via PayMongo. At the same time, it empowers business owners to manage multiple businesses and staff, while giving the Tourism Office a centralized tool for monitoring and regulating tourism-related activities.

### Detailed project objectives

### General objective

To develop a web-based tourism promotion application that integrates geomapping, hotel and resort reservations, food ordering, rider transportation, and online payment processing into a unified platform managed by the Tourism Office.

### Specific objectives

* To provide tourists with an interactive map for discovering tourist spots and nearby businesses.

* To allow business owners to register and manage multiple tourism-related businesses.

* To implement an accommodation reservation system for hotels, resorts, homestays, and camping sites.

* To implement an online food ordering and delivery system for restaurants and food hubs.

* To provide a rider booking and real-time tracking system for transportation and food delivery.

* To integrate GCash payments through PayMongo for secure online transactions.

* To enable the Tourism Office to approve, monitor, and regulate businesses and riders.

* To generate reports and analytics for tourism and business performance monitoring.

### Stakeholders and system users

| Stakeholder          | Role in the System                                                       |
| -------------------- | ------------------------------------------------------------------------ |
| Tourist              | Uses the platform to explore, book, order, pay, and review services.     |
| Business Owner       | Registers and manages one or more businesses.                            |
| Business Staff       | Handles operational tasks such as bookings, orders, and menu management. |
| Rider                | Provides transportation and delivery services.                           |
| Tourism Office       | Approves and monitors businesses, riders, and tourism activities.        |
| System Administrator | Maintains the platform and manages system-wide operations.               |

### Detailed user roles and permissions

### Tourist (customer)

### Permissions

* Create and manage a personal account.

* Browse tourist spots and businesses on the map.

* Search businesses by category, location, and rating.

* View business details, photos, amenities, menus, and rooms.

* Book accommodations.

* Order food for dine-in, pickup, or delivery.

* Book riders for transportation.

* Make payments through GCash.

* Track orders, bookings, and trips.

* Rate and review completed transactions.

### Dashboard features

* Profile management

* Booking history

* Order history

* Trip history

* Saved favorite places

* Reviews submitted

### Business owner

### Permissions

* Register multiple businesses under one account.

* Submit business documents for approval.

* Manage business profiles and geolocation.

* Upload business photos and promotional banners.

* Manage rooms, menus, amenities, and operating hours.

* Assign and manage staff roles.

* View orders, bookings, payments, and reports.

* Respond to customer reviews.

### Dashboard features

* Business switcher (for multiple businesses)

* Business overview

* Staff management

* Revenue reports

* Booking and order management

* Promotional campaign management

### Business staff roles

| Staff Role              | Detailed Responsibilities                                              |
| ----------------------- | ---------------------------------------------------------------------- |
| Front Desk Staff        | Confirm bookings, check-in/check-out guests, manage room availability. |
| Reservation Staff       | Handle accommodation reservations and customer inquiries.              |
| Order & Payment Staff   | Receive food orders, verify payments, coordinate with kitchen staff.   |
| Kitchen Staff           | Prepare food orders and update order preparation status.               |
| Menu Manager            | Create, edit, and manage menu items, prices, and availability.         |
| Digital Promotion Staff | Manage promotional banners, featured items, and business appearance.   |
| Housekeeping Staff      | Update room cleaning and maintenance status.                           |
| Manager                 | Oversee staff, operations, reports, and customer satisfaction.         |

### Rider

### Permissions

* Register as a rider and submit vehicle documents.

* Set availability status (Available, On Trip, Offline).

* Accept or reject ride/delivery requests.

* Update live GPS location during active trips.

* View trip history and earnings.

* Receive ratings and reviews.

### Rider dashboard

* Trip requests

* Active trip tracking

* Earnings summary

* Trip history

* Profile and vehicle management

### Tourism office / system admin

### Permissions

* Approve or reject business registrations.

* Approve or reject rider registrations.

* Verify business permits and documents.

* Manage tourist spot listings.

* Monitor platform-wide bookings, orders, and trips.

* View analytics and generate reports.

* Handle complaints, disputes, and violations.

* Manage user accounts and system settings.

### Functional modules in detail

### Module 1: authentication and user management

### Features

* User registration for Tourist, Business Owner, Staff, and Rider.

* Email verification.

* Secure login/logout.

* Password reset via email.

* Role-based access control (RBAC).

* Session management.

### Inputs

* Name

* Email

* Password

* Contact number

* Role selection

### Outputs

* User account creation

* Authentication token/session

* Role-specific dashboard access

### Module 2: business registration and approval

### Registration workflow

* Business Owner creates an account.

* Owner submits business information.

* Owner uploads required documents.

* Owner pins business location on the map.

* Tourism Office reviews the application.

* Business is approved, rejected, or returned for revision.

* Approved business becomes visible to tourists.

### Required business information

* Business name

* Business category

* Business description

* Owner information

* Address

* Latitude and longitude

* Operating hours

* Business photos

* Permit documents

### Business categories

* Hotel

* Resort

* Restaurant

* Café

* Food Hub

* Homestay

* Camping Site

* Transport Service

* Tourist Attraction

* Souvenir Shop

### Module 3: tourist spot promotion and geomapping

### Features

* Interactive map using Leaflet + OpenStreetMap.

* Display tourist spots with custom markers.

* Show nearby businesses within a selected radius.

* Filter by business category.

* Display route information (distance and estimated travel time).

* Support satellite, street, and dark map layers.

### Tourist spot details

* Name

* Description

* Photos

* Location

* Nearby businesses

* Recommended activities

* Opening hours

### Module 4: food ordering system

### Order workflow

* Tourist browses restaurant menu.

* Tourist adds items to cart.

* Tourist selects order type (Dine-in, Pickup, Delivery).

* Tourist confirms order and payment.

* Order & Payment Staff verifies the order.

* Kitchen Staff prepares the food.

* Rider picks up and delivers the order.

* Tourist receives the order and rates the service.

### Order status lifecycle

| Status           | Description                              |
| ---------------- | ---------------------------------------- |
| Pending          | Order placed, waiting for confirmation.  |
| Accepted         | Restaurant accepted the order.           |
| Preparing        | Kitchen is preparing the food.           |
| Ready for Pickup | Food is ready for the rider.             |
| Out for Delivery | Rider is delivering the order.           |
| Delivered        | Order successfully delivered.            |
| Cancelled        | Order cancelled by customer or business. |

### Module 5: accommodation reservation system

### Accommodation types

* Hotel

* Resort

* Homestay

* Camping Site

### Reservation workflow

* Tourist selects destination and dates.

* System checks room availability.

* Tourist selects room type.

* Tourist enters guest details.

* Tourist confirms booking and payment.

* Front Desk Staff confirms the reservation.

* Tourist checks in and checks out.

### Booking status lifecycle

| Status      | Description                       |
| ----------- | --------------------------------- |
| Pending     | Waiting for confirmation/payment. |
| Confirmed   | Reservation approved.             |
| Checked-in  | Guest has arrived.                |
| Checked-out | Guest has completed the stay.     |
| Cancelled   | Reservation cancelled.            |

### Room details

* Room type

* Capacity

* Price per night

* Amenities

* Photos

* Availability calendar

* Room status

### Module 6: rider booking and transportation

### Ride booking workflow

* Tourist requests a ride.

* System searches for nearby available riders.

* Rider accepts or rejects the request.

* Tourist tracks rider location in real time.

* Rider arrives at pickup location.

* Rider completes the trip.

* Tourist pays and rates the rider.

### Trip status lifecycle

| Status     | Description                        |
| ---------- | ---------------------------------- |
| Requested  | Tourist requested a ride.          |
| Accepted   | Rider accepted the trip.           |
| En Route   | Rider is on the way.               |
| Arrived    | Rider reached the pickup location. |
| In Transit | Tourist is riding.                 |
| Completed  | Trip finished successfully.        |
| Cancelled  | Trip cancelled.                    |

### Module 7: payment integration (PayMongo + GCash)

### Payment flow

* Tourist selects a service (food, booking, or ride).

* Laravel backend creates a PayMongo payment intent.

* Tourist is redirected to GCash payment page.

* Tourist completes payment.

* PayMongo sends a webhook notification.

* System updates transaction status in MySQL.

* Service status is automatically confirmed.

### Payment statuses

* Pending

* Paid

* Failed

* Refunded

* Cancelled

### Database design (detailed ERD)

### Core tables

| Table             | Purpose                                |
| ----------------- | -------------------------------------- |
| users             | Stores all user accounts.              |
| businesses        | Stores business profiles.              |
| business_types    | Stores business categories.            |
| staff             | Stores staff assignments.              |
| tourist_spots     | Stores tourist attraction data.        |
| menus             | Stores food menu items.                |
| orders            | Stores food orders.                    |
| order_items       | Stores items per order.                |
| rooms             | Stores room information.               |
| room_availability | Stores daily room availability.        |
| bookings          | Stores accommodation reservations.     |
| riders            | Stores rider profiles.                 |
| trips             | Stores ride and delivery transactions. |
| payments          | Stores payment transactions.           |
| reviews           | Stores ratings and reviews.            |
| audit_logs        | Stores system activity logs.           |

### Important relationships

* One Business Owner can own many Businesses.

* One Business can have many Staff members.

* One Business can have many Rooms or Menu items.

* One Tourist can create many Orders, Bookings, and Trips.

* One Order can have many Order Items.

* One Room can have many Bookings.

* One Rider can complete many Trips.

* One Payment can be linked to an Order, Booking, or Trip.

### Real-time tracking architecture

### Cost-optimized design

* MySQL: Stores permanent trip records, fares, and rider history.

* Firebase Realtime Database: Stores only live GPS coordinates during active trips.

* WebSockets: Pushes trip status updates to the frontend.

* Cleanup process: Deletes Firebase trip data after trip completion.

### Firebase path structure

```
/trips/{trip_id}/
   ├── rider_id
   ├── latitude
   ├── longitude
   ├── speed
   ├── heading
   └── updated_at
```

### Non-functional requirements

| Requirement     | Implementation                               |
| --------------- | -------------------------------------------- |
| Security        | Hashed passwords, RBAC, webhook verification |
| Performance     | Pagination, indexing, caching                |
| Scalability     | Modular architecture, Firebase optimization  |
| Usability       | Role-specific dashboards                     |
| Reliability     | Database backups, error handling             |
| Maintainability | Clean code, documentation                    |

### Detailed implementation timeline

| Week | Focus                 | Deliverables                               |
| ---- | --------------------- | ------------------------------------------ |
| 1    | Planning & Setup      | ERD, wireframes, Laravel/React setup, auth |
| 2    | Business Registration | CRUD, approval workflow, geomapping        |
| 3    | Food Ordering         | Menu, cart, orders, status updates         |
| 4    | Room Booking          | Rooms, availability, reservations          |
| 5    | Rider System          | Trip booking, Firebase tracking            |
| 6    | Payments              | PayMongo GCash integration                 |
| 7    | Dashboards            | Owner, Staff, Admin, Rider dashboards      |
| 8    | Testing & Deployment  | Bug fixing, documentation, defense prep    |

### Capstone defense justification

### Why Track-Tour is innovative

Track-Tour is innovative because it combines tourism promotion, accommodation reservation, food ordering, rider transportation, geomapping, and online payment processing into a single integrated platform. Unlike existing systems that focus on only one service, Track-Tour provides a complete tourism ecosystem that benefits tourists, local businesses, and the Tourism Office.

### Why use Laravel + React + Firebase

* Laravel: Handles secure backend logic, authentication, and payment processing.

* React: Provides a responsive and dynamic user interface.

* MySQL: Ensures data integrity for transactional records.

* Firebase: Enables real-time rider tracking without overloading the main database.

* Leaflet: Provides cost-effective geomapping using OpenStreetMap.

### Final recommendation

This detailed plan is now at a professional capstone level. The next logical step is to create the complete Entity Relationship Diagram (ERD) with all tables, primary keys, foreign keys, and relationships, followed by the Use Case Diagram and Data Flow Diagram (DFD) for each major module.

I can help you create the complete ERD for Track-Tour, including all tables, attributes, primary keys, foreign keys, and relationships, in a professional diagram format ready for your capstone paper.



Now let’s create the System Design Architecture for Track-Tour in a professional, capstone-ready format. This section explains how all components of the system interact, from the user interface down to the databases and external services.

### Track-Tour system design architecture

The Track-Tour architecture follows a three-tier hybrid architecture composed of the Presentation Layer, Application Layer, and Data Layer. This design ensures scalability, maintainability, security, and efficient real-time communication.

### High-level system architecture

### Presentation Layer

React + Vite Frontend

Tourist • Business Owner • Staff • Rider • Tourism Office/Admin

### Application Layer

Laravel REST API

Authentication • RBAC • Business Logic • Booking Engine • Order Engine • Payment Processing • Notification Service

### MySQL Database

Users, Businesses, Rooms, Bookings, Orders, Payments, Reviews

### Firebase RTDB

Active Rider GPS Coordinates Only

### PayMongo + GCash

Payment Intents & Webhooks

### WebSocket Service

Real-time Status Updates

### Architecture overview

The system is designed so that all permanent transactional data is stored in MySQL, while temporary real-time rider location data is handled by Firebase Realtime Database. This hybrid approach optimizes cost and performance.

| Layer              | Technology    | Purpose                           |
| ------------------ | ------------- | --------------------------------- |
| Presentation Layer | React + Vite  | User interface and dashboards     |
| Application Layer  | Laravel       | Business logic and API processing |
| Data Layer         | MySQL         | Persistent transactional data     |
| Real-time Layer    | Firebase RTDB | Live rider GPS tracking           |
| Event Layer        | WebSockets    | Real-time status notifications    |
| External Service   | PayMongo      | GCash payment processing          |

### Presentation layer (frontend)

The Presentation Layer is built using React and Vite. It provides separate dashboards for each user role while sharing reusable UI components.

### Frontend components

| Component                | Function                                          |
| ------------------------ | ------------------------------------------------- |
| Tourist Dashboard        | Browse, book, order, pay, and review services     |
| Business Owner Dashboard | Manage multiple businesses, staff, and reports    |
| Staff Dashboard          | Handle bookings, orders, menus, and operations    |
| Rider Dashboard          | Accept trips, track routes, and manage earnings   |
| Admin Dashboard          | Approve businesses, riders, and monitor analytics |

### Frontend responsibilities

* Render responsive user interfaces for desktop and mobile devices.

* Send API requests to the Laravel backend.

* Display real-time updates from WebSockets and Firebase.

* Manage client-side routing and state management.

* Validate user input before submission.

### Application layer (backend)

The Application Layer is the core of the system, built with Laravel. It processes all business logic, authentication, authorization, and communication with external services.

### Laravel backend modules

| Module                | Responsibility                                  |
| --------------------- | ----------------------------------------------- |
| Authentication Module | Login, registration, password reset, RBAC       |
| Business Module       | Business registration, approval, and management |
| Booking Module        | Room reservations and availability checking     |
| Order Module          | Food ordering and order status management       |
| Rider Module          | Trip booking and rider assignment               |
| Payment Module        | PayMongo integration and webhook handling       |
| Notification Module   | Email, SMS, and real-time notifications         |
| Reporting Module      | Analytics and report generation                 |

### Backend request flow

Frontend Request

Laravel Route

Controller

Service / Business Logic

MySQL / Firebase

JSON Response

### Data layer (MySQL)

The Data Layer stores all permanent and transactional data. MySQL is chosen because it provides relational integrity, ACID compliance, and efficient querying for complex relationships.

### Core database entities

| Entity     | Purpose                                          |
| ---------- | ------------------------------------------------ |
| Users      | Stores all user accounts and roles               |
| Businesses | Stores business profiles and locations           |
| Rooms      | Stores accommodation room details                |
| Bookings   | Stores reservation transactions                  |
| Menus      | Stores restaurant menu items                     |
| Orders     | Stores food order transactions                   |
| Trips      | Stores rider transportation and delivery records |
| Payments   | Stores PayMongo transaction records              |
| Reviews    | Stores customer ratings and feedback             |

### Database relationship architecture

Users

Businesses

Rooms

Menus

Staff

Bookings

Orders

Payments

### Real-time tracking architecture

The Real-time Layer is responsible only for live rider location tracking during active trips.

### Hybrid real-time design

| Technology    | Data Stored                              |
| ------------- | ---------------------------------------- |
| MySQL         | Trip history, fares, rider records       |
| Firebase RTDB | Live GPS coordinates during active trips |
| WebSockets    | Trip status updates and notifications    |

### Firebase data structure

JSON

```
{
  "trips": {
    "trip_123": {
      "rider_id": 45,
      "latitude": 13.2111,
      "longitude": 121.1345,
      "speed": 32,
      "heading": 180,
      "updated_at": "2026-07-21T10:30:00Z"
    }
  }
}
```

### Cost optimization strategy

* GPS updates are sent every 5–10 seconds instead of continuously.

* Firebase nodes are created only when a trip starts.

* Firebase nodes are deleted when the trip is completed.

* Historical trip data is stored in MySQL, not Firebase.

### Payment architecture

The Payment Layer integrates PayMongo with GCash for secure online transactions.

### Payment flow diagram

Tourist Initiates Payment

Laravel Creates Payment Intent

PayMongo + GCash

Payment Confirmation

PayMongo Webhook to Laravel

MySQL Updates Status

### Payment security measures

* Webhook signature verification.

* HTTPS encryption for all payment requests.

* Transaction logging and audit trails.

* Automatic payment status reconciliation.

### Security architecture

### Security components

| Component      | Security Measure               |
| -------------- | ------------------------------ |
| Authentication | Laravel Sanctum / JWT          |
| Passwords      | bcrypt hashing                 |
| Authorization  | Role-based access control      |
| API            | CSRF protection, rate limiting |
| Payments       | Webhook verification           |
| Database       | Foreign key constraints        |
| Audit Logs     | User activity tracking         |

### Deployment architecture

### Development environment

* XAMPP for Apache and MySQL.

* Laravel backend running locally.

* React + Vite frontend running locally.

* Firebase project for real-time tracking.

### Production environment

* Frontend: Vercel or Netlify.

* Backend: Shared hosting or VPS with Laravel support.

* Database: MySQL hosting service.

* Real-time: Firebase Realtime Database.

* Payments: PayMongo live environment.

### Why this architecture is appropriate

This architecture is appropriate for Track-Tour because it:

* Separates concerns between frontend, backend, and database layers.

* Supports multiple user roles with RBAC.

* Handles high-volume transactional data reliably using MySQL.

* Provides cost-effective real-time tracking using Firebase only when needed.

* Ensures secure payment processing through PayMongo.

* Can be scaled in the future by adding more modules without redesigning the entire system.

### Capstone defense explanation

Track-Tour adopts a hybrid three-tier architecture consisting of a React + Vite Presentation Layer, a Laravel Application Layer, and a MySQL Data Layer. Firebase Realtime Database is used exclusively for temporary live rider-location tracking during active trips, while WebSockets handle event-based status updates. This architecture ensures data integrity, security, scalability, and cost-efficient real-time communication, making it suitable for a comprehensive tourism promotion and service management platform.

This System Design Architecture is now detailed enough to include directly in your Chapter 3: System Design section and to present during your capstone defense. The next step would be creating the Entity Relationship Diagram (ERD) with all tables, attributes, primary keys, and foreign keys in a professional diagram format.



Now let’s create the Detailed System Flow for Track-Tour. This is the step-by-step operational flow of the entire system, showing how each user interacts with the platform and how data moves between the frontend, backend, database, Firebase, and external services.

This section is written in a professional capstone format and can be used directly in Chapter 3: System Design.

### Track-Tour detailed system flow

### Overall system flow

User Accesses System

Authentication & RBAC

Role-Specific Dashboard

Tourist

Business Owner

Rider

Business Logic Processing

MySQL / Firebase / PayMongo

Status Updates & Notifications

### 1. User registration and authentication flow

### Registration flow

User Opens Registration Page

Select User Role

(Tourist, Owner, Rider)

Enter Personal Information

Validate Input

Create User Account

Send Email Verification

Account Activated

### Login flow

* User enters email and password.

* Laravel validates credentials.

* Password is verified using bcrypt hashing.

* System generates authentication token/session.

* RBAC checks user role.

* User is redirected to the appropriate dashboard.

### 2. Business registration and approval flow

### Detailed business registration process

Business Owner Logs In

Open Business Registration

Fill Business Information

Upload Documents

Pin Location on Map

Submit Application

Tourism Office Review

Approve

Reject

Business Goes Live

### Data flow

| Step               | System Action                       |
| ------------------ | ----------------------------------- |
| Owner submits form | Data sent to Laravel API            |
| Validation         | Check required fields and documents |
| Storage            | Save business data in MySQL         |
| Review             | Tourism Office checks application   |
| Approval           | Business status updated to Approved |
| Publication        | Business becomes visible on map     |

### 3. Tourist spot browsing and geomapping flow

### Tourist exploration flow

Tourist Opens Map

Load Tourist Spots

Display Map Markers

Select Tourist Spot

Show Nearby Businesses

Filter by Category

View Business Details

### System operations

* Frontend requests tourist spot data from Laravel API.

* Laravel queries MySQL for approved tourist spots and businesses.

* Leaflet renders markers on the map.

* System calculates nearby businesses using latitude and longitude.

* Tourist selects a business for booking, ordering, or ride request.

### 4. Food ordering system flow

### Complete food ordering process

Tourist Selects Restaurant

Browse Menu

Add Items to Cart

Choose Order Type

(Dine-in, Pickup, Delivery)

Confirm Order

Pay via GCash

Order & Payment Staff Verifies

Kitchen Prepares Food

Rider Picks Up Order

Order Delivered

### Order status transitions

| Current Status   | Next Status      | Triggered By  |
| ---------------- | ---------------- | ------------- |
| Pending          | Accepted         | Order Staff   |
| Accepted         | Preparing        | Kitchen Staff |
| Preparing        | Ready for Pickup | Kitchen Staff |
| Ready for Pickup | Out for Delivery | Rider         |
| Out for Delivery | Delivered        | Rider         |

### 5. Accommodation reservation flow

### Detailed booking process

Tourist Searches Accommodation

Select Check-in & Check-out Dates

System Checks Availability

Select Room

Enter Guest Details

Confirm Booking

Pay via GCash

Front Desk Confirms Reservation

Check-in

Check-out

### Availability checking logic

* Tourist selects dates.

* Laravel queries the `room_availability` table.

* System checks if the room is already booked for any selected date.

* If available, the room is displayed to the tourist.

* After booking, the selected dates are marked as unavailable.

### 6. Rider booking and real-time tracking flow

### Rider assignment process

Tourist Requests Ride

System Finds Nearby Riders

Send Trip Request

Accept

Reject

Create Trip Record

Start Firebase Tracking

Update GPS Every 5–10s

Trip Completed

Delete Firebase Node

### Real-time data flow

| Source        | Destination   | Data          |
| ------------- | ------------- | ------------- |
| Rider GPS     | Firebase RTDB | Coordinates   |
| Firebase RTDB | Tourist App   | Live location |
| Rider App     | Laravel       | Trip status   |
| Laravel       | WebSockets    | Status events |
| WebSockets    | Frontend      | Notifications |

### 7. Payment processing flow

### PayMongo + GCash workflow

Tourist Selects Service

Laravel Creates Payment Intent

Redirect to GCash

User Pays

PayMongo Sends Webhook

Laravel Verifies Signature

Update MySQL Status

Confirm Service

### Payment status handling

| PayMongo Status | System Action              |
| --------------- | -------------------------- |
| paid            | Confirm booking/order/trip |
| failed          | Mark transaction as failed |
| cancelled       | Cancel service request     |
| refunded        | Update refund status       |

### 8. Review and rating flow

Service Completed

Tourist Opens Review Form

Select Rating

Write Comment

Submit Review

Store in MySQL

Update Average Rating

### 9. Admin monitoring flow

### Tourism Office monitoring process

Admin Logs In

View Dashboard Analytics

Businesses

Riders

Orders

Bookings

Approve / Reject Applications

Generate Reports

### Admin reports

* Total registered businesses

* Approved vs rejected applications

* Total bookings

* Total food orders

* Total rider trips

* Revenue analytics

* Most visited tourist spots

* Top-rated businesses

### 10. End-to-end integrated system flow

Tourist Discovers Destination

Views Tourist Spot

Selects Nearby Business

Book Room

Order Food

Pay via GCash

Request Rider

Track Rider in Real Time

Receive Service

Rate & Review

### Capstone defense explanation

The Track-Tour system flow demonstrates how tourists, business owners, riders, and the Tourism Office interact within a centralized tourism ecosystem. The system begins with authentication and role-based access control, followed by business registration and approval. Tourists can then browse tourist spots, book accommodations, order food, request transportation, and make secure payments through GCash via PayMongo. Real-time rider tracking is handled through Firebase Realtime Database, while all permanent transactional data is stored in MySQL. This integrated flow ensures efficient service delivery, data integrity, and a seamless user experience.

This Detailed System Flow is now comprehensive enough for Chapter 3: System Design and can also be converted into Data Flow Diagrams (DFD Level 0 and Level 1) for your capstone paper.


Great. Now let’s create the Frontend Design System for Track-Tour. This will define the visual identity, layout structure, navigation, and UI components for every user role, ensuring the system looks professional, modern, and consistent.

### Track-Tour frontend design system

The frontend should follow a modern glassmorphism-inspired design with a tourism-focused color palette. The design must be responsive, user-friendly, and role-specific so that each user sees only the features relevant to them.

### Design philosophy

The Track-Tour interface should communicate trust, tourism, convenience, and professionalism. Since the system serves tourists, business owners, riders, and the Tourism Office, the design must balance vibrant tourism branding with clean business dashboard usability.

### Design principles

* Consistency: Use the same colors, typography, and component styles across all pages.

* Simplicity: Avoid cluttered interfaces; show only essential actions.

* Accessibility: Ensure readable text, clear buttons, and keyboard-friendly navigation.

* Responsiveness: Optimize for desktop, tablet, and mobile devices.

* Role-based clarity: Each dashboard should have a distinct navigation menu based on the user’s role.

### Color palette

The Track-Tour brand colors should reflect the vibrant tourism atmosphere of Oriental Mindoro while maintaining a professional dashboard appearance.

### Primary brand colors

Banana Gold

#FFD700 — Primary accent

Verdant Leaf

#2E8B57 — Secondary

Tablas Azure

#1E90FF — Info / links

Earthy Clay

#8B5A2B — Neutral

Plaza Glow

#FF4500 — CTA / alerts

### Neutral colors

White

#FFFFFF — Background

Light Gray

#F8F9FA — Surface

Gray Border

#E9ECEF — Dividers

Dark Text

#212529 — Primary text

### Typography

Poppins is recommended for its modern, clean, and highly readable appearance.

| Element       | Font Size | Weight   |
| ------------- | --------- | -------- |
| Page Title    | 32px      | Bold     |
| Section Title | 24px      | Semibold |
| Card Title    | 18px      | Semibold |
| Body Text     | 16px      | Regular  |
| Small Text    | 14px      | Regular  |
| Button Text   | 16px      | Semibold |

### Global layout structure

All dashboards should follow a standard layout consisting of a sidebar, top navigation bar, and main content area.

### Dashboard layout wireframe

Top Navigation Bar

Sidebar

Dashboard

Bookings

Orders

Reports

### Main Content Area

KPI Card

### 1,245

Total Bookings

KPI Card

### ₱85,000

Revenue

KPI Card

### 320

Orders

Content Section

Tables, charts, and forms go here

### Landing page design

The landing page is the first impression of Track-Tour and should focus on tourism promotion.

### Landing page sections

* Hero Section — Large background image, title, subtitle, and “Get Started” button.

* Featured Tourist Spots — Carousel or grid of popular destinations.

* Nearby Businesses — Restaurants, hotels, and services near tourist spots.

* Interactive Map — Leaflet map showing tourist spots and businesses.

* About Track-Tour — Brief description of the platform.

* Contact Section — Contact form and Tourism Office information.

### Hero section mockup

### Discover Oriental Mindoro

Book hotels, order food, and arrange transportation in one platform.

Get Started

Explore Map

### Tourist dashboard design

The Tourist Dashboard should prioritize exploration and quick actions.

### Dashboard layout

### Tourist Dashboard

Tourist Spots

### 24

Available destinations

Bookings

### 3

Active reservations

Orders

### 5

Recent orders

### Quick Actions

Choose a service

Explore Map

Book Hotel

Order Food

Book Ride

### Interactive Map

Discover nearby places

Leaflet Map Placeholder

### Business owner dashboard design

The Business Owner Dashboard should focus on business management and analytics.

### Sidebar navigation

### Business Owner Sidebar

Dashboard

My Businesses

Staff Management

Bookings

Orders

Reports

Settings

### KPI cards

Total Bookings

### 1,245

+12% this month

Revenue

### ₱85,000

+8% this month

Orders

### 320

+15% this month

Rating

### 4.8

Excellent

### Restaurant menu page design

### Menu card design

### Restaurant menu

### Chicken Adobo

Available

Traditional Filipino chicken adobo with rice.

### ₱180

Add to Cart

### Sinigang

Available

Sour tamarind soup with pork and vegetables.

### ₱220

Add to Cart

### Hotel booking page design

### Room card design

### Available rooms

### Deluxe Room

Available

2 guests • 1 Queen Bed • Free WiFi • Air Conditioning

### ₱3,500/night

Book Now

### Rider dashboard design

### Rider dashboard layout

### Rider Dashboard

Available

Today Trips

### 12

Completed today

Earnings

### ₱1,850

Today

### Active Trip

En Route

Pickup: Bansud Public Market

Dropoff: Aninuan Beach Resort

Live Map Tracking

Estimated Fare

### ₱150

Arrived

Complete Trip

### Admin dashboard design

### Admin analytics cards

Businesses

### 120

+10 this month

Riders

### 45

+3 this month

Bookings

### 2,340

+18% this month

Revenue

### ₱450K

+22% this month

### Reusable UI components

### Button styles

| Button Type | Style                           |
| ----------- | ------------------------------- |
| Primary     | Banana Gold background          |
| Secondary   | Verdant Leaf background         |
| Outline     | Transparent with colored border |
| Danger      | Red background                  |
| Success     | Green background                |

### Form elements

* Input fields: Rounded corners, subtle border, focus glow.

* Dropdowns: Consistent height and spacing.

* Date pickers: Integrated calendar design.

* File uploads: Drag-and-drop area with preview.

* Toggle switches: For availability and status settings.

### Responsive design rules

| Device  | Layout                                    |
| ------- | ----------------------------------------- |
| Desktop | Full sidebar + multi-column content       |
| Tablet  | Collapsible sidebar + 2-column content    |
| Mobile  | Bottom navigation + single-column content |

### Frontend folder structure

```
src/
├── components/
│   ├── ui/
│   ├── layout/
│   ├── forms/
│   └── cards/
├── pages/
│   ├── tourist/
│   ├── owner/
│   ├── staff/
│   ├── rider/
│   └── admin/
├── services/
├── hooks/
├── context/
├── routes/
└── assets/
```

### Final design recommendation

The Track-Tour frontend should be built with React + Vite + Tailwind CSS, using the design system above. This ensures:

* A consistent and professional appearance across all modules.

* Easy maintenance through reusable components.

* Fast development with Tailwind CSS utility classes.

* A responsive experience for tourists and staff using mobile devices.

* A visually appealing tourism-themed interface suitable for capstone presentation.

This frontend design is now detailed enough to serve as the UI/UX design specification for your Track-Tour capstone. The next step would be to create the actual wireframes for each page, starting with the Business Registration Wizard and Tourist Dashboard.

Excellent. The best way to design the Track-Tour frontend is by user role, because each user has different goals, permissions, and workflows. This ensures that every dashboard is focused, uncluttered, and easy to use.

### Track-Tour frontend design by user

### 1. Tourist (customer) frontend design

The Tourist interface is the public-facing part of Track-Tour. It should prioritize exploration, booking, ordering, and convenience.

### Tourist user journey

Open Track-Tour

Explore Map

Select Service

Book / Order / Ride

Pay via GCash

### Tourist dashboard layout

### Tourist Dashboard

Tourist Spots

### 24

Available destinations

Bookings

### 3

Active reservations

Orders

### 5

Recent orders

### Quick Actions

Choose a service

Explore Map

Book Hotel

Order Food

Book Ride

### Interactive Map

Discover nearby places

Leaflet Map Placeholder

### Tourist navigation menu

* Home

* Explore Map

* Tourist Spots

* Hotels & Resorts

* Restaurants & Food Hubs

* Book a Ride

* My Bookings

* My Orders

* My Trips

* Profile

### 2. Business owner frontend design

The Business Owner interface is the management hub for all businesses owned by a single account.

### Business owner dashboard

### Business Owner Dashboard

Bansud Food Hub

Total Bookings

### 1,245

+12% this month

Revenue

### ₱85,000

+8% this month

Orders

### 320

+15% this month

Rating

### 4.8

Excellent

### Recent Activity

Today

New Booking

Deluxe Room — ₱3,500

10 min ago

Food Order

Chicken Adobo x2 — ₱360

25 min ago

### Business owner sidebar

### Navigation

Dashboard

My Businesses

Staff Management

Bookings

Orders

Payments

Reports

Settings

### 3. Business staff frontend design

Each staff role should have a focused interface with only the tools needed for their job.

### Front desk staff dashboard

### Front Desk Dashboard

Active

Pending

### 12

Reservations

Confirmed

### 28

Bookings

Checked-in

### 15

Guests

### Pending Reservations

Today

Juan Dela Cruz

Deluxe Room — July 25–27

Confirm

Reject

Maria Santos

Family Room — July 28–30

Confirm

Reject

### Kitchen staff dashboard

### Kitchen Dashboard

Busy

Pending

### 8

Orders

Preparing

### 5

Orders

Ready

### 3

For pickup

### Active Orders

Kitchen queue

#1023

Chicken Adobo x2

Table 5 • 15 min ago

Preparing

#1024

Sinigang x1

Delivery • 8 min ago

Pending

### Menu manager dashboard

### Menu Management

+ Add Menu Item

Chicken Adobo

₱180

Available

Sinigang

₱220

Available

### 4. Rider frontend design

The Rider interface should be optimized for mobile-first usage, since riders will primarily use smartphones.

### Rider dashboard

### Rider Dashboard

Available

Today Trips

### 12

Completed today

Earnings

### ₱1,850

Today

### New Trip Request

3 min ago

Pickup:

Bansud Market

Dropoff:

Aninuan Beach

Distance:

5.2 km

Fare:

### ₱150

Accept

Reject

### Live Map

Real-time tracking

Live GPS Tracking Map

### 5. Tourism office / admin frontend design

The Admin interface should focus on monitoring, approval workflows, and analytics.

### Admin dashboard

### Tourism Office Dashboard

Live Monitoring

Businesses

### 120

+10 this month

Riders

### 45

+3 this month

Bookings

### 2,340

+18% this month

Revenue

### ₱450K

+22% this month

### Pending Business Approvals

Review applications

Mindoro Beach Resort

Resort • Submitted July 20

Approve

Reject

Bansud Food Hub

Restaurant • Submitted July 19

Approve

Reject

### Admin sidebar

### Admin Navigation

Dashboard

Businesses

Riders

Tourist Spots

Bookings

Orders

Analytics

Reports

System Settings

### User-based design summary

| User             | Primary Focus                      |
| ---------------- | ---------------------------------- |
| Tourist          | Explore, book, order, and ride     |
| Business Owner   | Manage businesses and reports      |
| Front Desk Staff | Manage reservations and guests     |
| Kitchen Staff    | Prepare and update food orders     |
| Menu Manager     | Manage menu items and availability |
| Rider            | Accept trips and track routes      |
| Admin            | Approve, monitor, and analyze      |

### Final frontend design decision

By designing Track-Tour by user role, you ensure that:

* Each user has a clear and focused interface.

* The system is easier to navigate and learn.

* Development can be divided into smaller frontend tasks.

* The capstone presentation will clearly show how each user interacts with the system.

The next step is to create the actual page wireframes for each user, starting with the Tourist Landing Page and Business Registration Wizard, then moving to the Business Owner Dashboard.


Here is the complete Entity Relationship Diagram (ERD) for Track-Tour, designed specifically for your capstone project. This ERD includes all major entities, their attributes, primary keys (PK), foreign keys (FK), and relationships.

### Track-Tour Entity Relationship Diagram (ERD)

### High-level ERD overview

### Users

All system users

### Businesses

Owned by Business Owners

Staff

Menus

Rooms

Reviews

Orders

Bookings

### Payments

Linked to Orders, Bookings, and Trips

### Trips

Rider transportation & delivery

### Core entities and attributes

### 1. Users table

Stores all system users including tourists, business owners, staff, riders, and administrators.

| Attribute         | Type      | Key    |
| ----------------- | --------- | ------ |
| id                | BIGINT    | PK     |
| name              | VARCHAR   |        |
| email             | VARCHAR   | Unique |
| password          | VARCHAR   |        |
| contact_no        | VARCHAR   |        |
| role              | ENUM      |        |
| email_verified_at | TIMESTAMP |        |
| created_at        | TIMESTAMP |        |
| updated_at        | TIMESTAMP |        |

### 2. Business types table

Defines the different categories of tourism-related businesses.

| Attribute   | Type      | Key    |
| ----------- | --------- | ------ |
| id          | BIGINT    | PK     |
| name        | VARCHAR   | Unique |
| description | TEXT      |        |
| created_at  | TIMESTAMP |        |
| updated_at  | TIMESTAMP |        |

### 3. Businesses table

Stores all registered businesses.

| Attribute        | Type      | Key                    |
| ---------------- | --------- | ---------------------- |
| id               | BIGINT    | PK                     |
| owner_id         | BIGINT    | FK → users.id          |
| business_type_id | BIGINT    | FK → business_types.id |
| name             | VARCHAR   |                        |
| description      | TEXT      |                        |
| contact_no       | VARCHAR   |                        |
| email            | VARCHAR   |                        |
| status           | ENUM      |                        |
| average_rating   | DECIMAL   |                        |
| created_at       | TIMESTAMP |                        |
| updated_at       | TIMESTAMP |                        |

### 4. Addresses table

Stores business location information.

| Attribute      | Type          | Key                |
| -------------- | ------------- | ------------------ |
| id             | BIGINT        | PK                 |
| business_id    | BIGINT        | FK → businesses.id |
| country        | VARCHAR       |                    |
| province       | VARCHAR       |                    |
| municipality   | VARCHAR       |                    |
| barangay       | VARCHAR       |                    |
| street_address | VARCHAR       |                    |
| postal_code    | VARCHAR       |                    |
| latitude       | DECIMAL(10,8) |                    |
| longitude      | DECIMAL(11,8) |                    |
| created_at     | TIMESTAMP     |                    |
| updated_at     | TIMESTAMP     |                    |

### 5. Staff roles table

Defines the different staff roles.

| Attribute   | Type      | Key    |
| ----------- | --------- | ------ |
| id          | BIGINT    | PK     |
| name        | VARCHAR   | Unique |
| description | TEXT      |        |
| created_at  | TIMESTAMP |        |
| updated_at  | TIMESTAMP |        |

### 6. Staff table

Assigns staff members to businesses.

| Attribute     | Type      | Key                 |
| ------------- | --------- | ------------------- |
| id            | BIGINT    | PK                  |
| business_id   | BIGINT    | FK → businesses.id  |
| user_id       | BIGINT    | FK → users.id       |
| staff_role_id | BIGINT    | FK → staff_roles.id |
| status        | ENUM      |                     |
| created_at    | TIMESTAMP |                     |
| updated_at    | TIMESTAMP |                     |

### 7. Tourist spots table

Stores tourist attraction information.

| Attribute   | Type          | Key |
| ----------- | ------------- | --- |
| id          | BIGINT        | PK  |
| name        | VARCHAR       |     |
| description | TEXT          |     |
| latitude    | DECIMAL(10,8) |     |
| longitude   | DECIMAL(11,8) |     |
| image_url   | VARCHAR       |     |
| created_at  | TIMESTAMP     |     |
| updated_at  | TIMESTAMP     |     |

### Restaurant and food ordering entities

### 8. Menus table

Stores menu items for restaurants and food hubs.

| Attribute    | Type          | Key                |
| ------------ | ------------- | ------------------ |
| id           | BIGINT        | PK                 |
| business_id  | BIGINT        | FK → businesses.id |
| name         | VARCHAR       |                    |
| description  | TEXT          |                    |
| price        | DECIMAL(10,2) |                    |
| image_url    | VARCHAR       |                    |
| availability | BOOLEAN       |                    |
| created_at   | TIMESTAMP     |                    |
| updated_at   | TIMESTAMP     |                    |

### 9. Orders table

Stores food order transactions.

| Attribute        | Type          | Key                       |
| ---------------- | ------------- | ------------------------- |
| id               | BIGINT        | PK                        |
| tourist_id       | BIGINT        | FK → users.id             |
| business_id      | BIGINT        | FK → businesses.id        |
| rider_id         | BIGINT        | FK → riders.id (nullable) |
| order_type       | ENUM          |                           |
| status           | ENUM          |                           |
| total_amount     | DECIMAL(10,2) |                           |
| delivery_address | TEXT          |                           |
| created_at       | TIMESTAMP     |                           |
| updated_at       | TIMESTAMP     |                           |

### 10. Order items table

Stores individual items within an order.

| Attribute  | Type          | Key            |
| ---------- | ------------- | -------------- |
| id         | BIGINT        | PK             |
| order_id   | BIGINT        | FK → orders.id |
| menu_id    | BIGINT        | FK → menus.id  |
| quantity   | INT           |                |
| price      | DECIMAL(10,2) |                |
| subtotal   | DECIMAL(10,2) |                |
| created_at | TIMESTAMP     |                |
| updated_at | TIMESTAMP     |                |

### Accommodation reservation entities

### 11. Rooms table

Stores room information for accommodations.

| Attribute       | Type          | Key                |
| --------------- | ------------- | ------------------ |
| id              | BIGINT        | PK                 |
| business_id     | BIGINT        | FK → businesses.id |
| room_type       | VARCHAR       |                    |
| room_number     | VARCHAR       |                    |
| capacity        | INT           |                    |
| price_per_night | DECIMAL(10,2) |                    |
| description     | TEXT          |                    |
| status          | ENUM          |                    |
| created_at      | TIMESTAMP     |                    |
| updated_at      | TIMESTAMP     |                    |

### 12. Room availability table

Tracks room availability by date.

| Attribute    | Type      | Key                         |
| ------------ | --------- | --------------------------- |
| id           | BIGINT    | PK                          |
| room_id      | BIGINT    | FK → rooms.id               |
| date         | DATE      |                             |
| is_available | BOOLEAN   |                             |
| booking_id   | BIGINT    | FK → bookings.id (nullable) |
| created_at   | TIMESTAMP |                             |
| updated_at   | TIMESTAMP |                             |

### 13. Bookings table

Stores accommodation reservations.

| Attribute    | Type          | Key           |
| ------------ | ------------- | ------------- |
| id           | BIGINT        | PK            |
| tourist_id   | BIGINT        | FK → users.id |
| room_id      | BIGINT        | FK → rooms.id |
| check_in     | DATE          |               |
| check_out    | DATE          |               |
| guest_count  | INT           |               |
| status       | ENUM          |               |
| total_amount | DECIMAL(10,2) |               |
| created_at   | TIMESTAMP     |               |
| updated_at   | TIMESTAMP     |               |

### Rider and transportation entities

### 14. Riders table

Stores rider profiles and vehicle information.

| Attribute      | Type      | Key           |
| -------------- | --------- | ------------- |
| id             | BIGINT    | PK            |
| user_id        | BIGINT    | FK → users.id |
| vehicle_type   | VARCHAR   |               |
| plate_number   | VARCHAR   |               |
| license_number | VARCHAR   |               |
| status         | ENUM      |               |
| average_rating | DECIMAL   |               |
| created_at     | TIMESTAMP |               |
| updated_at     | TIMESTAMP |               |

### 15. Trips table

Stores rider transportation and delivery transactions.

| Attribute        | Type          | Key                       |
| ---------------- | ------------- | ------------------------- |
| id               | BIGINT        | PK                        |
| tourist_id       | BIGINT        | FK → users.id             |
| rider_id         | BIGINT        | FK → riders.id            |
| order_id         | BIGINT        | FK → orders.id (nullable) |
| pickup_location  | TEXT          |                           |
| dropoff_location | TEXT          |                           |
| distance_km      | DECIMAL(8,2)  |                           |
| fare             | DECIMAL(10,2) |                           |
| status           | ENUM          |                           |
| created_at       | TIMESTAMP     |                           |
| updated_at       | TIMESTAMP     |                           |

### Payment and review entities

### 16. Payments table

Stores all payment transactions.

| Attribute    | Type          | Key    |
| ------------ | ------------- | ------ |
| id           | BIGINT        | PK     |
| payable_type | VARCHAR       |        |
| payable_id   | BIGINT        |        |
| amount       | DECIMAL(10,2) |        |
| method       | VARCHAR       |        |
| paymongo_ref | VARCHAR       | Unique |
| status       | ENUM          |        |
| created_at   | TIMESTAMP     |        |
| updated_at   | TIMESTAMP     |        |

### 17. Reviews table

Stores ratings and reviews for businesses and riders.

| Attribute       | Type      | Key           |
| --------------- | --------- | ------------- |
| id              | BIGINT    | PK            |
| tourist_id      | BIGINT    | FK → users.id |
| reviewable_type | VARCHAR   |               |
| reviewable_id   | BIGINT    |               |
| rating          | INT       |               |
| comment         | TEXT      |               |
| created_at      | TIMESTAMP |               |
| updated_at      | TIMESTAMP |               |

### 18. Audit logs table

Tracks important system activities.

| Attribute   | Type      | Key           |
| ----------- | --------- | ------------- |
| id          | BIGINT    | PK            |
| user_id     | BIGINT    | FK → users.id |
| action      | VARCHAR   |               |
| description | TEXT      |               |
| ip_address  | VARCHAR   |               |
| created_at  | TIMESTAMP |               |

### Entity relationships

| Relationship                     | Cardinality      |
| -------------------------------- | ---------------- |
| Users → Businesses               | 1 : Many         |
| Business Types → Businesses      | 1 : Many         |
| Businesses → Addresses           | 1 : 1            |
| Businesses → Staff               | 1 : Many         |
| Users → Staff                    | 1 : Many         |
| Businesses → Menus               | 1 : Many         |
| Users → Orders                   | 1 : Many         |
| Businesses → Orders              | 1 : Many         |
| Orders → Order Items             | 1 : Many         |
| Menus → Order Items              | 1 : Many         |
| Businesses → Rooms               | 1 : Many         |
| Rooms → Bookings                 | 1 : Many         |
| Rooms → Room Availability        | 1 : Many         |
| Users → Bookings                 | 1 : Many         |
| Users → Riders                   | 1 : 1            |
| Riders → Trips                   | 1 : Many         |
| Users → Trips                    | 1 : Many         |
| Orders → Trips                   | 1 : 1 (optional) |
| Payments → Orders/Bookings/Trips | Polymorphic      |
| Reviews → Businesses/Riders      | Polymorphic      |

### ERD relationship diagram

### Text-based ERD relationship map

```
USERS (1) ────────< BUSINESSES (Many)
   │                      │
   │                      ├── ADDRESSES (1)
   │                      ├── STAFF (Many)
   │                      ├── MENUS (Many)
   │                      └── ROOMS (Many)
   │                               │
   │                               ├── ROOM_AVAILABILITY (Many)
   │                               └── BOOKINGS (Many)
   │
   ├── ORDERS (Many) ─────< ORDER_ITEMS (Many)
   │
   ├── BOOKINGS (Many)
   │
   ├── TRIPS (Many)
   │
   └── REVIEWS (Many)

BUSINESS_TYPES (1) ─────< BUSINESSES (Many)
STAFF_ROLES (1) ───────< STAFF (Many)
RIDERS (1) ────────────< TRIPS (Many)

PAYMENTS (Polymorphic) ─── Orders / Bookings / Trips
REVIEWS (Polymorphic) ─── Businesses / Riders
```

### Why this ERD is correct for Track-Tour

This ERD is designed to support all major Track-Tour features:

* Multi-business ownership: One Business Owner can manage multiple businesses.

* Role-based staff management: Staff are assigned to specific businesses with specific roles.

* Food ordering: Orders and Order Items support restaurant transactions.

* Accommodation booking: Rooms, Bookings, and Room Availability prevent double booking.

* Rider transportation: Trips support both tourist rides and food delivery.

* Unified payments: The polymorphic Payments table handles Orders, Bookings, and Trips.

* Reviews and ratings: Tourists can rate both Businesses and Riders.

### Capstone defense explanation

The Track-Tour Entity Relationship Diagram (ERD) was designed to support a centralized tourism ecosystem. The database structure follows normalization principles to reduce data redundancy and maintain data integrity. It includes entities for user management, business registration, food ordering, accommodation booking, rider transportation, payments, reviews, and audit logging. The use of polymorphic relationships in the Payments and Reviews tables allows the system to handle multiple transaction and review types efficiently, making the database scalable and maintainable.

This ERD is now complete and capstone-ready, containing all the entities, attributes, keys, and relationships needed for your Chapter 3: System Design. The next step would be to create the actual visual ERD diagram (with boxes and relationship lines) that you can insert directly into your capstone paper.





Perfect. Since Track-Tour is a large integrated system, the best way to build it is to divide it into small, manageable tasks that you can complete one by one. This will help you avoid being overwhelmed and ensure that each module is properly tested before moving to the next.

### Track-Tour development to-do list

### Phase 1: project setup and planning

These are the foundational tasks that must be completed before any major feature development.

Create the Laravel backend project

Create the React + Vite frontend project

Set up the MySQL database in XAMPP

Configure Laravel database connection

Install Laravel Sanctum for API authentication

Set up React routing (React Router)

Create the basic folder structure for frontend and backend

Set up Git repository and version control

Create the initial ERD and database schema

Prepare wireframes for all dashboards

### Phase 2: authentication and RBAC

This phase focuses on creating secure user access and role-based permissions.

Create the users table migration

Add role column to users table

Create user registration API

Create user login API

Implement password hashing

Implement email verification

Create password reset functionality

Set up Laravel Sanctum token authentication

Create RBAC middleware

Create role-based route protection

Create Tourist dashboard layout

Create Business Owner dashboard layout

Create Staff dashboard layout

Create Rider dashboard layout

Create Admin dashboard layout

### Phase 3: business registration module

This is one of the most important modules because it allows business owners to register multiple businesses.

Create business_types table

Seed default business categories

Create businesses table

Create addresses table

Create business registration form in React

Add business information fields

Add business photo upload

Add permit document upload

Integrate Leaflet map for location pinning

Store latitude and longitude in MySQL

Create business registration API

Create business listing page for owners

Create business edit/update functionality

Create business delete functionality

Create admin approval/rejection page

Send notification after approval/rejection

### Phase 4: tourist spot promotion and geomapping

This phase focuses on the tourism promotion aspect of Track-Tour.

Create tourist_spots table

Create tourist spot CRUD API

Create tourist spot management page for admin

Add tourist spot photo upload

Add tourist spot description

Add tourist spot location pinning

Display tourist spots on Leaflet map

Create custom map markers

Implement map filters by category

Show nearby businesses for each tourist spot

Calculate distance between tourist and business

Display route information (distance and travel time)

### Phase 5: business owner and staff management

This phase allows business owners to manage their staff and assign roles.

Create staff table

Create staff_roles table

Create staff invitation API

Create staff registration page

Assign staff to specific business

Assign staff roles

Create staff management page for owners

Create staff edit functionality

Create staff removal functionality

Restrict staff access based on role

### Phase 6: restaurant menu management

This phase focuses on the restaurant and food hub management features.

Create menus table

Create menu_categories table

Create menu item CRUD API

Create menu management page

Add menu item photo upload

Add menu item price

Add menu item availability toggle

Add menu item description

Create menu category management

Display menu to tourists

Implement search and filter for menu items

### Phase 7: food ordering system

This is the core operational module for restaurants and food hubs.

Create orders table

Create order_items table

Create shopping cart functionality

Add items to cart

Update item quantity in cart

Remove items from cart

Calculate cart total

Select order type (Dine-in, Pickup, Delivery)

Create checkout page

Create order placement API

Store order in MySQL

Create order status update API

Create Order & Payment Staff dashboard

Create Kitchen Staff dashboard

Update order status (Pending → Delivered)

Send real-time order notifications

### Phase 8: accommodation reservation system

This phase covers hotels, resorts, homestays, and camping sites.

Create rooms table

Create room_types table

Create room_availability table

Create bookings table

Create room CRUD API

Add room photo upload

Add room amenities

Add room pricing

Create room availability calendar

Check room availability by date

Prevent double booking

Create booking form

Create booking placement API

Create Front Desk dashboard

Confirm/reject bookings

Implement check-in functionality

Implement check-out functionality

### Phase 9: rider and transportation system

This phase handles transportation and food delivery riders.

Create riders table

Create rider vehicle information table

Create rider registration form

Upload rider documents

Create rider approval page for admin

Create trips table

Create ride request form

Find nearby available riders

Send trip request to riders

Allow rider to accept/reject trip

Create rider dashboard

Update rider availability status

Calculate trip fare

Complete trip functionality

### Phase 10: real-time tracking (Firebase)

This is the advanced feature for live rider tracking.

Create Firebase project

Configure Firebase Realtime Database

Integrate Firebase SDK in React

Create active trip node structure

Send rider GPS coordinates every 5–10 seconds

Display rider location on tourist map

Update rider marker in real time

Delete Firebase trip node after completion

Test multiple active trips

Optimize Firebase read/write usage

### Phase 11: payment integration (PayMongo + GCash)

This phase enables secure online payments.

Create PayMongo sandbox account

Store PayMongo API keys securely

Create payment intent API

Integrate GCash payment channel

Redirect user to GCash payment page

Create PayMongo webhook endpoint

Verify webhook signature

Update payment status in MySQL

Link payments to orders

Link payments to bookings

Link payments to trips

Create payment history page

Handle failed payments

Handle refunded payments

### Phase 12: reviews and ratings

This phase improves trust and service quality.

Create reviews table

Create rating submission form

Allow rating only after completed transaction

Store rating and comment

Calculate average rating

Display ratings on business page

Display ratings on rider profile

Allow business owner to respond to reviews

### Phase 13: admin dashboard and analytics

This phase gives the Tourism Office full control and monitoring capabilities.

Create admin analytics dashboard

Display total registered businesses

Display approved vs rejected businesses

Display total bookings

Display total food orders

Display total rider trips

Display total revenue

Display most visited tourist spots

Display top-rated businesses

Create user management page

Create complaint/dispute management page

Create audit logs page

Generate PDF reports

Export reports to Excel

### Phase 14: testing and quality assurance

Testing is crucial before your capstone defense.

Test user registration and login

Test RBAC permissions

Test business registration flow

Test tourist spot browsing

Test menu management

Test food ordering flow

Test room booking flow

Test rider booking flow

Test Firebase real-time tracking

Test PayMongo payment flow

Test reviews and ratings

Fix bugs and errors

Perform security testing

Perform performance testing

Conduct user acceptance testing (UAT)

### Phase 15: deployment and documentation

The final phase prepares the system for presentation and defense.

Deploy Laravel backend to hosting

Deploy React frontend to Vercel/Netlify

Configure production database

Configure Firebase production project

Configure PayMongo live environment

Set up HTTPS

Create user manual

Create technical documentation

Prepare ERD for Chapter 3

Prepare Use Case Diagram

Prepare DFD Level 0 and Level 1

Prepare System Architecture Diagram

Prepare testing documentation

Prepare capstone defense presentation

### Recommended build order

To avoid being overwhelmed, build the system in this exact order:

* Authentication & RBAC

* Business Registration & Approval

* Tourist Spot Geomapping

* Restaurant Menu Management

* Food Ordering System

* Accommodation Reservation System

* Rider & Transportation System

* Firebase Real-Time Tracking

* PayMongo Payment Integration

* Reviews, Analytics, Testing, and Deployment

### Your immediate next task

The best next step is to start with Phase 2: Authentication & RBAC, because every other module depends on secure user accounts and role-based permissions.

So your first coding task should be:

Set up Laravel Sanctum authentication

Create the users table with role column

Create registration and login APIs

Create RBAC middleware

Create the basic dashboard layouts

Once this is completed, you will have the foundation of the entire Track-Tour system, and all other modules can be built on top of it systematically.


