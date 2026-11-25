# Business Owner — Staff Management Module

Status: **Stage 1 approved 2026-11-23** (Stages 2–4 on hold until separately approved).

The business owner administers their own business's staff: creates accounts, assigns
responsibilities, controls what each staff member can use, and sees what they did.
A staff member sees and manages only what is assigned to them, for **one** business.

## 1. Audit of the existing implementation (2026-11-23)

| Area | Existing | Gap |
| --- | --- | --- |
| Staff ↔ business | `staff` table (business_id, user_id, staff_role_id, status, employee_id, employment fields, last_login_at), `users.role = 'staff'` | No guarantee a user is staff of only one business |
| Role templates | `staff_roles` (34 global roles) + `business_category_staff_role` | No business-specific (custom) roles — Stage 2 |
| Permissions | `role_permissions` (module × can_view/create/update/delete/export/approve) | Never enforced; only 2 of 34 roles have rows in the seeder, none locally |
| Owner API | list, create, show, edit, archive (`BusinessOwnerStaffController`) | Owner sets the staff password; `updateStatus` / `resetPassword` exist but are not routed; `resetPassword` returns the new password in plain text |
| Staff API | dashboard, orders, order status, rider-payment confirmation, bookings, menu CRUD (`StaffDashboardApiController`, `StaffMenuController`) | See security gaps |
| Invitations, activity logs | — | Missing |

### Security gaps found (all fixed in Stage 1)

1. **Suspended staff kept full access.** The staff API only checked `role:staff`; the staff
   record's status was never checked, login did not check it, and suspending revoked nothing.
2. **Permissions were never enforced.** Any staff account could change orders and bookings,
   create/delete menu items and confirm rider payments.
3. **The staff order endpoint bypassed the order rules.** `PATCH /staff/orders/{order}/status`
   wrote the whole canonical order's status with no accepted-order (fulfilment) policy and no
   unpaid check, and authorised by the order's *first* restaurant — in a group checkout the
   first restaurant's staff controlled the whole order and the other restaurants' staff could
   not reach their own items.
4. **Owners set staff passwords** and the reset returned the new password in the response.

## 2. Design (reuse, no duplicate auth)

- Staff keep using `users` + Sanctum. A staff member is a `users` row (role `staff`) with **one**
  `staff` row (`UNIQUE staff.user_id`).
- `staff_roles` stay the role templates (linked to business categories). Stage 2 adds a nullable
  `business_id` for custom roles and many roles per staff member.
- **Permission catalogue in code** (`App\Support\StaffPermissions`), so staff cannot edit it.
  Grants are stored per role in `staff_role_permissions` (role → permission key).
- **Never grantable to staff:** staff management, business settings, ownership; marking a
  GCash/PayMongo payment paid; marking the tourist's COD as collected. "Confirm cash" only
  means cash actually received by the business — today the rider paying the restaurant for the
  food (existing rider-payment confirmation, `CodPaymentConfirmationService`).
- One "businesses this user may act for" source (`StaffAccess::actingBusinessIds`): owner → own
  businesses; active staff → their one business. `Order::isManagedBy` / `OrderItem::isManagedBy`
  and the owner order controller use it; owner behaviour is unchanged.
- Staff order actions reuse the owner's canonical actions (rider-acceptance gate, accepted-order
  policy, unpaid checks), with a staff scope on top: item actions only on their own restaurant's
  items; whole-order actions only when **every** item is their restaurant's.

## 3. Stages

### Stage 1 — Staff accounts + security fixes (approved)

- Owner adds staff → invitation email with a single-use activation link (token stored as a
  SHA-256 hash, expires after 72 h) → the staff member sets their own password. If the email
  cannot be sent the owner gets a copyable link instead. Passwords never appear in responses,
  logs or emails.
- Suspend / deactivate / remove take effect immediately: all the staff member's tokens are
  revoked and every staff request requires an active staff record. Login is refused for
  pending, suspended, inactive or removed staff.
- Plain-text password reset removed → "resend invitation" (pending staff) and "send password
  reset link" (active staff).
