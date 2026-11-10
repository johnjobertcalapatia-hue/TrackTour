# PR Review — `feature/rider-trip-flow-dispatch-cash`

Review checklist for the branch containing:

| Commit | Scope |
| --- | --- |
| `b0b1429` | Rider trip flow, sequential dispatch, daily cash advance, resorts, tourist UX |
| `bc6ba39` | Migration hardening + placeholder mail addresses |

Baseline: `main` = `7e1cf6a`. `main` must stay untouched until every **BLOCK** item below is closed.

How to use: each section lists what to read, what must be true, and what evidence counts. A tick means
"I verified it", not "the tests pass".

---

## 0. Blocking gates

- [ ] `php artisan test` — 0 failures on this branch.
- [ ] `npm --prefix frontend run test:ui` — 0 failures.
- [ ] `npm run test:js` — socket suite green.
- [ ] `npm --prefix frontend run build` — clean.
- [ ] Migrations replayed against a **restored production dump**, not just an empty schema (§7).
- [ ] No `rider_credits` / `cod_credit_reserved` / `available_working_credit` reintroduced (§1.5).
- [ ] Production backup taken and restore-tested before any merge (§9).

---

## 1. Rider dispatch lifecycle

Files: `app/Services/SequentialDispatchService.php` (+311), `ProcessDispatchOfferTimeouts.php`,
`ScheduledDispatchProcessor.php`, `RiderDispatchController.php`, `routes/console.php`,
`frontend/src/features/rider/services/delivery-offers.ts`, `RiderDeliveryOffer.tsx`.

1.1 One live offer per delivery
- [ ] `deliveries.current_offer_id` is written **only** inside a `lockForUpdate()` transaction.
      Grep every writer: `Select-String -Path app\**\*.php -Pattern "current_offer_id"`.
- [ ] `offerNext()` cannot create a second row in `booking_dispatch_logs` for the same rider
      (DB `UNIQUE(delivery_id, rider_id)` still backs it).
- [ ] `hasLiveOffer()` treats an **expired** offer as dead, not live.

1.2 Offer expiry / no silent dead end
- [ ] `ProcessDispatchOfferTimeouts` is scheduled (verify in `routes/console.php`) and is idempotent
      when it runs twice in the same minute.
- [ ] Expiry path leads to the next targeted attempt, then `moveToManual()` — never a delivery that is
      neither offered nor on the board.
- [ ] `dispatch_end_reason` (or equivalent) is set on every terminal dispatch outcome so the failure is
      observable (AGENTS.md §20, P3 rule).
- [ ] Behaviour when the scheduler is **down** for >60 min: delivery still recoverable. Test it, don't
      reason about it.

1.3 Attempt policy
- [ ] `targeted_attempts` caps at `maxAttempts()` (4) and the counter cannot double-increment on a
      retried request.
- [ ] Manual board hand-off preserves the audit trail (`attempt_no`, `phase`).

1.4 Acceptance atomicity (must not regress)
- [ ] One active delivery per rider still enforced by transaction + row lock, not by UI (AGENTS.md §4.3).
- [ ] Concurrent double-accept by the same rider yields exactly one `accepted` delivery.
      `tests/Feature/DeliveryOfferConcurrencyTest.php`, `RiderAcceptanceGateTest.php` must still pass
      literally — not be edited to fit new behaviour.
- [ ] Accepting one offer cancels the rider's other pending offers without orphaning them.

1.5 Eligibility (must not regress)
- [ ] `NearestRiderService` (+424) does **not** reintroduce a credit wallet. Grep:
      `rider_credits`, `cod_credit_reserved`, `available_working_credit`, `reserved_credit`.
- [ ] COD eligibility still resolves through the credit-free `getCodEligibility()`.
- [ ] The dispatch radar path and the offer path return the **same** eligible set for the same
      delivery (the P1 "radar eligibility consistency" fix).
- [ ] `SmartDispatchService` is not forked: confirm the new sequential path calls into it rather than
      duplicating its checks.

1.6 Frontend is not authoritative
- [ ] `RiderDeliveryOffer.tsx` / `delivery-offers.ts` only render server state; no local "accepted"
      flag that survives a failed request.
- [ ] Offer UI respects reconnect: a reload mid-offer shows the server truth (HTTP recovery, §8.7).

---

## 2. Multi-restaurant pickup confirmations

Files: `PickupSequencePlanner.php` (new), `PickupSequenceService.php`, `PurchasingCashService::routeStops()`,
`RiderDeliveryController.php` (+208), `frontend/src/features/rider/pickup-route.ts`, `pickup-stops.ts`.

- [ ] Group checkout still produces **one** order, **one** delivery, **one** rider (AGENTS.md §4.1).
- [ ] `pickup_sequence` (farthest-from-tourist first) is authoritative when present; unplanned/legacy
      deliveries fall back to farthest-first by distance — verify the fallback, not just the planned case.
