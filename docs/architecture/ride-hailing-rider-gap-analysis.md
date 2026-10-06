# Motorcycle Ride-Hailing — Rider-Side Gap & Feasibility Analysis

> **Status:** Analysis only — no code written.
> **Source spec:** *Motorcycle Ride-Hailing — Rider/Driver-Side Product & UX Specification v1.0*
> **Date:** 2026-09-24
> **Method:** READ → AUDIT → IDENTIFY CANONICAL PATH (AGENTS §19). Every spec section
> was mapped against the live codebase, not the docs.

---

## 1. Executive Summary

TrackTour **already owns the passenger-ride pipeline**. A transport ride is an
`order_type = 'transport'` order with a normal `Delivery`, served by the same
dispatch → offer → atomic accept → status-transition → GPS → earnings machinery that
food delivery uses (`TransportationService`, `NearestRiderService`,
`RiderDispatchController`, `RiderDeliveryController`, `RiderMapController`,
`socket-server.js`). Roughly **70–80% of the rider spec maps onto canonical paths
that must be reused, not rebuilt.**

Core verdicts:

| Area | Verdict |
|---|---|
| Ride request / accept / decline / navigate / arrive / start / complete | **Mostly exists** — small, targeted extensions |
| Rider onboarding, documents, verification | **Planned, not built** — execute `docs/architecture/rider-system-workflow-spec.md` (all decisions RESOLVED) |
| Money flow for rides | **Broken / undefined** — needs an architecture decision before launch |
| Tourist ride-booking frontend | **Broken end-to-end** (confirmed 404 + payload mismatches) — must be repaired before rider-app work |
| Passenger verification (ride PIN) | **Tourist-only today** — PIN never reaches the rider API |
| Safety center / incident reporting / emergency | **New build** |
| Native-mobile expectations (push, background GPS, call privacy) | **Not on current web/PWA stack** — defer or re-scope |

**Feasibility: HIGH** for the rider journey inside the existing architecture. The spec's
*"Mobile App"* framing (push notifications, turn-by-turn navigation, background GPS,
privacy-preserving calls) does not map to the current Vite/React web app without a
native shell — that is a separate roadmap decision (Tier-2 "Mobile application").

---

## 2. Canonical Anchors (build on these, do not duplicate)

| Anchor | Path |
|---|---|
| Transport ride creation / fare table / status map | `app/Services/TransportationService.php` (vehicle types L19–55, `estimateFare` L57, `createRide` L82, `getRideStatus` L157) |
| Dispatch + offers + atomic accept + one-active-delivery | `app/Services/NearestRiderService.php` (`dispatchToNearest` L455, `handleRiderResponse` L790, `validateRiderAcceptance` L214) |
| Rider offer payload (what the rider sees pre-accept) | `app/Http/Controllers/Rider/RiderDispatchController.php::buildOfferPayload` L74–121 |
| Ride/order status transitions | `app/Http/Controllers/Rider/RiderDeliveryController.php::updateStatus` L51–159 |
| GPS + geofence + teleport guard | `app/Http/Controllers/Rider/RiderMapController.php` (adaptive interval L287, geofence L230) |
| Availability states | `User::RIDER_STATUS_*` (`app/Models/User.php` L65), toggles in `RiderController.php` |
| Earnings + payouts | `RiderEarning`, `RiderPayoutService`, `RiderPayoutController` |
| Realtime pings + GPS rooms | `socket-server.js` (radar L64, `startDispatchChallenge` L321, rooms), `socket-token.js`, `socket-events.js` |
| Rider onboarding/verification plan | `docs/architecture/rider-system-workflow-spec.md` |
| Money/status/architecture authority | `AGENTS.md` §4, §5, §8, §10; `docs/business-rules/*` |

---

## 3. Spec-to-Canonical Mapping (authority)

Per AGENTS §10, backend vocabulary is authoritative and labels are frontend-only.
The spec's proposed state machine §41/§42 maps onto existing states; **no new status
values are required** for the core journey:

