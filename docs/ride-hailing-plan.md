# Tourist Motorcycle Ride-Hailing — Implementation Plan

**Version:** 1.0
**Status:** Approved (plan only — implementation proceeds phase-by-phase per checkpoint)
**Product spec:** Tourist Ride-Hailing spec v1.0 (MVP scope §46 + bug fixes)
**Decision:** Scope = MVP (§46) + integration bug fixes. API shape = canonical `tourist/transport/*` (no `/api/rides` aliases). Vehicle types = keep motorcycle/tricycle/car/van (motorcycle stays default). Implementation is a planned track — it does NOT replace the Dispatch P4–P6 → Admin roadmap.

---

## 1. Architecture Grounding

Ride-hailing already exists as the **Transport** feature, reusing the food-delivery dispatch pipeline:

```text
orders (order_type='transport') → order_items → deliveries → booking_dispatch_logs (offers)
```

Canonical consumers (all verified, do NOT rebuild):

- `TransportController` + `TransportationService` — booking / fare / cancel / rate / status
- `NearestRiderService` — service-gated dispatch (`current_service` must match `order_type`), atomic accept via `BookingDispatchLog`
- `Delivery` + `RiderMapController` — lifecycle, GPS, pickup/destination geofences
- `HistoryController` — `?tab=transport` history split
- `RideHailingAcceptanceTest` — dispatch-gating protection

Rides dispatch at booking time; `payment_method` is stored on the order; GCash payment is a post-trip PayMongo intent. `business_id = 1` ride ownership is a known, previously-deferred decision (unchanged here).

---

## 2. Current Integration Defects (root causes of the 404s)

| # | Defect | Location | Effect |
|---|---|---|---|
| B1 | `BookRideSheet` POSTs `/tourist/transport/request` | `BookRideSheet.tsx:34` | 404 — canonical route is `/book` |
| B2 | Estimate payload uses `dest_lat`/`dest_lng` | `BookRideSheet.tsx:27-28,54-57` | 422 — backend requires `destination_lat`/`destination_lng` |
| B3 | Estimate response parsed as `fare_min`/`fare_max` | `BookRideSheet.tsx:14-18,127` | Always `₱0.00` — backend returns `{fares: {vehicle: {fare, fare_text}}}` |
| B4 | Book payload missing `vehicle_type`, `fare`, `distance_km`, `duration_min`, `payment_method` | `BookRideSheet.tsx:34-41` | 422 even after route fix (`BookTransportRequest`) |
| B5 | JSON `book()` calls `route('tourist.transport.tracking')` — named route does not exist | `TransportController.php:90` | `RouteNotFoundException` → 500 on every API booking |
| B6 | `index()` non-JSON calls `route('tourist.map')` — dead name | `TransportController.php:31` | 500 on direct browser nav |
| B7 | `tripStatus` returns a bare `Order` | `TransportController.php:34-39` | Tracking page expects `tripNumber`/`fare`/`rider`/coords — gets none; track view is a skeleton |
| B8 | `cancelTrip` has no lifecycle guard, no `cancellation_fee` | `TransportController.php:41-47` | Can cancel a completed trip; spec §31 contract missing |
| B9 | `TouristTransport.tsx` expects static `TransportOption[]` | `TouristTransport.tsx:8-17,41-47` | Backend serves paginated ride Orders → empty/undefined cards |

Note: `TransportController::tracking()` is dead wiring (its named route `tourist.transport.tracking` does not exist in `routes/*`). The SPA owns routing; the API surface under `tourist/transport/*` is the canonical integration point.

---

## 3. Canonical Ride Status Contract

`getRideStatus()` maps (order/delivery lifecycle) → tourist-facing ride status:

```text
searching        pending / confirmed / preparing / waiting (no accepted rider yet)
arriving         assigned / en_route_pickup
driver_arrived   arrived_pickup
in_progress      picked_up / in_transit / en_route_destination
completed        arrived_destination / completed
cancelled        cancelled (order or delivery)
```

`tripStatus` returns a stable JSON contract (snake_case, codebase convention):

```json
{
  "id": 123,
  "order_number": "TRP-...",
  "status": "searching|arriving|driver_arrived|in_progress|completed|cancelled",
  "ride_pin": "1234",
  "pickup_address": "...", "pickup_latitude": 12.51, "pickup_longitude": 121.31,
  "destination_address": "...", "destination_latitude": 12.60, "destination_longitude": 121.40,
  "vehicle_type": "motorcycle", "vehicle_color": "#16a34a", "passenger_count": 1,
  "payment_method": "gcash",
  "fare": 150, "distance_km": 3.5, "duration_min": 12, "eta_minutes": 12,
  "booking_notes": "...",
  "rider": {"id": 1, "name": "...", "rating": 4.9, "plate_number": "...",
            "contact_number": "...", "profile_photo": null},
  "is_rated": false, "rating": null, "review": null,
  "created_at": "...", "started_at": null, "completed_at": null,
  "cancelled_at": null, "cancellation_reason": null, "cancellation_fee": 0
}
```

