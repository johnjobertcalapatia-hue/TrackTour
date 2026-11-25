# Dynamic Resort Reservation System: Stage 0 audit and adapted architecture

Status: **Stage 4 complete (2026-11-07).** Stage 5 is next, pending review.
Date: 2026-11-06

The proposed architecture is one universal resort platform, configurable
resort types, and customizable bookable offerings. It is sound. This document
records what TrackTour already has (Stage 0) and maps the proposal onto it.
Where a canonical implementation already exists, it is reused rather than
duplicated (AGENTS.md §2).

---

## 1. What exists today (inspected 2026-11-06)

### Resorts are businesses
- `businesses` with `business_categories` hold the resort records. Relevant
  categories: Resort (2), Hotel (1), Homestay (12), Camping Site (13), Farm
  Tourism (16), Event Venue (15), Dive Shop (14), and Hotel & Restaurant
  Combination (3).
- Photos come from `businesses.cover_photo` / `logo` plus `business_media`
  (the gallery). Location is `businesses` (address, barangay, municipality,
  lat/lng). Reviews come from `reviews` (business-level, moderated).
- Resort-specific details are free-form key/value rows in `business_details`
  (EAV), defined in `BusinessRegistrationController`. Examples: `resort_type`
  (one value: Beach, Mountain, Lake, Spring or Private), `day_tour_available`,
  `overnight_stay`, `number_of_cottages`, `swimming_pool`, `beach_access`,
  `recreational_activities` (free text).
  - Only **one** resort type per resort, and it is free-form.
  - Facilities are booleans or free text, not a structured list.

### Bookings are minimal
- `bookings` has booking_number (UNIQUE), business_id, user_id, customer
  fields, `booking_type` (accommodation / rental / event), status,
  check_in/check_out date, check_in_time, guests, total_amount, paid_amount,
  payment_status, notes, and cancellation fields.
- `booking_items` has description, quantity, price, subtotal and date.
  **Nothing writes to it today.**
- `Tourist\BookingController@store` creates a booking with dates, guests and
  notes only:
  - **no price** (total_amount stays empty);
  - **no items**;
  - **no availability or inventory check**;
  - **no concurrency protection**.

  The status starts `pending` and the owner confirms or rejects it
  (`BusinessOwnerBookingController`, plus the calendar view).
- `/tourist/booking` lists only businesses with `accepts_reservation`.
- Payments: the `payments` table is polymorphic, and `PaymentController`
  already supports `payable_type = Booking` through PayMongo (with
  idempotency and webhooks, AGENTS.md §6).

### Offerings are food-only in practice
- `offerings` (85 rows, all `offering_type = menu`) carries food-specific
  columns: preparation_time, preparation_record_count,
  prediction_eligible, variations and add-ons. It also drives the food cart,
  kitchen and dispatch flows.

### Tourist and owner UI
- Tourist: Stays & Deals (`/tourist/stays`), TouristBooking,
  TouristBookingShow, and My Activities → Travels (which already lists
  bookings and visited municipalities).
- Owner: BusinessOwnerBookings, BookingShow, BookingCalendar, and the
  Offerings pages (generic, food-oriented).

### Local data
- The dev database has one restaurant and **no resorts**, so seed or test data
  is needed for every stage.

---

## 2. Gaps against the proposed architecture

| Proposal | Today | Gap |
| --- | --- | --- |
| Multiple resort types per resort | one free-text `resort_type` detail | structured, many-to-many types |
| Structured facilities | booleans or free text in `business_details` | facility catalogue plus per-resort selection |
| Generic bookable offerings (cottage, pool pass, activity, equipment, package…) | none (`offerings` is food) | new offering model with booking configuration |
| Pricing basis, booking mode, inventory, dependencies | none | structured columns |
| Availability rules, blocked dates, inventory | none | new tables plus a DB-enforced allocation |
| Reservation priced from selected offerings | booking has no price or items | reservation items with **snapshots** |
| Concurrency-safe reservations | none | transaction plus row lock plus DB constraint |
| Reservation status history | none | status log |
| Checkout and payments | Booking payable already supported | reuse |

---

## 3. Adapted architecture: reuse vs new

The proposal's tables are mapped to TrackTour as follows. Three proposed tables
are **not** created, because a canonical equivalent already exists.

| Proposed | Decision | Why |
| --- | --- | --- |
| `resort_profiles` | **Reuse `businesses`** (plus `business_media`, `reviews`, `business_details`) | Photos, location, description, reviews, approval workflow and Tourism Office governance already live on `businesses`. A second profile table would duplicate them. |
| `resort_types` + `resort_profile_types` | **New**: `resort_types` (seeded catalogue: Pool, Nature, Beach, Riverside, Adventure, Farm, Other) + `business_resort_types` (business_id, resort_type_id, UNIQUE pair) | Many-to-many classification for discovery and filters. |
| `resort_facilities` + `resort_profile_facilities` | **New**: `resort_facilities` (catalogue) + `business_resort_facilities` (UNIQUE pair, optional custom label) | Structured facilities. Existing EAV booleans are migrated or kept for backward compatibility. |
| `resort_offerings` | **New, separate from `offerings`** | `offerings` is coupled to food (cart, kitchen, prediction, dispatch). Mixing reservable resort items into it risks the food flows. |
| `resort_offering_images` | **New** | Per-offering gallery. |
| `resort_availability_rules` | **New** | Operating days and time windows, and slot schedules per offering. |
| `resort_inventory` | **New, as a per-date allocation**: `resort_offering_allocations` (offering_id, date[, slot], reserved_quantity, UNIQUE(offering_id, date, slot)) | Capacity is enforced at the database layer under a row lock (AGENTS.md §4.3-style atomic acceptance). |
| `resort_blocked_dates` | **New** | Owner closures and maintenance. |
| `resort_reservations` | **Reuse `bookings`**, extended (reservation_kind / booking mode, date range, subtotal, fees, policy snapshot) | Bookings already power owner management, the calendar, My Activities → Travels and Booking payments. A parallel reservations table would split history. |
| `resort_reservation_items` | **Reuse `booking_items`**, extended with resort_offering_id, a name and pricing snapshot, pricing unit, unit price, quantity / participants, start and end date/time, and a configuration snapshot (JSON) | Keeps historical bookings accurate when owners edit offerings. |
| `resort_reservation_payments` | **Reuse `payments`** (payable = Booking) | PayMongo, idempotency, webhooks and refunds already handle Booking (AGENTS.md §6–7). |
| `resort_reservation_status_logs` | **New**: `booking_status_logs` | Reservation history for owners and tourists. |

