# System Architecture

## Overview

**TrackTour** is an integrated tourism promotion and multi-restaurant food delivery platform for the municipality of **Bansud, Oriental Mindoro**.

The platform unifies tourism discovery (destinations, resorts, cultural heritage, and local businesses) with an on-demand food ordering and delivery ecosystem powered by local motorcycle riders.

---

## High-Level Topology

```text
┌────────────────────────────────────────────────────────────────────────┐
│                              CLIENT TIER                                │
│                                                                        │
│   ┌────────────────┐     ┌────────────────┐     ┌──────────────────┐   │
│   │ Tourist Web    │     │ Business Owner │     │ Rider Mobile/Web │   │
│   │ App (React)    │     │ Portal (React) │     │ Portal (React)   │   │
│   └───────┬────────┘     └───────┬────────┘     └────────┬─────────┘   │
│           │                      │                       │             │
│           │                      │                       │             │
│           ▼                      ▼                       ▼             │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ Tourism Office / Admin Web Dashboard (React + Blade legacy)   │   │
│   └──────────────────────────────┬─────────────────────────────────┘   │
└──────────────────────────────────┼─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                            APPLICATION TIER                            │
│                                                                        │
│    HTTPS REST API (Port 8000 / Apache)                                 │
│    ┌──────────────────────────────────────────────────────────────┐    │
│    │               Laravel 12 / PHP 8.2 Application               │    │
│    │  - Sanctum Auth & Role-Based Access Control                  │    │
│    │  - Domain Services (GroupOrder, NearestRider, Payouts)       │    │
│    │  - Task Schedulers (AutoReject, AutoCancel, Dispatch)        │    │
│    │  - TripTokenService (HMAC-SHA256 Token Minting)              │    │
│    └──────────────┬───────────────────────────────┬───────────────┘    │
│                   │                               │                    │
│      Shared Secret│Bridge                         │                    │
│      HTTP POST    │(Port 3002)                    │                    │
│                   ▼                               ▼                    │
│    ┌─────────────────────────────┐   ┌────────────────────────────┐    │
│    │ Node.js Socket.IO Server    │   │ External Payment Gateway   │    │
│    │ (Port 3001)                 │   │ (PayMongo API)             │    │
│    │ - GPS Ingress & Validation  │   │ - GCash, GrabPay, Cards    │    │
│    │ - HMAC Token Verification   │   │ - Webhooks with HMAC check │    │
│    │ - Low-Latency Trip Rooms    │   └────────────────────────────┘    │
│    └──────────────┬──────────────┘                                     │
└───────────────────┼────────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                              STORAGE TIER                              │
│                                                                        │
│    MySQL Relational Database (XAMPP)                                   │
│    - ACID Transactions & Strict Row-Level Locks (`lockForUpdate`)      │
│    - Unique Constraints as Concurrency Backstops                       │
│    - Auditable Ledgers (cod_settlements, rider_earnings, payouts)      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## System Actors & Roles

1. **Tourist**:
   - Discovers Bansud destinations, resorts, and restaurants.
   - Places unified orders containing items from multiple restaurants (Group Checkout).
   - Pays via PayMongo (GCash/Cards) or Cash on Delivery (COD).
   - Tracks assigned riders in real-time via interactive Leaflet map using WebSockets with HTTP polling fallback.

2. **Business Owner (Restaurant / Tourism Merchant)**:
   - Manages menu items, pricing, business profile, and opening hours.
   - Accepts or rejects orders.
   - Kitchen preparation interface gated strictly on rider assignment.
   - Views COD settlement receivables and financial statements.

3. **Rider**:
   - Toggles online/available status and transmits GPS fixes.
   - Receives nearest-rider delivery dispatch offers (120s acceptance window).
   - Operates under the strict **One Active Delivery** constraint.
   - Manages credit wallet (topping up credits to accept COD orders).
   - Requests payout of accumulated earnings.

4. **Bansud Tourism Office / Platform Administrator**:
   - Manages municipal listings, verified tourism businesses, and tourist feedback.
   - Oversees rider onboarding, approvals, and payout disbursement.
   - Monitors municipal revenue share (20% platform share on COD settlements, system fees).

---

## Communication Protocols & Data Flow

| Pathway | Protocol | Description | Security / Guards |
|---|---|---|---|
| Client ↔ Laravel API | HTTPS / JSON | REST endpoints for auth, cart, orders, and management | Laravel Sanctum Bearer tokens, CSRF protection, Role Middleware |
| Client ↔ Socket Server | WSS / Socket.IO | High-frequency GPS updates, trip room tracking | HMAC-SHA256 signed Trip Token, Subject validation, Teleport guard |
| Laravel ↔ Socket Server | HTTP POST (Internal) | Trip dispatch notifications, status sync, completion events | `SOCKET_BRIDGE_SECRET` constant-time verification |
| PayMongo ↔ Laravel | HTTPS Webhook | Asynchronous payment authorization, capture, and refund verdicts | Webhook signature verification, idempotent event ledger |

---

## Fault Tolerance & Fallback Strategies

- **Real-Time GPS Fallback**: The tourist map primary channel is Socket.IO. If the WebSocket connection drops or encounters repeated failures (5 attempts with exponential backoff), the client transparently degrades to HTTP polling against `GET /api/orders/{order}/status` every 4 seconds.
- **Dispatch Recovery**: If an offered rider fails to respond within 120 seconds or declines the delivery, the dispatch scheduler automatically re-offers the delivery to the next nearest eligible rider without resetting order preparation state.
- **Money Flow Integrity**: All money transitions (PayMongo capture, COD reserve, credit debit, and payout batching) are wrapped in atomic database transactions protected by exclusive row locks (`lockForUpdate`).