| Spec state (§41) | Canonical TrackTour state |
|---|---|
| `AVAILABLE` | `rider_status = online / available` (derived availability) |
| `REQUEST_RECEIVED` | offer `response = pending` (`booking_dispatch_logs`) |
| `ACCEPTED` | `deliveries.status = assigned` (accepted rider bound) |
| `EN_ROUTE_TO_PICKUP` | `en_route_pickup` |
| `ARRIVED_AT_PICKUP` | `arrived_pickup` (manual or 100 m geofence) |
| `PASSENGER_VERIFIED` | **No status — frontend-only step** before `picked_up`; use ride PIN. Do NOT add a status. |
| `TRIP_STARTED` / `TRIP_IN_PROGRESS` | `picked_up` → `in_transit` / `en_route_destination` |
| `ARRIVED_AT_DESTINATION` | `arrived_destination` (geofence or manual) |
| `TRIP_COMPLETED` | `delivered` → `completed` (earnings post atomically at completion) |
| `PAYMENT_COMPLETED` | payment recorded as an idempotent side effect — never a delivery status |
| `DECLINED` | offer `response = declined` → dispatch re-offer |
| `CANCELLED_BY_PASSENGER` | `cancelled` / `cancelled_by_tourist` (+ `OrderCancellation.reason_code`) |
| `CANCELLED_BY_DRIVER`, `PASSENGER_NO_SHOW`, `DRIVER_NO_SHOW`, `PAYMENT_FAILED`, `SAFETY_CANCELLED`, `VEHICLE_BREAKDOWN` | **Not in vocabulary** — treat as state-machine decision (see §9, D3) |

Availability machine (§42): `OFFLINE → ONLINE → OFFERED_RIDE → BUSY → ONLINE` maps to
`offline / online+available / (pending offers, derived) / busy / available`. The
`OFFERED_RIDE` state is intentionally derived from pending `booking_dispatch_logs`,
**not persisted** — keep it that way (availability states stay
offline/online/available/busy).

The canonical status translation for display labels is already settled in
`rider-system-workflow-spec.md` §0.3 — reuse that table rather than inventing a new one.

---

## 4. What Already Satisfies the Spec (reuse — do NOT rebuild)

| Spec section | Existing implementation |
|---|---|
| §3 bottom nav (Home / Earnings / Trips / Profile) | Rider dashboard, earnings, deliveries/completed, profile pages under `frontend/src/features/rider` |
| §4–§7 Home / offline / online / going online | `rider_status` toggles, radar availability, `DashboardLayout` 60 s heartbeat |
| §8–§10 request → accept | `order_received_ping` socket + 4 s `/dispatch/offers` poll; `PATCH /rider/dispatch/accept` (atomic, one-active-delivery; 409/422 semantics) |
| §11 navigate to pickup | `RiderMap` + `RiderMapController::updateLocation` (adaptive interval, teleport guard); server geofence at 100 m |
| §12 arrival | `arrived_pickup` transition (manual `arrived` action or geofence auto-flip) |
| §15 start trip | `picked_up` transition from `arrived_pickup` |
| §16–§17 active trip / navigation | `in_transit` / `en_route_destination`; external map deep-link for turn-by-turn |
| §22–§23 arrive destination / end trip | `arrived_destination` → `delivered` → `completed` (prepaid) / `settle-cod` (cash) |
| §27–§30, §51–§52 earnings + trips | `RiderController::earnings/earning`, `RiderEarning` (commission + tip), `RiderPayoutService`; completed-deliveries history |
| §31 profile | `RiderProfileController` (show/update/photo) |
| §34 going offline | 409 while `busy` — exactly the spec's "complete the current trip first" |
| §41–§42 state machines | See §3 mapping |
| §43–§50, §53–§55 API/event surface | Nearly every endpoint already exists under `/api/rider/*` and `/api/transport/*` (see §8 route map) |
| §56 auth | Sanctum, role-gated rider routes |
| §61 performance metrics | Derived from orders/deliveries/earnings — reads only (Admin Phase 3/7 already plan the admin side) |
| §62 offline/poor network | Socket disconnect recovery + HTTP state restore (AGENTS §8.7); poll-based offers are resilient |
| §63 duplicate protection | DB-level guards already cover the critical ops (unique offer per rider, atomic accept under row locks, unique earnings, payment idempotency) — **no new `Idempotency-Key` header needed** |
| §64 security | Backend-authoritative fares/commissions; client-submitted GPS is validated + teleport-guarded |

