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
