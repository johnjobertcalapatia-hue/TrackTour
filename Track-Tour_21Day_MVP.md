# Track-Tour: 21-Day MVP Task List

## Overview

A realistic 3-week plan to build a working MVP for capstone defense.

**Scope:** Auth + Business Registration + Food Ordering + Room Booking + Payments

---

## WEEK 1: Foundation + Business Module

### Day 1-2: Project Setup

| Task | Details |
|------|---------|
| Create Laravel project | `composer create-project laravel/laravel track-tour-api` |
| Create React project | `npm create vite@latest track-tour-frontend -- --template react` |
| Setup MySQL database | Create `track_tour` database in XAMPP |
| Configure Laravel .env | DB connection, Sanctum config |
| Install Sanctum | `composer require laravel/sanctum` |
| Setup CORS | Allow localhost:5173 |
| Create folder structure | Organize frontend components/pages/services |

### Day 3: Database Migrations

| Table | Columns |
|-------|---------|
| `users` | id, name, email, password, role (enum: tourist/owner/admin), contact_no, timestamps |
| `businesses` | id, owner_id (FK), name, type, description, address, latitude, longitude, status (pending/approved/rejected), timestamps |
| `menus` | id, business_id (FK), name, description, price, image_url, availability, timestamps |
| `rooms` | id, business_id (FK), room_type, price_per_night, capacity, status, timestamps |
| `orders` | id, tourist_id (FK), business_id (FK), status (pending/accepted/preparing/ready/delivered), total_amount, timestamps |
| `order_items` | id, order_id (FK), menu_id (FK), quantity, price, subtotal, timestamps |
| `bookings` | id, tourist_id (FK), room_id (FK), check_in, check_out, guest_count, status (pending/confirmed/checked-in/checked-out), total_amount, timestamps |

### Day 4: Authentication Backend

| Task | File |
|------|------|
| AuthController | Register, login, logout, me |
| RBAC Middleware | Check role in request |
| Sanctum Routes | `routes/api.php` |
| Test with Postman | Verify token-based auth works |

### Day 5: Authentication Frontend

| Task | Component |
|------|-----------|
| Login page | Email/password form |
| Register page | Role selection, form fields |
| Auth context | Store token, user data |
| Protected routes | Redirect based on role |
| Axios setup | Attach token to requests |

### Day 6-7: Business Registration

| Task | Details |
|------|---------|
| Business registration form | Name, type, description, address |
| Leaflet map integration | Pin location, store lat/lng |
| Business listing (Owner) | Show own businesses |
| Admin approval page | List pending, approve/reject |
| Business status filter | Pending/Approved views |

---

## WEEK 2: Food Ordering + Room Booking

### Day 8-9: Menu Management

| Task | Details |
|------|---------|
| Menu CRUD (Owner) | Create, edit, delete menu items |
| Image upload | Store menu item photos |
| Menu display (Tourist) | Browse by restaurant |
| Availability toggle | Enable/disable items |

### Day 10-12: Food Ordering Flow

| Task | Details |
|------|---------|
| Cart functionality | Add/remove items, update quantity |
| Cart page | Show items, totals |
| Checkout page | Order type selection (Dine-in/Pickup/Delivery) |
| Order placement | Create order + order_items |
| Order status updates | Owner/staff can update status |
| Order history (Tourist) | View past orders |
| Order management (Owner) | View incoming orders |

### Day 13-14: Room Booking

| Task | Details |
|------|---------|
| Room listing | Display rooms by business |
| Room details | Type, price, capacity |
| Booking form | Check-in/out dates, guest count |
| Availability check | Verify dates not booked |
| Booking placement | Create booking record |
| Booking management (Owner) | Confirm/reject bookings |
| Booking history (Tourist) | View own bookings |

---

## WEEK 3: Payments + Polish

### Day 15-17: PayMongo Integration

| Task | Details |
|------|---------|
| PayMongo account | Setup sandbox account |
| API keys | Store in .env |
| Payment intent | Create payment request |
| GCash channel | Integrate GCash payment |
| Webhook endpoint | Handle payment status |
| Link to orders | Update order status on payment |
| Link to bookings | Update booking status on payment |

### Day 18-19: Dashboards

| Dashboard | Contents |
|-----------|----------|
| Tourist | Quick actions, recent orders/bookings |
| Owner | Business stats, recent activity |
| Admin | Pending approvals, basic stats |

### Day 20: Testing

| Flow | Test |
|------|------|
| Register → Login | Works for all roles |
| Business register → Admin approve | Status updates |
| Browse menu → Add to cart → Checkout → Pay | End-to-end |
| Book room → Pay → Confirm | End-to-end |
| Order status updates | Status transitions work |

### Day 21: Fix Bugs + Demo Prep

| Task | Details |
|------|---------|
| Fix critical bugs | Anything blocking demo |
| Seed test data | Sample businesses, menus, rooms |
| Prepare demo script | Walk through flow |
| Deploy (optional) | Vercel for frontend, Railway for backend |

---

## Daily Time Commitment

| Week | Hours/Day | Total |
|------|-----------|-------|
| Week 1 | 8-10 hrs | 56-70 hrs |
| Week 2 | 8-10 hrs | 56-70 hrs |
| Week 3 | 6-8 hrs | 42-56 hrs |
| **Total** | | **154-196 hrs** |

---

## Critical Path Items

1. **Day 1-2**: Must complete setup or everything delays
2. **Day 4-5**: Auth must work before any feature
3. **Day 10-12**: Core ordering flow is your demo centerpiece
4. **Day 15-17**: Payment integration is capstone requirement

---

## What to SKIP (Stretch Goals)

| Skip | Why |
|------|-----|
| Full staff sub-roles | Use single "Staff" role |
| Firebase real-time tracking | Simulate or use simple polling |
| Reviews & Ratings | Not critical for defense |
| Tourist spot promotion pages | Basic map is enough |
| Advanced analytics | Simple tables work |
| Room availability calendar | Use date range check instead |

---

## Risk Mitigation

| Risk | Backup Plan |
|------|-------------|
| PayMongo setup takes too long | Use cash-on-delivery as fallback |
| Firebase too complex | Skip real-time, use page refresh |
| Time runs out | Focus on food ordering only, skip rooms |

---

## Simplified Scope

### Keep

- Auth + 3 roles (Tourist, Owner, Admin)
- Business registration + approval
- Food ordering (browse → order → status)
- Room booking (browse → book → confirm)
- ONE payment flow (GCash via PayMongo)
- Basic dashboards per role

### Total Tasks: ~50-60 (vs 200+ in full plan)

---

## Honest Assessment

| Scenario | Outcome |
|----------|---------|
| 2 weeks | Bare-bones demo, may have bugs |
| 3 weeks | Working MVP, defensible capstone |
| Full plan | 8-10 weeks minimum |

**Recommendation:** Focus on one complete workflow (food ordering OR room booking) with working payments. A polished single flow beats a buggy incomplete system for capstone defense.
