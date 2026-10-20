# TrackTour Delivery Tracker

**Established:** 2026-10-20 (task 1.4 — "Establish the tracker")
**Evidence base:** audit 1.3 live Railway probes (2026-10-20), uncommitted-changeset
audit (2026-10-20), full regression suite run (2026-10-20), `docs/PROGRESS.md`
checkpoints, `docs/current-status/known-issues.md` (baseline 2026-10-06),
`docs/current-status/roadmap.md`, `docs/FULL-STACK-DEPLOYMENT-AUDIT.md`
(2026-10-16), Admin Phase 1 verification (2026-10-19).

**Status legend**

| Symbol | Meaning |
|---|---|
| ✅ Verified complete | Automated tests green **and** documented checkpoint evidence; not complete merely because the UI exists |
| 🟡 In progress | Work exists; named gates remain before the status can advance |
| 🟠 Partial | A named sub-scope is complete; the remainder is tracked |
| ⚪ Not started | Spec/plan may exist; no implementation checkpoint |
| 🔴 Open defect | Known broken behavior with evidence |
| 📦 Deferred | Deliberately parked by decision; revisit trigger recorded |

---

## Step 1 — Feature status (audit evidence)

### Core platform (delivery/dispatch/payment/realtime track — P4 → P11.7)

| # | Feature | Status | Audit evidence |
|---|---------|--------|----------------|
| F1 | Auth, Sanctum, role-based access, session hardening | ✅ | Auth test files green in suite; cross-role auto-logout + stale-credential 401 guard checkpoints (PROGRESS 2026-09-24/25) |
| F2 | Business registration & approval wizard | ✅ | `BusinessRegistrationTest` incl. name-keyed category fix (PROGRESS 2026-10-19, VERIFIED) |
| F3 | Tourism registry (destinations, businesses, landing) | ✅ | Tourist/landing tests green; live probe: `/api/landing/cards` 200 with DB data (2026-10-20) |
| F4 | Food ordering + multi-restaurant group checkout | ✅ | P11.6 acceptance-gate regression; one canonical order/delivery per checkout pinned by tests |
| F5 | Dispatch (`SmartDispatchService`, offers, one-active-delivery, 60-min deadline) | ✅ | P4/P9/P10 + Dispatch Reliability P0–P3 (2026-09-23); `DeliveryOfferConcurrencyTest` 10/77 |
| F6 | Rider-acceptance gate (preparation blocked without accepted rider) | ✅ | P11.2; `PreparationStartServiceGateTest` + `RiderAcceptanceGateTest` |
| F7 | Delivery lifecycle + tourist confirmation gate (P14) | ✅ | P10 money/state invariants; P14 checkpoint 2026-09-24 |
| F8 | Realtime — Socket.IO, trip tokens, GPS integrity, live tracking | ✅ | P5.1/P5.2/P6/P11.5; socket JS suite **52/52** (2026-10-20); live handshake 200 on `tracktour-socket-production` (2026-10-20) |
| F9 | Payments — PayMongo GCash + COD | ✅ (code) / 🟡 (prod acceptance) | P11.4 idempotency; production live-mode webhook/refund acceptance still a deployment blocker (audit §B9) |
| F10 | Refund hardening (provider-authoritative, idempotent) | ✅ | P11.3 |
| F11 | COD settlement — credit-free, 80/20 split | ✅ | P11.1; `CodSettlementService` allocation pinned by tests |
| F12 | Rider earnings & payouts | ✅ | P8 ledger-first payouts, double-spend UNIQUE backstop; ⚠ atomicity hardening open (see T7) |

### Partial / open tracks

