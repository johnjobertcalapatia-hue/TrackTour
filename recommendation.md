Your architecture is already strong, but for a **capstone-ready Chapter 3 System Design Architecture**, I would refine it slightly to make it more academically professional and aligned with your actual Track-Tour implementation.

The main improvements I recommend:

1. Change **"three-tier hybrid architecture"** → **"Hybrid Multi-Layer Three-Tier Architecture"** because you added real-time, event, and external service layers.
2. Clarify that **Firebase is not a primary database** but a **temporary real-time synchronization service**.
3. Add **API Gateway / Middleware Layer** because Laravel handles authentication, RBAC, and request filtering.
4. Add **Leaflet Mapping Service** because mapping is a core Track-Tour feature.
5. Separate **Booking Engine** into accommodation, food, and transportation because Track-Tour is not only a hotel system.

Here is the improved professional version:

---

# Chapter 3

# System Design Architecture

## Track-Tour System Design Architecture

Track-Tour follows a **Hybrid Multi-Layer Three-Tier Architecture** designed to provide scalability, maintainability, security, and efficient communication between users, application services, databases, and external platforms.

The architecture consists of five major layers:

1. **Presentation Layer**
2. **Application Layer**
3. **Data Layer**
4. **Real-Time Communication Layer**
5. **External Integration Layer**

This architecture separates user interfaces, business processes, permanent data storage, real-time communication, and third-party services to ensure efficient system operation.

---

# High-Level Architecture Overview

```
                 USERS
                   |
                   |
        React + Vite Web Application
          Presentation Layer
                   |
                   |
            Laravel REST API
          Application Layer
                   |
        ------------------------
        |          |           |
      MySQL     Firebase    WebSocket
     Database    RTDB       Service
        |
        |
   External Services
        |
 ------------------------
 |                      |
PayMongo              Leaflet
GCash Payment         Mapping
```

---

# 1. Presentation Layer

## Technology

**React + Vite**

The Presentation Layer provides the user interface where different system users interact with Track-Tour services.

The frontend implements role-based dashboards designed according to each user's responsibilities.

---

## User Interfaces

| User Role            | Main Functions                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Tourist              | Browse destinations, search businesses, book accommodations, order food, request transportation, make payments, submit reviews |
| Business Owner       | Manage businesses, employees, products/services, availability, reports, and transactions                                       |
| Staff                | Manage daily business operations such as orders, reservations, menus, and customer requests                                    |
| Rider                | Accept transportation requests, deliver orders, update trip status, and manage earnings                                        |
| Tourism Office/Admin | Approve businesses, verify riders, monitor activities, and generate reports                                                    |

---

## Frontend Responsibilities

The Presentation Layer is responsible for:

* Rendering responsive user interfaces.
* Managing navigation and user sessions.
* Sending API requests to Laravel.
* Receiving real-time updates.
* Displaying maps and location information.
* Performing client-side validation.

---

# 2. Application Layer

## Technology

**Laravel REST API**

The Application Layer serves as the core processing layer of Track-Tour.

It manages:

* Business rules
* Authentication
* Authorization
* Transactions
* Data processing
* External API communication

---

# Laravel System Modules

| Module                     | Responsibility                                                |
| -------------------------- | ------------------------------------------------------------- |
| Authentication Module      | Registration, login, password management, user sessions       |
| Role Management Module     | RBAC permission handling                                      |
| Business Management Module | Business registration, verification, approval, and management |
| Tourism Module             | Tourist attractions and destination management                |
| Accommodation Module       | Room management and reservations                              |
| FoodHub Module             | Menu management, ordering, and food preparation               |
| Transportation Module      | Rider assignment, trip management, and fare calculation       |
| Booking Module             | Reservation processing and availability checking              |
| Payment Module             | PayMongo payment processing                                   |
| Notification Module        | Real-time alerts and transaction updates                      |
| Reporting Module           | Analytics and business reports                                |

---

# Backend Request Processing Flow

```
User Action

      ↓

React Frontend

      ↓

Laravel API Route

      ↓

Middleware
(Authentication + Authorization)

      ↓

Controller

      ↓

Service Layer

      ↓

Database / External Services

      ↓

JSON Response
```

---

# 3. Data Layer

## Primary Database

**MySQL**

MySQL is used as the main database because Track-Tour requires structured relational data involving users, businesses, transactions, bookings, and payments.

MySQL provides:

* ACID transaction support
* Referential integrity
* Relationship management
* Reliable transaction processing

---

# Core Database Entities

