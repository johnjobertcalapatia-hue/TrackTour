# TrackTour — Business Owner Web Application

## Features & Current Progress

**TrackTour** is a multi-role tourism management platform for the Municipality of Bansud. The Business Owner module is the largest and most feature-rich part of the system with **63 pages** across dashboard, operations, reporting, and settings.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Laravel 12 (PHP 8.2) |
| Frontend | React 19 + TypeScript + Vite 8 |
| Styling | Tailwind CSS 4 |
| State Management | Zustand + React Hook Form + TanStack React Query + Zod |
| Mapping | Leaflet.js + react-leaflet |
| Charts | Recharts |
| Auth | Laravel Sanctum + Laravel Breeze |
| Real-time | Firebase Cloud Messaging + Firebase Realtime DB |
| Payments | PayMongo (GCash channel) |
| PDF Generation | barryvdh/laravel-dompdf |

---

## Feature Breakdown

### Multi-Step Business Registration (11 Steps)

| Step | Description | Status |
|---|---|---|
| Step 1 | Basic business info | Done |
| Step 2 | Business category selection | Done |
| Step 3 | Dynamic fields per category | Done |
| Step 4 | Contact details | Done |
| Step 5 | Operating hours | Done |
| Step 6 | Location pin on Leaflet map | Done |
| Step 7 | Barangay/municipality selection | Done |
| Step 8 | Document upload (DTI/SEC, Mayor's Permit) | Done |
| Step 9 | OCR extraction of uploaded documents | Done |
| Step 10 | Logo & cover photo upload | Done |
| Step 11 | Review & submit | Done |

- Session persistence across all steps
- Support for multiple business categories (Restaurant, Cafe, FoodHub, Hotel, Resort, Tourist Attraction)

---

### Dashboard

| Dashboard Type | Description | Status |
|---|---|---|
| RestaurantDashboard | KPIs for restaurant operations | Done |
| CafeDashboard | KPIs for cafe operations | Done |
| FoodHubDashboard | KPIs for food hub operations | Done |
| HotelDashboard | KPIs for hotel operations | Done |
| ResortDashboard | KPIs for resort operations | Done |
| TouristAttractionDashboard | KPIs for attraction operations | Done |

- KPI cards: total orders, bookings, revenue, ratings
- Recent activity feed
- Category-specific layout and metrics

---

### Business Management

| Feature | Description | Status |
|---|---|---|
| My Businesses List | View all owned businesses with business switcher | Done |
| Business Profile Editing | Edit name, description, contact info | Done |
| Business Documents | Upload, delete, OCR verification of documents | Done |
| Business Gallery | Image upload, sort order, featured toggle, visibility toggle, video upload | Done |
| Logo & Cover Photo | Upload and manage business branding | Done |
| Verification Workflow | Submit documents for admin verification | Done |
| Restaurant Profile Settings | Restaurant-specific configuration | Done |
| Open/Close Toggle | Mark business as open or closed | Done |
| Welcome Message | Set a welcome message for customers | Done |
| Featured Menu Items | Curate featured items for display | Done |
| Promotions Curation | Manage and feature promotions | Done |

---

### Offerings (Products/Services)

| Feature | Description | Status |
|---|---|---|
| CRUD Operations | Create, read, update, delete offerings | Done |
| Offering Categories | Organize offerings into categories | Done |
| Bulk Actions | Bulk edit/delete multiple offerings | Done |
| Duplicate | Clone existing offerings | Done |
| Featured Toggle | Mark offerings as featured | Done |
| Per-Offering Analytics | View performance metrics per offering | Done |
| Variations | Variation groups and options (size, flavor, etc.) | Done |
| Add-On Groups | Add-on groups and items (toppings, extras) | Done |

---

### Menu Management

| Feature | Description | Status |
|---|---|---|
| Menu CRUD | Create, edit, delete, show menus | Done |
| Food Creation Shortcut | Quick food item creation | Done |
| Offering Categories | Manage food categories | Done |

---

### Orders Management

| Feature | Description | Status |
|---|---|---|
| Order Listing | View all incoming and past orders | Done |
| Order Detail View | Full order details with items | Done |
| Status Updates | Update order through preparation pipeline | Done |
| Rider Assignment | Assign delivery rider to orders | Done |
| Delivery Tracking | Track delivery progress in real-time | Done |

---

### Bookings Management

| Feature | Description | Status |
|---|---|---|
| Calendar View | Visual calendar of upcoming bookings | Done |
| Booking Listing | View all bookings | Done |
| Booking Detail View | Full booking details | Done |
| Status Workflow | Accept, confirm, complete, cancel bookings | Done |

---

### Kitchen Display System (KDS)

| Feature | Description | Status |
|---|---|---|
| Kitchen Orders View | Real-time display of incoming kitchen orders | Done |
| Quick Status Updates | One-tap status changes for order preparation | Done |

---

### Promotions Management

| Feature | Description | Status |
|---|---|---|
| Promotion CRUD | Create, edit, delete promotions | Done |
| Featured Promotions | Highlight active promotions | Done |

---

### Staff Management

| Feature | Description | Status |
|---|---|---|
| Staff CRUD | Create, edit, deactivate, delete staff | Done |
| Role Assignment | Assign roles from staff roles catalog | Done |
| Rider Listing | View riders associated with business | Done |
| Staff Detail View | Individual staff profile page | Done |
| Staff Attendance | Track staff attendance | Done |
| Staff Scheduling | Create and manage staff schedules | Done |
| Roles Management | Define and manage staff roles | Done |
| Payroll | Manage staff payroll | Done |

---

### POS (Point of Sale)

| Feature | Description | Status |
|---|---|---|
| POS Page | In-store point of sale interface | Stub |

---

### Tables Management

| Feature | Description | Status |
|---|---|---|
| Restaurant Tables | Manage dining table assignments | Stub |

---

### Dispatch System

| Feature | Description | Status |
|---|---|---|
| Pending Dispatch | View pending delivery dispatch requests | Done |

---

### Reports & Analytics

| Report Type | Description | Export | Status |
|---|---|---|---|
| Sales Reports | Revenue and sales analytics | PDF, CSV, Excel | Done |
| Order Reports | Order volume and trends | PDF, CSV, Excel | Done |
| Booking Reports | Booking statistics and trends | PDF, CSV, Excel | Done |
| Operational Reports | Overall business performance | PDF, CSV, Excel | Done |
| Expense Tracking | Track and categorize business expenses | Done |
| Expense Summary | Aggregated expense analytics | Done |

---

### Archive Vault

| Feature | Description | Status |
|---|---|---|
| Archived Items View | Browse archived entities | Done |
| Restore | Restore archived items | Done |
| Permanent Delete | Permanently remove archived items | Done |

---

### Customer Management

| Feature | Description | Status |
|---|---|---|
| Customer Listing | View customers who ordered/visited | Done |
| Customer Details | View individual customer info | Done |

---

### Notifications

| Feature | Description | Status |
|---|---|---|
| Notification Listing | View all notifications | Done |
| Mark Read | Mark individual notifications as read | Done |
| Mark All Read | Mark all notifications as read | Done |

---

### Activity Logs

| Feature | Description | Status |
|---|---|---|
| Activity Log History | View history of actions performed | Done |

---

### Chat/Messaging

| Feature | Description | Status |
|---|---|---|
| Real-time Chat | Chat with tourists and riders via Firebase | Done |
| Chat Channels | Manage conversation threads | Done |

---

### Account Settings

| Feature | Description | Status |
|---|---|---|
| Profile View | View current profile | Done |
| Profile Edit | Edit name, email, photo | Done |
| Account Status | View account approval/verification status | Done |
| Settings Page | General account settings | Done |

---

## Supporting Services (Backend)

| Service | Purpose | Status |
|---|---|---|
| FirebaseService | Push notifications, chat, GPS tracking | Done |
| NearestRiderService | Haversine-based nearest rider matching | Done |
| TransportationService | Fare calculation, ride PIN generation | Done |
| GpsService | GPS coordinate handling | Done |
| LocationPersistenceService | Rider location persistence to MySQL | Done |
| PaymongoService | Payment intent creation and webhooks | Done |
| OcrService | Document OCR extraction and verification | Done |
| NotificationService | Multi-channel notification delivery | Done |
| OrderService | Order business logic | Done |
| BookingService | Booking business logic | Done |
| DeliveryService | Delivery assignment and tracking | Done |
| BusinessService | Business CRUD operations | Done |
| StaffService | Staff management logic | Done |

---

## Database

- **130 migration files** — full schema built
- **59 Eloquent models** — all entities modeled
- **100+ API endpoints** in `routes/api.php`
- **4 custom middleware**: CheckRole, CheckAccountStatus, CheckBusinessOwnerApproval, StaffMiddleware

---

## Current Progress Summary

### Completed
- Multi-step business registration wizard (11 steps)
- Category-specific dashboards (6 types)
- Full business profile and document management
- OCR-based document verification
- Offerings CRUD with variations and add-ons
- Orders management with rider assignment
- Bookings management with calendar view
- Kitchen Display System
- Promotions management
- Staff management (CRUD, roles, attendance, scheduling, payroll)
- Reports & analytics with PDF/CSV/Excel export
- Expense tracking and summaries
- Archive vault with restore/delete
- Notifications system
- Real-time chat via Firebase
- Account settings and profile management
- Leaflet map integration for business location

### In Progress / Stubs
- POS (Point of Sale) interface — page exists, functionality pending
- Tables Management — page exists, functionality pending
- Advanced reporting dashboards — export works, UI polish ongoing
- End-to-end payment flow verification (PayMongo code exists, integration testing needed)

### Planned / Not Yet Implemented
- Mobile application (API ready, no client built yet)
- Multi-language support
- Deeper WebSocket real-time enhancements
- Expanded automated test coverage

---

## Testing Status

| Type | Count | Status |
|---|---|---|
| Selenium Integration Tests | 3 | Done |
| PHPUnit Feature Tests | Scaffolding only | Needs expansion |
| PHPUnit Unit Tests | Scaffolding only | Needs expansion |

---

## File Locations

| Area | Path |
|---|---|
| Backend Controllers | `app/Http/Controllers/BusinessOwner/` |
| Backend Services | `app/Services/` |
| Frontend Pages | `frontend/src/features/business-owner/` |
| API Routes | `routes/api.php` |
| Database Migrations | `database/migrations/` |
| Models | `app/Models/` |

---

*Last updated: August 2026*
