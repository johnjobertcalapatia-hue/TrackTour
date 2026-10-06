# Rider System Workflow — Reconciled Implementation Spec

> **Status:** Spec only — no code written for the new stages yet.
> **Origin:** A proposed *system implementation workflow* covering rider registration,
> document verification, safety seminar, driving test, vehicle inspection, activation,
> ride/food-delivery requests, navigation, status updates, earnings, chat, and reporting.
> **Method:** Audited against the live codebase (READ → AUDIT → IDENTIFY CANONICAL PATH,
> AGENTS §19) before any plan item was accepted.

---

## 0. Audit Summary

Every section of the proposed workflow was checked against existing code.

### 0.1 Already implemented — DO NOT rebuild

| Proposed section | Canonical existing implementation |
|---|---|
| Registration, profile, login | `RegisteredUserController` (riders start `rider_status = offline`), Sanctum, profile endpoints |
| Document upload | ⚠ **Schema exists, feature does not.** `rider_details` declares `drivers_license_front/back`, `or_cr_image`, `license_number`, `license_expiry`, `or_cr_number`, `nbi_clearance`, `drug_test_result` in `$fillable`, but nothing in the backend writes them: **both** registration paths discard the vehicle/license fields the form collects (API `AuthController::register` → `referral_code`, `current_service`; web `RegisteredUserController` → those plus `rider_status = offline`), and no rider upload endpoint exists. Seeded legacy numbers still display in `AdminRiderShow`. The `required_documents` framework is **business-scoped** (`business_category_id`); riders never touch it. |
| Admin review / approve | `AdminRiderController::index/show/approve/reject/suspend/activate` — flips `account_status` and writes a `RiderReview` row. **No document verification is performed** (`approve()` accepts no document input). |
| Expired-document lifecycle | `CheckExpiredDocuments` (every 6 h) — **business-only** (`Business::status` suspend/reinstate). It does **not** inspect or suspend riders — rider expiry handling must be built. |
| Online/Offline status | `User::RIDER_STATUS_OFFLINE / ONLINE / AVAILABLE / BUSY` (`User` model constants) |
| Request matching | `SmartDispatchService` + `NearestRiderService` — 120-second offers, nearest eligible rider, radar re-entry |
| Accept / Reject | `NearestRiderService::handleRiderResponse` — atomic acceptance, **one active delivery per rider** (AGENTS §4.3), reject → re-offer to next eligible rider (the proposed "returned to dispatch" branch already exists) |
| Ride requests | `TransportController::book` + `BookTransportRequest` + `TransportationService` (transport orders start at `pending`) |
| Food delivery requests | Group checkout → `GroupOrderService` → dispatch → rider acceptance gate (AGENTS §4.1/§4.2) |
| Trip status machine | Exists with the vocabulary in §2 of this spec (see §0.3 conflict) |
| Map & navigation | Socket.IO GPS streaming + trip tokens + rate limits, `PolylineEncoder`, Leaflet, satellite/radar eligibility (`socket-validation.js`) |
| In-app chat | `ChatController` — rooms, messages, send, markRead, unreadCount, findOrCreateRoom |
| Earnings credit + history | `RiderEarning::updateOrCreate` posted at completion (`NearestRiderService`), `RiderPayoutService`, `DeliveryService::getRiderEarnings`, rider earnings endpoints |
| Continue-working loop | Auto `busy → available` on completion; explicit online/offline toggles on the rider dashboard |

### 0.2 Genuinely new — the real gaps

