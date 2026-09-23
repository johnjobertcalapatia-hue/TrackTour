# ADR 003: Custom Node.js WebSockets vs Firebase

## Status
**Accepted & Implemented**

## Context
Real-time rider tracking requires transmitting GPS coordinates every 1 to 2 seconds while a delivery is in transit. 

We evaluated using Google Firebase (Firestore / Realtime Database) versus hosting a dedicated, lightweight Node.js Socket.IO server.

## Decision
We chose a **Dedicated Node.js Socket.IO Server (`socket-server.js`)**:
- Port `3001` serves WebSocket connections to riders and tourists.
- Port `3002` serves an internal HTTP control bridge accessible only by the Laravel backend via `SOCKET_BRIDGE_SECRET`.
- In-memory trip rooms (`trip_{delivery_id}`) manage coordinate broadcasting.

## Rationale
1. **Zero Database Write Overhead**:
   - Writing 1-second GPS fixes into MySQL or cloud Firestore incurs extreme I/O load, rapid storage exhaustion, and financial API costs.
   - Coordinates in Socket.IO are broadcast directly in memory to active room listeners without touching disk storage.
2. **Deterministic Security & Custom Validation**:
   - We enforce strict anti-spoofing logic (`socket-validation.js`), teleport speed guards, and geographic bounds before fixes are accepted.
   - Room joins are secured by cryptographic HMAC-SHA256 tokens minted by Laravel (`TripTokenService`), preventing unauthorized surveillance.
3. **Local Sovereignty & Offline Resilience**:
   - Operates entirely self-hosted within the municipal server environment.
   - Dual-mode client (`useCustomerMapSocket`) automatically falls back to HTTP polling if socket connectivity is disrupted.

## Consequences
- Requires running and supervising a Node.js background process alongside the PHP/Apache server.
- WebSockets require token verification logic in both Node.js and PHP.

## Amendment (2026-09-23) — Firebase fully removed

The remaining Firebase Realtime Database mirrors were deleted rather than
merely disabled:

```text
app/Services/FirebaseService.php  → deleted
config/firebase.php               → deleted
firebase.rules.json, FIREBASE_RULES.md → deleted
FIREBASE_* / VITE_FIREBASE_*      → removed from .env
```

Removed call sites: rider availability toggle / switch-service / logout mirrors,
dispatch `createRiderRequest`/`createBookingRequest`, offer accept/decline/timeout
cleanup, cancellation release mirror, guide trip start/location/end nodes, chat
broadcast, and the `/rider/map` `firebase_config` payload.

Authoritative state was never in Firebase (ADR 003), so no behavior moved:
MySQL + `WebsocketNotifierService` remain the canonical sources. The
`users.firebase_uid` column was left in place (nullable, unwritten) as a
deferred schema cleanup.
