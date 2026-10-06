# P12.5 — Restaurant Wallet Foundation Backfill (Plan)

> **Status:** PLANNED — scope approved 2026-09-23; implementation pending review of this plan.
> **Type:** data-integrity hardening (small phase). Not mixed into Dispatch P0–P3 (complete & verified).

## 1. Problem

Wallets are provisioned only by the `Business::saved` hook
(`app/Models/Business.php:520` → `RestaurantWalletService::ensureForBusiness()`).
Any approved restaurant **not re-saved after** migration
`2026_09_21_000001_create_restaurant_wallets_table` never receives a wallet.

**Failure chain when a wallet is missing** (verified live, 2026-09-23):

```text
settleCodDelivery()
  → OrderSettlementService::recordCodSettlement()
  → LogicException: Approved restaurant wallet is required before settlement.
  → whole settlement transaction rolls back
  → delivery stays delivered + cash_settled_at = NULL
  → activeBindingsQuery() still binds the rider
  → excluded from pings (getBusyRiderIds) + accept answers 409 already_active
```

Rider 14 hit exactly this with delivery #3 (settled today after manual healing).

**Evidence:**

- 2026-09-23 audit: `approved=8, restaurants=8, with_wallet=3, MISSING=5`.
- Healed the same day via canonical `ensureForBusiness()` → `8/8`, all ₱0,
  ledger transactions unchanged (`1 → 1`).
- Gap class is **reproducible**: `track_tour_db.sql` contains
  `INSERT INTO businesses` but **no** `restaurant_wallets` CREATE/INSERT — a
  fresh import + `migrate` recreates the gap. The fix must therefore be a
  permanent, re-runnable tool, not a throwaway script.

## 2. Goal

One canonical, idempotent backfill that finds approved restaurant businesses
without a wallet and provisions them through the existing service — creating
**exactly one ₱0 wallet each, no transactions, no funds, no schema change**.

## 3. Design

```text
Approved restaurant businesses
        ↓
Find businesses without wallet   (Business::where('status','approved')->whereDoesntHave('restaurantWallet'))
        ↓
RestaurantWalletService::ensureForBusiness()   ← SOLE write path
        ↓
Create zero-balance wallet
        ↓
Existing wallet?
        ↓
No-op / idempotent               (firstOrCreate + UNIQUE(business_id) backstop)
```

### Vehicle decision: Artisan command (not migration, not seeder)

| Option | Verdict | Why |
|---|---|---|
| **Artisan command `wallets:backfill`** | ✅ chosen | Matches the `payments:reconcile-refunds` reconciler precedent; testable via `$this->artisan(...)->assertSuccessful()` (existing pattern); re-runnable for future drift (SQL imports); **zero DDL**. |
| Data migration | ❌ | Schema history must not depend on evolving app services; no schema change is needed — `UNIQUE(business_id)` already exists (`2026_09_21_000001:22`, live-verified). |
| Seeder | ❌ | Fixture tool; `RestaurantBusinessSeeder` already fires the hook via `Business::create`. |

**Implementation notes**

- Candidates: `status='approved'` + `whereDoesntHave('restaurantWallet')`,
  eager-load `category`. Eligibility is **not** duplicated in SQL — the service
  re-checks `approved` + `isRestaurant()` and returns `null` otherwise
  (counted as skipped). `Business` uses `SoftDeletes` (verified) — the Eloquent
  query respects the global scope; a restored business heals via the hook.
- Never call `RestaurantWallet::create` directly; only `ensureForBusiness()`.
- Catch `UniqueConstraintViolationException` per candidate → count as
  already-present (race-idempotent; same pattern as `SmartDispatchService`).
- Output: pre/post audit — candidates, created, skipped (ineligible),
  already-present. On today's dev DB the run reports **`created=0`** — proof of
  idempotency on real data (creation itself is proven by the tests).
- Precondition: migrations applied (standard; the wallet table must exist).

## 4. Safeguards → enforcement → test

| # | Safeguard (user-required) | Enforcement | Test |
|---|---|---|---|
| 1 | Only approved restaurant businesses | Query filter + service re-check (`approved` + `isRestaurant()`), null → skip | T3 |
| 2 | Use `ensureForBusiness()` | Sole write path; grep-verifiable, no direct create in command | T1–T5 (behavior) |
| 3 | Never insert wallet rows directly | Same as 2 | T1–T5 |
| 4 | Never create wallet transactions | Command never touches the ledger | T4 (`count() === 0`) |
| 5 | Never add funds | Service defaults all balances to 0 | T1 (₱0), T4 (existing balance untouched) |
| 6 | Idempotent | `firstOrCreate` + `UNIQUE` + exception catch | T2 (run twice) |
| 7 | Preserve unique constraint | **No migration / no DDL at all** + foundation duplicate test stays green + live `SHOW CREATE TABLE` check | foundation T3 + step 5 of DB verification |
| 8 | Approved restaurant without wallet → exactly one wallet | End-to-end command run | **T1 (required)** |
| 9 | Run twice → no duplicates | Two consecutive runs, count stable | **T2 (required)** |

