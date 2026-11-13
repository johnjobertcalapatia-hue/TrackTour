# Ride-hailing redesign (2026-11-10)

Source: the user's "Ride-Hailing Flow: 5 Seamless Phases" mockup (tourist
phases 1–5 + driver overview 1–4).

## Decisions (user, 2026-11-10)

- **Order:** tourist flow first (5 screens), then the driver flow (4 screens).
- **New features to build:** SOS button, tip after the ride, chat with the
  driver.
- **Left out for now:** "Add Stop" (route/fare change mid-trip).
- The design follows the mockup: green header, map-first screens, white
  rounded cards, dark-green "finding your driver" screen, large green CTAs.

## Tourist phases → existing system

| Mockup phase | Existing data / endpoint | Notes |
|---|---|---|
| 1 Request & configuration | `POST /tourist/transport/estimate` (fare, duration, pax per vehicle), `/transport/locations/search`, `POST /transport/book` | Vehicles: motorcycle, tricycle, car, van. Home/Work chips → recent / saved destinations (no saved-home backend). |
| 2 Matching & dispatch | `GET /transport/trip/{id}/status` → `status = searching`; `POST /transport/trip/{id}/cancel` | Dark-green radar screen, elapsed timer, Cancel Request. |
| 3 En route to pickup | status `arriving` / `driver_arrived`; `rider` (name, rating, photo, vehicle, plate, phone), `rider_location`, `tracking` | Arriving-in card, driver card, Call + Chat, progress, Share trip. |
| 4 In-trip journey | status `in_progress`; route via `/transport/route` | ETA + distance card, **SOS**. No turn-by-turn data: show "Heading to destination". |
| 5 Drop-off, payment & review | status `completed`; `fare`, `payment_method`, `paid_amount`; `POST /transport/trip/{id}/rate` (rating, review, tags) | Fare, paid via, stars, **tip**, feedback, Submit Review. |

## New backend work

- **SOS:** admin `/admin/live/sos*` endpoints are stubs today. Needs an
  `sos_alerts` table, a tourist (and later rider) create endpoint, real admin
  list / acknowledge / respond / resolve.
- **Tip after the ride:** rides only (food fast-delivery tips stay
  checkout-time, AGENTS.md §5.4). Must reach rider earnings; GCash tips need a
  PayMongo payment distinct from the paid fare (the paid-once guard on the
  order must not swallow it).
- **Chat:** per-trip messages between tourist and assigned rider (table +
  endpoints, realtime via the existing socket bridge, HTTP polling fallback),
  only while the trip is active.

## Status

- [x] Phase 1 Request screen — green "Where are you going?" panel with recent
      destination chips; booking summary restyled: vehicle cards (icon, min,
      pax, fare, check), "Pay with" chips, "Book Ride Now · ₱fare" CTA.
- [x] Phases 2–5 tracking screens — `components/ride/RidePhases.tsx`:
      full-screen dark-green search (radar, timer, Cancel Request); map with
      ETA card + driver card (call), progress, PIN at pickup, share / cancel;
      in-trip ETA + distance + SOS (opens the Safety sheet until the SOS
      backend lands); completed: fare, paid via, stars + tags + feedback →
      `/rate` (replaces RatingSheet), receipt on demand. Screens sized with
      `.tourist-map-page` (between header and bottom bar). Fixed a crash when
      the route API returns no polyline. Tests: `tourist-ride-phases` (7).
- [ ] SOS (backend + UI + admin list)
- [ ] Tip after ride (backend + payment + UI)
- [ ] Chat (backend + realtime + UI)
- [ ] Driver flow 1–4