- [ ] Ids in `pickup_sequence` that no longer exist among the order's businesses are filtered out and
      cannot drop a real stop from the route.
- [ ] Confirmation is **per business**: confirming stop 1 must not mark stop 2 collected.
- [ ] Out-of-order confirmation (skip ahead) is rejected or explicitly allowed — pick one and prove it.
- [ ] Repeated confirmation is idempotent (no duplicate `cod_purchases`, no double ledger row).
- [ ] Geofence: `TRACKING_PICKUP_RADIUS_METERS` is the only source of the radius; a wide arrival radius
      must not silently satisfy the pickup radius.
- [ ] A restaurant whose items are ready while another is not does not block the whole route
      unintentionally.

---

## 3. Purchasing-cash issuance (daily advance)

Files: `PurchasingCashService.php` (+117), `RiderCashFundService.php` (+229),
`AdminPurchasingCashController.php`, `frontend/.../AdminRiderCash.tsx`,
`AdminRiderCashReconciliation.tsx`.

- [ ] **No double count**: `linkDailyAdvance()` must not also write a `cash_issued` transaction — the
      advance already counted that money. Verify a COD delivery linked to a fund leaves
      `SUM(type = cash_issued)` unchanged.
- [ ] Concurrency: `update()->whereNull('rider_cash_fund_id')` is the race winner check. Prove two
      parallel `markPurchase` calls produce **one** link and **one** purchase set
      (`initializeForDelivery()` must be idempotent — check what happens if it runs twice).
- [ ] `issuePurchasingCash()` invariant (`allocation total == settlementBaseFor`) throws a **422-class**
      business error, not a 500, and never partially issues cash (fund row + delivery row in one
      transaction).
- [ ] The legacy per-delivery issue path is still reachable from the admin UI. Confirm the UI cannot
      issue cash for a delivery already linked to a daily advance, and vice versa.
- [ ] Which path is live in production? Document the toggle/decision explicitly; do not leave both
      silently active.
- [ ] Issuance is attributed to the officer (`User`) and appears in that rider's fund statement.

---

## 4. Personal-fund reimbursement

Files: `RiderCashFundService.php` (`rider_personal_contribution`, `assertSplits`,
`buildDailyReceipt`), `CodPurchaseExpense`.

- [ ] `office_cash_used + rider_personal_contribution == actual_amount` holds before verification;
      the failure message is actionable and mapped to 422/409.
- [ ] The rider cannot self-declare a personal contribution larger than the purchase.
- [ ] Reimbursement reaches the rider exactly once: it appears in `verified_personal_purchase_reimbursement`
      and must not also be paid by the payout batch. Trace one amount end to end.
- [ ] A personal contribution on a delivery with **no** open fund still reimburses.
- [ ] Rejecting/correcting an expense does not leave a stranded contribution in the balance.

---

## 5. COD remittance

Files: `RiderCashFundService::buildDailyReceipt/officeCashBalance`, `CodSettlementService`,
`config/cod_cash.php`, `AdminRiderCashReconciliation.tsx`.

- [ ] Net remittance follows AGENTS.md §5.1 exactly:
      `verified COD − delivery-fee earnings − tips − verified rider-funded purchases − approved entitlements`.
- [ ] Negative result becomes `rider_payable`; **no negative remittance row** is ever created.
- [ ] `max(0, …)` floors are applied to both sides and cannot mask a double deduction.
- [ ] `officeCashBalance()` counts **only VERIFIED** office-funded purchases. A pending expense must not
      reduce the balance (otherwise the rider "returns" cash they already spent).
- [ ] Cash returns recorded as `TYPE_OFFICE_CASH_RETURNED` are the only subtraction from issued cash;
      the `unreturned < 0` guard is reachable in a test.
- [ ] COD cash is never treated as earnings; the 80/20 allocation is **not** deducted a second time from
      physical remittance (§5.3).
- [ ] Legacy policy date: `net_remittance` / `rider_payable` stay `null` before the configured effective
      date, including for deliveries completed before it but settled after it.
- [ ] Remittance is idempotent: double submit, retry after timeout, and replay of the same business date.
- [ ] Deleting/voiding a movement cannot rewrite a closed day's receipt.

---

## 6. Settlement math

Files: `CodSettlementService::businessBases()`, `recordAllocations()`, `settlementBaseFor()`,
`PurchasingCashService::allocation()`.

- [ ] `businessBases()` sums **exactly** to `round(subtotal + system_fee, 2)` — the last business absorbs
      the fee remainder. Verify with a rounding-hostile case: subtotal `100.01` across 3 businesses,
      `system_fee = 7.77`.
- [ ] Same round-trip for: 1 business, 3+ businesses, a zero/absent `business_id` (falls back to
      `order->business_id`), a cancelled quantity, and quantity 0.
- [ ] `sortKeys()` remainder assignment is stable — no reliance on undefined collection ordering.
- [ ] `settlementBaseFor($delivery, $order)` and `settlementBaseFor($delivery)` return the **same** number
      for a standard group checkout; the explicit-order form cannot under-state the base.
