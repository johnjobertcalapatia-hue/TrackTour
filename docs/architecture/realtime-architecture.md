# Real-Time Architecture

## Overview

TrackTour implements a dedicated **Node.js Socket.IO** real-time server (`socket-server.js`) rather than routing high-frequency location fixes through traditional database writes or commercial cloud platforms.

This decoupled architecture separates high-frequency ephemeral telemetry (such as rider GPS fixes every 1–2 seconds) from transactional database records.

---

## Network Architecture

```text
    ┌───────────────────────┐             ┌────────────────────────┐
    │     Rider Client      │             │     Tourist Client     │
    │  (Streams GPS fixes)  │             │   (Views live map)     │
    └──────────┬────────────┘             └───────────▲────────────┘
               │                                      │
               │ WSS (Port 3001)                      │ WSS (Port 3001)
               │ Event: `rider_location_update`       │ Event: `rider_location_stream`
               ▼                                      │
    ┌─────────────────────────────────────────────────┴────────────┐
    │               Node.js Socket.IO Server (:3001)               │
    │                                                              │
    │  - Pure Ingress Validation (`socket-validation.js`)          │
    │  - HMAC Trip/User Tokens (`socket-token.js`)                 │
    │  - In-Memory Trip Rooms (`trip_{deliveryId}`) +             │
    │    audience rooms (business/rider/user)                      │
    │  - Status-event fan-out (`socket-events.js`)                 │
    │  - Internal HTTP Bridge (:3002)                              │
    └──────────────────────────────▲───────────────────────────────┘
                                   │
                                   │ HTTP POST (Internal, Port 3002)
                                   │ Authorization: SOCKET_BRIDGE_SECRET
                                   │ Endpoints: /dispatch, /trip/assign,
                                   │            /trip/complete, /trip/cancel,
                                   │            /event, /status
                                   │
                    ┌──────────────┴───────────────┐
                    │      Laravel API (:8000)     │
                    │  `WebsocketNotifierService`  │
                    │      `TripTokenService`      │
                    │  `SocketTokenController`     │
                    └──────────────────────────────┘
```

---

## 1. Zero-DB Ingress & Token Security

- **Trip Token (`socket-token.js` / `TripTokenService.php`)**:
  - Tokens are signed HMAC-SHA256 payloads containing:
    ```json
    {
      "v": 1,
      "deliveryId": 42,
      "role": "customer",
      "sub": 105,
      "exp": 1726750000
    }
    ```
  - Both PHP (`TripTokenService`) and Node.js (`socket-token.js`) share the `SOCKET_BRIDGE_SECRET` key, maintaining byte-identical parity verified by unit tests.
  - Room joins via `join_trip_room` demand a valid, unexpired token matching the requested delivery ID.
  - Prevents eavesdropping: a customer cannot track any delivery other than their own.

---

## 2. GPS Integrity & Anti-Spoofing (`socket-validation.js`)

Before any GPS fix is broadcast to consumers, it must pass a strict suite of validation filters:

1. **Null Island Rejection**:
   - Rejects coordinates at or near `(0, 0)` (`lat === 0 && lng === 0`).
2. **Geographical Bounds**:
   - Rejects coordinates outside valid Philippine/Oriental Mindoro coordinate ranges.
3. **Freshness Guard**:
   - Fix timestamp must be within ±60 seconds of server time to reject stale or replayed packets.
4. **Identity & Trip Binding**:
   - The socket emitting the fix must match the authenticated rider assigned to that active trip.
5. **Teleport Guard (Speed Limit)**:
   - Calculates speed between consecutive fixes. Implausible velocity (> 120 km/h) results in dropped packets to prevent spoofed GPS jumps.

---

## 3. Internal HTTP Bridge (:3002)

Laravel communicates with the Socket engine via an internal HTTP bridge protected by `SOCKET_BRIDGE_SECRET`:

- `POST /dispatch`: Sends a new delivery offer to online candidate riders.
- `POST /trip/assign`: Authoritatively locks a rider to a delivery room upon database acceptance.
- `POST /trip/complete`: Releases the rider back to the dispatch radar (`status: available`), emits `trip_completed` to all room listeners, and tears down the room.
- `POST /trip/cancel`: Terminal-cancel twin of `/trip/complete` — emits `trip_cancelled` + `dispatch_status_update`, releases the radar rider, and evicts the trip room + RAM entry. Both endpoints share the **`applyTripTerminal`** helper in `socket-events.js`, which is idempotent on duplicate terminal calls (a duplicate cancel is a harmless no-op — canonical `cancelDelivery()` fires it only on real cancels).
- `POST /event`: One endpoint for canonical **status fan-out**. The listener `ForwardStatusEventsToBridge` forwards `OrderStatusChanged` / `DeliveryAssigned` / `DeliveryStatusChanged` via `WebsocketNotifierService::notifyStatusEvent`. `routeStatusEvent` (+ `validateAudienceRooms`) validates the target **audience rooms** (`business:{id}`, `user:{id}`, `rider:{id}`, `trip:{id}`), de-duplicates, and emits one event per room; unsupported/malformed rooms → 400 and nothing is emitted.
- `GET /status`: Returns real-time health checks, connected socket counts, and active trip rooms.

---

## 3.1 Event Flow: DB State → Audience Rooms

MySQL/Laravel remains authoritative; the socket engine only caches transient room membership:

```text
MySQL transition (row lock + commit)
   ↓
OrderStatusChanged | DeliveryAssigned | DeliveryStatusChanged   (dispatched once)
   ↓
ForwardStatusEventsToBridge  →  WebsocketNotifierService::notifyStatusEvent
   ↓
POST /event  (x-socket-secret)
   ↓
routeStatusEvent → emit to business:{id}, user:{id}, rider:{id}, trip:{deliveryId}
   ↓
    │ business:{id}      → BusinessOwnerKitchen (live indicator, query invalidate)
    │ user:{id}          → TouristOrderStatus (order status / terminal cancel)
    │ rider:{id}, trip:  → assigned rider + live tracking
```

- **Authoritative dispatch points**: `DeliveryAssigned` on successful rider acceptance (`NearestRiderService` accept branch, never on offers); `OrderStatusChanged` at every restaurant transition (`BusinessOwnerOrderController` accept/assign/start/mark-ready/acceptAll/acceptItem/reject, `BusinessOwnerKitchenController::updateStatus`, `Order::refreshStatusFromItems`); `DeliveryStatusChanged` at the rider/delivery transitions (`NearestRiderService`, `RiderMapController`, `RiderDeliveryController`).
- **Cancellation** bridges `notifyTripCancelled` → `/trip/cancel` from the canonical `cancelDelivery()` (covers reject, auto-cancel, refund paths — one call site, single-fire).
- **Duplicate safety**: event discovery is disabled (`bootstrap/app.php → withEvents(false)`) because every listener is registered explicitly in `$listen` — this is what makes "one DB transition ⇒ exactly one `/event`" hold; otherwise each listener fired twice. `applyTripTerminal` and `/event` are themselves idempotent under provider-side retries.
- **Never authoritative**: the socket engine cannot be repolled for authoritative state. Every client keeps an HTTP/API polling fallback (kitchen order feed, tourist order status, rider map) — reconnects recover via the API, not socket RAM.

## 3.2 Room Membership & Tokens

| Room | Join auth | Token endpoint |
|---|---|---|
| `trip:{deliveryId}` | HMAC trip token (`TripTokenService::issueTripToken`) + rider must hold the `/trip/assign` assignment | minted into `food.orderStatus` tracking payload |
| `user:{id}` | HMAC user token (`TripTokenService::issueUserToken`) | `POST /api/socket/user-token` |
| `business:{id}` | Laravel-scoped token (`SocketChannelAuthorizer`, per-role + ownership check) | `POST /api/business-owner/socket/token?business_id=` |
| `rider:{id}` | driver-bound socket identity (existing rider auth) | — (broadcast target, not a join room) |

`routes/channels.php` + `BroadcastServiceProvider` (rewritten for Laravel 12.62, where the legacy base class was removed) keep broadcast routing wired. `useBusinessSocketNotifier` (kitchen) and `useUserSocketNotifier` (tourist) on the React side mint the tokens and join `business:{id}` / `user:{id}`; `useCustomerMapSocket` joins `trip:{deliveryId}` and now also surfaces the terminal `trip_cancelled` state to drive the cancellation exit UI.

---

## 4. Client Resilience & Fallback

- **Connection Lifecycle**:
  - Clients attempt up to 5 automatic reconnections with a 2000ms delay.
  - Upon reconnection, `useCustomerMapSocket` re-authenticates using the cached HMAC token.
- **HTTP Polling Fallback**:
  - If the socket connection fails permanently or the token is invalidated, the client seamlessly falls back to querying `GET /api/orders/{order}/status` every 4 seconds.
  - Displays a visual badge on the UI: `Live (Socket)`, `Reconnecting...`, or `Polling (HTTP)`.