## 5. Tests — `tests/Feature/RestaurantWalletBackfillTest.php` (new, 5 tests)

Fixture note: no `BusinessFactory` exists (only `UserFactory`); the test carries
a private `makeBusiness()` helper mirroring `RestaurantWalletFoundationTest`.
The missing-wallet precondition is created explicitly by deleting the
hook-created wallet row (deterministic "historical row" simulation).

1. `test_approved_restaurant_without_wallet_receives_exactly_one_zero_balance_wallet`
   — approved restaurant, wallet removed → one run → exactly 1 wallet, all four balances `0.00`.
2. `test_backfill_run_twice_creates_no_duplicates` — run twice → count stable, second run `created=0`.
3. `test_backfill_skips_pending_and_non_restaurant_businesses` — pending restaurant + approved hotel get **no** wallet.
4. `test_backfill_never_creates_transactions_or_changes_existing_balances` — pre-funded fixture wallet keeps its balance; `RestaurantWalletTransaction::count() === 0`.
5. `test_soft_deleted_restaurant_is_not_provisioned` — soft-deleted approved restaurant skipped (global scope).

## 6. Verification gates (AGENTS §13)

1. **Targeted:** new 5 + `RestaurantWalletFoundationTest` 3 + the four
   settlement/wallet suites from today (**18 / 236**) → expect **26 green**.
2. **Full suite:** baseline **381 tests / 1,846 assertions / 0 failures / 7 skipped**
   → expect **386 / ≥1,846 / 0 / 7**. Report Tests / Assertions / Failures / Skipped.
3. **Live dev DB (data component — must be actually verified):**
   - `php artisan wallets:backfill` → expect `created=0` (idempotent on real data);
   - audit: approved restaurants missing wallet = `0` (baseline today: 8/8);
   - `SHOW CREATE TABLE restaurant_wallets` → `UNIQUE KEY business_id` intact (no DDL ran);
   - ledger: `restaurant_wallet_transactions = 1` unchanged; wallet #3 = `107.36`, all others `0.00`;
   - **no live settlement is executed** — that would create transactions/funds (safeguards 4/5) and belongs to the separate COD ping smoke test.
4. **Socket JS / frontend build:** not re-run — this phase touches no JS/frontend files.
5. **Docs:** this plan marked complete; `docs/PROGRESS.md` checkpoint with final counts + the architectural note below.

## 7. Architectural note (documented, per decision)

> The backfill fixes **historical data**, while the `Business::saved` hook
> protects **future business creation/updates**. The two mechanisms complement
> each other rather than replacing one another.

Homes: this file, the command class docblock, and the PROGRESS checkpoint.

## 8. Scope fences (explicit non-goals)

- ❌ No schema change / no migration / no DDL (constraint already exists).
- ❌ No changes to `RestaurantWalletService`, the `Business` hook, or any settlement service (verify with tests — AGENTS §19).
- ❌ No wallet transactions, no funds, no balance edits on the live DB.
- ❌ **Not** mixed into Dispatch P0–P3 (complete & verified).
- ❌ Rider-14 COD ping smoke test stays separate: needs a **fresh GPS fix** and a **new COD order** — delivery #10 is **not** re-pinged (`alreadyDispatchedRiderIds` by design).
- ⚠️ Related finding, separate decision (do not silently expand scope): `track_tour_db.sql` is stale vs the migration set (no `restaurant_wallets` schema at all).

## 9. Artifacts (on approval)

| Action | File |
|---|---|
| NEW | `app/Console/Commands/BackfillRestaurantWallets.php` (`wallets:backfill`) |
| NEW | `tests/Feature/RestaurantWalletBackfillTest.php` (5 tests) |
| EDIT | `docs/PROGRESS.md` (planned bullet → completion checkpoint) |
| EDIT | `docs/current-status/roadmap.md` (maintenance-window row) |

## 10. Execution sequence

```text
Implement command (service-only writes)
        ↓
Write 5 tests → targeted run green (26 expected)
        ↓
Full suite → 386 / 0 failures / 7 skipped
        ↓
Live DB verification (created=0, SHOW CREATE TABLE, ledger unchanged)
        ↓
Document (this file + PROGRESS checkpoint) → report counts
        ↓
Return to COD ping smoke test (fresh GPS + NEW COD order)
```