### `resort_offerings`: structured booking configuration
- Identity: business_id, name, description, `category` (cottage, room,
  pool_access, campsite, activity, equipment, function_area, package,
  food_service, other).
- `booking_mode`: day_use, overnight, time_slot or duration.
- Pricing: `pricing_basis` (per_person, per_unit, per_hour, per_night,
  per_booking) and `price` (decimal).
- `inventory_mode` (units, capacity or slots) and `inventory_quantity`.
- Guest rules: `min_guests`, `max_guests`, `min_quantity`, `max_quantity`.
- `duration_minutes` (time slot or duration), `is_required`,
  `bookable_independently`, `requires_offering_id` (dependency), and
  `status` / `is_published`.
- Optional `attributes` JSON (validated) for display-only extras. Booking
  logic never lives in JSON.

### Reservation engine: one engine for every resort
1. Quote: `POST /tourist/resorts/{business}/quote`. Validates the date(s),
   guests and selected offerings against the rules (dependencies, min/max,
   blocked dates, availability) and returns a price breakdown. Read-only.
2. Book: `POST /tourist/resorts/{business}/reservations`. Opens a DB
   transaction and locks the allocation rows (`lockForUpdate`). It re-checks
   capacity, increments `reserved_quantity` (the UNIQUE row and a capacity
   check are the backstop), writes the `bookings` row plus `booking_items`
   **snapshots** and a status log, then hands off to the existing Booking
   payment flow.
3. Cancel or reject: releases the allocations in the same transaction.

### Tourist UI: assembled from data
- The resort card and detail page show only the sections with published
  content, following §7–8 of the proposal. For example: "N cottages from ₱X"
  only when cottages exist, and a per-night price only for overnight
  offerings.
- The reservation builder renders only the questions the selected offerings
  need, with one shared summary and checkout.

---

## 4. Stage plan (each stage ends with targeted tests, the full suite, DB verification and docs)

| Stage | Scope |
| --- | --- |
| 0 | ✅ Inspection (this document) |
| 1 | `resort_types`, `business_resort_types`, `resort_facilities`, `business_resort_facilities`, plus a backfill from `business_details.resort_type` |
| 2 | Resort cards and filters by type and facility (Stays & Deals) |
| 3 | Reusable resort detail page (sections hidden when empty) |
| 4 | `resort_offerings` + images (model, API, validation) |
| 5 | Owner offering and inventory management UI |
| 6 | Availability rules, blocked dates, allocations (DB-enforced capacity) |
| 7 | Reservation builder + quote endpoint |
| 8 | Reservation creation (locks, snapshots, status log) + Booking payment |
| 9 | My Activities → Travels shows the itemised reservations |
| 10 | Concurrency, authorization, payment and cancellation tests; full regression |

## 5. Decisions (confirmed by the product owner, 2026-11-06)
1. **Reuse the existing tables.** There are no `resort_profiles`,
   `resort_reservations` or `resort_reservation_payments` tables. Resorts
   are `businesses`, reservations are `bookings` / `booking_items`
   (extended in later stages), and payments use `payments` with payable =
   Booking.
2. `resort_offerings` stays separate from food `offerings`.
3. **Scope:** the Resort category first; other stay and activity categories
   later, on the same engine.
4. Delivery happens stage by stage, with a review after each stage.

## 6. Stage 1 checkpoint: resort types and facilities

**Implemented**
- Migration `2026_11_06_000002_create_resort_classification_tables`:
  - `resort_types` (UNIQUE slug): seeded with pool, nature, beach,
    riverside, adventure, farm and other.
  - `business_resort_types` (UNIQUE business_id + resort_type_id):
    many-to-many.
  - `resort_facilities` (UNIQUE slug): 15 seeded facilities.
  - `business_resort_facilities` (UNIQUE pair).
  - `business_resort_custom_facilities` (UNIQUE business_id + name):
    owner-added facilities.
- `ResortClassificationService` seeds the catalogue (idempotent) and
  backfills from the registration details:
  - `resort_type` maps Beach → beach, Mountain or Lake → nature, Spring or
    Private → pool, and anything else → other.
  - `swimming_pool`, `beach_access`, `parking` and
    `number_of_cottages` are also read.

  The backfill is additive and never removes owner choices. It ran during
  the migration.
- API:
  - `GET /api/resort-catalogue` (public).
  - `GET` and `PUT /api/business-owner/businesses/{business}/resort-profile`:
    owner only, Resort category only, at least one type, distinct ids.
    Custom facilities are trimmed and de-duplicated case-insensitively.
  - `GET /api/tourist/explore/{business}` now includes
    `resort: { types, facilities, custom_facilities }`, or null for
    non-resorts.
- Models: `ResortType`, `ResortFacility`, `BusinessResortCustomFacility`,
  and `Business::resortTypes()`, `resortFacilities()` and
  `resortCustomFacilities()`.