---

## 5. Partial — Small, Targeted Extensions

| Spec section | Gap | Extension |
|---|---|---|
| §8–§9 request info | Offer payload pre-accept lacks `vehicle_type`, `passenger_count`, `estimated_distance_km`, `estimated_duration_min`, `payment_method`. `buildOfferPayload` shows commission but not passenger-facing fare breakdown. | Enrich `buildOfferPayload` for transport rides from `delivery.notes`. Do **not** expose the ride PIN pre-accept. |
| §13–§14 find & verify passenger | Ride PIN is **tourist-only** (`TransportController::tracking`); the rider API (`DeliveryResource`, active delivery) never returns it, so rider-side verification is impossible today. | Expose `ride_pin` (and passenger name) in the rider active-trip payload **only after `arrived_pickup`**. Verification = passenger confirms name + PIN, a frontend step before `picked_up`. |
| §24 fare breakdown | No per-ride fare/fee/commission breakdown view for the rider (commission = `max(20, fare × 40%)` from `TransportationService::createRide` L87). | Server-compute `platform_fee = fare − commission` for display only. Never trust client fares (see §7.7). |
| §27 online time / average trip | `RiderController::dashboard` has counts + earnings but no online-time or average-trip aggregates. | Trivial aggregation from `rider_status_updated_at` + completed deliveries. |
| §32 motorcycle | Vehicle registry exists on `rider_details.vehicle_*` (make/model/year/color/plate) but has **no rider-facing endpoint or UI**; verification tie-in pending. | Add `GET/PUT /api/rider/motorcycle` + a verified-status flag sourced from OR/CR + `VEHICLE_INSPECTION` (rider-system-workflow-spec §5.2). |
| §59 payouts | `available / pending / total` exists conceptually (`RiderEarning.status` pending→earned; payouts lock earnings). No rider-facing withdrawal screen. | Frontend screen against `RiderPayoutController` (`/payouts/available`, `/payouts/request`). |
| §60 ratings | Tourist rates the **order** (`orders.rating/review`); `RiderController::dashboard` hard-codes `rating = 0` (L45). No tourist→rider rating. | New rider-rating model + aggregation (see D5). Defer; not ride-critical. |
| §18 chat + "call" | In-app chat exists (`ChatController`, `/rider/messages`). Number privacy (platform-mediated call) does not; `TransportController::tracking` currently leaks `contact_number`. | Keep chat; gate phone exposure behind a platform-call or reveal-after-accept decision. |

---

## 6. New Builds (genuinely absent)

| Spec section | Build | Notes |
|---|---|---|
| §31, §33, §56–§58 onboarding & verification | Rider document pipeline + safety seminar + driving test + vehicle inspection + readiness gate | **Already designed** in `docs/architecture/rider-system-workflow-spec.md` (§4, §5.1–5.3, decisions RESOLVED). Execute that plan: `rider_verifications` table, `RiderVerificationGate`, upload UI, admin verify, expiry command. This is the biggest new backend surface. |
| §35–§39 safety center | Emergency help, share-trip, incident reporting, breakdown flow, accident flow | Entirely new. Admin has only an SOS **stub** page. New endpoints under `/api/rider/safety`; incident reporting table. |
| §25–§26 cash/digital payment flows for rides | Cash-collection confirmation + digital-payment completion | **Blocked on a money decision** (D1/D2). Current transport rides have no payment wiring at all. |
| §40 notifications center | Rider notification list + per-event realtime | DB `NotificationService` exists; no rider notification UI. Socket events partially delivered. |
| §54–§55 missing screens/routes | `/rider/motorcycle`, `/rider/documents`, `/rider/notifications`, `/rider/safety`, `/rider/support` | Frontend + (where needed) API. |
| Native-mobile affordances | Push (FCM removed — decision 003), background GPS, turn-by-turn, call privacy | Requires native shell (Tier-2 roadmap) — out of web scope. |