| Entity            | Description                                                      |
| ----------------- | ---------------------------------------------------------------- |
| Users             | Stores tourist, business owner, staff, rider, and admin accounts |
| Businesses        | Stores registered tourism and service establishments             |
| Business Profiles | Stores category-specific information                             |
| Rooms             | Stores accommodation room information                            |
| Menus             | Stores food products and pricing                                 |
| Orders            | Stores food transactions                                         |
| Trips             | Stores transportation and delivery records                       |
| Bookings          | Stores reservation transactions                                  |
| Payments          | Stores payment history                                           |
| Reviews           | Stores customer feedback                                         |
| Audit Logs        | Stores user activities                                           |

---

# Database Relationship Overview

```
Users

 |
 |
 +---- Businesses
 |
 +---- Bookings
 |
 +---- Orders
 |
 +---- Trips
 |
 +---- Payments
 |
 +---- Reviews


Businesses

 |
 +---- Rooms
 |
 +---- Menus
 |
 +---- Staff
```

---

# 4. Real-Time Communication Layer

## Technologies

* Firebase Realtime Database
* WebSocket Service

The Real-Time Layer handles temporary live information that requires immediate synchronization.

---

# Firebase RTDB Usage

Firebase is only used for active rider tracking.

It stores:

* Current GPS coordinates
* Speed
* Direction
* Last update timestamp

Permanent information remains in MySQL.

---

## Firebase Data Example

```json
{
  "activeTrips": {
    "trip_123": {
      "rider_id":45,
      "latitude":13.2111,
      "longitude":121.1345,
      "speed":32,
      "heading":180,
      "updated_at":"2026-07-21T10:30:00Z"
    }
  }
}
```

---

# Real-Time Optimization Strategy

To reduce operational cost:

* GPS updates occur every 5–10 seconds.
* Firebase records exist only during active trips.
* Completed trips are archived in MySQL.
* Inactive tracking nodes are automatically removed.

---

# WebSocket Responsibilities

WebSockets handle:

* Order status updates
* Booking confirmation
* Rider acceptance notifications
* Delivery progress
* Real-time alerts

Example:

```
Order Created

↓

Kitchen Receives Notification

↓

Food Prepared

↓

Rider Assigned

↓

Tourist Receives Update
```

---

# 5. External Integration Layer

## PayMongo Payment Gateway

PayMongo handles online payment processing using GCash.

---

# Payment Workflow

```
Tourist

↓

Checkout

↓

Laravel Creates Payment Intent

↓

PayMongo

↓

GCash Payment

↓

PayMongo Webhook

↓

Laravel Verification

↓

MySQL Payment Update
```

---

# Payment Security

Implemented security measures:

* HTTPS encrypted communication
* Webhook signature verification
* Payment status validation
* Transaction logs
* Audit trail recording

---

# Mapping Integration

## Leaflet Mapping Library

Leaflet provides:

* Interactive maps
* Tourist destination visualization
* Business location markers
* Rider tracking display
* Route visualization

---

# Security Architecture

| Security Component | Implementation            |
| ------------------ | ------------------------- |
| Authentication     | Laravel Sanctum           |
| Password Security  | bcrypt hashing            |
| Authorization      | Role-Based Access Control |
| API Security       | Middleware validation     |
| Database Security  | Foreign key constraints   |
| Payment Security   | Webhook verification      |
| Monitoring         | Audit logs                |

---

# Deployment Architecture

## Development Environment

| Component | Technology   |
| --------- | ------------ |
| Frontend  | React + Vite |
| Backend   | Laravel      |
| Database  | MySQL        |
| Server    | XAMPP        |
| Real-Time | Firebase     |
| Mapping   | Leaflet      |

---

## Production Environment

| Component         | Platform                |
| ----------------- | ----------------------- |
| Frontend Hosting  | Vercel / Netlify        |
| Backend Hosting   | VPS / Laravel Hosting   |
| Database          | MySQL Cloud Hosting     |
| Real-Time Service | Firebase RTDB           |
| Payment           | PayMongo Production API |

---

# Architectural Justification

The Hybrid Multi-Layer Three-Tier Architecture is appropriate for Track-Tour because:

* It separates presentation, processing, and storage responsibilities.
* It supports multiple user roles through RBAC.
* It maintains reliable transactional records using MySQL.
* It reduces infrastructure cost by limiting Firebase usage.
* It supports real-time transportation tracking.
* It enables secure online payments.
* It allows future expansion without major architectural changes.

---

# Capstone Defense Explanation

> Track-Tour uses a Hybrid Multi-Layer Three-Tier Architecture composed of a React-based Presentation Layer, Laravel Application Layer, and MySQL Data Layer. Firebase Realtime Database is integrated only for temporary rider GPS tracking, while WebSocket communication manages real-time system events. External services such as PayMongo and Leaflet provide payment processing and geographic visualization. This architecture ensures scalability, security, data integrity, and efficient resource utilization, making it suitable for a tourism ecosystem platform integrating business management, food ordering, transportation, and accommodation services.

---

This version is more aligned with **BSIT capstone documentation standards** and is easier to defend because every technology choice has a clear justification.