**Database verification (dev MySQL):** the migration was applied with
`--path` (no other migrations were pending). `SHOW CREATE TABLE` confirmed
every UNIQUE key and foreign key. A live probe inserting the same type twice
for one business, in a rolled-back transaction, failed with error 1062
(business_resort_types_business_id_resort_type_id_unique), leaving 0 rows.

**Tests:** ResortClassificationTest has 5 tests and 29 assertions, covering:
the catalogue, the owner's multi-type, facility and custom selection,
validation, ownership, resort-only scope, an idempotent backfill, and tourist
page exposure.
- Full Laravel suite: 790 passed, 2 skipped (known environment skips), 0
  failures.
- Frontend: 375 passed. Build clean.

**Deferred to later stages:** owner UI for types and facilities (Stage 5
setup), resort cards and filters (Stage 2), and the detail page sections
(Stage 3).

## 7. Stage 2 checkpoint: resort cards and filters (Stays & Deals)

**Scope:** cards and filters only. There is no inventory, pricing engine,
reservation builder or checkout yet.

**API** (`GET /api/tourist/stays`, `Tourist\StaysController`, read-only)
- Each card adds `resort_types` [{slug, name}] and `facilities` [{slug,
  name}], where owner-created facilities have slug null.
- `cottage_count` and `starting_price` are always null until real
  inventory or published offering prices exist (Stages 4–6). Nothing is
  invented.
- New filters:
  - `resort_types[]`: any of, validated against the catalogue;
  - `facilities[]`: all of, validated;
  - `custom_facilities[]`: all of;
  - `min_rating`: from approved reviews only, so unrated stays never match;
  - `municipality_id` (existing).
- New `filters` block, built from real data:
  - `resort_types`: the full catalogue with counts of approved listings;
  - `facilities`: only those in use, with counts;
  - `custom_facilities` (with counts);
  - `municipalities` that have listings;
  - `rating_available`.

  A price filter is not offered until offering prices exist.

**Frontend** (`TouristStays.tsx`)
- "Resort type" chips cover all 7 types with counts and allow multiple
  selections; types with no listings are disabled.
- A "Filters" panel holds:
  - facility pills, both catalogue and owner-created, with counts;
  - Location: your area (the default, with the existing fallback), all
    municipalities, or one municipality;
  - Rating, shown only once real ratings exist.
- Active filters appear as removable chips, and "Clear filters" resets them.
- Cards show up to 2 resort-type labels (+N) and up to 3 facilities (+N
  more), plus cottage count and "From ₱X" only when real data exists. The
  location falls back to the address, never a made-up "Bansud".
- The existing stay-category chips, search, sort, Deals & Promotions and
  responsive layout are kept.

**Not affected:** restaurant cards, food ordering, attraction discovery,
ownership and approval rules. Only `StaysController` and
`TouristStays.tsx` changed, and the restaurant, food and explore suites
pass unchanged.

**Tests:**
- `TouristStaysResortFiltersTest`: 4 tests, 36 assertions.
- `tourist-stays-deals.test.tsx`: 5 new tests (15 total).
- Laravel: 794 passed, 2 skipped (known environment skips), 0 failures.
- Frontend: 380 passed. Build clean.
- The `min_rating` SQL was also run against dev MySQL and returned 200.
- Not done: screenshots. There is no headless browser in the project, and
  the dev database has no resorts yet.

## 8. Stage 3 checkpoint: reusable resort detail page (2026-11-07)

**What:** `frontend/src/features/tourist/components/resort/ResortDetail.tsx`.
`TouristExploreShow` renders it whenever `GET /tourist/explore/{id}`
returns a `resort` block, which is the Resort category only. Every other
category keeps the existing place page; restaurants still redirect to the
restaurant page.

**Sections**, in §7 order. Each is shown only when it has real, published
content:
1. Gallery and overview: the main photo with thumbnails from the business
   gallery (falling back to the cover photo), resort-type labels, name,
   barangay and municipality (or the address), the rating with its count or
   "No reviews yet", and the owner's price range. Share and Save use the
   existing favourites toggle.
2. Facilities: catalogue facilities with icons, plus owner-created ones.
3. About: the description.
4–5. Cottages, accommodations and other bookable offerings: intentionally
   absent until Stage 4 publishes offerings. No placeholder is shown.
- Activities: owner-entered `recreational_activities` from registration,
  split on commas or new lines.
6. Availability: day tours, overnight stays, check-in and check-out times,
   and hours (from the details and schedule). The reservation builder comes
   in Stage 7, so there is no fake "Reserve" button. There is no tourist
   booking form in the frontend today.
7. Reviews: the latest 5 approved reviews, with the average and count.
8. Location: the address, plus the in-app route map from the tourist's
   location (the existing `RestaurantRouteMap`, reused) when coordinates
   exist.
9. Policies and contact: house rules, cancellation and payment terms are
   shown only if such details exist (none are captured yet), plus call and
   email.

**Backend:** no change. The page uses the existing place payload (details,
gallery, reviews, rating summary, favourite state) and the Stage 1
`resort` block.

**Tests:** `resort-detail-page.test.tsx` has 3 tests:
- a full resort shows every section in order, the gallery switches photos,
  and there are no offering or reservation fakes;
- a bare resort hides every section;
- attractions keep the old page, and restaurants still redirect.

Laravel: 794 passed, 2 skipped (known environment skips), 0 failures.
Frontend: 383 passed. Build clean.

## 9. Stage 4 checkpoint: bookable offerings (2026-11-07)

**Schema** (migration `2026_11_07_000001_create_resort_offerings_tables`)
- `resort_offerings`: business_id (FK, cascade), category, name,
  description, booking_mode, pricing_basis, `price` decimal(10,2)
  **unsigned**, inventory_mode, `inventory_quantity` unsigned, min/max
  guests, min/max quantity, duration_minutes, is_required,
  bookable_independently, `requires_offering_id` (self FK, null on
  delete), is_published, sort_order, `attributes` JSON (display-only),
  timestamps, soft deletes. Index (business_id, is_published, sort_order).