- Permission enforcement on every staff route (backend). Stage-1 permission keys:
  `orders.view`, `orders.update`, `orders.reject`, `payments.confirm_rider_cash`,
  `bookings.view`, `bookings.update`, `menu.view`, `menu.manage` (`menu.manage` off except for
  menu roles and the Restaurant Manager).
- Existing staff keep their logins; their roles are mapped to permissions by migration
  (legacy `role_permissions` rows converted + role-purpose defaults).
- Staff activity records from the start: account created, invited, invitation resent/revoked,
  activated, suspended, reactivated, deactivated, removed, role (permission) changed, password
  reset link sent, profile updated.
- Owner page: Overview (counts + recent activity), All Staff (search, filters, profile, last
  login, actions), Invitations. Public activation page `/staff/activate/:token`.
- The staff portal menu shows only what the staff member's permissions allow (backend still
  enforces every route).

### Stage 2 — Roles & permissions (on hold)

Category-based templates from the approved role list, custom roles per business, several roles
per staff member, Roles & Permissions page, full permission catalogue for the 9 modules.

### Stage 3 — Staff dashboards (on hold)

Kitchen, dispatch, inventory, reservations, transport dashboards; staff "handed to rider" record.

### Stage 4 — Activity logs (on hold)

Full owner-facing activity log page and filters (account events are already recorded from Stage 1).

## 4. Stage 1 implementation record (built 2026-11-23, not committed)

### Database (4 additive migrations; no existing row changed)

| Migration | What |
| --- | --- |
| `2026_11_25_000001_create_staff_role_permissions_table` | role → permission key, `UNIQUE(staff_role_id, permission)`; seeds every existing role (legacy `role_permissions` converted + purpose defaults) |
| `2026_11_25_000002_create_staff_invitations_table` | `token_hash` CHAR(64) UNIQUE (SHA-256), `expires_at` (+72 h), `accepted_at`, `revoked_at`, FKs to staff/business/users |
| `2026_11_25_000003_create_staff_activity_logs_table` | append-only owner-facing staff events (model refuses update/delete) |
| `2026_11_25_000004_add_unique_user_to_staff_table` | `UNIQUE(staff.user_id)` — skipped with a logged warning if a user is already linked to several businesses |

Local MySQL verified: `SHOW CREATE TABLE` for both new tables, `staff_user_id_unique` present, 16 roles
seeded with defaults, live probes: duplicate grant → error 1062, orphan invitation → error 1452.

Default grants (`StaffPermissions::ROLE_DEFAULTS`): Restaurant Manager = all food permissions incl.
`menu.manage`; Order & Payment Staff = food + reject + rider cash, no menu editing; Kitchen /
Preparation = view/update orders + view menu; Menu Management / Food Menu = menu; Inventory = view
menu; reservation/booking/front-desk/visitor roles = bookings view/update; Room Management, Guest
Relations, Concierge = bookings view. Other roles (promotion, housekeeping, maintenance, guides,
drivers…) get no order/booking/menu access until Stage 2.

### Backend

- `App\Support\StaffPermissions` — catalogue, role defaults, legacy mapping, idempotent seeding
  (also called by `StaffRoleSeeder` for fresh installs).
- `App\Services\StaffAccess` — active staff, acting businesses, `can()`, own-order/own-item scope,
  login block reason, token revocation. Never cached (a suspension is effective on the next request).
- `App\Services\StaffAccountService` — invite, resend, revoke, accept, status, role change record,
  password reset link, remove; every step writes a `staff_activity_logs` row.
- Middleware: `staff.active` (rewritten `StaffMiddleware`), `staff.can:<perm>[,field=value]`,
  `staff.order:shared|item|whole`.
- Gap 1: login refuses pending/suspended/inactive/removed staff (no token); every staff route needs an
  active record; suspend/deactivate/remove delete all the user's Sanctum tokens.
- Gap 2: every staff route has a permission. Cancelling through the status endpoint also needs
  `orders.reject`.
