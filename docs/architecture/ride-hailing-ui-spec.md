# Ride-Hailing UI — Screen-by-Screen Specification (Tourist Passenger App)

**Version:** 1.0
**Status:** Draft (supersedes nothing — extends the shipped Transport feature)
**Related:** `docs/ride-hailing-plan.md` (canonical plan, Phases 1–3 COMPLETE, 4–6 pending) · `docs/architecture/ride-hailing-rider-gap-analysis.md` · `docs/architecture/frontend-architecture.md` · `docs/DESIGN_SYSTEM.md`

---

## 0. Grounding Decision (read first)

Ride-hailing in TrackTour is **already built and shipped** as the **Transport** feature — not a
greenfield app. Backend Phases 1–3 (integration fix, location selection, route/fare) are
**COMPLETE & VERIFIED (2026-09-24)**. Three screens already exist:

| Proposed screen (this spec) | Canonical file | Status |
|---|---|---|
| Home / "Where are you going?" | `frontend/src/features/tourist/pages/TouristTransport.tsx` | Built (Phase 1–2) |
| Destination → Pickup → Ride options → Confirm | `frontend/src/features/tourist/components/BookRideSheet.tsx` | Built (Phase 2–3) |
| Driver searching → arriving → arrived → trip | `frontend/src/features/tourist/pages/TouristTransportTracking.tsx` | Partial (Phase 4) |
| Activity / past rides | `MyTrips.tsx` + `TouristTransport` recent list + `HistoryController ?tab=transport` | Built |
| Receipt / rating | tracking page `completed` state | Partial (Phase 5) |
| Wallet | *(no tourist wallet exists)* | Deferred — see §11 |
| Profile | `TouristProfile.tsx` | Built (unrelated to rides) |

**This spec therefore defines the screen-by-screen UI as an evolution of the existing
Transport feature**, executed through the pending **ride-hailing-plan Phases 4–6**. It does
not propose a standalone app, a new route namespace, or a parallel component tree.

Hard constraints inherited from the plan and `AGENTS.md` (see §12) are non-negotiable:
canonical API stays `tourist/transport/*` (no `/api/rides` aliases), vehicle types stay
**motorcycle / tricycle / car / van**, and **no new status values** may be introduced.

---

## 1. Proposed-vs-Canonical Alignment

### 1.1 Bottom navigation — keep the existing tourist shell

The proposed **Home / Activity / Wallet / Profile** tab bar belongs to a standalone
ride-hailing app. TrackTour's tourist experience already ships a bottom nav
(`TouristLayout`, `lg:hidden`): **Home · Explore · Map · Saved · Profile**, plus a
desktop sidebar (DISCOVER / ACTIVITY).

**Decision:** rides remain a module *inside* the tourist shell. Do not ship a second
bottom nav — it would fragment navigation and split the tourist role's RBAC surface.

Mapping of the four proposed tabs onto what already exists:

| Proposed tab | Canonical location | Action |
|---|---|---|
| 🏠 Home (request a ride) | `/tourist/transport` hub → opens `BookRideSheet` | Add entry CTA on `TouristHome` + active-ride banner |
| 🕘 Activity (current + past) | `/tourist/trips` (`MyTrips`) and `/tourist/transport` recent list | Keep; fix transport row deep-link (§7.4) |
| 💳 Wallet | No tourist wallet table exists | **Deferred** (§11) — payment method is chosen per-booking; GCash bind already exists at `/tourist/profile` |
| 👤 Profile | `/tourist/profile` | Unchanged |

Persistent ride access: a **green active-ride banner** is rendered from the hub header and
`TouristHome` whenever `GET /tourist/transport` returns a trip in
`searching|arriving|driver_arrived|in_progress`, navigating to `/tourist/transport/tracking/:id`.

### 1.2 Ride tiers → canonical vehicle types

The proposed **Economy / Comfort / XL** tiers are a presentation concept. The backend fares
are keyed by `vehicle_type`; renaming or adding tiers would break `estimate()` and
`book()` contract tests. Present the **four canonical vehicles** as the ride options:

| Proposed tier | Canonical `vehicle_type` | Icon (lucide) | Seats label | ETA column |
|---|---|---|---|---|
| Economy | `motorcycle` (default) | `Bike` | 1 | *not available pre-dispatch* |
| Comfort | `tricycle` | `Bike` | up to 4 | *not available pre-dispatch* |
| — | `car` | `Car` | up to 4 | *not available pre-dispatch* |
| XL / Group | `van` | `Bus` | up to 6 | *not available pre-dispatch* |