- `resort_offering_images`: resort_offering_id (FK, cascade), path,
  sort_order. Up to 8 per offering, enforced by the app.
- Separate from food `offerings` (decision 2).

**DB verification (dev MySQL):** the migration was applied with `--path`
(it was the only one pending). `SHOW CREATE TABLE` checked. Live probes ran
in rolled-back transactions:
- a valid insert succeeded;
- a missing business failed with 1452 (business FK);
- a negative price failed with 1264 (out of range, unsigned);
- a missing required offering failed with 1452 (self FK).

0 rows were left.

**Owner API** (`ResortOfferingController`, Resort businesses owned by the
caller): GET, POST, GET {id}, PUT and DELETE on
`/api/business-owner/businesses/{business}/resort-offerings`.
- Coherence rules:
  - per_night needs overnight;
  - per_hour needs time_slot or duration;
  - slots needs time_slot;
  - time_slot and duration need duration_minutes;
  - min ≤ max for guests and quantity.
- Dependencies point to the same resort, not to itself, one level only (no
  chains or cycles), and are required when `bookable_independently` is
  false.
- Photos: add and remove, up to 8; removed files are deleted.
- Delete is soft, and is blocked while other offerings depend on it.
- The list also returns the option lists for the Stage 5 UI.

**Tourist exposure**
- `GET /tourist/explore/{id}` → `resort.offerings`: published only; a
  dependent offering whose partner is unpublished is hidden.
- `GET /tourist/stays` cards: `cottage_count` is the units of published
  cottages; `starting_price` and `starting_price_basis` are the lowest
  published price. Both are null without published offerings.
- `ResortDetail` renders "Cottages & stays" (cottage, room, campsite) and
  "Activities & services" (the rest), each hidden when empty. Each card shows
  the price and unit, booking mode, guests, availability, "Required" and
  "Only with …". There is still no reserve button (Stage 7).

**Tests**
- `ResortOfferingTest`: 6 tests, 66 assertions.
- Frontend: 2 new tests (resort detail offerings; Stays price unit).
- Laravel: 800 passed, 2 skipped (known environment skips), 0 failures.
- Frontend: 385 passed. Build clean.


## 10. Stage 5 checkpoint: owner screens (2026-11-07)

Resort owners can now set up everything from the app. Stage 5 is frontend
only: it uses the Stage 1 and Stage 4 APIs unchanged, with no new
migrations or endpoints.

**Navigation**
- When the active business is a Resort, the sidebar gains "Resort — Setup"
  (Resort Types & Facilities; Cottages & Offerings) and "Resort — Operations"
  (Reservations, shown only with the `reservation_management` module).
- The Setup links have no module filter, because the backend gates on Resort
  category and ownership, not on modules.
- Routes:
  - `/business-owner/resort/profile`
  - `/business-owner/resort/offerings`
  - `/business-owner/resort/offerings/new`
  - `/business-owner/resort/offerings/:offeringId/edit`
- Non-resort businesses see an info notice and make no requests.

**Resort Types & Facilities** (`BusinessOwnerResortProfile`)
- Resort types are checkboxes (at least one; Save stays disabled until one
  is chosen). Facilities are toggle pills from the catalogue. Custom
  facilities can be added and removed (whitespace trimmed, case-insensitive
  duplicates rejected, at most 20).
- Saves via `PUT …/resort-profile`. Server field errors show inline.

**Cottages & Offerings list** (`BusinessOwnerResortOfferings`)
- Each card shows the first photo, category, name, price with its unit,
  booking mode, inventory, guests, "only with …", and a Published/Draft
  badge. The header shows "N of M published".
- Publish/Unpublish resends the offering unchanged with only `is_published`
  flipped. Edit links to the form.
- Delete asks for confirmation first. The server's "depends on" refusal is
  shown as an error.
- The empty state links to create.

**Offering form** (`BusinessOwnerResortOfferingForm`), with sections Basics,
Booking & pricing, Inventory & guests, Rules, Visibility:
- It offers only coherent combinations (`pricingBasesFor` and
  `inventoryModesFor` mirror the backend rules). Changing the booking mode
  resets a pricing or inventory choice that no longer fits. Duration (at
  least 15 minutes) appears only for time slot and duration modes.
- The inventory field label follows the mode: units, capacity, or capacity
  per slot.
- "Only available with" lists only top-level offerings, excluding itself
  (one dependency level). An offering that others depend on must stay
  bookable on its own.
- Photos: up to 8, kept and new combined. Removed photos are sent as
  `remove_image_ids[]`.
- Requests are multipart: POST to create, PUT (`_method`) to update. 422
  errors show next to each field. The server stays authoritative; for
  example, "not bookable on its own" with no partner is sent as-is and the
  server rejects it.

**Unaffected**
- No backend, restaurant, food ordering, attraction or hotel code changed.
  The Hotel and Restaurant nav entries are untouched.

**Tests**
- `tests/ui/business-owner-resort-setup.test.tsx`: 17 tests covering the
  profile (load, save payload, minimum one type, server errors, non-resort
  gate), the list (API data, empty state, publish payload, delete
  confirmation and blocked delete, non-resort gate), the form (coherent
  options, create payload with photo, editing an add-on's dependency choices
  and photo removal, dependents lock, server errors, missing offering), and
  the helpers.
- Frontend: 405 passed (56 files, including the cross-tab session fix). Build clean.
- Laravel: 800 passed, 2 skipped (known environment skips), 0 failures. The first full run had 1 intermittent failure in `EmailVerificationTest` (line 76, a mail count); it passes alone and on the rerun. No backend code changed.