---

## 7. Confirmed Defects Found During This Audit

These are **active breaks**, verified in code, not speculative. Repairing them is
pre-requisite work for any rider-app build, because the tourist ride flow is what
produces the requests the rider app serves.

| # | Defect | Evidence |
|---|---|---|
| 1 | Ride booking 404s | `BookRideSheet.tsx:34` POSTs `/tourist/transport/request`; route is `/tourist/transport/book` (`routes/api.php:219`). |
| 2 | Fare estimate always fails validation | `BookRideSheet.tsx:27` sends `dest_lat/dest_lng`; `TransportController::estimate` (L64–69) requires `destination_lat/destination_lng`. |
| 3 | Booking payload incompatible | Sheet sends 6 fields; `BookTransportRequest` requires `vehicle_type`, `passenger_count`, `fare`, `distance_km`, `duration_min`, `payment_method` → guaranteed 422. |
| 4 | Estimate shape mismatch | Sheet expects `fare_min/fare_max`; `estimateFare` returns `fares{}` per vehicle type + distance/duration. |
| 5 | Tracking screen is a stub | `TouristTransportTracking.tsx` consumes a `TripData` shape that matches neither `tripStatus()` (raw `Order`) nor `tracking()` payload. |
| 6 | Passenger verification impossible rider-side | `ride_pin` exists only in `TransportController::tracking`; never returned by `RiderDeliveryController`/`DeliveryResource`. No rider-side PIN = no "confirm passenger" by PIN. |
| 7 | Booking trusts client fare | `BookTransportRequest.fare` is client-supplied and stored verbatim (`createRide`); `estimateFare` is never used at book time → violates spec §64 (backend-authoritative fare) and the existing food-flow convention. |
| 8 | Transport rides have **no payment flow** | `payment_method` is recorded (default `cash`) but no `Payment` row / PayMongo intent is created for non-cash, and the food COD settlement path would allocate 80/20 against the fake `business_id = 1`. A transport ride is effectively unpaid end-to-end. |
| 9 | Rider rating is fake | `RiderController::dashboard` L45 hard-codes `rating = 0`. |

---

## 8. Rider API Route Map (what the spec's §55 tree already has)

| Spec tree | TrackTour canonical route |
|---|---|
| `/rider/profile` | `GET/PUT /api/rider/profile`, `POST /api/rider/profile/photo` |
| `/rider/status` | `POST /api/rider/availability/toggle`, `POST /api/rider/service`, `PATCH /api/rider/auto-accept` |
| `/rider/requests` | `GET /api/rider/dispatch/pending-request`, `GET /api/rider/dispatch/offers`, `GET /api/rider/dispatch/eligibility` |
| `/rider/rides/:id/accept` `/decline` | `PATCH /api/rider/dispatch/accept`, `PATCH /api/rider/dispatch/decline` |
| `/rider/rides/:id/arrived /start /complete` | `PATCH /api/rider/deliveries/{delivery}/status` (`arrived_pickup`, `picked_up`, `delivered`/`completed`), `POST /deliveries/{delivery}/settle-cod` |
| `/rider/rides/:id/location` | `POST /api/rider/map/location` |
| `/rider/earnings` | `GET /api/rider/earnings`, `GET /api/rider/earnings/{delivery}` |
| `/rider/trips` | `GET /api/rider/deliveries/active`, `/completed`, `/pending` |
| `/rider/payouts` | `GET /api/rider/payouts/available`, `GET /api/rider/payouts`, `POST /api/rider/payouts/request` |
| `/rider/motorcycle`, `/rider/documents`, `/rider/notifications`, `/rider/safety`, `/rider/support` | **Do not exist** — new (see §6) |

Existing route block: `routes/api.php` L455–488.

---

## 9. Required Decisions Before Implementation