**ETA honesty rule:** the user's table shows a *driver-arrival* ETA ("3 min") per ride. The
estimate API returns **trip duration** (`duration_min`), not driver ETA. Driver ETA exists
only **after** a rider is assigned (`eta_minutes` in `tripStatus`). Pre-dispatch the options
grid shows **trip duration + price**; a per-vehicle "driver ETA" column is out of scope
until a dispatch-side estimate exists (open decision §13).

Seat count: `BookRideSheet` currently hardcodes `passenger_count: 1`. A seats stepper is a
UI-only enhancement (the field already exists in `BookTransportRequest`) — optional, Phase 5.

### 1.3 Booking flow — already matches

The requested flow `Home → Destination → Ride options → Confirm → Driver searching →
Driver arriving → Trip → Receipt` maps 1:1 onto built stages:

```text
Home (hub) ──▶ BookRideSheet ──▶ POST /book ──▶ Tracking page (single router) ──▶ Receipt
 [S10]         [S20 dest/pickup]  [S30 options+confirm]  [S40–S70 states]        [S80]
```

### 1.4 Vocabulary bridging (decision D6)

User-facing copy may say **driver, ride, passenger**; the codebase keeps
**rider, order/delivery, tourist**. Bridging happens only in the frontend labels layer
(`STATUS_LABEL`, `TYPE_LABELS`) — never in API field names, status enums, or DB columns.

---

## 2. Design Language (canonical tokens)

From `docs/DESIGN_SYSTEM.md` + `frontend/src/index.css` `@theme`:

| Token | Value | Use |
|---|---|---|
| Brand green | `#087F3F` (hover `#056B35`) | Primary CTAs, active states, pickup pin |
| Brand light | `#E9F7EF` | Selected row tint, icon chips |
| Gold | `#F4B400` | Destination pin, rating stars, highlights |
| Ink / muted / border / canvas | `#17201B` / `#68736D` / `#E5E9E7` / `#F7FAF7` | Text, labels, cards, page bg |
| Card | `bg-white rounded-2xl border border-[#E5E9E7]` | every panel (`.tourism-card` / `glass-card`) |
| Primary button | `bg-[#087F3F] hover:bg-[#056B35] text-white rounded-xl font-semibold` | all primary actions |
| Selected chip | `border-[#087F3F] bg-[#E9F7EF] text-[#087F3F]` | vehicle / payment selection |
| Micro-label | `text-[10px] font-bold uppercase tracking-[0.08em] text-[#9CA3AF]` | section captions |
| Icons | `lucide-react` only | see per-screen |
| Money | `formatCurrency()` (₱, en-PH) | every amount |
| Map | Leaflet + OSM tiles; OSRM polyline `#087F3F` w=4, grey dashed `#9CA3AF` fallback | route preview & tracking |

**Theme consistency fix (required in Phase 4):** `TouristTransport` and
`TouristTransportTracking` currently render a dark `gray-950` chrome that diverges from the
tourist light shell, and pin colors differ between screens (sheet uses `#087F3F`/`#F4B400`;
tracking uses `#10b981`/`#ef4444`).

- **Active-trip screen:** keep the map **dark/immersive** (standard ride-app pattern) but
  restyle the bottom panel to a **white brand card** with brand tokens.
- **Hub + Activity + modals:** full light brand tokens (match `BookRideSheet` / `MyTrips`).
- **Pins, unified:** pickup `#087F3F`, destination `#F4B400` on *every* screen.

---

## 3. Global Structure & Navigation

```text
TouristLayout (sticky header + sidebar + bottom nav + mobile drawer)
├─ /tourist/dashboard          ── S10 entry CTA + active-ride banner
├─ /tourist/transport          ── S10 Booking hub
│   └─ BookRideSheet (modal)   ── S20 → S30
├─ /tourist/transport/tracking/:id  ── S40–S90 (full-screen, own chrome)
├─ /tourist/trips              ── S100 Activity
├─ /tourist/history            ── S100 (orders/stays/transport tabs)
└─ /tourist/profile            ── S120 Profile, GCash bind, saved places
```