## 11. Reservations plan — Stages 6–10 (2026-11-24, decisions recorded; awaiting "go" for Stage 6)

### Product owner's decisions (2026-11-24)

| Topic | Decision |
| --- | --- |
| Payment | The tourist chooses **pay at the resort** or **GCash online** (PayMongo, payable = Booking — already supported). Refund rules apply to cancellations and owner rejections. |
| Confirmation | **Owner approves.** A reservation starts Pending and holds its units; the owner (or staff with `bookings.update`) confirms or rejects. |
| Cancellation | The tourist may cancel **any time before the check-in date**. |
| Commission | Deducted from the resort's share, never added on top for the tourist. **8%** default; **5%** for event venues / function areas (`function_area`). Configurable by the Tourism Office. Charged only on money paid **through TrackTour**; reversed on a full refund, recalculated on a partial refund. No commission on refundable security deposits. Gateway fees recorded separately. |

### Audit (2026-11-24)

- No resort reservation can be made today: `Tourist\BookingController@store` saves dates/guests only (no price, no items, no availability or concurrency check). There are no bookings in the dev database.
- `bookings` / `booking_items` / `payments` (payable = Booking) exist; the owner Reservations page confirms / completes / cancels with no rules (`BusinessOwnerBookingManageController@updateStatus`).
- Stage 4 offerings carry everything the engine needs (booking mode, pricing basis, inventory, guests, dependencies).
- Earnings: §R Stage 1 (rate settings + snapshots) is built; earnings records (§R Stage 3) are not.

### Stages (each: targeted tests, full suites, DB verification, this doc; review before the next)

| Stage | Scope |
| --- | --- |
| 6 | **Availability engine.** `resort_blocked_dates` (owner closures) and `resort_offering_allocations` (offering, date, reserved_quantity; UNIQUE(offering, date)). Day use = 1 date; overnight = each night from check-in to the night before check-out. Capacity checked under `lockForUpdate`; the UNIQUE row is the backstop. Read API: availability per offering for a date range. Owner UI: blocked dates on the resort setup. |
| 7 | **Quote + reservation (pay at the resort).** `POST /tourist/resorts/{business}/quote` (read-only price breakdown, every rule checked) and `POST /tourist/resorts/{business}/reservations`: transaction + locks, `bookings` row (subtotal, commission snapshot, payment choice) + `booking_items` **snapshots** + `booking_status_logs`. Owner confirm / reject (reason) / complete / no-show; tourist cancel before check-in; every cancel or reject releases the units in the same transaction. Notifications to both sides. Tourist reservation builder on the resort page (dates, guests, offerings, required items, dependencies, summary) and the reservation in My Activities → Travels. |
| 8 | **GCash online payment + refunds.** Pay at submission through the existing Booking payment flow; an unpaid GCash reservation holds its units for 30 minutes, then expires and releases them. Refunds through the existing refund processor (dedupe per the PayMongo idempotency finding): owner reject → full refund; owner cancel → full refund; tourist cancel before check-in → per the decision below. |
| 9 | **Commission.** Rates `resort_commission_percent` 8 and `resort_event_commission_percent` 5 in `CommissionRateSettings` (district default, town override, Bansud limits), snapshotted per reservation. Commission on the GCash amount only, at completion; reversed / recalculated on refund. Resort payable shown to the owner per reservation (pending → available after check-out). Payout to the resort stays manual GCash (no automated disbursement). |
| 10 | Concurrency (two tourists, last unit), authorization, payment and cancellation tests; full regression; deploy notes. |

### Further decisions (product owner, 2026-11-24)

1. **Commission is set by the Tourism Office**: Bansud sets the district defaults (8%, events 5%) and the limits; each municipal office may set its own town's rates inside them (same mechanism as §R5–R6 of the secure-transaction audit).
2. **Pay at the resort: no commission.** Commission only on money paid through TrackTour (the risk that resorts steer guests to pay on arrival is accepted).
3. **The commission is the resort's municipal Tourism Office's income** (resort's town, snapshotted), like food and ride commissions; TrackTour takes its platform % of the office's net (§R1).
4. **Cancellation policy per resort, inside Tourism Office limits.**
   - The resort owner sets: free cancellation until **N days before check-in**, then a **late-cancellation penalty %** (example: free until 3 days before, 50% after).
   - The Tourism Office sets the defaults and the allowed range for both, and **edits the penalty percentage** (district default + town override + Bansud limits).
   - Starting values: free days 3 (allowed 0–14); penalty 50% (allowed 0–100% until the office narrows it).
   - The policy in force is **snapshotted on the reservation** and shown to the tourist before booking (no hidden charges).
5. **Refunds (GCash).**
   | Case | Refund |
   | --- | --- |
   | Tourist cancels inside the free period | 100% |
   | Tourist cancels after the free period (before check-in) | 100% − penalty % (penalty kept by the resort) |
   | Owner rejects or cancels | 100% |
   | Payment / TrackTour failure | 100% |
   | No-show | none (as disclosed) |
   - **No extra refund transaction fee** for the tourist; an unrecovered PayMongo fee is recorded separately as a **TrackTour platform expense**, never as commission.
   - Commission: reversed on a full refund; on a partial refund it is recalculated on the amount the resort keeps (the penalty).
   - The tourist may still cancel any time before the check-in date; only the refund amount depends on the policy.

### Stage changes from these decisions

- Stage 7 adds the resort's cancellation policy setting (owner, inside the office's limits) and shows it in the reservation builder and on the reservation.
- Stage 8 computes refunds from the snapshotted policy.
- Stage 9 adds the office settings (commission 8% / events 5%, free days, penalty %, with limits), the commission on retained amounts, and the platform-expense record for unrecovered gateway fees.


## 12. Stage 6 checkpoint: availability engine (2026-11-24, built — awaiting review)