Cancel lifecycle guard: cancel allowed only while `ride_status ∈ {searching, arriving, driver_arrived}`; otherwise 422. Response: `{status: "cancelled", cancellation_fee: 0}` (fee = 0 for MVP).

---

## 4. Phases

### Phase 1 — Fix the broken integration (bug checkpoint) ✅ COMPLETE (2026-09-24)

Backend:
- B6: `index()` JSON-only (remove dead `route('tourist.map')` branch).
- B5: JSON `book()` returns `redirect` as a plain string `/tourist/transport/tracking/{id}`.
- B7: `tripStatus()` returns the rich contract above (from `getRideStatus()`), including `is_rated`.
- B8: `cancelTrip()` lifecycle guard + `cancellation_fee`.
- B10: **server-authoritative fare** — `createRide()` re-derives fare/distance/duration from coordinates + vehicle type (`estimateFare()`), ignoring client-supplied values; `BookTransportRequest` fields demoted to advisory; `book()` returns the authoritative `fare` (spec §64).
- Extend `getRideStatus()` statusMap: `arrived_pickup → driver_arrived`, add `cancelled`.
- Verify ride_status resolves from the delivery lifecycle (not stuck at order `pending` → `searching`).

Frontend:
- B1–B4: fix `BookRideSheet.tsx` route + payload + response parsing.
- B9: rewrite `TouristTransport.tsx` as the booking hub consuming canonical responses.
- Align `TouristTransportTracking.tsx` to the rich `tripStatus` contract.

Tests (`TouristTransportContractTest`):
- JSON `book` returns 201 + string redirect (no 500 RouteNotFound).
- `tripStatus` returns `status`/`vehicle_type`/`rider`/`is_rated` for owner; 404 for another user.
- `estimate` 422 on legacy `dest_lat` field names; 200 on canonical names.
- `cancelTrip` 422 after start; 200 + `{cancellation_fee: 0}` pre-start; ownership enforced.
- Existing `RideHailingAcceptanceTest` re-run green (dispatch backbone intact).

Exit: full suite 0 failures; `docs/PROGRESS.md` checkpoint.

**Phase 1 checkpoint (2026-09-24):** COMPLETE & VERIFIED — twice-verified. Round 1: all contract-fault fixes (B1–B9) pinned by `TouristTransportContractTest` (**10 / 36**). Round 2 (client-fare closeout, B10): `createRide()` authoritative-fare + advisory request fields, +2 tests (**12 / 46**), `RideHailingAcceptanceTest` fare assertion reconciled to `expectedMotorcycleFare()`. Final: full suite **443 passed / 2,350 assertions / 0 failures / 7 skipped** (known env skips); socket JS **45/45**; frontend `npm run build` clean. Full record: `docs/PROGRESS.md` → "Tourist Ride-Hailing — Phase 1".

### Phase 2 — Pickup & destination selection (spec §3–7)

- `GET /tourist/transport/locations/search?q=` — local registry search (`TouristDestination`, accommodation/restaurant `Business`, `Municipality`/`Barangay`), no external geocoder. Returns `[{id, type: attraction|stay|restaurant|municipality|barangay, name, address, lat, lng}]`.
- `GET /tourist/transport/locations/reverse-geocode?lat&lng` — nearest known place within 2 km else "Picked location" fallback.
- Frontend: multi-step `BookRideSheet` (Destination → Pickup → Trip summary) with live search, Leaflet map pin + reverse-geocode label, "Use current location", manual entry, recent destinations (localStorage `tracktour_recent_locations`). Hub CTA opens the sheet with `initialQuery` instead of navigating away.

**Phase 2 checkpoint (2026-09-24):** COMPLETE & VERIFIED. Backend: `TransportationService::searchLocations()` / `reverseGeocodeLocation()`, thin `TransportLocationController`, two routes added under the tourist group. Pinned by `TouristTransportLocationContractTest` (**9 / 33**): active-destination/approved-business filtering, municipality/barangay via parent-municipality match, empty-q, auth 401, nearest-within-radius, "Picked location" fallback, 422 on bad coords. Frontend: `BookRideSheet` rewritten as a 3-step flow (search + pin + current-location + manual + recents), `TouristTransport` CTA opens it with `initialQuery`; Phase 1 `TouristTransportContractTest` + `RideHailingAcceptanceTest` re-run green. Final: full suite **452 passed / 2,383 assertions / 0 failures / 7 skipped** (known env skips); socket JS **45/45**; frontend `npm run build` clean. Full record: `docs/PROGRESS.md` → "Tourist Ride-Hailing — Phase 2".