Sheet patterns: bottom sheets = `fixed inset-0 z-50 flex items-end` + `rounded-t-3xl`
+ drag handle + `max-h-[88vh]` (matches `BookRideSheet`). Dialogs = shared `Modal`
(`z-[1400]`). Route transitions use `PageLoader` Suspense (existing `App.tsx`).

---

## 4. Screen Specifications

Screen IDs are stable references for implementation tickets.

### S10 — Booking Hub (`/tourist/transport`)  [EXISTS — restyle]

**Purpose:** entry point; "Where are you going?"; recent rides; active-ride resume.

```text
┌─────────────────────────────────┐
│ Ride Hailing                    │  header (light tokens)
│ Book a ride around Bansud       │
│ ┌─ACTIVE RIDE BANNER──────────┐ │  ← NEW (conditional)
│ │ ● Trip TRP-0042 in progress │ │
│ └─────────────────────────────┘ │
│ ┌ Card: "Where are you going?" ┐│
│ │ 🔎 Search destination…       ││
│ │            [ Book a Ride → ] ││
│ └──────────────────────────────┘│
│ Recent destinations (chips)     │  ← from BookRideSheet recents
│ Recent Rides                    │  ← GET /tourist/transport
│  ┌ TRP-…  ●Active  ₱150  cash ┐│     tap → tracking/:id
│  └─────────────────────────────┘│
└─────────────────────────────────┘
```

**Components:** search input (seeds sheet `initialQuery`), primary CTA opens
`BookRideSheet`, pending-booking card (localStorage `tracktour_pending_booking`),
active-ride banner, recent-ride row (`order_number`, status pill, green/red dot
connector, `formatCurrency(total)`, `payment_method`).

**States:**
- `loading` → `DashboardSkeleton`
- `empty` (no rides) → `Bike` icon + "No rides yet." + CTA hint
- `active ride present` → banner above CTA
- `error` → retry card

**Actions:** open sheet · navigate to tracking · dismiss pending card.
**Out:** → `/tourist/transport/tracking/:id`.

**Copy fix:** subtitle currently says "Book a motorcycle ride" — change to
"Book a motorcycle, tricycle, car or van".

---

### S20 — Destination & Pickup Selection (`BookRideSheet`, steps 1–2)  [EXISTS]

**Purpose:** pick destination, then pickup. 3-step indicator: `Destination → Pickup → Trip`.

**Per-step layout:** search box → results list (name, address, type tag) → recent
destinations (localStorage `tracktour_recent_locations`, max 4) → manual address entry →
`Pick on map` (PinMap + reverse-geocode) → pickup-only `Use current location`.

**APIs:** `GET /tourist/transport/locations/search?q=` ·
`GET /tourist/transport/locations/reverse-geocode?lat&lng`.

**States:** searching (`Loader2`) · no matches → fallback hint ("Use the map or enter it
manually") · reverse-geocode pending → "Resolving…" · "Picked location" fallback (not
near a registered place) · geolocation permission denied → stay on manual entry.

**Controls:** back chevron (step regression), close `X`, `Confirm location`, `Cancel`
(map mode), `Use this address`.

**Enhancement (Phase 5, optional): Saved places (🏠 Home / 💼 Work).** Stored in
localStorage key `tracktour_saved_places` (`{label, name, lat, lng}`), rendered as two
chips above recents on step 1. No backend — same trust model as recents.

**Validation:** missing coordinates → inline red hint under route summary
("Destination needs a map pin / pickup needs a map pin or your current location") and the
booking button stays disabled.

---

### S30 — Ride Options, Fare & Confirm (`BookRideSheet`, step 3)  [EXISTS]

```text
┌ Trip summary ──────────────────────┐
│ 🟢 Pickup    [address]             │
│ 🔵 Destination [name · address]    │
│ ┌ RoutePreview (Leaflet + OSRM) ┐  │
│ │ Street route · 3.5 km · 12 min│  │
│ └────────────────────────────────┘  │
│ Vehicle                             │
│ ┌ Motorcycle ₱80 ┐┌ Tricycle  ₱120 ┐│
│ │ (Bike icon)    ││ (Bike)         ││
│ ┌ Car        ₱150 ┐┌ Van      ₱250 ┐│
│ │ (Car)           ││ (Bus)         ││
│ Payment: (cash)(gcash)(maya)(card)  │
│ Base fare          ₱60              │
│ Distance (3.5 km)  ₱90              │
│ Service fee (if >0) …               │
│ ─────────────────────               │
│ Total fare        ₱150              │
│ [ ✓ Request Ride ]                  │
└─────────────────────────────────────┘
```