| # | Decision | Options / recommendation |
|---|---|---|
| D1 | **Ride payment model** | (a) Prepay via PayMongo at booking like food — fits current payment architecture (AGENTS §6); (b) collect-at-end like the spec §25–§26 — needs a new end-of-trip payment/collection flow. **Recommend (a)** with a digital-payment completion status mirroring food; document the departure from spec §26. |
| D2 | **Transport cash settlement** | Food COD splits 80% restaurant / 20% Tourism Office (§5.3). A ride has no restaurant. Either (a) Tourism Office is the only allocable party for rides, or (b) rides are exempt from COD settlement and the rider keeps 100% of cash beyond recorded earnings. **Needs explicit decision; do not reuse food settlement against `business_id = 1`.** |
| D3 | **Terminal-state vocabulary** | `PASSENGER_NO_SHOW`, `VEHICLE_BREAKDOWN`, `SAFETY_CANCELLED`, driver-cancel, failed payment are new semantics. AGENTS §10 forbids silent status additions. **Recommend reusing `cancelled` + `OrderCancellation.reason_code`** (existing pattern) instead of new status values; extend the `reason_code` vocabulary only. |
| D4 | **Fare authority** | Book must recompute fare server-side from the stored estimate (or quote a fare + allow driver/passenger confirmation), never trust the client. |
| D5 | **Rider ratings** | New tourist→rider rating model (orders currently carry the rating). Small; defer to a later phase. |
| D6 | **Vocabulary bridging** | Spec says "ride/passenger/driver"; TrackTour says "order/delivery/tourist/rider". Keep backend vocabulary; map labels in the frontend constants layer only (established pattern). |

---

## 10. Recommended Implementation Path

Every phase ends on a tested checkpoint (AGENTS §13: full suite, 0 failures, docs updated).

- **R1 — Repair the tourist ride flow.** Fix defects §7.1–§7.5 (route, estimate/booking payloads, tracking screen against the canonical `tracking()` payload). Add rider-side PIN + confirm-passenger step (§7.6). Tests: booking 200, estimate shape, tracking render, PIN verification gate.
- **R2 — Rider onboarding & verification.** Execute `rider-system-workflow-spec.md` §5.1–§5.3 end-to-end (migrations, `rider_verifications`, gate service, admin verify, rider upload UI, expiry command). Unblocks spec §31/§33/§56–§58 and the §6 "ready to ride" gate.
- **R3 — Rider journey UX hardening.** Enrich offer payload (§5 request info), add area match / motorcycle profile endpoints, fare-breakdown screen, external turn-by-turn, earnings aggregates (online time/avg), payouts screen.
- **R4 — Money wiring for rides.** D1 + D2 decisions implemented: PayMongo prepay for non-cash rides; explicit transport cash handling; ride completion posts earnings. Tests: payment idempotency, settlement allocation for rides, earnings posting.
- **R5 — Safety & support module.** Incident reporting, emergency/share-trip, breakdown flow, rider notification center. NEW endpoints.
- **R6 — Performance & reports.** Rider performance view + (admin side is already planned as Admin Phase 3/7).

Dependency note: R2 is independent of R1; R4 depends on D1/D2; everything else is incremental.

---

## 11. Architecture Constraints to Preserve (no regressions)

- **One active delivery per rider** (§4.3) — already enforced for transport rides; never loosen for a "ride-hailing" mode.
- **Backend-authoritative fare/commission/earnings** — never trust the rider app (spec §64; already the food-flow convention).
- **Socket is never authoritative** (§8) — HTTP recovery + DB constraints stay the source of truth; poll-based offers stay.
- **No new status values without a migration decision** (§10) — see D3.
- **No rewrites** of `NearestRiderService`, `SmartDispatchService`, COD settlement, payment idempotency, refund processor, payout architecture, GPS token security, or the socket engine (§16).
- **No Firebase/push reintroduction** (decision 003) — offers remain socket + poll.
- **Spec's native-mobile affordances** (push, background GPS, call privacy) are explicitly out of web-app scope until the Tier-2 mobile decision.

---

## 12. Non-Goals

- No new passenger-ride "statuses" beyond the §3 mapping unless D3 explicitly approves them.
- No re-architecture of dispatch for "ride-hailing mode" — transport rides already route through the canonical dispatch.
- No native mobile build in the web phase; no new notification backend (FCM).
- No marketing/bonus/surge engine (spec §28 says the financial model is config/configurable — TrackTour's commission model governs).