- [ ] Invariant probe on a real row: `order.rider_financed_amount == SUM(cod_settlements.settlement_base)
      == SUM(cod_purchases.purchase_amount)`.
- [ ] Settlement + purchasing ledgers share the formula (no second implementation left behind).
- [ ] 80/20 split unchanged at the configured `COD_PLATFORM_FEE_PERCENT`.
- [ ] Partial cancellation **after** settlement is recorded: does either ledger drift? If yes, that is a
      blocker or an explicitly deferred item.

---

## 7. Production database compatibility  ← the real merge risk

`bc6ba39` proved the migrations on an **empty** database. That does not prove they apply to a populated
one. Do this against a restored dump of production:

- [ ] `php artisan migrate --pretend` on a staging clone: read every generated `ALTER TABLE`.
- [ ] `2026_11_04_000001` — `hasColumn()` guards are per-block, so a half-applied prod run is marked
      applied after the first guard passes. Confirm each guard creates **all** the columns it claims,
      and update `migrations` state manually only with evidence.
- [ ] `2026_11_07_000003` — `deliveries.current_offer_id` FK → `booking_dispatch_logs`:
      no orphan values, `nullOnDelete` verified, index name length fine on the target MySQL version.
- [ ] `2026_11_06_000002` — the now-named unique index: run the duplicate pre-check
      `SELECT business_id, name, COUNT(*) … GROUP BY … HAVING COUNT(*) > 1` on prod data first.
- [ ] Non-nullable additions (`targeted_attempts`, `popularity_score`, etc.) all carry defaults that
      MySQL will accept on non-empty tables (strict mode).
- [ ] New tables (`order_item_reviews`, `resort_*`) match prod charset/collation.
- [ ] No new order/delivery status strings were introduced without a documented mapping
      (AGENTS.md §10).
- [ ] Rollback of the 9 migrations on the clone, then re-apply, then plain re-run: all three clean.
- [ ] Full test suite passes against the **restored prod dump**, not only a fresh schema.

---

## 8. Routes, RBAC, realtime isolation

Files: `routes/api.php` (+53), `MunicipalityLocateController.php`, `MunicipalityPhotosController.php`,
`OrderItemReviewController.php`, `ResortOfferingController.php`, `TouristOrderListController.php`,
`TouristTravelsController.php`, `StaysController.php`.

- [ ] Every new route has `auth:sanctum` (or an explicit public justification) **and** the correct role
      middleware. List them and tick each one off.
- [ ] Tourist-owned resources are scoped by ownership, not just by id (order, review, travels).
- [ ] Business-owner resort endpoints verify the business belongs to the caller.
- [ ] Admin rider-cash endpoints are `tourism_official`-only and read-only where intended.
- [ ] Socket rooms (`business:`, `rider:`, `user:`, `trip:`) still authorize server-side; no new
      client-trusted room join (§8.2).
- [ ] Terminal delivery states still stop tracking and clean transient socket state (§8.8).

---

## 9. Email OTP + repo hygiene

Files: `EmailVerificationOtpService.php`, `EmailVerificationOtpMail`, `resources/views/emails/…`,
`.env.example`, `docs/EMAIL-OTP.md`, `frontend/.../VerifyEmailPage.tsx`.

- [ ] No credential, app password, or real address in the repo (`.env.example` now uses
      `your-address@example.com` — verify nothing else slipped in).
- [ ] OTP is hashed at rest, expires, is single-use, and has a per-user + per-IP rate limit.
- [ ] Verification does not leak whether an account exists.
- [ ] `RestaurantBusinessSeeder` now takes its identity from `TRACKTOUR_DEMO_OWNER_*` env vars instead of
      a hardcoded personal address — keep or drop, but do not reintroduce the address.
- [ ] **History reality check**: the personal address remains in commit metadata and in
      `docs/PROGRESS.md`. Redacting the working tree does not undo that. Decide: private repo, or
      rewrite history + switch to a GitHub `noreply` committer address going forward.

---

## 10. Merge and deploy sequence

1. [ ] Production backup taken **and restore-tested**.
2. [ ] Staging restored from that backup; `migrate` + smoke test (login, order, dispatch, pickup,
       COD issue, remit, settle).
3. [ ] Feature freeze on `main`; PR reviewed against this document.
4. [ ] Merge; deploy backend, socket server, frontend in that order.
5. [ ] Post-deploy: run the invariant probe (§6) on live data; watch `dispatch_end_reason`,
       failed migrations, and 422 rates on cash issuance for 24 h.
6. [ ] Rollback plan: code revert is trivial; database rollback is **not** — confirm the down migrations
       are safe on populated tables before relying on them.

---

## 11. Findings log

| # | Area | Severity | Finding | Status |
| --- | --- | --- | --- | --- |
| — | — | — | — | — |