**APIs:** `POST /tourist/transport/estimate` (line items per vehicle),
`POST /tourist/transport/route` (OSRM polyline), `POST /tourist/transport/book`
→ `{order_id, redirect}` → navigate to `/tourist/transport/tracking/{id}`.

**Server-authoritative rule:** displayed fare is advisory only; the backend re-derives
fare/distance/duration (Phase 1, B10). The UI must render the `fare` returned by `book()`
if it differs (show "fare updated by system" note when `|Δ| > ₱0.01`).

**States:** estimating (`Loader2 "Estimating fare…"`) · estimate error → inline retry ·
requesting (`Loader2 "Requesting…"`) · request 4xx → toast with field errors ·
no coordinates → disabled CTA + hint (§S20).

**Disabled CTA rule:** `canBook = hasDest && hasPickup && estimate && isIdle`.

---

### S40 — Searching for a Driver (tracking, `status = searching`)  [PARTIAL — Phase 4]

```text
┌─────────────────────────────────┐
│ (dark map: pickup + dest pins)  │
│  ←          ●Finding a Driver   │  status pill w/ pulse
├─────────────────────────────────┤  ← white brand sheet
│ ⏳ Requesting a nearby driver…  │
│ Vehicle: Motorcycle · ₱150 cash │
│ Typically < 5 min in Bansud     │  static guidance copy
│ [ Safety ]        [Cancel Ride] │
└─────────────────────────────────┘
```

**Behavior:** `GET /tourist/transport/trip/{id}/status` poll **5 s** (existing
`refetchInterval`). No rider card yet. `Cancel Ride` opens cancel dialog (S90).

**No-drivers-available (`no_driver_found`):** per plan, a pre-assignment cancel surfaces
`status = cancelled` + `cancellation_reason`. Screen switches to **S90 cancelled** state
with reason and "Try again" (reopens `BookRideSheet` seeded with last route).

**Realtime (Phase 6):** subscribe `user:{userId}` room so `DeliveryAssigned` flips the
screen without waiting for the poll; HTTP 5 s poll remains the recovery path
(`AGENTS §8.7`).

---

### S50 — Driver Matched / Arriving (`status = arriving`)  [EXISTS — enhance]

```text
┌─────────────────────────────────┐
│          LIVE MAP               │  ← add: rider marker + OSRM
│          🏍 (rider)             │    route from /transport/route
├─────────────────────────────────┤
│ Assigned — arriving in 4 min    │  eta_minutes (post-dispatch ETA)
│ ┌ Driver card ────────────────┐ │
│ │ [photo] Alex                │ │  ← unverified rating ⇒ hide ★
│ │          ★ 4.9 (or —)       │ │    (known issue #9)
│ │ Moto • ABC 123 • Green      │ │
│ │ [ 📞 Call ]  [ ✉ Message ]  │ │
│ └─────────────────────────────┘ │
│ 🛡 Safety · Share trip          │
│ [Cancel Ride]                   │
└─────────────────────────────────┘
```

**Driver card fields (from `tripStatus.rider`):** `profile_photo` (fallback `User`
initials avatar), `name`, `rating` (render `—` until real ratings exist), `plate_number`,
`vehicle_type`, vehicle color. **Message:** Phase 4 UI-only quick messages
(preset chips → toast, no chat backend). **Call:** `tel:` link to `contact_number`
(current behavior; masked contacts deferred).

**Enhancement (Phase 4):** live rider GPS on this map. Requires the tracking contract to
expose a `tracking.token` so the existing `useCustomerMapSocket` (`trip:{deliveryId}`
room) can be reused — **open decision §13**. Fallback: static pins + route polyline +
5 s poll.

**Driver/vehicle changed:** no new status — the rider block in `tripStatus` is
authoritative. On poll/socket update where `rider.id` differs from the previous render,
re-render the card and show a non-blocking toast **"Your driver was updated"**; if
`status` reverted to `searching`, fall back to S40.

---

### S60 — Driver Arrived / Verify (`status = driver_arrived`)  [EXISTS — harden]

Existing `showVerify` callout must become the dominant element:

```text
┌ Verify before boarding ─────────────────┐
│ 🛡 Show this to your driver             │
│ Driver: Alex · Plate: ABC 123           │
│          ┌──────────┐                   │
│          │  1  2 3 4 │  ← ride_pin      │
│          └──────────┘                   │
│ Mismatch? Do not board — Report issue   │
└─────────────────────────────────────────┘
```

