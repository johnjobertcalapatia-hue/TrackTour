# Phase 2.1 — Roles & Permission Matrix

**Date:** 2026-10-20
**Scope:** Phase 2 "System Architecture and Municipality Management" — 2.1 Define roles
and permissions (Steps 1–3 documented here; Step 4 evidence is the automated test
`tests/Feature/Phase2RoleAuthorizationTest.php`).
**Evidence base:** full role/authorization code audit (2026-10-20) — middleware,
policies, gates, seeder catalogs, route groups, registration flow, existing RBAC tests.

---

## Step 1 — Role catalog (purpose and scope)

Phase 2 uses six roles. Two of them map onto **existing canonical `users.role`
strings** — no new role strings are introduced (the audit confirmed the existing
two-tier vocabulary already encodes the municipal/district split):

| # | Phase 2 role | Canonical `users.role` value | Purpose | Scope (data visibility) | How accounts are created |
|---|---|---|---|---|---|
| 1 | Tourist | `tourist` | Browse destinations, book, order food, ride transport | Own profile, own bookings/orders only | Public self-registration (`POST /api/register`, `User::REGISTRABLE_ROLES`) |
| 2 | Business Owner | `business_owner` | Operate a business: menu/offerings, orders, hours, documents | Own business + own staff only (approval-gated: `business.approved`) | Public self-registration → `account_status=pending` → admin/office approval |
| 3 | Staff | `staff` | Delegated business operations (orders, menu, dashboard) assigned by the owner | Own business only, via active `staff` record (`StaffMiddleware`) | Created by the Business Owner (`BusinessOwnerStaffController`), never self-registered |
| 4 | Rider | `rider` | Accept deliveries/rides, GPS tracking, earnings | Own offers/assignments/earnings only | Public self-registration with OTP (`OtpService`) + age/name dedup rules |
| 5 | Municipality Tourism Admin | `tourism_office` | Municipal administration: municipal business approvals, tourism content, municipal reports | **One municipality** (`municipality_id`) — target scope; see F-3 | Created by District Super Admin (`StoreUserRequest`); **never** self-registered (see F-1 fix) |
| 6 | District Super Admin | `bansud_tourism_office` | District-wide oversight: all municipalities, users, riders, payouts, municipalities CRUD, audit trail | District-wide, all municipalities | Provisioned out-of-band (seeder/admin); **never** self-registered (see F-1 fix) |

### Canonical vs actual storage

- **Authoritative mechanism:** the `users.role` string column, read by
  `CheckRole` middleware (`app/Http/Middleware/CheckRole.php:13`) and by
  service/repository queries. User constants: `app/Models/User.php:26–48`.
- **Dead schema (not authorization):** `roles` + `user_roles` tables
  (`2026_07_06_000018_…`) are seeded by `RoleSeeder` but **never read at runtime**.
  `role_permissions` belongs to `staff_roles` (business-staff permission system,
  separate concern) — not the top-level role system.
- **`staff` catalog drift:** `staff` is a live `users.role` value and a route gate
  (`routes/api.php:457`) but is absent from `User::ROLES`, `User::REGISTRABLE_ROLES`,
  `RoleSeeder`, and `AdminService::getUsersByRole()` — while `AdminRoleController`
  hard-codes it. Three role catalogs disagree (F-4).
- **Enforcement layers that actually protect routes:** route middleware only
  (`role:` gates on `routes/api.php` + `token.only`). Nine policy classes exist in
  `app/Policies/` but **none are registered or called** (F-2).

---

## Step 2 — Permission matrix (approved target state)

Actions: **view / create / edit / approve / reject / cancel / settle** per record
type. ✅ = authorized, ❌ = explicitly denied, — = capability not offered anywhere.
Scope notes reference the enforcement status in Step 3 (F-numbers).