**Schema** (migration `2026_11_28_000001_create_resort_availability_tables`, local MySQL verified with `SHOW CREATE TABLE`)
- `resort_blocked_dates`: business_id (FK cascade), `resort_offering_id` (nullable FK cascade; NULL = whole resort), inclusive `start_date`/`end_date`, reason, created_by (FK users, null on delete). Index (business_id, start_date, end_date).
- `resort_offering_allocations`: resort_offering_id (FK cascade), `date`, `slot` varchar(5) default `''` (time-slot start, `''` for whole day/night so the key never holds NULL), `reserved_quantity` **unsigned** int. `UNIQUE(resort_offering_id, date, slot)`.

**Engine** — `App\Services\ResortAvailabilityService` (dates are Philippine dates; app timezone stays UTC)
- Dates used: day_use / duration → the date; time_slot → the date at a start time; overnight → each night from check-in to the night before check-out (max 30 nights).
- Amount used: `units` → quantity; `capacity` / `slots` → guests. Capacity = `inventory_quantity`.
- Unavailable when: blocked by the owner (whole resort or that offering); the resort is closed that weekday (it has opening hours and none that day — day-based offerings only; nights may fall on a closed day, Stage 7 refuses a check-in on one); outside today … +365 days; an unknown time slot; not enough left.
- Time slots: from the day's opening hours, one every `duration_minutes`, each ending by closing; 08:00–17:00 when the resort set no hours.
- `reserve()` / `release()` run only inside the caller's transaction (a `LogicException` otherwise): rows created with `insertOrIgnore`, then `lockForUpdate`, merged and sorted by (offering, date, slot) so every transaction locks in the same order; one failing claim fails the whole reservation (`ResortUnavailableException` with a list of problems: sold_out with `available`, blocked, closed, slot, out_of_window, unknown). Release never goes below zero.
- **MySQL race check (dev DB):** two separate PHP processes each asked for both units of RJM's Family room for the same night. Process A reserved and held its transaction 3 s; process B **waited on the row lock (2.2 s)** and was then refused "Family room is fully booked". With A rolling back instead, B waited and then got the room. Test rows were removed (0 allocation rows left, no open transactions).

**API**
- Tourist (public, throttled): `GET /api/tourist/resorts/{business}/availability?from=&to=` — approved Resort businesses only (404 otherwise); published offerings (a dependent one only with its published partner); per offering per date: capacity, reserved, available, blocked, closed, and for time slots each slot's availability; plus `closed_dates` and the blocks. Past `from` moves to today; at most 62 days.
- Owner (Resort businesses they own): `GET …/resort-availability` (includes unpublished offerings), `GET/POST …/resort-blocked-dates`, `DELETE …/resort-blocked-dates/{block}`. A block must start today or later, end on/after its start, last at most a year, and name an offering of this resort. Reservations already on those dates stay booked; the reply reports `already_reserved` so the owner can contact guests.

**Owner UI** — Cottages & Offerings gains "Closed & blocked dates" (`BlockedDatesPanel`): first/last day, whole resort or one offering, optional reason; upcoming closures listed with Reopen.

**Tests**
- `tests/Feature/ResortAvailabilityTest.php` (11): dates and usage per mode; capacity enforced with the whole reservation rolled back; a sold-out night refuses the whole stay; same-date lines added together; capacity counts guests; release floor; blocked / closed / past / far dates; time slots from opening hours; tourist calendar (published only, blocked, closed, slots, range limits, unapproved 404); owner block/reopen with the already-reserved warning and validation; other owners 403, non-resorts refused. (The "outside a transaction" guard is not unit-tested: RefreshDatabase already wraps every test in a transaction.)
- `frontend/tests/ui/resort-blocked-dates.test.tsx` (4).
- Frontend full suite: 157 files, 1078 tests passed.

**Not in this stage:** no reservation is created yet (Stage 7 uses `reserve()`); tourists see no calendar UI until the Stage 7 builder.

**Found by the full Laravel run (fixed in this stage):** production names its attraction category **"Attractions"** (BusinessModuleSeeder alias), not "Tourist Attraction". The not-yet-deployed Deals & Posts migration `2026_11_27_000005` now also covers "Attractions", and the owner sidebar / Business Gallery type mapping (`profileKind`) treats it as an attraction. `BusinessModuleBackfillTest` now expects the attraction modules to include `promotions`.

**Full Laravel suite:** 1509 passed, 2 skipped, 2 failed before the fix — the backfill test above (fixed; 6/6 in the affected files after) and `OrderDeliveryScenariosTest::a rider on a trip cannot accept a second one`, which passes when run alone (intermittent, unrelated to this stage).


## 13. Ownership, visibility and visitor access — plan (decided 2026-11-24; build after Stage 7)

Product owner's decisions, for **resorts and tourist attractions**. Three separate settings:

| Setting | Values | Meaning |
| --- | --- | --- |
| Ownership | Private · Government · Community-managed | Information shown on the listing. A privately owned place can still be publicly listed and take ordinary reservations. |
| Listing visibility | Public · Unlisted · Private | **Public:** in search, lists and the map. **Unlisted:** not in search/lists/map; its page opens from a direct link. **Private ("hidden, request access"):** not listed anywhere; a tourist with the link sees only the name, photos and contact, and can submit a **Request access** form; the owner approves or rejects; offerings and reservations stay unavailable to that tourist until approved. |
| Visitor access | Open to all · Reservation required · Approval required · Exclusive access | Open: visit during operating hours without booking. Reservation required: must reserve first. Approval required: must request the owner's permission. Exclusive: only approved bookings / private groups. |

**Tourism Office review:** approval at registration stays for every ownership type. After approval, changing **ownership type, or making a listing Private / an access type Restricted (Approval required or Exclusive)** goes back to the Tourism Office; the listing keeps its current settings until approved. Other edits do not need re-review.