**Rule (gap-analysis §3):** verification is a **frontend-only** step —
`PASSENGER_VERIFIED` is *never* a status. Trip start remains rider-driven; the UI must not
gate on a tourist "confirm boarded" action.

**Known gap:** `ride_pin` is tourist-only today — the rider cannot verify it
(`known-issues.md` #6, OPEN). The panel must read: "Share this PIN with your driver" and
the rider-side PIN entry UI is tracked separately, **not** in tourist Phase 4.

**Cancel:** allowed while `searching | arriving | driver_arrived` (backend guard, B8).

---

### S70 — Trip In Progress (`status = in_progress`)  [EXISTS — enhance]

Same layout as S50 with:

- Stepper step 3 (`In Progress`) active; `progress` bar advances.
- Header pill **"Trip In Progress"** + destination address always visible.
- **ETA / distance remaining** block (`eta_minutes`, `duration_min`, `distance_km`).
- Route polyline upgraded from the current straight dashed line to the OSRM polyline
  (`POST /tourist/transport/route` already exists).
- **Cancel button hidden** (backend would 422) — replaced by "Contact support" link.
- **Safety (🛡) control persists** on every active state — `Share trip` (Web Share API,
  fallback = copy `/tourist/transport/tracking/{id}`) + emergency numbers
  (config-driven, Phase 4).

**Realtime:** existing 5 s HTTP poll continues; socket `trip:` room optional (§13).

---

### S80 — Trip Complete, Receipt & Rating (`status = completed`)  [PARTIAL — Phase 5]

```text
┌ Trip completed ✓ ───────────────────────┐
│ Receipt      TRP-0042 · 24 Sep 2026     │
│ Pickup → Destination                    │
│ Base fare                     ₱60       │
│ Distance (3.5 km)             ₱90       │
│ Service fee (when > 0)        ₱…        │
│ ───────────────────────                 │
│ Total                            ₱150   │
│ Payment: cash / gcash                   │
│ Estimate ₱150 · Final ₱150              │  ← only when they differ:
│ (route differed from estimate)          │    explain "route/traffic"
│ [ 💳 Pay with GCash ]   ← gcash only    │
│ How was your ride with Alex?            │
│ ★★★★★   tags: (Friendly)(Safe driving)  │
│ [optional comment]                      │
│ (Skip)                    (Submit)      │
│ 🛡 Report a problem · Lost item         │  ← deferred links (§11)
└─────────────────────────────────────────┘
```

**APIs:** `POST /tourist/transport/trip/{id}/rate` `{rating, review, tags?}` (tags =
`friendly|safe_driving|clean_vehicle|good_communication|arrived_on_time`, Phase 5
migration) · GCash = existing `createCheckoutSession('order', id, 'gcash')` → redirect →
`/payment/callback` (existing `PaymentCallbackPage` + `GCashDetailsModal`).

**Receipt content (Phase 5):** fare breakdown + estimate-vs-final explanation; fix the
PayMongo line-item label `'Food Subtotal'` → ride-aware label (plan Phase 5).

**Rating:** stars + tag chips + comment; **non-blocking** (`Skip` closes; `is_rated`
suppresses the button later). Tipping: **out of scope for rides** — fast-delivery tips are
food-only and never part of a ride settlement (`AGENTS §5.4`); if a tip UI is ever added
it must not touch COD settlement.

**Payment failed state (deferred `PAYMENT_FAILED`):** until the deferred status exists,
failure renders inline: GCash modal error + **Retry** (re-open checkout) + "Pay later from
Activity". Never imply success before `checkAndConfirmPayment`/callback confirmation
(`AGENTS §6`).

---

### S90 — Cancelled Ride (`status = cancelled`)  [EXISTS — enhance]

**Cancel dialog (existing):** title "Cancel Ride", fee notice ("A cancellation fee may
apply"), optional reason textarea, `Keep Ride` / `Confirm Cancel` (pending state).
Backend guard: 422 when `status ∉ {searching, arriving, driver_arrived}` → show toast
"Ride already started — contact support".

**Cancelled result screen:** red `XCircle`, `cancellation_reason`,
`cancellation_fee` (formatted), timestamps, and:
- `no_driver_found` reason → **"Try again"** (reopen sheet, last route re-seeded)
- other reasons → **"Back to Transport"** + "Book another ride".

---

### S100 — Activity / Trips (`/tourist/trips`)  [EXISTS — fix]

Tabs `Active / Upcoming / Done` (existing) over `GET /tourist/history?tab=transport` +
`?tab=bookings`. Row card: type chip (`Ride`/`Resort`), `#number`, `StatusBadge`,
timestamp, `formatCurrency(total)`, Eye (view) + Star (rate) actions.

**Required fixes:**
1. Transport rows currently navigate to `/tourist/trips` (no-op) — must go to
   `/tourist/transport/tracking/{id}`.
2. Ride tab filter uses delivery vocabulary (`pending`, `rider_assigned`,
   `out_for_delivery`…) — ride rows must filter on the canonical ride statuses
   (`searching/arriving/driver_arrived/in_progress/completed/cancelled`), bridged via the
   labels layer only.
3. Star (rate) action must only show for `completed && !is_rated` rides.

---

### S110 — Wallet & Payment Methods  [DEFERRED]

There is **no tourist wallet** in the architecture (no balance, no top-up, no ledger) and
rides must not invent one (`AGENTS §5.2` credit-free principle). MVP equivalents:

- **Choose payment** in S30: `cash | gcash | maya | card` chips (existing).
- **GCash binding** at `/tourist/profile` (existing `TouristGcashBind`).
- **Pay for a ride** post-trip in S80 (GCash intent) or later from Activity.
- **Proof of payment** = receipt in S80 / `PaymentCallbackPage`.

A real "Wallet" tab (stored value, promos) requires an explicit architecture decision —
listed as an open decision (§13), not scheduled work.

---

### S120 — Profile, Settings & Support  [EXISTS]

Unchanged `TouristProfile`. Ride-relevant additions (Phase 6 polish):
- **Saved places** management (edit 🏠/💼 entries from S20).
- **Emergency contacts** (feeds the S70 safety center).
- **Support entry:** "Report a problem" / "Lost item" deep-link — routes to the existing
  messages/support surface or Tourism Office contact. Full lost-item workflow is
  **deferred** (needs a support ticket model decision §13).

---

### S130 — Persistent Safety Components (overlay, all active states)

Rendered inside S40–S70 bottom sheet, always visible:
- 🛡 **Safety center** — config-driven emergency numbers (Tourism Office, barangay,
  police), copy-address, share trip.
- **Share trip** — Web Share API → clipboard fallback (tracking URL).
- **Quick messages** — Phase 4 UI-only preset chips.
- No SOS button in MVP (SOS belongs to the separate planned SOS/Emergency system,
  `PROGRESS.md` In-Progress list — do not fork it here).

---

### S140 — Error & Edge Screens

| Condition | UI |
|---|---|
| Trip 404 / not owner | "Trip not found" + `Back to Transport` (exists) |
| 401 dead token | existing `auth:logout` redirect (global) |
| Poll/network failure | keep last known state + subtle "Reconnecting…" pill; do not blank the map (`AGENTS §8.7`) |
| Payment failed | S80 inline error + Retry (§11) |
| Socket disconnect | HTTP 5 s poll already recovers state |
| Terminal state reached elsewhere | screen flips to S80/S90 on next poll; stop polling (existing) |

---

## 5. State Matrix (all requested states)

| # | Requested state | Canonical trigger | Screen | Key controls | API |
|---|---|---|---|---|---|
| 1 | No destination selected | sheet step validation | S20/S30 | search, recents, map pin, manual | `locations/search` |
| 2 | Searching for driver | `status = searching` | S40 | Safety, Cancel | `trip/{id}/status` (5 s) |
| 3 | No drivers available | pre-assign cancel → `cancelled` + `no_driver_found` | S90 | Try again, Back | `trip/{id}/cancel` |
| 4 | Driver accepted | `status = arriving`, `rider != null` | S50 | Call, Message, Share, Safety, Cancel | status poll |
| 5 | Driver approaching | `arriving` + `eta_minutes > 0` | S50 | same | status poll / `trip:` socket |
| 6 | Driver arrived | `status = driver_arrived` | S60 | Verify (ride PIN), Cancel | status poll |
| 7 | Trip in progress | `status = in_progress` | S70 | Safety, support (no cancel) | status poll / `trip:` socket |
| 8 | Driver/vehicle changed | `rider.id` differs on re-render | S50/S70 | toast + re-render card | status poll |
| 9 | Payment failed | PayMongo/callback failure (deferred `PAYMENT_FAILED`) | S80 | Retry GCash, Pay later | `payment.ts` |
| 10 | Ride cancelled | `status = cancelled` | S90 | reason, fee, Try again | status poll |
| 11 | Trip completed | `status = completed` | S80 | receipt, Pay GCash, Rate | `rate`, checkout session |
| 12 | Rating/tipping | `completed && !is_rated` | S80 | stars, tags, comment, Skip | `POST …/rate` |
| 13 | Lost item / report issue | user intent (deferred) | S120/S130 | support link | deferred |

**Status vocabulary (do not extend):** `searching · arriving · driver_arrived ·
in_progress · completed · cancelled` (map from order/delivery lifecycle via
`getRideStatus()`).

---

## 6. Phasing (screens → `docs/ride-hailing-plan.md` phases)

| Phase | Screens delivered | Exit |
|---|---|---|
| **4 — Active states + completion** | S40 dedicated searching UI, S50 driver card hardening, S60 verify card, share trip, safety center, quick messages, `no_driver_found`→S90, theme/pin unification, S100 deep-link fix, tests | full suite 0 failures + PROGRESS checkpoint |
| **5 — Payment, receipt, rating** | S80 receipt math + estimate-vs-final, GCash label fix, rating tags (migration), optional seats stepper, saved places | full suite 0 failures + DB verify |
| **6 — Notifications + polish** | `user:{userId}` ride notifications, driver-cancelled handling, reconnect/a11y pass, S120 support links | full suite 0 failures + socket JS green |

No changes to: `SmartDispatchService`, `NearestRiderService`, COD settlement, payment
idempotency, refund processor, Socket.IO core (`AGENTS §16`).

---

## 7. Component Inventory (build vs reuse)

**Reuse as-is:** `TouristLayout`, bottom nav, `DashboardSkeleton`, `StatusBadge`,
`Modal`, `BookRideSheet` (3-step engine, `PinMap`, `RoutePreview`), Leaflet pins,
`formatCurrency/cn/formatDate`, `payment.ts`, `GCashDetailsModal`, `PaymentCallbackPage`,
socket hooks (`useUserSocketNotifier`, `useCustomerMapSocket`).

**New components (Phase 4):** `ActiveRideBanner`, `SearchingState`,
`DriverCard`, `VerifyRidePin`, `SafetyCenterSheet`, `ShareTripButton`,
`QuickMessages`, `TripReceipt`, `RatingSheet` (extracted from current inline modals),
`CancelledState`.

---

## 8. Do-Not List

- ❌ No new app shell, second bottom nav, or `/api/rides` route alias.
- ❌ No new status values (incl. `PASSENGER_VERIFIED`, `no_driver_found` as a status —
  it is a cancellation **reason**).
- ❌ No Economy/Comfort/XL backend tiers — vehicle types stay
  `motorcycle|tricycle|car|van`.
- ❌ No tourist wallet / balance / top-up without an ADR.
- ❌ No choose-a-rider UI (dispatch model is canonical; the old
  `tourist-dashboard.md` §7 "choose rider" spec is legacy).
- ❌ No client-authoritative fares; no reintroduction of `dest_lat`/`fare_min` legacy
  payload names (B1–B10 must stay fixed).
- ❌ No rider-credit / COD reserve logic for rides; no tip logic on rides.
- ❌ No claiming Phase 4–6 as done without contract tests + full suite + PROGRESS
  checkpoint (`AGENTS §13`, §18).

---

## 9. Open Decisions (need product/architecture sign-off before coding)

1. **Live rider GPS on ride maps** — expose `tracking.token` in `tripStatus` to reuse
   `useCustomerMapSocket`? (recommended: yes, Phase 4)
2. **Pre-dispatch per-vehicle driver ETA** — backend estimate addition; otherwise show
   trip duration only (recommended: defer).
3. **Share-trip link** — currently an auth-protected URL; a public shareable tokenized
   link needs a backend endpoint (recommended: Phase 4 = copy URL only).
4. **Lost item / report issue** — needs a support-ticket model or routes to existing
   messages (recommended: Phase 6 = contact links only).
5. **Wallet tab** — no architecture exists; keep deferred.
6. **Unverified rider rating display** (`known-issues.md` #9) — show `—` instead of a
   fabricated ★ until real ratings exist (recommended: Phase 4).