| Record type | Action | Tourist | Business Owner | Staff | Rider | Municipality Tourism Admin | District Super Admin |
|---|---|---|---|---|---|---|---|
| **R1 User accounts** (incl. office accounts) | view | — | — | — | — | ✅ municipal users (target; no surface today) | ✅ (`/admin/users`) |
| | create | — | — | — | — | ❌ | ✅ (`StoreUserRequest`) |
| | edit (role/status/suspend) | — | — | — | — | ❌ | ✅ |
| | approve / reject | — | — | — | — | ❌ | ✅ (`/admin/users/{u}/approve`) |
| **R2 Business registrations** | view | — | own | own | — | ✅ (`/tourism-office/business-owners`) | ✅ (`/admin/businesses`) |
| | approve / reject | ❌ | ❌ | ❌ | ❌ | ✅ own municipality (target; **unscoped today, F-3**) | ✅ district-wide |
| **R3 Business records** (profile, hours, offerings) | view | public approved subset | own | own | — | ✅ municipal | ✅ |
| | edit | ❌ | own | own (menu/orders) | — | ❌ | ❌ (approve/suspend only) |
| **R4 Rider accounts & documents** | view | — | — | — | own | ✅ municipal (target; no surface today) | ✅ (`/admin/riders`) |
| | approve / reject | ❌ | ❌ | ❌ | ❌ | ✅ municipal (target; **not built**) | ✅ (`/admin/riders/{r}/approve`) |
| **R5 Rider payouts** | view | — | — | — | own earnings | ❌ (Phase 4 financial view) | ✅ (`/admin/payouts`) |
| | approve / reject / settle | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (`/admin/payouts/{p}/approve`) |
| **R6 COD settlements / system fees** | view | — | own orders | own business orders | own deliveries | ❌ (Phase 4) | ✅ |
| | settle | — | — | — | — | — | — (automated by `CodSettlementService`; no manual endpoint) |
| **R7 Orders** | view | own | own business | own business | assigned | ✅ municipal reports | ✅ |
| | cancel | own (per lifecycle rules) | own (pre-acceptance) | own business (pre-acceptance) | ❌ | ❌ | — (no platform-cancel endpoint) |
| **R8 Refunds** | view | own | own | — | — | ❌ | ✅ |
| | approve / reject | ❌ | ❌ | ❌ | ❌ | ❌ | — (provider-authoritative via PayMongo; no human approve endpoint, P11.3) |
| **R9 Tourism content** (destinations, events, announcements, categories) | view | public | public | public | public | ✅ (`/tourism-office/…`) | ✅ |
| | create / edit / delete | ❌ | ❌ | ❌ | ❌ | ✅ municipal (target: own municipality; **unscoped today, F-3**) | ✅ district-wide |
| **R10 Landing page content** | view | public | public | public | public | ✅ | ✅ |
| | edit | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| **R11 Tourism documents & category assignments** | view | ❌ | own business docs | own business docs | own docs | ✅ (`/tourism-office/documents`) | ✅ |
| | create / edit / delete | ❌ | own business | own business | own docs | ✅ | ✅ |
| **R12 Municipalities** | view | public (landing) | public | public | public | ✅ (forms dropdown) | ✅ |
| | create / edit | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (`/admin/municipalities`, matches `MunicipalityPolicy` intent) |
| **R13 Audit trail & operational KPIs** | view | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (`/admin/audit-logs`, `/admin/dashboard`) |

Office-account management (creating `tourism_office` accounts, R1) is
**District-Super-Admin-only by design**: Municipality Tourism Admin has no
account-provisioning surface.

---

## Step 3 — Comparison with Laravel (findings)

Comparison method: matrix above vs actual enforcement (`routes/api.php` gates,
`CheckRole`, `RegisterRequest`/`AuthController`, `bootstrap/app.php` aliases,
`app/Policies`, controllers, repositories).