**Attraction operating hours (supersedes "attractions are always open", same day):** operating hours and reservations are independent settings. An attraction chooses **Open 24 hours (24/7)**, **custom operating hours** (opening/closing time and closed days), or **Temporarily closed**. Being open 24/7 is not an access permission: reservations, capacity limits and owner approval still apply when the access type says so. Owners can set visitor capacity per day or time slot, entrance fees, tour packages and guided tours; attraction reservations reuse the resort reservation engine (Stages 6–10).
- **Today's behaviour = the "Open 24 hours" option for every attraction** (built 2026-11-24: no hours asked or stored, "Always open" shown). The custom-hours and temporarily-closed options come with this stage.

**Order:** after Stage 7 (tourist resort reservations). Plan the stage (audit + decisions) before building.


## 14. Stage 7 checkpoint: quote, reservations (pay at the resort), status flow, cancellation policy (2026-11-24, built — awaiting review)

**Schema** — migration `2026_11_28_000002_add_resort_reservations` (additive; local MySQL verified)
- `bookings` + `subtotal`, `payment_option`, `cancellation_policy` (JSON snapshot), `confirmed_at`, `client_reference` with `UNIQUE(user_id, client_reference)`.
- `booking_items` + `resort_offering_id` (FK, null on delete), category, booking_mode, pricing_basis, units, guests, nights, **`allocated_quantity`** (exactly what is held per date), start/end date, slot, `snapshot` JSON. The price and name are snapshots: later offering edits never change a booking.
- `booking_status_logs` (from → to, actor id/type, reason; append-only).
- `resort_settings` (one per resort: `cancellation_free_days` default 3, `cancellation_penalty_percent` default 50).

**Engine** — `App\Services\ResortReservationService`
- `quote()` / `create()` check: approved Resort; check-in today or later; guests 1–200; each published offering once; **required offerings included**; **add-ons only with their partner**; min/max quantity; guests per unit (`max_guests × units`) or per reservation (capacity); a time for time-slot offerings; check-out after check-in (max 30 nights) and **no check-in on a closed day** for overnight stays; availability (Stage 6).
- Pricing (nights = 1 for day use): per_person price × people × nights; per_unit / per_night price × units × nights; per_hour price × hours × quantity; per_booking flat.
- `create()`: one transaction — reserve (row locks) → booking (`booking_type = resort`, pending, pay at the resort, unpaid, policy snapshot) → item snapshots → status log; owner notified (`booking_created`). A repeated `client_reference` returns the same booking (also when two submits race: the UNIQUE key keeps one).
- Status changes lock the booking row: pending → confirmed (owner/staff) · pending → rejected (reason) · pending/confirmed → cancelled by the resort (reason) · pending/confirmed → cancelled by the tourist **before the check-in date** · confirmed → completed / no-show **from the check-in date**. Reject, cancel and no-show **release the units** in the same transaction. Every change is logged; the other side is notified (`booking_status_changed`).
- GCash is refused with a "coming soon" message until Stage 8.

**Cancellation policy** — `App\Support\ResortCancellationPolicy`: starting defaults and limits (free 3 days, allowed 0–14; penalty 50%, allowed 0–100%) until Stage 9 moves them to the Tourism Office settings. `refundPercent()` ready for Stage 8 (free period 100%, then 100 − penalty). A pay-at-the-resort cancellation costs nothing (nothing was paid).

**API**
- Public: `POST /api/tourist/resorts/{business}/quote`.
- Tourist (`role:tourist`): `POST /api/tourist/resorts/{business}/reservations` (throttle 10/min), `GET /api/tourist/reservations/{booking}` (own only; includes `can_cancel`), `POST /api/tourist/reservations/{booking}/cancel`.
- Owner: `PATCH /api/business-owner/bookings/{id}/status` now routes resort reservations through the service (confirmed / rejected / cancelled / completed / no_show; reason for reject and cancel) — and finds bookings with `whereIn` over the owner's businesses (it used `where(…, list)`). `GET /api/business-owner/bookings/{booking}` adds `actions` (allowed changes now). `GET/PUT …/businesses/{business}/resort-policy`.
- Staff with `bookings.update`: the same service for resort reservations (`no_show` added to the request rule).
- `GET /api/tourist/explore/{id}` → `resort.cancellation_policy` (shown before reserving).
- Fixed on the way: `BookingItemResource` referenced columns that do not exist (unit_price, notes, offering) — it now returns the real fields; the tourist history list showed no resort name (it read `business_name`, the API sends `business`).

**Frontend**
- Resort page: "Reserve your stay" card + a bottom "From ₱X · Reserve" bar (only with published offerings) open `ReserveBuilder`: dates (check-out only when an overnight offering is chosen), guests, offerings with "N left" from the Stage 6 calendar, required items included (per-person ones follow the party size), add-ons locked until their partner, guests per unit, time slots, the server's price breakdown, contact, **Pay at the resort** (GCash shown as coming soon), the policy; a per-form `client_reference`; success screen with the booking number. Logged-out visitors are asked to log in (no quote or calendar requests).
- Tourist: `/tourist/reservations/:id` — status and next step, dates, guests, items and total, policy, history, Cancel (before check-in). Trips & bookings opens it for resort reservations.
- Owner: a resort reservation on `/business-owner/bookings/:id` shows guest and contact, notes, items and total, payment, policy, history and only the allowed actions; reject / cancel ask for a reason the guest sees. Cottages & Offerings gains the **Cancellation policy** panel.