- Gap 3: the unsafe `StaffDashboardApiController::updateOrderStatus` and its own rider-payment
  endpoint were removed. Staff routes now call the owner's routed canonical actions
  (`updateStatus`, `startPreparation`, `markReady`, `updateItemStatus`, `codPaymentReceived`).
  Whole-order actions only when every item is the staff member's restaurant's; item status only for
  their own items. `Order::isManagedBy` / `OrderItem::isManagedBy` have a strict staff branch (owner
  behaviour unchanged). `OrderResource` shows staff only their own items (+
  `shared_with_other_restaurants`). The staff order list/summary now include group-checkout orders
  containing their items. Never-routed owner methods (`acceptOrder`, `rejectOrder`, `acceptItem`,
  `rejectItem`) are not exposed to staff.
- Gap 4: `store` takes no password (any sent is ignored), creates a pending account with an unusable
  random password and emails the invitation; plain-text `resetPassword` removed; `update` no longer
  accepts a password; "send password reset link" uses the existing reset flow.
- Also fixed in the staff module: `StaffMenuController` read a has-many collection
  (`$request->user()->staff?->business_id`) and failed on every call; staff dashboard no longer shows
  revenue (financial reports are not a staff permission).
- New routes: `GET /staff/me`; owner `GET /staff/overview`, `GET /staff/invitations`,
  `DELETE /staff/invitations/{id}`, `PATCH /staff/{staff}/status`, `POST /staff/{staff}/resend-invitation`,
  `POST /staff/{staff}/send-password-reset`; public `GET /staff-invitations/{token}`,
  `POST /staff-invitations/{token}/accept` (throttled).

### Frontend

- Owner: `BusinessOwnerStaff` → Staff Management (Overview, All Staff, Invitations); create page
  without password fields + invitation result (copyable link only when the email failed); edit page
  without password; staff profile with role & access, account, invitation, activity history and
  actions (suspend, deactivate, reactivate, resend, reset link, remove).
- Public `/staff/activate/:token` (`StaffActivatePage`).
- Staff portal: `StaffLayout` menu from `/staff/me` permissions; `StaffOrders` rewritten (it read
  `data.data` and never showed orders) with whole-order vs item-by-item actions; menu delete hidden
  without `menu.manage`; dashboard without revenue and with permitted shortcuts only.

### Tests

- New `tests/Feature/StaffManagementStage1Test.php` (23): all four gaps, existing-staff login and
  mapping, legacy conversion, one business per account, multi-restaurant authorisation, invitation
  hashing / single use / expiry / replacement, email failure, activity records.
- Reconciled (AGENTS.md §12): `StaffApiTest` and `RiderAcceptanceGateTest` gave their staff fixture a
  role with order permissions — they assumed any staff account could do everything; their own
  assertions are unchanged.
- New `frontend/tests/ui/staff-management.test.tsx` (10).

### Remaining risks / deferred

1. **Owner-side group-checkout gaps (existing, unchanged, outside Stage 1):** the owner's
   `updateStatus`, `startPreparation` and `markReady` act on the whole canonical order;
   `updateItemStatus` checks the order but not the item's restaurant; `OrderItem::isManagedBy` lets
   the first restaurant's owner manage other restaurants' items; owner order responses include other
   restaurants' items. Staff are protected from all of these; owners are not. Recommend a separate fix.
2. Existing staff whose role has no default grants (and staff with no role) keep their login but lose
   order/booking/menu access after deploy. The owner can switch them to a granted role now; Stage 2
   adds custom roles.
3. Staff order responses still carry order-level totals (subtotal/total/fee) of the whole canonical
   order; item details are filtered.
4. `FRONTEND_URL` must be set on Railway or invitation links point to localhost. (The existing
   `AuthController::forgotPassword` hardcodes `http://localhost:3000` — not changed.)
5. Staff booking status updates follow the same rules as the owner's (no booking payment checks on
   either side).
6. Deploy: run the four `2026_11_25_*` migrations on Railway (with the three earlier pending ones).
   If `staff_user_id_unique` is skipped, the log names the duplicate user ids.

## 5. Restaurant staff roles — Stage 2/3 slice (approved 2026-11-23)

Approved by the product owner after Stage 1, for **restaurants, cafés and food hubs only**. Resort,
attraction, transport and other categories keep their existing roles. All four recommendations accepted.

### Roles (templates linked to the Restaurant, Café and Food Hub categories)