### Phase 3 — Route preview, fare breakdown, confirmation (spec §7–10)

- Fare model UNCHANGED (`base_fare + per_km × distance`). `estimate()` gains explicit line items `{base_fare, distance_fare, total_fare, duration_min, distance_km}`. `service_fee` config-driven, default 0, shown only when > 0 — not added to `orders.total` in MVP.
- `POST /tourist/transport/route` (small): OSRM polyline via existing `config/delivery.php`; frontend falls back to straight dashed line.
- Frontend: RoutePreview (pins + polyline + vehicle fare chooser + payment), ConfirmRide summary.

**Phase 3 checkpoint (2026-09-24):** COMPLETE & VERIFIED. Backend: `estimateFare()` now returns per-vehicle line items `{base_fare, distance_fare, total_fare, distance_km, duration_min}` (legacy `fare`/`fare_text` preserved) plus top-level `service_fee` (new `config/delivery.php service_fee`, default 0, NOT in `orders.total`); `DeliveryFeeService::routePolyline()` decodes OSRM GeoJSON via `config('delivery.routing_url')`; `TransportationService::getRoute()` returns an OSRM polyline or a straight-line fallback; `POST /tourist/transport/route` added. Pinned by `TouristTransportRouteContractTest` (**6 / 40**, with existing 3 transport suites re-run: 32 total green). Frontend: `BookRideSheet` summary step now renders a RoutePreview Leaflet map (pickup/destination pins + green OSRM polyline or grey dashed fallback, fit-bounds) and an itemized fare breakdown (base + distance [+ service fee when > 0] = total). Final: full suite **458 passed / 2,426 assertions / 0 failures / 7 skipped** (known env skips); socket JS **45/45**; frontend `npm run build` clean. Full record: `docs/PROGRESS.md` → "Tourist Ride-Hailing — Phase 3".

### Phase 4 — Active ride states + completion (spec §11–22, §28) ✅ COMPLETE (2026-09-24)

- `tripStatus` drives the active-ride screen. Add `eta_minutes`.
- `no_driver_found`: pre-assignment cancel surfaces `cancelled` + `cancellation_reason`.
- Driver verification: `arrived_pickup → driver_arrived` shows the Verify card (rider photo, name, plate, `ride_pin`). Trip start stays rider-driven (no dispatch gate change).
- Frontend: Searching screen, DriverMatched card, Share trip (Web Share + copy link), Safety center (config-driven emergency numbers), quick messages (UI-only MVP).
- Tests: status transitions, cancel block after start, pre-assignment cancel reason, ownership.

**Phase 4 checkpoint (2026-09-24):** COMPLETE & VERIFIED. The tracking screen is rewritten to share the delivery map, canonical markers (`src/shared/utils/map-markers.ts`), and the OSRM road-following route (full-trip via `POST /tourist/transport/route` + live rider→target segment via `useOsrmRoute`) while keeping the ride status flow. Live rider position uses the P11.5 `useCustomerMapSocket` (`trip:<deliveryId>` + `rider_location_stream`) with HTTP-polled `rider_location` fallback. Backend: `createRide()` sets `user_id`, new shared `OrderTrackingService::customerBlock()` (null-safe), `FoodController` refactored onto it, `tripStatus()` returns `rider_location` + `tracking`. Pinned by `TouristTransportContractTest` (+4 → **16 / 67**): user_id subject, tracking block + rider_location after accept, null while searching, null without bridge secret. Final: full suite **485 passed / 2,532 assertions / 0 failures / 7 skipped** (known env skips); socket JS **45/45**; frontend `npm run build` clean + `npm run lint` clean for touched files. Full record: `docs/PROGRESS.md` → "Tourist Ride-Hailing — Phase 4".

### Phase 5 — Payment, final fare, rating, history (spec §20–23, §32–33)

- `rateTrip` optional `tags` (`friendly|safe_driving|clean_vehicle|good_communication|arrived_on_time`) → migration `add_rating_tags_to_orders`.
- Receipt: fare breakdown + estimate-vs-final explanation. Fix PayMongo line-item label `'Food Subtotal'` → ride-aware label.
- Frontend: TripComplete/Receipt, Rating (stars + tags + comment, non-blocking).
- Tests: rating persists tags, receipt math, GCash label.