| # | Feature | Status | Audit evidence |
|---|---------|--------|----------------|
| F13 | Ride-hailing (transport) | 🟠 | Integration fix resolved defects 1–5, 7 (PROGRESS ride-hailing Phase 1); **open:** rider-side ride PIN (#6), no payment flow for rides (#8), fake rider rating (#9) — `known-issues.md` |
| F14 | Restaurant wallet backfill (P12.5) | ⚪ | Plan written (`docs/current-status/wallet-backfill-plan.md`); caused rider-14 delivered-but-unsettled block |
| F15 | Rider verification stages (seminar/skills/inspection gates) | ⚪ | Spec written, all §5 decisions resolved, DB probe done (0 files); no implementation |
| F16 | State-machine hardening (prior-state guards, terminal-revival protection) | ⚪ | P11 recon #6 — Pending (`known-issues.md` MED #1) |
| F17 | Payout transition atomicity (`lockForUpdate` on approve/markPaid/reject) | ⚪ | P11 recon #7 — Pending (`known-issues.md` MED #2) |
| F18 | Offer-timeout scheduled runner (currently poll-driven only) | ⚪ | `known-issues.md` MED #4 — Pending |
| F19 | PING delivery honesty (dispatch_status vs actual ping outcome) | ⚪ | `known-issues.md` MED #5 — spec drafted, awaiting checkpoint |
| F20 | SOS / emergency alerts | 🔴 stub | Admin live SOS page exists as stub; Tier-2 feature (`roadmap.md`) |
| F21 | Mobile app, localization, advanced reporting exports | ⚪ | Tier-2 (`roadmap.md`); API/Sanctum already mobile-ready |

### Admin module (Phases 1–7)

| # | Feature | Status | Audit evidence |
|---|---------|--------|----------------|
| A1 | Phase 1 — Foundation (dashboard, layout, RBAC, audit log, KPI stats) | ✅ | `AdminFoundationTest` 15/49; 73 admin routes carry `TokenOnlyAuth + CheckRole:bansud_tourism_office`; migration verified (PROGRESS 2026-10-19) |
| A2 | Phase 2 — Rider management | ⚪ | Not started |
| A3 | Phase 3 — Rider operations monitoring | ⚪ | Not started |
| A4 | Phase 4 — Financial monitoring | 🟠 | POS & sales read-only sub-module done (2026-09-24); COD-receivable/system-fee reporting still pending |
| A5 | Phase 5 — Business management | ⚪ | Not started |
| A6 | Phase 6 — Tourism management | ⚪ | Not started |
| A7 | Phase 7 — Reports & audit explorer | ⚪ | Audit-log explorer built in A1 foundation; full reports/CSV-PDF export not started |

### Deployment (Railway full stack)

| # | Feature | Status | Audit evidence |
|---|---------|--------|----------------|
| D1 | Railway services live (frontend, API, Socket.IO, MySQL) | 🟡 | Live probes 2026-10-20: API `/up` 200 + `/api/landing/cards` 200; frontend 200 (SPA); socket handshake 200; CORS preflight 204 with correct origin |
| D2 | API root / SPA catch-all fix | 🟡 | Implemented + tested locally (changeset); **not deployed** — live `/` still 500 (deployed HEAD serves Blade SPA view with no Vite manifest in backend-only image) |
| D3 | Durable storage (uploads public **and** private) | ⚪ | Volume recommendation in `DEPLOYMENT.md` §3.5 covers `storage/app/public` only; private verification docs need coverage — unverified on target |
| D4 | Socket bridge private networking (`SOCKET_SERVER_URL` :3002 + shared secret) | ⚪ | Cannot be probed externally; dashboard verification pending |
| D5 | Production migration control & data audit | ⚪ | Target DB migration history not audited; auto-`migrate --force` on boot documented as blocker §B7 |
| D6 | Production acceptance (payments, email/Resend, scheduler, end-to-end order) | ⚪ | Not executed |

### Database

| # | Item | Status | Audit evidence |
|---|------|--------|----------------|
| DB1 | Schema integrity (UNIQUE backstops, FKs on money paths) | ✅ | P9 schema backstops; DB write-probe of migration 2026_09_23_000001 |
| DB2 | Local dev DB migration reconciliation | ✅ | Re-probe 2026-10-20 (XAMPP restored — repair log in PROGRESS): **90 tables; 202/202 migrations applied, 0 pending, 0 stale**; `2026_10_19_000001_add_audit_context_to_activity_logs_table` applied; full sync with migration files |
| DB3 | 4 live-only tables without migrations (`business_wallets`, `business_wallet_transactions`, `menu_groups`, `menu_group_variations`) | ✅ (local) | Re-probe 2026-10-20: all 4 absent from local DB; zero references in `database/migrations` or `app/` — retired; production-side check folds into T2/D5 migration audit |
| DB4 | Local backup + restore test | ✅ | Restore-verified 2026-10-19 (94/94 tables, row-count match); off-box copy still required |
| DB5 | Historical rebuild migrations (3 files drop/recreate document tables) | 🟠 | Safe on empty DB (201 migrations, 0 pending); populated-target safety unproven (`FULL-STACK-DEPLOYMENT-AUDIT.md`) |

### Test suite baseline (measured 2026-10-20)

```text
Laravel : 629 passed / 3,374 assertions / 0 failures / 2 skipped (SQLite-only)
Frontend: 128 passed / 18 files / 0 errors; vite build clean
Socket  : 52 passed / 0 failures
Working tree: 18 modified + 1 deleted + 1 stray untracked (Dockerfile.review-backup)
```

---

## Step 2 — Dependencies (foundational work first)

```text
T0  Deploy current changeset (fixes live `/` 500; JSON root + SPA auth redirects)
     └── blocks: D2, and any production flow that hits API-domain web routes

T1  Railway dashboard verification (bridge secret, health checks, logs, volume incl. storage/app/private)
     └── prerequisite for: D4, D3, D6

T2  Production migration history audit + backup of target DB (read-only first)
     └── prerequisite for: D5, and any schema migration on the live DB

T3  Restaurant wallet backfill (P12.5, plan exists)
     └── prerequisite for: reliable COD settlement for newly approved restaurants

T4  Admin Phase 2 (rider management)
     └── prerequisite for: A3 (ops monitoring), F15 (verification stages gate rides
         the existing admin approve→activate flow inside Phase 2 UI)

T5  State-machine hardening + payout atomicity + offer-timeout runner (T6–T8)
     └── independent of Admin; recommended before scaling production traffic
         (money-path integrity per P11 recon MED #1/#2)

T6  Ride-hailing follow-ups: ride PIN (#6), ride payment flow (#8), rider rating (#9)
     └── #8 depends on a payments decision (extend PayMongo flow to transport);
         #6 depends on delivery resource contract; #9 independent (data source decision)

T7  Admin Phases 3→7 (sequential per AGENTS.md §15)
     └── Phase 7 (reports/audit/export) consumes surfaces built in 2–6
         A4 remainder (COD receivable reporting) also feeds Phase 7 exports

T8  Production acceptance run (deployed smoke: auth, order→dispatch→delivery,
     PayMongo test-mode webhook/refund, Resend OTP, scheduler/queue, GPS tracking)
     └── depends on T0–T2; closes D6
```

Ordering rule (AGENTS.md §19): READ → AUDIT → IDENTIFY CANONICAL PATH → PLAN
MINIMAL CHANGE → IMPLEMENT → TEST → FULL SUITE → DOCUMENT. No task advances on
UI existence alone.

---

## Step 3 — Completion criteria (definition of done)

A feature may be marked ✅ only when **all** applicable criteria hold:

| Gate | Criterion |
|---|---|
| G1 Tests | Feature-scoped automated tests cover success, invalid state, unauthorized access, duplicates, concurrency, and financial side effects where applicable (AGENTS.md §12) |
| G2 Regression | Full suites green: Laravel 0 failures (skips explicitly understood), frontend Vitest 0 failures, socket JS 0 failures |
| G3 Architecture | No canonical service/controller/route duplicated; acceptance gate, one-active-delivery, COD rules, payment idempotency preserved (AGENTS.md §4–§7) |
| G4 Database | Schema change applied to the intended DB and verified (`SHOW CREATE TABLE` / constraint probe); no constraint removed to pass a test (AGENTS.md §11) |
| G5 Realtime | Authorized-room isolation respected; HTTP recovery works without Socket.IO (AGENTS.md §8) |
| G6 Docs | `docs/PROGRESS.md` checkpoint written (implementation, tests, counts, DB verification, deferred items); this tracker status updated |
| G7 Deployment (if user-facing) | Deployed on Railway, live-probed (endpoint/flow returns expected status), and observed in logs without new errors |

Feature-specific evidence requirements:

| Feature | Additional completion evidence |
|---|---|
| F9/F10/F11 payments & money | PayMongo test-mode webhook + refund replay idempotency on the deployed host; settlement math assertions |
| F5 dispatch | End-to-end: order → offer → single-rider accept → 60-min deadline path with `dispatch_end_reason` observable |
| F8 realtime | Live WebSocket + polling fallback both verified post-deploy; terminal-state broadcast cleanup |
| A1–A7 admin | RBAC probe on every new route (403 for non-`bansud_tourism_office`); audit-log row per governance mutation |
| D1–D6 deployment | Checklist in `docs/DEPLOYMENT.md` §7 executed against the real services; blockers in `FULL-STACK-DEPLOYMENT-AUDIT.md` closed or re-assigned |
| DB2/DB3 | Live `migrate:status` + schema probe recorded here when XAMPP/MySQL is reachable |

---

## Phase 1 exit checklist (repository, database, tests, deployment, outstanding work)

| Requirement | State | Evidence |
|---|---|---|
| Repository audited | ✅ | Deployment audit 1.3 (live probes) + uncommitted-changeset audit (2026-10-20) |
| Database audited | ✅ | Re-probe 2026-10-20: 90 tables, 202/202 applied, 0 pending, 0 stale (DB2); restore test 2026-10-19; DB3 retired locally; DB5 open, documented |
| Tests audited | ✅ | 629/3,374/0/2 + frontend 128 + socket 52 (2026-10-20) |
| Deployment audited | ✅ | Services identified healthy vs pending; blockers documented (`FULL-STACK-DEPLOYMENT-AUDIT.md` §1–§9) |
| Outstanding work documented | ✅ | This tracker + `known-issues.md` + `roadmap.md` + audit blockers |

**Phase 1: COMPLETE (2026-10-20)** — all five requirements met (database
re-probe recorded above). DB5 (historical rebuild migrations on a populated
target) remains a documented open risk, not a Phase 1 blocker; it is owned by
T2/D5.