| Role | Permissions | Uses (existing owner logic) |
| --- | --- | --- |
| Order & Pickup Staff | `orders.view`, `orders.update`, `payments.confirm_rider_cash`, `handover.confirm` | owner order actions (Stage 1) + new **Handed to rider** |
| Finance Staff | `finance.view`, `expenses.manage` | owner sales, reports, COD settlements, expenses (create/edit) |
| Menu & Promotions Staff | `menu.view`, `menu.manage`, `promotions.manage` | owner menu manager (incl. photos, availability), categories, promotions |

- One employee may hold several roles (new `staff_role_assignments`; `staff.staff_role_id` stays as the
  first/primary role for compatibility). Permissions = union of the roles' grants.
- **Fixed, never grantable** (no route exists for staff, whatever the roles): expense deletion, payouts,
  bank/payout details, staff management, business settings/ownership, marking GCash paid, marking the
  tourist's COD collected. Only catalogue keys count as permissions.

### Audit (2026-11-23)

- Menu (`BusinessOwnerMenuController`, `BusinessOwnerMenuManageController`, `BusinessOwnerFoodController`,
  `BusinessOwnerOfferingCategoryController`), promotions (`BusinessOwnerPromotionController`,
  `…PromotionManageController`), finance (`BusinessOwnerExpenseController`, `BusinessOwnerSalesController`,
  `BusinessOwnerReportController`) and the business list all scope with `$request->user()->businesses()`
  or `owner_id === user id`. Each will use one "businesses this user acts for" source
  (`StaffAccess::actingBusinessIds`, via a controller trait): owners unchanged, staff limited to their
  one restaurant. Staff routes call these same methods (no duplicated logic).
- Owner pages call several menu endpoints that do not exist (`offerings/{id}/featured`, `/duplicate`,
  `/bulk-action`); they fail for owners today and are left as they are.
- No owner page shows `sales/*` or `reports/cod-settlements`; those endpoints are exposed to finance staff
  but no new screens are built for them in this slice.
- Rider pickup: the rider confirms each pickup stop (`PickupSequenceService::confirmStop`); there is no
  restaurant-side confirmation today.

### Handed to rider