| # | Finding | Severity | Status |
|---|---|---|---|
| F-1 | **Privilege self-grant via public registration.** `RegisterRequest` validated `role` against `User::ROLES`, which includes `tourism_office` and `bansud_tourism_office`; `AuthController::register` then created the account with `account_status=approved` + session token. Anyone could `POST /api/register {role:"tourism_office"}` and immediately pass the `role:tourism_office,bansud_tourism_office` gate on all `/tourism-office/*` routes (full tourism-content CRUD + business approvals). No test or frontend flow relied on this path. | **Critical** | **FIXED in 2.1** — validation changed to `User::REGISTRABLE_ROLES` (`RegisterRequest.php:24`); pinned by Step 4 tests |
| F-2 | Nine policies in `app/Policies/` (incl. `MunicipalityPolicy`, which encodes the exact DSA-only municipality CRUD rule) are **never registered or invoked** — no `Gate::` calls, no `$this->authorize()`. Actual enforcement = route middleware + ad-hoc controller `abort(403)` checks. Policies are aspirational dead code. | Medium | Documented; wiring belongs to a later authorization-hardening step (do not duplicate middleware logic in policies before scoping exists) |
| F-3 | **No municipality data scoping.** Once past the role gate, every `/admin/*` and `/tourism-office/*` query returns **all municipalities' data** — no controller/repository forces `municipality_id = $user->municipality_id`. Also: `users.municipality_id` (seeder/admin) vs `user_profiles.municipality_id` (registration) can diverge — the authoritative scope column must be chosen before scoping is implemented. | **High** (the core Phase 2 gap) | Documented; scoping is the expected next Phase 2 step; matrix rows R2/R4/R9 marked accordingly |
| F-4 | Role catalogs disagree in three places: `User::ROLES` (5, no `staff`), `AdminRoleController` hard-coded list (6, with `staff`), `RoleSeeder` (5, no `staff`); `StoreUserRequest`/`UpdateUserRequest` cannot assign `staff`; `AdminService::getUsersByRole()` omits it. | Low | Documented |
| F-5 | `bootstrap/app.php:32` aliases `business.context` → `SetBusinessContext` class that **does not exist**. Currently latent (alias unused on any route); attaching it would fatal. | Low | Documented |
| F-6 | `roles`/`user_roles` tables + `RoleSeeder` create a false impression of a permission system; `AdminRoleController` looks DB-backed but is a hard-coded array. | Low | Documented (dead schema; do not build on it) |
| F-7 | `Municipality::tourismOfficers()` reads `user_profiles.municipality_id` while registration/auth elsewhere use `users.municipality_id` — undefined which is authoritative for scope enforcement (depends on F-3 resolution). | Medium (blocks F-3) | Open decision recorded |

### Gates verified as correct today

- `/admin/*` → `role:bansud_tourism_office` only (`routes/api.php:517`) — MTA is
  correctly excluded from the district surface (existing tests + Step 4).
- `/tourism-office/*` → `role:tourism_office,bansud_tourism_office` (`:628`) —
  all other roles denied (existing `TourismOfficeApiTest`).
- Role gates run behind `token.only` (bearer auth); staff requires an active
  `staff` record (`StaffMiddleware`); business owners require approval
  (`business.approved`).
- `/admin` governance mutations are audit-logged (`AdminFoundationTest`).

---

## Step 4 — Unauthorized-action tests

See `tests/Feature/Phase2RoleAuthorizationTest.php`. Coverage:

1. Public registration rejects `tourism_office` and `bansud_tourism_office`
   (422 + **zero rows created**) — pins the F-1 fix; positive control keeps
   `tourist` registration working.
2. `staff` role denied on `/admin/*` (missing from the existing
   `AdminFoundationTest` non-admin loop).
3. Municipality Tourism Admin denied district-admin **writes** with a
   **data-unchanged** assertion (target account status stays `pending` after 403).
4. Wrong roles denied payout settle (`/admin/payouts/{p}/approve`) and rider
   approval writes — 403 with the record's state verified unchanged.
5. Non-office roles denied tourism-content **create** — 403 with row-count
   unchanged.
6. Positive controls: District Super Admin still passes `/admin/dashboard`;
   tourist registration still succeeds.
