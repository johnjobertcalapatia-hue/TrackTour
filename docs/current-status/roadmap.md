# Roadmap

## Current Phase: Admin — Tourism Office Governance & Monitoring

The delivery/dispatch/payment/realtime phase is complete (P11.1 → P11.7). The next build phase is the **Admin module** — a Tourism Office governance/monitoring surface.

**Starting regression baseline**: 311 tests / 1,493 assertions / 0 failures / 2 skipped (Laravel) + 43 JS socket tests.

### Admin Boundary (non-negotiable)

Tourism Office manages only through **monitor / verify / approve / audit / report** actions. It must never:

- accept deliveries on behalf of riders
- manipulate rider GPS
- bypass COD credit rules
- mark PayMongo payments
- force riders online
- bypass the rider-acceptance gate
- alter authoritative delivery states
- treat WebSocket as source of truth

### Admin Build Scope (Phases 1–7)

- [ ] Phase 1 — Foundation: dashboard, layout, RBAC, audit log, stats
- [ ] Phase 2 — Rider management
- [ ] Phase 3 — Rider operations monitoring
- [ ] Phase 4 — Financial monitoring
- [ ] Phase 5 — Business management
- [ ] Phase 6 — Tourism management
- [ ] Phase 7 — Reports & audit

### Post-P11 Maintenance Window (documented, tracked here)

| Item | Description |
|------|-------------|
| State-machine hardening (P11 recon #6) | Prior-state guards on item transitions, terminal-revival protection, pre-pickup delivery-state check, conditional order-status PATCH guards |
| Payout transition atomicity (P11 recon #7) | Transactions + `lockForUpdate` on approve/markPaid/reject/cancel |
| Admin system-fee / COD receivable reporting | Platform accounting of `system_fee` and COD receivables |
| Dispatched-time vs accepted-time metrics parity | Cosmetic reporting divergence |
| **P12.5 — Restaurant wallet foundation backfill** (planned, next small phase) | Idempotent `wallets:backfill` command heals approved restaurants missing a wallet (hook-only provisioning gap; caused the rider-14 delivered-but-unsettled ping block). Plan: `docs/current-status/wallet-backfill-plan.md` |
| **Rider verification stages** (spec written; **all §5 decisions RESOLVED**) | Safety seminar + driving skills test + vehicle inspection as gates inside the existing admin approve→activate flow. §5.1: source-faithful 4 required docs (License R1/Code A, OR/CR, Barangay/Police Clearance, Medical Certificate — all expirable; NBI/drug-test dormant). §5.2: single append-only `rider_verifications` table, `type` discriminator (4 docs + 3 stages), type-scoped status vocab, JSON `metadata` for stage payloads, no backfill (DB probe: 0 files exist). §5.3: readiness enforced at approve / go-online / activate + dispatch eligibility via one shared gate (seeded riders re-onboard once through the new UI). §5.4: performance reports deferred to Admin Phase 3/7. §5.5: no transport status work. **Next: implementation phase** → migrations, models, gate service, endpoints, rider/admin UI, expiry command, tests, full suite, docs. Spec: `docs/architecture/rider-system-workflow-spec.md` |

### Priority Tier 2 — Features

| Item | Description |
|------|-------------|
| Mobile application | API routes defined, Sanctum auth ready |
| Advanced reporting dashboards | Data export (CSV/PDF) |
| Multi-language support | Localization |
| SOS/Emergency alert system | Admin live SOS page exists (stub) |

---

## Completed Phases

| Phase | Description | Status |
|-------|-------------|--------|
| P4 | Order/Delivery Regression & Rider Concurrency | Done |
| P5.1 | GPS Integrity | Done |
| P5.2 | Basic Order Size & Dispatch Eligibility | Done |
| P6 | WebSocket Live-Tracking Hardening | Done |
| P7 | Fast Delivery Rider Tip | Done |
| P8 | Rider Payouts | Done |
| P9 | Dispatch & Concurrency Locks | Done |
| P10 | Completion & Money Invariants + Suite to Green | Done |
| P11.1 | COD Financial Settlement Allocation | Done |
| P11.2 | Rider Acceptance Gates Food Preparation | Done |
| P11.3 | Refund Path Hardening | Done |
| P11.4 | Payment Idempotency | Done |
| P11.5 | Realtime Completeness | Done |
| P11.6 | Acceptance-Gate Regression | Done |
| P11.7 | Final System Verification | Done |