- New `restaurant_handovers` (delivery, order, restaurant, rider, confirmed_by, confirmed_at;
  UNIQUE delivery + restaurant). Allowed once a rider has accepted and all of the restaurant's active items
  are ready (for COD, "ready" already requires the rider's payment to be confirmed). Idempotent; recorded in
  the transaction ledger and, for staff, in staff activity.
- **The rider pickup flow is unchanged:** the rider still confirms pickup independently; the handover only
  adds a record shown to the rider and the restaurant.
- Owner and staff share one endpoint implementation (like the rider-payment confirmation).

### Frontend

- The owner menu, promotion, expense and report pages take their API prefix, link prefix and business from
  a small portal context (default = owner, so owner pages are unchanged). The `/staff` portal renders the
  same pages under `/staff/...`. Expense delete is hidden for staff (and refused by the server).
- Staff menu shows Orders, Bookings, Menu, Promotions, Reports, Expenses by permission.
- Staff orders: "Confirm cash received" and "Handed to rider", with the rider's name.
- Owner create/edit staff: tick one or more roles.

### Implementation record (built 2026-11-23, not committed)

**Migrations (local MySQL verified; nothing existing removed):**

| Migration | What |
| --- | --- |
| `2026_11_25_000005_create_staff_role_assignments_table` | staff ↔ role, `UNIQUE(staff_id, staff_role_id)`; every existing staff member's role copied in |
| `2026_11_25_000006_add_restaurant_staff_roles` | the three roles + grants; Restaurant, Café and Food Hub now offer exactly these (verified: Resort and Tourist Attraction lists unchanged) |
| `2026_11_25_000007_create_restaurant_handovers_table` | `UNIQUE(delivery_id, business_id)`, FKs to deliveries, orders, businesses, users |

**Backend**
- `ActsForBusiness` trait (owner → own businesses, staff → their restaurant) in the menu, menu-manage,
  food, offering-category, promotion, promotion-manage, expense, sales, report and business-list
  controllers. Owner behaviour unchanged; staff routes call the same methods.
- Permissions `handover.confirm`, `finance.view`, `expenses.manage`, `promotions.manage`;
  `StaffPermissions::effective()` ignores any stored grant that is not a catalogue key (or is in
  `NEVER_GRANTABLE`).
- `Staff::roles()` / union of grants; owner create/edit take `staff_role_ids[]` (first = primary);
  every new role must be offered for the business's category; role changes are logged with
  permissions before/after.
- "Handed to rider": `RestaurantHandoverService` + `BusinessOwnerOrderController::handover`
  (owner `POST /business-owner/orders/{order}/handover`, staff `POST /staff/orders/{order}/handover`);
  the restaurant choice is shared with the rider-payment confirmation (`actingRestaurantInOrder`).
  The rider's pickup-stops payload shows `restaurant_handover` (first name only). No pickup stop,
  delivery or order status is changed.
- Staff `/menu*` routes now use the owner menu controllers; `Staff\StaffMenuController` and the three
  staff-only menu pages were removed (replaced).
- **Owner defects fixed because the staff roles reuse them:**
  - creating a promotion failed (no `business_id` rule; the page's `discount_type` / `discount_value` /
    `start_date` / `end_date` were not accepted) — both field shapes now work, fixed amounts allowed
    (tourist pages already show "₱X OFF"; promotions do not change checkout prices);
  - the promotion edit page loaded the raw model (empty form) — now the resource;
  - `PromotionManageController` used `where(...)` with a list, so an owner with several businesses
    could only open the first business's promotions — now `whereIn`.

**Frontend**
- `business-portal` context (prefix, business, isStaff); the owner menu, menu create/edit, food create,
  promotions (list/create/edit/featured), expenses and reports pages use it (owner default unchanged).
- Staff portal: Menu, Promotions, Sales & Reports, Expenses routes render those pages; expense delete
  and report exports hidden for staff.
- Staff orders: "Confirm cash received", "Handed to rider", rider name/phone, handover done state.
- Owner create/edit staff: `RolePicker` (tick one or more roles); a role already held stays visible.
- Rider order sheet shows "Restaurant handed it over · confirm your pickup".

**Tests**
- `tests/Feature/RestaurantStaffRolesTest.php` (12): roles per business type, multi-role, role change
  log, menu & availability, promotions (both field shapes, cross-restaurant refusal), finance scope and
  expense rules (no delete), handover rules / idempotency / rider view / group checkout / owner, fixed
  restrictions with forged grants.
- `frontend/tests/ui/restaurant-staff-roles.test.tsx` (8).

**Known / deferred**
- Owner menu page actions `featured`, `duplicate`, `bulk-action` call routes that do not exist (owner
  and staff alike) — unchanged.
- No owner or staff screen for `sales/*` or `reports/cod-settlements` yet (API available to finance staff).
- The owner's group-checkout gaps from Stage 1 (§4 risk 1) remain.
- Deploy: run `2026_11_25_000001…000007` on Railway.

## 6. Roles & Permissions page — Stage 2 (approved and built 2026-11-24, not committed)

### Audit

- `/business-owner/roles` (sidebar "User Roles & Permissions") renders `BusinessOwnerRoles.tsx`, a mock:
  four hard-coded roles, "Add Role" and "Edit" buttons do nothing.
- Roles are global templates only (`staff_roles`, `name` globally UNIQUE), offered per business category
  (`business_category_staff_role`). Grants live in `staff_role_permissions`; staff permissions = union of
  their roles' grants (`Staff::grantedPermissions`, catalogue keys only). Owners cannot see or change grants.
- `GET /business-owner/staff/roles` is an inline route closure; it returns every role in the system when the
  business is missing, not the owner's, or its category has no templates.
- `rolesError` only accepts templates offered for the business's category.

### Proposal

1. **Built-in roles (templates) are read-only.** They are shared by every business of that type, so an owner
   cannot change them. The page shows each with its permissions and staff count, plus **Duplicate** to start
   a custom role from it.
2. **Custom roles per business.** Additive migration: nullable `staff_roles.business_id` (FK, cascade);
   replace the global `UNIQUE(name)` with `UNIQUE(business_id, name)`; a custom role may not reuse a
   built-in role's name for that business (checked in code, since MySQL lets NULLs repeat). Max 20 custom
   roles per business; name 2–50 chars, description up to 255.
3. **Permission editor** grouped by module (`CATALOGUE`), showing only the permissions that fit the business
   type: food businesses → orders, rider cash, handover, menu, promotions, finance, expenses; booking
   businesses (resort, attraction, …) → bookings, finance, expenses, promotions. `NEVER_GRANTABLE` items are
   listed as locked "Owner only" rows so owners can see what staff can never do. At least one permission.
4. **Changes apply immediately** to everyone holding the role (permissions are already checked per request).
   Each affected staff member gets a `staff_activity_logs` "role permissions changed" entry with before/after;
   the page warns "This changes access for N staff" before saving.
5. **Delete** a custom role only when nobody holds it (the page lists who to reassign); built-ins cannot be
   deleted.
6. **Staff create/edit:** `RolePicker` shows built-in + this business's custom roles; `rolesError` accepts a
   custom role only for its own business. The roles endpoint moves into a controller and returns nothing for
   a business the owner does not own (fixes the "all roles" leak above).
7. **API** (owner only, `role:business_owner`, ownership checked): `GET /business-owner/roles?business_id=`,
   `GET /business-owner/roles/permissions?business_id=` (catalogue for that business type),
   `POST /business-owner/roles`, `PUT /business-owner/roles/{role}`, `DELETE /business-owner/roles/{role}`.
   Staff never get these routes (`staff.manage` stays never-grantable).
8. **Page:** business selector (owners with several businesses), "Built-in" and "Custom" role lists with
   permission chips and staff count; create/edit drawer with grouped checkboxes; staff-holding-this-role list.
9. **Tests:** feature tests (CRUD, cross-business refusal, name rules, grant filtering by business type, never-
   grantable refused, delete while assigned refused, picker accepts own custom role / refuses another's,
   permission change takes effect for staff + logged) and a UI test for the page.

Out of scope: editing built-in templates, resort/attraction built-in role lists (unchanged until described),
staff dashboards (Stage 3), the full activity log page (Stage 4).

### Product owner's decision (2026-11-24)

"Roles for staff: there are 3 roles for staff, and the business owner can add roles and choose what modules
they can manage." The three restaurant roles stay built-in (read-only); owners add custom roles by module.

### Implementation record (built 2026-11-24, not committed)

- Migration `2026_11_25_000008_add_business_id_to_staff_roles_table`: nullable `business_id` (FK, cascade),
  `created_by`; `UNIQUE(name)` → `UNIQUE(business_id, name)`. Local MySQL verified. Rollback refused while
  custom roles exist.
- `StaffPermissions::MODULES` (Orders, Rider cash payments, Rider handover, Bookings & reservations, Menu,
  Promotions & discounts, Sales & reports, Expenses), `modulesForCategory` (food modules for Restaurant /
  Café / Food Hub, bookings for other types, both for Hotel & Restaurant Combination), `withImplied`
  (manage ⇒ view), `OWNER_ONLY_LABELS`.
- `BusinessOwner\BusinessOwnerRoleController`: `GET/POST /business-owner/roles`,
  `PUT/DELETE /business-owner/roles/{role}`, and `GET /business-owner/staff/roles` (replaces the route
  closure; returns nothing for a business the owner does not own). Max 20 custom roles; a custom name may
  not repeat one of the business's roles or any built-in name (case-insensitive). Editing logs
  `staff.role_permissions_changed` (before/after) for every holder whose access changed.
- `BusinessOwnerStaffController::rolesError` accepts a custom role of the same business only.
- Seeders look up built-in roles only (`business_id` NULL).
- Frontend: `BusinessOwnerRoles.tsx` rewritten (follows the owner's selected business); `RolePicker` tags
  custom roles.
- Tests: `tests/Feature/StaffCustomRolesTest.php` (8), `frontend/tests/ui/business-owner-roles.test.tsx` (5).
- Deploy: run `2026_11_25_000008` on Railway with the earlier `000001…000007`.