| Gap | Notes |
|---|---|
| **Safety seminar** stage | Zero matches for `seminar` in `app/` — no record, scheduling, or activation gate exists |
| **Driving skills test** stage | Zero matches for `driving_test` — no result records, pass/retry |
| **Vehicle/motorcycle inspection** stage | Zero matches for `inspection` — no checklist, pass/fail, reinspection |
| **Rider document pipeline (does not exist)** | The `rider_details` document columns are **dead schema** — no upload endpoint, nothing writes them (both registration paths discard the form's vehicle/license fields), and `approve()` does not check documents; seeded legacy numbers still display in `AdminRiderShow`. Rider-side upload → admin review → readiness gate must be built from scratch (shape settled in §5.2). |
| **Document-type set** | ✅ **RESOLVED (§5.1)** — source-faithful 4 required: *Driver's License R1/Code A*, *Motorcycle OR/CR*, *Barangay/Police Clearance*, *Medical Certificate*. Dormant *NBI* + *drug test* columns stay dormant (not required, not migrated). Two of the four are new (Barangay/Police, Medical); all four are expirable → rider expiry handling is mandatory. |
| **Rider performance / incentive reports** | Planned as **Admin Phase 3 + Phase 7** (AGENTS §15) — not built yet; treat as optional unless the thesis requires it |

The three assessment stages are the only substantial new backend work. They must
**plug into** the existing `approve → activate` flow as additional gates, not replace it.

### 0.3 Conflict — the proposed status machine must NOT be adopted as written

AGENTS §10 forbids introducing new status values without a full migration plan and
forbids duplicate meanings. The proposed vocabulary (`PENDING → ASSIGNED → EN_ROUTE →
ARRIVED → IN_PROGRESS → COMPLETED → EARNINGS_POSTED`) partially duplicates existing
statuses, and `EARNINGS_POSTED` must not become a status at all — earnings posting is an
atomic side effect of completion (`RiderEarning::updateOrCreate`, P8/P11). A separate
post-completion status would create a state orders can be stranded in if posting fails,
breaking the settlement invariants.

**Authoritative mapping (display labels only — DB vocabulary unchanged):**

| Proposed status | Canonical existing status | Where it lives |
|---|---|---|
| `PENDING` | dispatch offer `response = pending` | `booking_dispatch_logs` |
| `ASSIGNED` | `assigned` | `deliveries.status` (after rider acceptance) |
| `EN_ROUTE` | `en_route_pickup` / `in_transit` / `en_route_destination` | `deliveries.status` |
| `ARRIVED` | `arrived_pickup` / `arrived_destination` | `deliveries.status` |
| `IN_PROGRESS` | `tour_started` (tours) / `in_progress` (bookings) | `deliveries.status` / `bookings.status` |
| `COMPLETED` | `completed` | `deliveries.status` / `orders.status` |
| `EARNINGS_POSTED` | *(not a status)* | `rider_earnings` row created at completion |
| `REJECTED → CANCELLED` | offer `response = declined` → re-offer; delivery `cancelled` on terminal rejection | `booking_dispatch_logs` / `deliveries.status` |

Same pattern as the restaurant-order redesign: **labels are frontend-only**
(`STATUS_LABELS` in `frontend/src/shared/constants`), backend vocabulary untouched.

---

## 1. Registration & Verification Workflow

```text
START
  │
  ▼
Rider creates account ─── name, contact, email/password, address, profile
  │                       (riders start rider_status = offline)
  ▼
Apply via Rider Registration Form
  │
  ▼
Upload required documents                          [GAP — no rider upload endpoint; columns are dead]
  │   • Driver's License – Restriction 1 / Code A   ← §5.1: reuse existing license columns
  │   • Motorcycle OR/CR                            ← §5.1: reuse existing or_cr columns
  │   • Barangay/Police Clearance                   ← §5.1: NEW (NBI column stays dormant)
  │   • Medical Certificate                         ← §5.1: NEW (no column yet)
  ▼
Admin/Tourism Officer reviews application          [PARTIAL — approve/reject flag only, no doc check]
  │
  ◇ Documents complete and valid?
  │
  NO ──► Return application → rider corrects/reuploads → review again
  │
  YES
  ▼
Attend Safety Seminar                              [NEW — §4.1]
  │
  ▼
Pass Driving Skills Test                           [NEW — §4.2]
  │
  ◇ Passed?  NO ──► schedule/retry assessment
  │
  YES
  ▼
Motorcycle Audit / Inspection                      [NEW — §4.3]
  │
  ◇ Vehicle meets standards?  NO ──► mark for correction → reinspection
  │
  YES
  ▼
Admin/Officer verifies rider account               [EXISTS — approve/activate]
  │
  ▼
Account Activated  →  rider eligible for ride/delivery matching
  │
  ▼
END OF REGISTRATION
```

**Integration rule:** activation (`AdminRiderController::activate`) must remain the single
point that makes a rider dispatch-eligible. The three new stages become *pre-conditions*
recorded as verifiable rows; `activate` (or the eligibility check in `NearestRiderService`)
refuses to pass while any required stage is unpassed. No second activation path.

---

## 2. Rider Operational Workflow — already live

```text
Rider Login → Rider Dashboard
  (online/offline, incoming requests, current trip, earnings,
   notifications, chat, profile, history)                    [EXISTS]
  │
  ▼
Set Status: ONLINE                                           [EXISTS — User::RIDER_STATUS_*]
  │
  ◇ Incoming Request?  NO ──► remain online, keep waiting   [EXISTS — 120s offers + radar]
  │
  YES
  ▼
◇ Request type: Ride Request | Food Delivery Request         [EXISTS — transport + group checkout]
  │
  ▼
Display request details
  (pickup, destination, distance, estimated fare,
   customer/order info, request type)                        [EXISTS — dispatch offer payload]
  │
  ◇ Accept or Reject?
  │
  REJECT ──► returned to dispatch/matching, stays ONLINE     [EXISTS — re-offer next rider]
  │
  ACCEPT
  ▼
assigned → en_route_pickup → arrived_pickup → picked_up
        → in_transit / tour_started → en_route_destination
        → arrived_destination → delivered → completed        [EXISTS — see §0.3 mapping]
  │
  ▼
Fare / delivery earnings calculated, rider credited,         [EXISTS — atomic at completion;
transaction saved to history, earnings displayed               RiderEarning + payout pipeline]
  │
  ◇ Continue Working?
  YES ──► back to ONLINE
  NO  ──► OFFLINE → END SESSION
```

The rider app action buttons map onto the existing transitions exactly as proposed:

| Current status | Rider action | New status (canonical) |
|---|---|---|
| pending offer | Accept | `assigned` (one active delivery only) |
| pending offer | Decline | offer `declined` → re-offer |
| `assigned` | Start navigation | `en_route_pickup` |
| `en_route_pickup` | Arrive | `arrived_pickup` |
| `arrived_pickup` | Pickup | food: `picked_up` / tour: `tour_started` |
| `picked_up` / `tour_started` | Navigate | `in_transit` → `en_route_destination` |
| `en_route_destination` | Arrive | `arrived_destination` |
| `arrived_destination` | Finish | `delivered` → `completed` (earnings post atomically) |

---

## 3. Supporting Functions (parallel, not inline steps)

- **In-app chat** — rider ↔ tourist trip communication: **exists** (`ChatController`,
  chat rooms/messages/read receipts).
- **Earnings module** — calculate → credit → record → history: **exists**
  (`rider_earnings` posted at completion, `RiderPayoutService`, earnings history endpoints).
  COD cash is never an earning (AGENTS §5.1); tips are (§5.4).
- **Performance module** — completed/cancelled trips, delivery count, ride count,
  earnings, activity, customer feedback: **NOT built** — this is Admin Phase 3 (live
  monitoring) + Phase 7 (reports) per AGENTS §15. Optional unless the thesis requires it.

---

## 4. New Stages — design sketch (implementation phase)

### 4.1 Shared pattern

All three stages share one shape, following existing conventions:

- **✅ DECIDED (§5.2): one generic `rider_verifications` table** with a `type`
  discriminator covering all 4 documents *and* all 3 stages. Stage-specific payloads
  (score, checklist, batch) live in a JSON `metadata` column — precedent:
  `payments.metadata`, `refunds.metadata`, `business_document_uploads.ocr_data`.
  Full schema + type map: §5.2 Decision Record.
- Each record: `user_id`, `type`, type-scoped `status`, `files`, credential fields,
  `performed_by`/`performed_at` (reviewer for documents; officer/examiner/inspector
  for stages), `scheduled_at`, `remarks`, `metadata`, timestamps.
- Admin endpoints under the existing admin rider routes (`AdminRiderController` or a
  sibling controller), gated by the same RBAC as `approve/reject`.
- Rider-facing read endpoints so the app can show *what is blocking activation*.
- Readiness gate (enforcement points: §5.3) refuses (422) while a required document
  is not verified/unexpired or a required stage is not `passed`. Note:
  `AdminRiderController::activate` exists but is currently **unrouted** — wiring it
  under the admin rider RBAC group is part of the implementation phase.
- Expiry: all 4 documents are expirable (§5.1) — riders get their own scheduler
  command (§5.2). The authoritative readiness check reads `expires_at` directly, so
  it never depends on the scheduler having run.

### 4.2 Stage specifics

| Stage | Pass criteria | Retry path |
|---|---|---|
| Safety seminar | attendance record marked by officer | reschedule → new record |
| Driving skills test | score/pass flag + evaluator + date | `failed` → schedule again |
| Vehicle inspection | checklist items all pass (plate, brake, lights, helmet, papers…) | `failed` → corrections → reinspection, new record |

### 4.3 Data to capture (from the source workflow)

- Seminar: date, attendee, officer, batch/reference.
- Driving test: evaluator, date, result, remarks.
- Inspection: motorcycle plate/OR-CR cross-check, per-item checklist result, inspector,
  date, next-inspection hint.

---

## 5. Decisions

1. **§5.1 Document types — ✅ RESOLVED (source-faithful, 4 required)** — see the decision
   record below. Remaining open items:

2. **§5.2 Storage shape — ✅ RESOLVED (one generic table)** — see the decision record
   below. Schema is settled; every §5 decision is now resolved:
3. **§5.3 Where the gate lives — ✅ RESOLVED (all entry points + dispatch)** — see the
   decision record below.
4. **§5.4 Performance module — ✅ RESOLVED (defer to Admin Phase 3/7)** — see below.
5. **§5.5 Transport (ride) requests — ✅ RESOLVED (no work)** — the proposed
   `PENDING → ASSIGNED …` table above is already satisfied by transport orders; build
   literal label strings only if the thesis demands them.

### §5.1 Decision Record — Registration Document Set (RESOLVED)

**Decision:** Adopt the uploaded source workflow's document list exactly — **4 required
documents**, all expirable. Chosen over the "union of 6" and "hybrid/NBI" alternatives
because the source workflow is the stated requirement and NBI/Barangay are *different*
Philippine documents (national vs. local clearance), so NBI does not silently stand in
for Barangay/Police Clearance.

| # | Document | Required | Expirable | Schema target |
|---|---|---|---|---|
| 1 | Driver's License — Restriction 1 / Code A | ✅ | ✅ (~5 yr) | reuse existing `rider_details`: `license_number`, `license_expiry`, `drivers_license_front`, `drivers_license_back` |
| 2 | Motorcycle OR/CR | ✅ | ✅ (annual reg.) | reuse existing: `or_cr_number`, `or_cr_image` |
| 3 | Barangay / Police Clearance | ✅ | ✅ (6–12 mo) | **new** — no column/table exists today |
| 4 | Medical Certificate | ✅ | ✅ (~1 yr) | **new** — no column/table exists today |

**Consequences of this decision:**

- **All 4 documents are expirable** → expiry handling (your "Expiry handling" step) is
  mandatory for the whole set, not optional. `CheckExpiredDocuments` is business-only
  today, so rider expiry must be built (new command or an extended one — decide at
  schema time, don't assume reuse).
- **Dormant `nbi_clearance` and `drug_test_result` columns stay dormant.** They are not
  part of the required set, are not migrated, and are not rendered in the UI. They can be
  dropped in a cleanup migration later or promoted to optional documents if the thesis
  requires them — that is a separate decision, not this one.
- **Two documents are new (Barangay/Police, Medical)** and two are reuse (license,
  OR/CR). The storage model must therefore support *both* the two live `rider_details`
  columns and the two new documents without a third pattern — which is exactly what the
  §5.2 table-choice decision must settle next.
- Upload happens **at application time, before any stage** (Class A), and the admin
  review of these 4 files is what `approve()` must start actually checking.

**Next:** §5.2 storage shape — ✅ RESOLVED immediately below. Remaining: §5.3 gate
enforcement points, §5.4 performance timing — then implementation as one controlled
phase.

---

### §5.2 Decision Record — Storage Shape (RESOLVED)

**Decision:** ONE generic table, `rider_verifications`, with a `type` discriminator
holding all 4 registration documents **and** all 3 verification stages — no per-type
or per-stage tables. The discriminator is the common structure; anything that varies
by type lives in a JSON `metadata` column rather than a giant nullable column set
(the caution: a document needs file + expiry, a driving test needs score + examiner,
an inspection needs findings + inspector — those payloads do **not** become columns).

**Type map** (model constants; `type` is a plain string column, **not** a DB `enum`,
so adding a future verification type is data, not a migration):

| `type` | Class | Allowed `status` | Satisfies readiness when |
|---|---|---|---|
| `DRIVER_LICENSE` | document | `pending → verified / flagged`, `verified → expired` | `verified` and `expires_at >= today` |
| `OR_CR` | document | same | same |
| `BARANGAY_POLICE_CLEARANCE` | document | same | same |
| `MEDICAL_CERTIFICATE` | document | same | same |
| `SAFETY_SEMINAR` | stage | `pending → scheduled → passed / failed` | `passed` |
| `DRIVING_TEST` | stage | same | `passed` |
| `VEHICLE_INSPECTION` | stage | same | `passed` + plate rule below |

Document vocabulary mirrors `business_document_uploads.verification_status`
(`pending/verified/flagged`) plus rider-specific `expired`; stages use the §4.1 set.
These are **verification-record** statuses only — zero overlap with `rider_status`,
`account_status`, or order/delivery vocabulary (AGENTS §10).

**Schema sketch:**

```text
rider_verifications
├── id
├── user_id          FK users(id) cascadeOnDelete, index     -- the rider
├── type             string, index        -- discriminator (type map above)
├── status           string, index        -- type-scoped vocabulary
├── files            json nullable        -- document scans (license = [front, back]);
│                                           stages = NULL (they upload nothing)
├── document_number  string nullable      -- credential #: license / OR-CR / clearance
├── issued_by        string nullable      -- LTO / PNP / barangay / clinic
├── issue_date       date nullable
├── expires_at       date nullable        -- all 4 documents (§5.1: all expirable)
├── scheduled_at     timestamp nullable   -- stages
├── performed_by     FK users(id) nullOnDelete   -- reviewer / officer / examiner / inspector
├── performed_at     timestamp nullable   -- reviewed-at (docs) / conducted-at (stages)
├── remarks          text nullable        -- why flagged / examiner findings
├── metadata         json nullable        -- stage payload (see below)
├── timestamps + softDeletes              -- parity with business_document_uploads
└── INDEX (user_id, type, status)
```

Column groups: *lifecycle* (every row), *credential* (documents), *scheduling*
(stages); variable payload → `metadata`. The submitted-at / reviewed-at /
reviewed-by / review-result / expires-at fields map to `created_at` / `performed_at`
/ `performed_by` / `status` + `remarks` / `expires_at` — append-only rows make
`created_at` the submission time.

**Stage payload (`metadata`):**

| Stage | `metadata` |
|---|---|
| `SAFETY_SEMINAR` | `{batch, venue}` |
| `DRIVING_TEST` | `{score, plate}` |
| `VEHICLE_INSPECTION` | `{plate, checklist: [{item, result, remarks}]}` |

The checklist stays JSON deliberately: per-item reporting can extract it to a child
table later *if* Admin reports need it (AGENTS §15 Phase 7) — no eighth table today.

`files` is a JSON **array** (not `file_path`) because one logical document can need
several images (license front/back), and splitting those into two rows would split
one review across two readiness checks; JSON image arrays have precedent
(`products.images`).

**Append-only, one row per submission/attempt:** re-upload after `flagged`, renewal
after expiry, and stage retry each create a **new row** (history preserved;
`CheckExpiredDocuments`' group-by/has-valid logic is the precedent for "a type is
satisfied if any row qualifies"). No `(user_id, type)` unique constraint — retries and
renewals must coexist. The satisfaction check lives in **one** canonical service
(sketch: `RiderVerificationGate::isReady(rider)` / `::missing(rider)`) consumed by
every enforcement point — no per-caller re-implementations (AGENTS §19).

**Plate rule:** `VEHICLE_INSPECTION` readiness requires `metadata.plate` to equal the
rider's `rider_details.vehicle_plate_number` — checked only when **both** are
non-empty (NULL-safe for riders without a registered plate). The `vehicle_*` columns
stay on `rider_details`: that table remains the vehicle registry (admin vehicle
filter, profile display) and the inspection cross-check target.

**File storage:** follow the codebase-wide convention — public disk,
`store('rider-documents/{user_id}', 'public')` (business documents and KYC IDs are
already public-disk today). Known deferred item: moving *all* document storage
(business + KYC + rider) to private storage with authorized downloads is a separate
cross-cutting hardening task, not rider-phase scope.

**Expiry:** new scheduled command `rider-documents:check-expired` (runs beside
`documents:check-expired`) flips `verified → expired` for visibility + rider
notification — deliberately **not** extending `CheckExpiredDocuments`, which is
completed, business-only architecture (AGENTS §16). Authoritative readiness always
reads `expires_at >= today` directly, so gate correctness never depends on the
scheduler having run. Expiry does **not** touch `account_status` — no auto-suspension;
it only removes online/dispatch readiness (verification records never become account
statuses).

**`rider_details` reconciliation (settles the §5.1 handoff):**

| Legacy columns | Fate |
|---|---|
| `vehicle_type/make/model/plate_number/year` | **stay** — vehicle registry home |
| `license_number`, `license_expiry`, `or_cr_number` | **deprecated** — canonical home becomes `document_number`/`expires_at`; `AdminRiderShow`'s license display switches source this phase; legacy values (DB probe: 2/3 riders, seeded) serve only as upload pre-fill; no dual-write; drop in a later cleanup migration |
| `drivers_license_front/back`, `or_cr_image` | **deprecated** — replaced by `files`; never written today |
| `nbi_clearance`, `drug_test_result` | **stay dormant** (§5.1 — outside the required set) |

**DB probe (live `track_tour_db`, 2026-09-23):** 3 riders, **all
`account_status = approved`** (2 currently `available`), identical seeded text data on
2 riders (`D12-34-567890`, exp 2028-09-22, `ORCR-2026-001`), **zero scan files**
→ **no backfill** (nothing verifiable exists to migrate). Existing riders complete the
pipeline once through the new rider UI; whether they leave the dispatch pool
immediately depends on the §5.3 choice.

**Registration defect fixed in this phase:** `RegisterPage` already collects
`vehicle_type`, `plate_number`, and `license_number` (required in the form) but
**both** backend paths discard them — API `AuthController::register` writes only
`referral_code`/`current_service`, web `RegisteredUserController` adds only
`rider_status`. Fix: persist `vehicle_*` into `rider_details` and seed a pending
`DRIVER_LICENSE` row carrying the collected `document_number` (files attached later
in the documents screen).

---

### §5.3 Decision Record — Gate Enforcement Points (RESOLVED)

**Decision:** enforce at **every canonical entry point plus dispatch** — all calling
the one shared `RiderVerificationGate` checker:

| Entry point | Enforces | On failure |
|---|---|---|
| `AdminRiderController::approve` | documents (4 verified + unexpired) | 422 + missing list |
| Rider go-online transition (availability toggles in `RiderController`) | full readiness (docs + stages) | 422 + missing list |
| `AdminRiderController::activate` (reinstatement) | full readiness | 422 + missing list |
| `NearestRiderService` dispatch eligibility | full readiness (belt-and-suspenders) | rider excluded from offer candidates |

Rationale: AGENTS §9 already lists **"valid required documents"** as an established
rider eligibility requirement — unimplemented only because the document pipeline never
existed. This makes the stated rule real at the same choke point COD eligibility uses,
and closes every path (otherwise a rider could go online without ever passing a
stage). Note `activate` is currently **unrouted** — wiring it under the admin rider
RBAC group is part of this phase, and it remains the *only* activation path.

**Accepted consequence (confirmed):** the 3 seeded `approved` riders (2 currently
`available`) leave the dispatch offer pool until each completes the pipeline through
the new rider UI — a one-time re-onboarding that doubles as the demo flow. No rider is
auto-suspended; `account_status` stays admin-controlled.

**Boundaries:** the checker returns missing *verification requirements*, never a new
rider/order status (AGENTS §10). On the dispatch side this is one additional
eligibility predicate — **not** a rewrite of `SmartDispatchService`/`NearestRiderService`
matching, offer broadcast, or acceptance atomicity (AGENTS §9/§16).

---

### §5.4 Decision Record — Performance Module (RESOLVED)

**Decision:** **defer** rider performance / incentive reports to the Admin module —
rider monitoring to Admin Phase 3, reports to Admin Phase 7 (AGENTS §15 already
assigns them there). No schema impact: performance reads orders / deliveries /
earnings, never `rider_verifications`, so nothing in §5.2 changes later.

---

## 6. Explicit Non-Goals

- No new order/delivery status values (AGENTS §10).
- No OCR/automation for rider document review — verification stays manual
  (business-document OCR flagging is a separate system).
- No auto-suspension of riders on document expiry — expiry removes readiness only;
  `account_status` stays admin-controlled.
- No `EARNINGS_POSTED` status — earnings remain an atomic completion side effect.
- No rewrite of `SmartDispatchService` / `NearestRiderService` (AGENTS §9, §16).
- No second activation path bypassing `AdminRiderController::activate`.
- Socket/GPS architecture untouched (AGENTS §8).

---

## 7. Reference

- Authoritative rules: `AGENTS.md` §4 (dispatch/acceptance), §5 (COD/earnings),
  §9 (dispatch), §10 (status vocabulary), §15 (Admin module phases).
- Related specs: `docs/architecture/dispatch-ping-reliability-spec.md`,
  `docs/architecture/delivery-offer-atomic-acceptance.md`,
  `docs/business-rules/rider-dispatch.md`, `docs/business-rules/rider-wallet.md`.
- Testing: every implementation phase must land with automated tests per AGENTS §12
  and report Tests/Assertions/Failures/Skipped per §13.