**Phase 5 checkpoint (2026-09-24):** COMPLETE & VERIFIED. Receipt state finalized: `rateTrip` (`POST /tourist/transport/trip/{id}/rate`) validates `tags` via `Rule::in(TransportationService::RATING_TAGS)` (max 5 distinct), persists `orders.rating_tags` (migration `2026_09_24_000003` applied + write-probed), completed-ride-only + idempotent; transport orders are scoped to the endpoint (a tourist cannot rate a food order via it). `PaymentController::createIntent` renders the ride-aware `'Ride Fare'` line item for transport orders and refuses a cancelled ride (422); `markPayablePaid`'s transport branch records paid state only — never the kitchen fan-out, never resurrecting a cancelled ride; `tripStatus` exposes `payment_status`/`paid_amount`/`rating_tags`/`allowed_rating_tags`. **Receipt math** — new `TransportationService::getFareBreakdown($vehicleType, $totalFare)` exposes `base_fare`/`distance_fare`/`service_fee`/`total_fare` with the invariant **base + distance === total** (the distance leg is `total − base` to absorb the booking-time raw-distance rounding; `service_fee` stays out of `orders.total`); `tripStatus` now returns `base_fare`, `distance_fare`, `service_fee`, `estimate_fare` (est === final in the single-fare MVP). Contract suite **29 / 114** (receipt math + payment-state + rating gates + webhook transport/no-resurrect). Frontend: S80 `TripReceipt` (fare breakdown, estimate-vs-final row only when they differ, Paid/pending from `payment_status`/`paid_amount`) and `RatingSheet` (stars + tag chips + comment + Skip/Submit, submits `{rating, review, tags}`) wired into `TouristTransportTracking`; the Pay button is method-aware (GCash/Card only — Maya rides show a settlement support note and never render a pay button). Final: full suite **496 passed / 2,664 assertions / 0 failures / 7 skipped** (known env skips); socket JS **45/45**; frontend `test:ui` 70 passed / 10 files, `build` clean, `oxlint`/`tsc` clean on touched files; DB verification done. Full record: `docs/PROGRESS.md` → "Tourist Ride-Hailing — Phase 5".

### Phase 6 — Notifications + polish (MVP completion)

- Ride transitions to existing `Notification` rows + `user:{userId}` socket room via existing events; verify rides emit on transition points.
- Driver-cancelled handler, reconnect recovery (5s polling already present), accessibility pass on new screens.

**Phase 6 checkpoint (2026-09-24):** COMPLETE & VERIFIED. **Ride notifications** — the three canonical listeners are now ride-aware during valid states with no new event system: `SendDeliveryAssignedNotification` (tourist `Ride Status Updated` row on assign; rider row unchanged), `SendDeliveryStatusNotification` (ride wording map across `assigned`/`en_route_pickup`/`arrived_pickup`/`picked_up`/`in_transit`/`arrived_destination`/`completed`; food branch untouched and `$message` still resolved for non-transport orders), `SendOrderStatusNotification` (transport cancel → tourist "Your ride has been cancelled"). **Driver-cancelled handler** — `TransportationService::cancelRideByDriver()` (transport-only; locked transaction cancels order + delivery while releasing the rider to `available`, then fires `OrderStatusChanged` + best-effort `notifyTripCancelled`), exposed as `POST /rider/deliveries/{delivery}/cancel-ride` (403 unless the assigned rider, 422 if pickup already happened); `DeliveryResource` now returns `order_type`. Frontend: rider "Cancel Ride" action on active transport trips with confirm modal in `RiderDeliveriesActive`. **Accessibility pass** — `TouristTransportTracking` gets aria-labels on the icon-only Back/Call controls, `role="dialog"`/`aria-modal`/`aria-labelledby` on the cancel + safety modals, Escape-to-close for all three modals, and `role="status"` on the toast. Reconnect recovery already present via 5s HTTP polling (no change). Pinned by `TransportRideNotificationsTest` (**6 / 38**): assignment notification, driver-cancels lifecycle incl. tourist cancel notice + rider release, block-after-pickup 422, assigned-rider 403, food-delivery 422, transition wording across states. Final: full suite **502 passed / 2,702 assertions / 0 failures / 7 skipped** (known env skips); socket JS **45/45**; frontend `test:ui` 70 passed / 10 files, `build` clean, `oxlint`/`tsc` clean on touched files (no new tsc errors introduced). Full record: `docs/PROGRESS.md` → "Tourist Ride-Hailing — Phase 6". MVP delivery/driver/tourist notification surface complete.

### Deferred (documented, not MVP)

- Spec §25–26 i18n / currency conversion, §34–35 guest onboarding, §28 `PAYMENT_FAILED`, payment-gated dispatch, masked contacts, airport zone warnings, external geocoder, `business_id = 1` ride ownership.

---

## 5. Test & Checkpoint Policy (AGENTS.md §13, §18)

Every phase:
1. Targeted contract tests.
2. Full suite — **0 failures** (baseline 381 tests / 1,846 assertions / 0 failures / 7 skipped; 46/46 socket JS).
3. Database verification where applicable.
4. `docs/PROGRESS.md` checkpoint (Tests / Assertions / Failures / Skipped).

No changes to: `SmartDispatchService`, `NearestRiderService` accept logic, COD settlement, payment idempotency, refund processor, Socket.IO.