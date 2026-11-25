# Municipal Tourism Office portal — audit and plan (2026-11-25)

Goal (product owner's proposal): Bansud is the Super Admin; every other
municipality has a Municipal Tourism Admin with nearly the same modules as
Bansud, limited to its own town's data and to the money powers Bansud allows.
One shared portal, data scoped by municipality and enforced on the server,
never just by hiding links.

Status: **decisions D1–D5 accepted as recommended (2026-11-25, "go"). Stage 0 in
progress; each later stage starts after its own "go".**

---

## 1. Audit: what already exists

The architecture the proposal asks for (§6, "one shared dashboard, scoped by
municipality") is already how the system works:

| Piece | Today |
| --- | --- |
| Bansud Super Admin | role `bansud_tourism_office`, portal `/admin/*` (`routes/api.php`, `role:bansud_tourism_office`) |
| Municipal Tourism Admin | role `tourism_office`, portal `/municipal/*` (`role:tourism_office` + `municipal.scope`) |
| Scoping | `MunicipalScopeService`; the town always comes from `users.municipality_id`, never from the request; unassigned or suspended officers get 403 (docs/PHASE2-ROLES-PERMISSIONS.md F-3, F-7) |
| Municipal admins | Bansud creates towns and each town's `tourism_office` accounts (`/admin/municipalities/{m}/admins`) |
| Commission hierarchy (proposal §3) | **Built** (docs/secure-transaction-audit.md §R5–R6): Bansud sets district defaults and min/max limits; each town sets its own rates inside them; rates snapshotted per order |
| Resort commission per town | Planned in resort reservation Stage 9 (Bansud default + limits, town override) — awaits its own "go" |

Module by module, against the proposal's table:

| Proposal module | Municipal portal today | Gap |
| --- | --- | --- |
| Dashboard | ✅ `/municipal/dashboard` (+ analytics) | — |
| Live Map | ❌ | Bansud only; `AdminLiveController` is fixed to Bansud (`Municipality::HOME_MUNICIPALITY`) |
| Deliveries | ❌ | Bansud only; the query already filters by a municipality id, so it can take the officer's town |
| Rider Cash | ❌ | Bansud only; `RiderCashFundService::assertFundMunicipalityAccess` already exists |
| SOS Alerts | ❌ | Alerts go to Bansud only; `sos_alerts` has **no municipality column** |
| Businesses | ✅ incl. document review, approve / reject | — |
| Users | ⚠️ Business Owners ✅, Tourists (read-only) ✅ | No staff view; see decision D3 |
| Riders | ✅ | — |
| Rider Onboarding | ✅ `/municipal/onboarding` | — |
| Cashouts | ❌ | Bansud only; see decision D2 |
| Commission Rates | ✅ within Bansud's limits | — |
| Tourism Earnings | ❌ | Needs per-town earnings (secure-transaction §R Stage 2, awaiting "go") |
| Reports | ✅ | — |
| Audit Logs | ✅ "Activity Logs" | — |
| Notifications | ❌ | — |
| Office Profile / Settings | ✅ "Profile & Settings" | — |
| System Notices | ❌ | Bansud only; see decision D4 |
| Destinations / Events / Announcements | ❌ in `/municipal` | Only in the old `/tourism-office` screens, **unscoped** (below) |

Bansud-only modules in the proposal (Municipalities, municipal admins, global
limits, platform settings, network-wide reports and audit logs, global notices)
already exist in `/admin`.

### Security gap found (existing, not new)

`/tourism-office/*` is open to `role:tourism_office,bansud_tourism_office`
(`routes/api.php:1067`). In `TourismManagementController` a town officer can
**create, edit and delete any municipality's destinations, events and
announcements** (the `municipality_id` comes from the request), and the old
`/tourism-office/dashboard` and `/reports` return district-wide figures. This
breaks the proposal's §4 ("view another municipality's … No") and was listed as
"deferred" in PHASE2-ROLES-PERMISSIONS.md. The `/tourism-office` UI is
Bansud-only, but the API is not.

---

## 2. Decisions needed

| # | Question | Recommendation |
| --- | --- | --- |
| D1 | **SOS:** who is alerted and who handles it? | The rider's / restaurant's town office handles it (same town rule as earnings: food → restaurant's town, ride → driver's town); **Bansud always sees and can take over every alert**. A safety alert should never depend on one small office being online. |
| D2 | **Cashouts:** can a town release rider payouts? | Town office **reviews and approves** its riders' cashouts; **Bansud keeps releasing the GCash payment** while all online money sits in one PayMongo account and payouts are manual. Revisit when towns hold their own funds. |
| D3 | **Users:** can a town suspend tourists and staff? | Tourists stay **read-only** (a tourist is not "from" a town; suspending one would lock them out everywhere) — suspension stays with Bansud. Business staff stay with their owner; the town gets a read-only staff list per business. |
| D4 | **Local notices:** who sees a town's notice? | Business owners, staff and riders of that town, in their portals. Tourist-facing news stays in Announcements. Bansud notices keep reaching everyone. |
| D5 | **Order of work** | Stage 0 (security) first, then the rest in order; Tourism Earnings waits for secure-transaction §R Stage 2. |

---

## 3. Stages

Each stage: audit the touched code, build, run the full Laravel + frontend
suites, record here, review, then the next "go".

**Stage 0 — Close the cross-town hole (security).**
`/tourism-office` destinations, events and announcements: a `tourism_office`
officer may only read and write its own municipality (forced from the account;
a request for another town is 403). Old `/tourism-office/dashboard` and
`/reports` become Bansud-only. Unauthorized-action tests for each route.

**Stage 1 — Same sidebar for every office; tourism content for towns.**
`MunicipalLayout` uses the same groups as Bansud (Dashboard · Live Operations ·
Tourism Management · Financial Management · Records & Analytics · System),
showing only the modules the town has. Destinations, Events and Announcements
pages move into `/municipal`, on the scoped endpoints from Stage 0.

**Stage 2 — Live operations for towns: Live Map, Deliveries, Rider Cash.**
Shared "office scope": Bansud = district (unchanged), town = its own
municipality from `MunicipalScopeService`. Reuse `AdminLiveController`,
`AdminMapController` and `AdminPurchasingCashController` logic behind
`/municipal/live/*` and `/municipal/rider-cash` instead of copying controllers.
Bansud's screens do not change.

**Stage 3 — SOS for towns (per D1).**
`sos_alerts.municipality_id` set when the alert is raised, backfilled for old
alerts; alert notifications to the town office and Bansud; town can
acknowledge / respond / resolve its own alerts; Bansud sees all.

**Stage 4 — Cashouts for towns (per D2).**
Town queue of its own riders' cashouts with approve / reject; Bansud's queue
shows town approval and keeps the payment step.

**Stage 5 — Notifications and System Notices (per D4).**
Town notifications feed; towns see Bansud's notices and publish notices to
their own town's owners, staff and riders.

**Stage 6 — Tourism Earnings (after secure-transaction §R Stage 2).**
Town earnings page (its commissions, expenses, net, TrackTour share);
Bansud's network-wide earnings report across all towns.

---

## 4. Built

### Stage 0 — cross-town hole closed (built 2026-11-25, awaiting review)

- `municipal.scope:district` (`EnsureMunicipalScope`, new optional mode): the
  Bansud Tourism Office passes through district-wide; a `tourism_office`
  officer gets the usual checks (approved, assigned to an active municipality)
  and its municipality as the `municipality` request attribute.
- `/tourism-office` management dashboard, destinations, events and
  announcements now sit behind it (`routes/api.php`). In
  `TourismManagementController`:
  - lists, detail and the management dashboard counts show only the
    officer's municipality;
  - another municipality's record is **404** for show / update / delete;
  - create fills `municipality_id` from the account; naming another
    municipality (create, or moving a record on update) is **403**;
  - Bansud is unchanged and must still name the municipality.
- Old `/tourism-office/dashboard` and `/tourism-office/reports` (district-wide
  aggregates) are **Bansud only**; municipal offices use `/municipal/dashboard`
  and `/municipal/reports`. No screen changes: the `/tourism-office` UI was
  already Bansud-only.
- Tests: new `TourismContentMunicipalScopeTest` (7); `TourismOfficeApiTest` and
  `Phase2RoleAuthorizationTest` updated, because they asserted that a municipal
  officer could read the district dashboard — the access this stage removes.
- Full suites: Laravel 1549 passed (2 skipped), frontend 1102 passed.
- Found by the full run, outside this stage: the Café category migration
  (`2026_11_28_000004`) created Café on a fresh database, clashing with tests
  (and fresh installs) that seed it. It now does nothing when no categories
  exist yet; covered by `CafeCategoryMigrationTest`.

### Stage 1 — same sidebar; tourism content for towns (built 2026-11-25, awaiting review)

- `MunicipalLayout` sidebar uses the Bansud group names and order: Overview ·
  Tourism management · **Tourism content** · Financial management · Records &
  analytics · System. Live operations is added in Stage 2, when its modules
  exist for towns. "Tourism content" (Destinations, Events, Announcements) is
  its own group so Tourism management does not grow to eight links; Bansud
  manages the same content in its `/tourism-office` screens.
- "Profile & Settings" is listed as **Office Profile** (sidebar and account
  menu), as on Bansud's sidebar; the page itself is unchanged.
- New `/municipal/destinations`, `/municipal/events`, `/municipal/announcements`
  (`MunicipalTourismContent.tsx`): one config-driven list + form + delete
  confirmation, in the municipal portal's light style, on the Stage 0 scoped
  `/tourism-office` endpoints. The forms never ask for a municipality (the
  server fills it from the account); the old dark `/tourism-office` pages stay
  Bansud's.
- No backend change.
- Tests: `municipal-portal.test.tsx` — sidebar links and group order (it
  previously asserted towns had **no** Destinations link, the rule this stage
  changes); creating a destination sends no `municipality_id`; deleting asks
  first.
- Full suites: Laravel 1549 passed (2 skipped), frontend 1104 passed.

### Stage 2 — Live Map, Deliveries, Rider Cash for towns (built 2026-11-25, awaiting review)

No new controllers or pages: the Bansud ones serve both portals.

- **Backend scope.** `/municipal/*` routes (behind `municipal.scope`) point at
  `AdminMapController`, `AdminLiveController` and `AdminPurchasingCashController`.
  The controllers read the `municipality` request attribute; without it (Bansud
  on `/admin/*`) behaviour is unchanged.
  - Map: only the town's businesses and its own town marker.
  - Deliveries: the town's delivery record (same rule as Bansud's: a
    restaurant in the town; a ride by a rider of the town).
  - Live riders: the town's riders, plus any rider on a live trip belonging to
    the town (e.g. a Bansud rider picking up at a Gloria café).
  - Live tourists: only opted-in tourists whose shared position is in the town
    right now (`MunicipalityLocator::nearest`).
- **Rider Cash.** `RiderCashFundService::officerMunicipalityId()` now accepts an
  approved `tourism_office` officer with a municipality, resolving to that
  municipality. Every cash action already checks the rider's or fund's
  municipality against it (advances, purchasing cash, daily receipt, returns,
  verify, close, corrections, reversals, adjustments), so a town manages only
  its own riders' cash, and Bansud still only Bansud's. Purchasing cash on a
  delivery goes through the same check (the rider must be the town's).
- **Frontend.** `features/admin/office-portal.tsx`: `useOfficePortal()` gives
  the API and route prefix (`/admin` default, `/municipal` under
  `MunicipalLayout`). Live Map, Deliveries, Rider Cash and the daily receipt use
  it for every call and link. Towns do not get trip diagnostics (it can repair
  trips) or the SOS layer (Stage 3). A town's map opens at street level on its
  own town. Sidebar: new **Live operations** group (Live Map, Deliveries, Rider
  Cash).
- Tests: `MunicipalLiveOperationsTest` (8): every endpoint scoped, cash refused
  for another town's rider both ways, Bansud unchanged, `/admin` still closed to
  towns, suspended/unassigned officers refused. Frontend: town variants in
  `admin-deliveries` and `admin-rider-cash` tests; sidebar test.
- Full suites: Laravel 1557 passed (2 skipped), frontend 1106 passed.

### Stage 3 — SOS per municipality (built 2026-11-25, awaiting review)

Decision D1: the trip's town office handles the alert; Bansud always sees every
alert and can act on any.

- **Which office.** New `sos_alerts.municipality_id` (migration
  `2026_11_28_000006`), set when the alert is raised
  (`SosAlertService::municipalityIdFor`) by the office-earnings rule: food → the
  order's restaurant's town (first restaurant of a group checkout), even when
  the rider is from another town; ride → the driver's town. The migration
  backfills alerts already raised the same way. No town known (e.g. a rider
  with no municipality) → null → Bansud only.
- **Municipal office.** `/municipal/live/sos`, `/summary`, and
  acknowledge / respond / resolve, on the same `AdminLiveController` actions,
  limited to its own alerts. Another town's alert is **404** for every action
  (`SosAlertService::transition` takes the office's municipality). Sidebar:
  **SOS Alerts** with a red count; the red alarm banner and sound run on every
  municipal page; the Live Map shows its own alerts.
- **Bansud.** Unchanged: every alert, every action. Each alert now shows the
  office that handles it ("Gloria office", or "No town · Bansud"). When Bansud
  acts on a town's alert, the town sees "Bansud Tourism Office is helping"
  (`bansud_involved`); the acknowledged / help sent / resolved names show who
  did each step.
- **Wording.** The SOS confirmation now says "SOS sent to the Tourism Office."
  The tourist's location-sharing consent now says the Bansud Tourism Office
  **and the tourism office of the town they are in** can see their location —
  true since Stage 2 (town offices see tourists inside their town) and missed
  then.
- Tests: `MunicipalSosTest` (7): food and ride attribution, town sees and
  handles only its own, Bansud sees all and takes over, no-town alerts,
  `/admin` closed to towns, backfill. Frontend: town SOS page, alarm and sidebar
  in `sos.test.tsx` and `municipal-portal.test.tsx`.
- Full suites: Laravel 1564 passed (2 skipped), frontend 1109 passed.

Not in scope: separate dashboards or controllers per town; letting towns change
Bansud's limits, other towns' data, or municipalities themselves (already
refused today).