**Verification**
- `tests/Feature/ResortReservationTest.php` (12, 114 assertions): pricing per basis; every rule; reserve holds units, notifies the owner, snapshots price and policy; double submit books once; login / role / GCash refusals; confirm + notice + no double confirm; reject needs a reason and frees units; complete / no-show only from the check-in date (no-show frees units); another owner refused, legacy bookings still update; tourist cancel before check-in only (other tourist 404); owner policy limits, snapshot kept, policy on the tourist page; refund percentages.
- `frontend/tests/ui/resort-reservations.test.tsx` (8); `resort-detail-page.test.tsx` updated (the Reserve button now exists).
- **MySQL smoke test (rolled back):** RJM — 4 guests, cottage + Family room 2 nights → ₱3,380; a repeated submit returned the same booking; units held per night; confirm → tourist cancel released them; log pending → confirmed → cancelled; 0 rows left.
- Frontend full suite: 159 files, 1095 tests passed. Laravel full suite: 1525 passed, 2 skipped (known environment skips), 0 failed.

**Next (Stage 8):** GCash online payment through the existing Booking payment flow, 30-minute hold for unpaid GCash reservations, refunds from the snapshotted policy.


## 15. Stage 8 checkpoint: GCash payment and refunds (2026-11-24, built — awaiting review)

**Schema** — migration `2026_11_28_000003_add_resort_reservation_payments` (additive; local MySQL migrated): `bookings.payment_due_at`, `bookings.refund_due`, index (booking_type, payment_status, payment_due_at). New booking status `expired`.

**Flow** (`ResortReservationService`, existing payment + refund infrastructure reused)
- **Reserve with GCash:** `payment_option = gcash`, `payment_status = awaiting_payment`, units held for **30 minutes** (`payment_due_at`). The owner is **not** notified, the reservation is **not** in the owner's / staff's lists or dashboard counts, and it cannot be confirmed or rejected ("The guest has not paid with GCash yet.") until paid. The tourist may still cancel the hold (nothing to refund; units released).
- **Pay:** the existing `POST /api/payments/create-intent` (payable = booking) — for a resort reservation only while it is pending, awaiting payment, inside its hold, and the tourist's own; a paid reservation cannot be paid twice. PayMongo's webhook (existing, exactly-once per event, row-locked) → `markPayablePaid` → `recordPayment()`:
  - in time → `paid`, `paid_amount`, hold cleared, owner notified "New reservation (paid with GCash)";
  - after the hold expired or after a cancel → money recorded and **refunded in full** (payment failure is never the tourist's loss), tourist notified.
- **Expiry:** `resorts:process-payments` (every minute, `onOneServer`) expires unpaid holds past `payment_due_at` → status `expired`, units released, logged as `system`, tourist notified.
- **Refunds** — `refund_due` is decided under the booking lock when the status changes, then `PaymentRefundProcessor::initiateRefund` runs after commit (records "requested" before the single PayMongo call; never refunds more than paid − refunded − in flight; the existing webhook / `ReconcilePendingRefunds` settle pending refunds):

  | Change | Refund |
  | --- | --- |
  | Owner/staff reject or cancel | 100% |
  | Tourist cancel before check-in | snapshotted policy: 100% in the free period, then 100 − penalty % (the resort keeps the penalty) |
  | Late payment (expired / cancelled) | 100% |
  | No-show, completed | none |
- **Refused refunds** are retried by the same command until **5** failed attempts; then it stops and records `escalation.resort_refund_failed` (financial activity log, once) so an admin returns the money by hand.
- Unchanged on purpose: the food "no refund after a rider accepts" rule only looks at orders (booking payments are never blocked); restaurant wallet deductions only apply to orders.

**API additions**
- Tourist reservation (`GET /api/tourist/reservations/{id}` and the cancel/create replies): `awaiting_payment`, `payment_due_at`, `cancel_refund` ({percent, amount} for cancelling now) and `refund` ({due, refunded, in_flight, status none/pending/refunded/failed, failed_attempts}).
- Owner reservation (show + status change): `refund`.

**Frontend**
- Builder: payment choice **Pay at the resort** / **GCash online** ("held 30 minutes while you pay"); "Reserve & pay" creates the reservation and goes straight to the PayMongo checkout; if the checkout cannot open, the tourist gets **Pay now** on the reservation page.
- Tourist reservation page: while held, "Pay ₱X with GCash within N minutes" + **Pay with GCash**; cancel dialog states the exact refund ("You get ₱170.00 back (50%) …" or the full amount); refund status shown (refunded / on its way / did not go through yet). Expired reservations explain why.
- Owner page: "₱X paid online" and the refund status. PayMongo's return page now goes back to the reservation (it went to the food order tracker for bookings).

**Verification**
- `tests/Feature/ResortReservationPaymentTest.php` (7): 30-minute hold invisible to the owner and unconfirmable; paying through the real create-intent + webhook path sends it to the owner, no second payment; expiry releases the units and a late webhook payment is refunded in full; tourist cancel in / after the free period (100% / 50%, payment stays "paid" on a partial refund); owner reject = 100%, no-show = none; refused refund retried to 5 attempts then stops and escalates once; cancelling an unpaid hold costs nothing. PayMongo faked over HTTP.
- `ResortReservationTest` (12) still green (GCash is now allowed).
- `frontend/tests/ui/resort-reservations.test.tsx` (13, +5): GCash checkout redirect, Pay now fallback, pay-again on the reservation page, refund preview, refund status.
- **MySQL smoke (rolled back, no PayMongo calls):** a GCash hold awaited payment with no owner actions; recording the payment made it paid and confirmable; a second hold past its due time expired and released its unit; 0 rows left.
- Frontend full suite: 159 files, 1100 tests passed. Laravel full suite: 1532 passed, 2 skipped (known environment skips), 0 failed.

**Next (Stage 9):** commission (8% / events 5%, Tourism Office settings, on GCash money only, reversed / recalculated on refunds), the policy limits as Tourism Office settings, unrecovered PayMongo fees as a TrackTour platform expense, owner earnings per reservation.
