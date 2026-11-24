# Secure Transaction Architecture — Stage 1 Existing System Audit (2026-11-11)

Plan: "TrackTour Secure Transaction Architecture and Implementation Plan" (stages 1–9). This audit compares every logical structure in plan §10 with the live schema (MariaDB 10.4, 106 tables) and the canonical code paths, per AGENTS §2 / §19 (reuse, no duplicate implementations).

## 1. Plan structures vs what exists

| Plan structure | Exists today | Decision |
|---|---|---|
| `transaction_blueprints` | — | **New** (Stage 2). One per food-delivery / ride order; references `orders.id`, never replaces it. |
| `transaction_events` | — (`activity_logs` is a flat audit log, no chain) | **New** (Stage 2), append-only, SHA-256 chained. |
| `transaction_integrity_checks` | — | **New** (Stage 2). |
| `transaction_checkpoints` | — | **New** (Stage 2), HMAC-signed, exported to file storage. |
| `menu_availability_events` | — (`offerings.is_available` only) | New in Stage 3. |
| `orders` / `order_items` (`business_id` per item) | ✓ canonical group order (AGENTS §4.1) | Reuse. |
| `deliveries` | ✓ UNIQUE `order_id`, `rider_id`, `delivery_confirmed_at/_by`, `delivery_proof_path`, `delivery_proof_distance_m` | Reuse. |
| `delivery_pickups` | ✓ as `delivery_pickup_stops` (`business_id`, `sequence`, `arrived_at`, `pickup_confirmed_at`) | Reuse; arrival coordinates / accuracy / distance not stored yet (Stage 3). |
| `ride_bookings` | ✓ as `orders` with `order_type = transport` (+ ride JSON in `deliveries.notes`) | Reuse — no separate table (AGENTS §2.5). |
| `ride_trips` / `ride_location_events` | partly: `trip_logs` (polyline, distance), `rider_locations` | Reuse; per-trip GPS anomaly records in Stage 4. |
| `payments` | ✓ + `payment_webhook_events` UNIQUE `provider_event_id` (P11.4) | Reuse. |
| `refunds` | ✓ provider-authoritative (P11.3) | Reuse. |
| `rider_earnings` | ✓ one row per (rider, order, status); **mutable** (`updateOrCreate` in `NearestRiderService::recordEarning`) | Keep the row; immutable movements added in Stage 5 (`rider_earning_ledger`). Stage 2 already records every earning change as a chained event, so an untracked edit is detectable. |
| `rider_cashout_requests` / `rider_cashout_items` | ✓ as `rider_payouts` + `rider_payout_rider_earning` (UNIQUE per earning), `items_snapshot` | Reuse (secure-cashout decision 2026-11-11). |
| `rider_cashout_reviews` | ✓ columns on `rider_payouts` (review/approve/reject/fail by + at + reason) + `activity_logs` | Reuse. |
| `rider_payouts` (PayMongo payout reference) | manual GCash evidence (`payment_reference` UNIQUE, proof) | **Conflict — see §3.** |
| `financial_audit_logs` | ✓ `activity_logs` `type = financial` | Reuse. |

## 2. Findings (gaps against the plan)

1. **No tamper evidence.** Orders, payments, deliveries and earnings can be edited in SQL with no trace. → Stage 2.
2. **Checkout availability is checked outside the order transaction** and without locks (`GroupOrderService`, lines 30–75); a concurrent "unavailable" toggle can slip through. → Stage 3 (recheck inside the transaction with `lockForUpdate`).
3. **`offerings.stock` still exists** and is editable in four menu controllers; it is never deducted at checkout (no inventory behaviour), only shown as an "out of stock" filter. Plan §4.2 forbids quantified inventory. → Stage 3: stop exposing it (column left in place; no data loss).
4. **No availability history** (who toggled what, when). → Stage 3.
5. **Ride fare is server-derived** (`TransportController` re-derives; client `fare` is advisory) ✓. The plan's *included distance* term does not exist (`fare = base + per_km × distance`); a quote snapshot is stored in `deliveries.notes` but without a fare-configuration version. → Stage 4.
6. **No ride pickup PIN / QR.** Passenger-on-board is a rider tap with a 100 m GPS condition. → Stage 4.
7. **Pickup stops store no arrival coordinates / accuracy / distance.** → Stage 3.
8. **Earnings are mutable rows** (see table). → Stage 5.
9. **GCash recipient stored in plain text** on `rider_payouts` (`destination_*`, `paid_recipient_*`). Plan §8.1: encrypt at rest. → Stage 6/7 (encrypted casts; the UNIQUE payment reference is unaffected).
10. **Status vocabulary.** Plan names `pending_review` / `payout_failed`; existing `pending` / `failed` are kept (AGENTS §10: no renames without a migration plan). `payout_processing` only exists if Stage 8 (automated payouts) is adopted.
11. **Event coverage.** `OrderCreated` is defined but never dispatched; several delivery transitions in services emit no `DeliveryStatusChanged`. The ledger therefore records from **model observers** (every Eloquent write path), not from domain events. Query-builder mass updates bypass observers — the integrity check compares the last recorded amounts with the live rows, so such edits surface as a mismatch.

## 3. Decisions the plan changes (need the product owner)

- **Payout mechanism.** The secure-cashout decision of 2026-11-11 is *manual*: staff send GCash themselves and record reference + proof ("TrackTour never sends money"). Plan §6.3 / §8.6 / Stage 8 move this to **PayMongo disbursements**, conditional on the merchant account having disbursement access with GCash as a recipient institution. That cannot be verified from code; the account owner must confirm it with PayMongo. Until then the manual flow stays.
- **Saved GCash account.** Plan §8.1 settles the earlier open question: **no reusable saved GCash profile**; recipient details live only on each request (as built), encrypted at rest.

## 4. Stage order adopted

Stage 2 (shared blueprint + chain + integrity + checkpoints) first — it changes no business behaviour and every later stage reports into it. Stages 3–7 then integrate food, rides, the ledger, cashout validation and the investigation page; Stage 8 waits for the payout decision above.

---

# Stage 2 — Shared Transaction Integrity Service (2026-11-11)

**Built.** No business behaviour changed: the ledger only records and verifies.

- **Blueprint** (`transaction_blueprints`): one per `orders` row with `order_type` `delivery` (food_delivery) or `transport` (ride_hailing); UNIQUE `order_id`; references the order, customer and rider; carries `event_count`, `current_hash`, `integrity_status` (pending / verified / flagged / invalid), `legacy`, `finalized_at`.
- **Event ledger** (`transaction_events`): `current_hash = SHA256(previous_hash + "\n" + canonical JSON)` over schema version, blueprint UID, sequence, type, actor id + role, source record, payload and a server millisecond timestamp. Canonical JSON (`CanonicalJson`): keys sorted at every level, floats as fixed strings, amounts as `"360.00"`. Appends lock the blueprint row; UNIQUE (`blueprint_id`, `sequence`) and UNIQUE `current_hash` are the backstop. Payloads hold references and amounts, never contact details.
- **Recording** (`TransactionLedgerObserver`, registered in `AppServiceProvider`) on `Order`, `OrderItem`, `Payment`, `Refund`, `Delivery`, `DeliveryPickupStop`, `RiderEarning`: order created / status / payment status / amounts / customer; item added / changed; payment verified / refund status / status; refund status; delivery created; rider assigned / released; delivery status; delivery confirmed (who, photo, distance); delivery fee / commission changed; pickup stop created / arrived / confirmed; earning posted / changed. Written in the same database transaction as the change (a rollback leaves no event). A ledger failure is reported (`report()`) and never breaks the operation; the verifier then shows the gap.
- **Append-only:** database triggers refuse UPDATE and DELETE on `transaction_events`, `transaction_checkpoints`, `transaction_checkpoint_entries` (MariaDB `SIGNAL 45000`, SQLite `RAISE(ABORT)`); the models refuse too. `actor_id` has no foreign key so deleting a user never rewrites history.
- **Signed checkpoints** (`TransactionCheckpointService`, `integrity:checkpoint` hourly): pins the head of every chain that changed (only intact chains; a broken one is skipped and logged as a security event), chains each checkpoint root to the previous one, signs it with HMAC-SHA256 using `TRANSACTION_CHECKPOINT_KEY` (outside the database; derived from `APP_KEY` when unset), and exports a JSON copy to `storage/app/integrity/checkpoints/{n}.json`. **For real independence set a dedicated key and point `TRANSACTION_CHECKPOINT_DISK` at storage the database user cannot write** — both are environment settings for the owner to configure.
- **Integrity service** (`TransactionIntegrityService`): PASS / FLAG / BLOCK, stored in `transaction_integrity_checks`, mirrored on the blueprint; BLOCK writes a `security` activity log entry.
  - BLOCK: chain broken; history differs from its signed checkpoint (catches a fully recomputed chain); checkpoint signature / root / export mismatch; original order missing or of another type; customer, order amounts, payment amount / status, rider assignment or earning amount / status / rider differ from the last recorded event (catches direct SQL edits).
  - FLAG: ledger opened after the order existed (legacy); a finished order missing assignment, completion or (online) payment verification.
- **Commands:** `integrity:verify [--order=] [--hours=48] [--all]` (daily 02:30 for the last 48 h), `integrity:checkpoint`, `integrity:backfill [--dry-run]` (opens legacy ledgers with a baseline snapshot of the order, rider, payments and earnings — **not run** on the dev database; run it when ready).
- **API (Tourism Office RBAC):** `GET /api/admin/integrity/orders/{order}` (blueprint + events with hashes + last check), `POST /api/admin/integrity/orders/{order}/verify`.
- **Database verification (dev MariaDB 10.4):** migration `2026_11_11_000004` applied with `--path`; `SHOW TRIGGERS` lists the six triggers; `SHOW CREATE TABLE transaction_events` shows UNIQUE (`blueprint_id`, `sequence`), UNIQUE `current_hash`, FK to blueprints; live probe inside a rolled-back transaction — UPDATE refused (1644 append-only), DELETE refused, duplicate sequence refused (UNIQUE); nothing left behind.
- **Tests:** `TransactionIntegrityTest` (17): blueprint + linked chain; full lifecycle PASS; ride / out-of-scope types; model + database refuse update / delete; duplicate sequence; earning, amount, payment and rider edits in SQL → BLOCK; legitimate app changes stay PASS; edited event breaks the chain; fully recomputed chain caught by the checkpoint; forged checkpoint / differing export detected; incremental checkpoints chain to the previous root; legacy → FLAG; finished order without payment verification → FLAG; commands; RBAC.
- **Known limits (honest):** query-builder mass updates bypass observers — they surface as BLOCK mismatches, not as events. The checkpoint key falls back to `APP_KEY` until a dedicated key is set. Verification is not yet wired into cashout approval (Stage 6) or the investigation page (Stage 7).
- **Checkpoint:** full Laravel suite 980 passed / 6,316 assertions / 0 failures / 2 skipped (the known environment skips) — every existing order, payment, delivery and earning test now also runs through the ledger observers. No frontend change in Stage 2.

---

# Stage 3 — Food delivery: manual availability, checkout revalidation, pickup evidence (2026-11-11)

Scope approved 2026-11-11 (plan A → F). Ride hailing, payouts, COD and group-order behaviour unchanged.

## A. Stage 2 hardening

- **Key rotation:** `transaction_checkpoints.key_id` (migration `2026_11_11_000005`; existing rows = `derived`). Keyring in `config/integrity.php`: `TRANSACTION_CHECKPOINT_KEY` + `TRANSACTION_CHECKPOINT_KEY_ID`, retired keys in `TRANSACTION_CHECKPOINT_OLD_KEYS` (`id:key,id:key`). Each checkpoint is verified with the key that signed it; a missing retired key is reported, never accepted.
- **Rotation procedure:** `php artisan integrity:key --id=k2` (prints a random key; never writes `.env`) → move the current `id:key` into `TRANSACTION_CHECKPOINT_OLD_KEYS` → set the new key + id → back both up in the secret store. Never delete a retired key while checkpoints signed with it must still verify.
- **Production:** signing refuses without a dedicated key (no `APP_KEY` derivation) and refuses a key equal to `APP_KEY`; `integrity:checkpoint` exits with failure. Local / testing keeps the derived key (`derived`).
- **Checkpoint files:** keep `TRANSACTION_CHECKPOINT_DISK` writable by the app only, not by the database user, with a further copy off the application server (owner's infrastructure task).
- **Backfill:** idempotent (orders with a history are skipped; tested twice), `--dry-run`, and every opening event records `ledger_cutoff`. **Back up the database before running it.** Legacy histories are FLAG (`history`) only — the lifecycle check is skipped for them so a missing pre-ledger step is never presented as a second problem, and never as BLOCK.

## B. No stock quantities

- `offerings.stock` is **deprecated and unused**: removed from `Offering::$fillable`, `OfferingResource`, every validator (`BusinessOwnerMenuController`, `BusinessOwnerOfferingController`, `BusinessOwnerMenuManageController`, `StaffMenuController` incl. `unlimited_stock`), the `out_of_stock` filter, and the business-owner menu page ("Manage Inventory" → "Set unit"; CSV export has no Stock column; CSV import skips a legacy Stock column). Old clients sending `stock` are ignored.
- The column and its 85 values stay; **drop it in a separate migration** once no code, integration or legacy client depends on it.

## C. Availability history

- `menu_availability_events` (append-only: triggers + model guards; UNIQUE (`business_id`, `sequence`), UNIQUE `current_hash`): item / variation, previous → new, actor id + role, source (`owner_menu.toggle`, `owner_offerings.bulk`, `staff_menu.edit`, …), optional reason, server ms timestamp, SHA-256 chained **per business**.
- **Serialisation:** `menu_availability_chains` holds each business's head; every append locks that row (`insertOrIgnore` + `SELECT … FOR UPDATE`), so concurrent changes cannot claim the same sequence; the UNIQUE key is the backstop.
- **One authoritative writer:** `MenuAvailabilityService` saves the item and appends the event in one transaction (re-reading the committed value under a row lock). Every write path routes through it: create / edit / archive / restore / toggle / duplicate / bulk / variations in the five menu controllers and `BusinessOwnerFoodController`; the bulk action now saves item by item. `MenuAvailabilityObserver` records only writes that bypass the service (source `unrouted`) and is silent while the service writes — **no duplicate events** (tested).
- `MenuAvailabilityService::verifyChain($businessId)` recomputes a business's chain.
- Finding (pre-existing, not changed): the `toggleStatus`, `bulkAction` and `duplicate` controller actions have **no API routes**, so the menu page's bulk action currently 404s. They are protected by the service if routed later.

## D. Checkout revalidation

- `CheckoutAvailabilityGuard::assertOrderable()` runs **inside** the order transaction of both checkout paths (`GroupOrderService::createGroup`, `FoodController::orderFlat`): locks the ordered items in id order (no checkout-vs-checkout deadlock), re-reads availability, menu membership, price and whether the restaurant is accepting orders. Failure → 422 and the whole transaction rolls back.
- `FoodController::orderFlat` previously created the order and items **without a transaction**; it now uses one, so no partial order can remain.
- The cart never supplies prices; a price changed between cart and submission is refused ("please review your cart").
- Availability changes never touch existing orders: item name, unit price, quantity, subtotal and preparation time are already snapshotted on `order_items`. Checkout does not accept variants today (none to snapshot).

## E. Pickup evidence (observe-only)

- `delivery_pickup_stops.arrival_evidence` / `pickup_evidence` (JSON, written once, inside the canonical `PickupSequenceService` transactions): `device` (fix sent by the rider app: coordinates, `accuracy_m`, `fix_at`, `age_s` on the device clock, `distance_m`) and `server` (last saved fix: coordinates, `accuracy_m` — now stored on `rider_locations` — `fix_at`, `age_s`, `distance_m`, `location_id`) kept separate, plus the restaurant coordinates. Invalid device input → `{rejected: …}`; none → `null`. Copied into the `pickup_arrived` / `pickup_confirmed` ledger events.
- Evidence never blocks a pickup (P4 geofence stays deferred). The pre-existing 50 m server-side radius check on arrival / confirmation is unchanged.
- Rider app: `setRiderPosition(lat, lng, accuracy, timestamp)`; arrive / confirm post `{latitude, longitude, accuracy, fix_at}` when a fix exists, otherwise the request is unchanged.

## F. Verification

- **Tests added:** `FoodDeliveryIntegrityTest` (14), `PickupSequenceFlowTest` +3, `TransactionIntegrityTest` +4 (key rotation, production key rules, key command, backfill idempotent + cutoff), frontend `rider-order-info-sheet-pickup` +1, `business-owner-menu-no-stock` (2).
- **Database (dev MariaDB 10.4):** migrations `2026_11_11_000005` and `2026_11_11_000006` applied with `--path` (the unrelated pending `2026_11_10_000001` untouched). `SHOW TRIGGERS` lists `menu_availability_events_no_update` / `_no_delete`; `SHOW CREATE TABLE` shows UNIQUE (`business_id`, `sequence`) and UNIQUE `current_hash`; `key_id`, `arrival_evidence`, `pickup_evidence`, `rider_locations.accuracy_m` present; `offerings.stock` kept (85 rows). Live probe in a rolled-back transaction: UPDATE refused (1644), DELETE refused, duplicate sequence refused; nothing left behind.
- **Known limits:** availability chains are verified on demand (`verifyChain`) but not yet covered by the signed checkpoints; query-builder writes to `offerings.is_available` outside Eloquent bypass both the service and the observer (none remain in the app).
- **Checkpoint:** Laravel 1,001 passed / 6,427 assertions / 0 failures / 2 skipped (known environment skips); frontend 669 passed (95 files); `vite build` clean. Nothing committed, pushed or deployed.

---

# Stage 4 — Ride hailing: audit (2026-11-11)

Scope corrected by the product owner: **no passenger pickup PIN** (no generation, no PIN fields, no verification endpoint). Audit only; no code changed yet.

| Area | Current implementation | Finding |
|---|---|---|
| 1. Fare + quote | `TransportationService::estimateFare` (base + per_km × distance, Tourism Office `RideFareSettings`); `createRide` re-derives the fare server-side and stores a snapshot in `deliveries.notes` (vehicle, passengers, est. distance / duration, fare, base_fare, per_km). Fare changes are audited (`ActivityLog` settings). | `book()` ignores the fare the tourist confirmed: if rates or route changed between quote and booking, the ride is booked at a different fare without telling them first. No fingerprint of the fare settings used; the quote is not in the tamper-evident ledger (notes JSON is mutable). |
| — PIN | `createRide` generates `ride_pin` (4 digits) into `deliveries.notes`; `getRideStatus` / `TransportController` (2 responses) return it; `TouristTransportTracking` shows it. Never verified. | **Out of scope by decision — to be removed** (generation, API fields, UI). |
| 2. Assignment | `SequentialDispatchService` (nearest to the passenger first, 30 s offers, never the same rider twice, then Available Bookings); atomic accept; one active delivery per rider; `booking_dispatch_logs`. | Sound and covered by existing tests. Offers / declines live only in `booking_dispatch_logs` (mutable); acceptance is in the ledger (`rider_assigned`). |
| 3. Transitions | assigned → arrived_pickup (auto, server location) → picked_up (passenger on board) → in_transit → arrived_destination → delivered → completed (cash: settle-cod). Driver cancel (`cancelRideByDriver`): transaction, row locks, rider released. | **Tourist cancel (`cancelRide`) has no transaction or locks** (races a concurrent accept) and **does not release an assigned rider** as driver cancel does. Ride drop-off has **no server location gate** (food has 50 m) and rides need no passenger confirmation — completion is rider-driven. |
| 4. GPS / evidence | `rider_locations` (now with `accuracy_m`), `trip_logs` (polyline, distance, duration), teleport / accuracy guard in `RiderMapController`. | No location evidence captured at passenger-on-board, drop-off or completion. GPS refusals (`implausible_movement`, `low_accuracy`) are returned to the app but **never stored**. |
| 5. Payment / refunds | Cash (settle-cod) or pay-after-completion online (Pay button only when `completed`); PayMongo webhook idempotency (P11.4). | `createIntent` accepts a ride in **any** state, including cancelled. The ride branch of the paid handler returns **before** the closed-order refund logic food has, so money paid for a cancelled ride is recorded paid and **never refunded**. |
| 6. Earnings | `recordEarning` via `completeDelivery`: rider commission = `max(₱20, 40% of fare)` fixed at booking (`deliveries.rider_commission`); rides carry no tip. | Formula is hard-coded and not in the ledger quote; consistent with the secure cashout (online ride earnings wait for a provider-confirmed payment). |
| 7. Ledger | Ride orders already get `ride_hailing` blueprints via the Stage 2 observers (created, item, delivery, assignment, statuses, payments, earning). | Missing: the fare quote, cancellation actor / reason / stage, trip location evidence, GPS anomalies, trip summary. |

**Audit correction:** `createIntent` already refused *cancelled* rides; what was missing was refusing rides not yet completed and refunding a payment that lands on a ride cancelled meanwhile (both built below).

# Stage 4 — Ride hailing: built (2026-11-11)

Decisions (2026-11-11, recommended options): a changed fare is refused for re-confirmation; online ride payment only after completion; drop-off location is evidence + FLAG only (no new gate; P4 deferred); no passenger confirmation; **no PIN**.

- **A. PIN removed.** No generation in `createRide`, no `ride_pin` in `getRideStatus` / `TransportController` (`tripStatus`, `tracking`), no PIN card on `TouristTransportTracking`. PINs stored on older bookings' notes are left untouched (history is not rewritten) and never returned. Known issue #6 closed as superseded.
- **B. Fare quote.** `createRide` refuses (`RideFareChangedException` → HTTP 409 with `data.fare` / `data.quoted_fare`) when the confirmed `fare` differs from the server fare by ≥ ₱0.01; a request without `fare` keeps the old behaviour. The booking keeps `fare_quote` in `deliveries.notes` (vehicle, passengers, base, per km, distance, duration, distance fare, fare, quoted fare, rider commission, `commission_rule` "max(₱20, 40% of fare)", payment method, `fare_settings_fingerprint` = SHA-256 of the vehicle's rates, `quoted_at`) and a `ride_quoted` ledger event inside the booking transaction. `BookRideSheet` shows the 409 message, re-quotes and stays bookable (it previously stayed disabled after any booking error).
- **C. Cancellation.** Tourist `cancelRide` now runs in one transaction, locks the delivery then the order, re-checks both under lock (refuses once the passenger is on board even if the order still reads confirmed), releases an assigned rider to `available`, notifies the rider's trip room (best effort), and records `ride_cancelled` {cancelled_by tourist, actor, reason, stage, rider}. Driver cancellation records the same event.
- **D. Trip evidence (observe-only).** `deliveries.trip_evidence` (migration `2026_11_11_000007`): `passenger_on_board` (target: pickup), `arrived_destination` and `completed` (target: destination), each written once with the device fix (from the rider app's request, or the heartbeat for the automatic arrival) and the server-saved fix kept apart, each with accuracy, fix age and distance; copied to `trip_evidence` ledger events. Captured in `RiderDeliveryController` (incl. the `picked_up` branch) and `RiderMapController`'s automatic drop-off arrival. GPS refusals during an active ride (`low_accuracy`, `implausible_movement` with jump distance, `invalid_coordinates`) → `gps_anomaly` events, one per reason per minute per ride. Offline gaps are not recorded as anomalies. `TripLog` creation → `trip_summary` event. Rider app sends `{latitude, longitude, accuracy, fix_at}` with picked_up / arrived_destination / delivered.
- **E. Payments.** `createIntent` refuses a ride that is not `completed` (422). A payment confirmed for a ride already cancelled is refunded through `OrderRefundService::refundPaidOrder` (provider-authoritative; never marked refunded locally).
- **F. Integrity (FLAG only, ride blueprints, not legacy):** `ride_quote` (quote recorded), `ride_commission` (every earning = recorded commission + tip; commission changes via `delivery_fee_changed` honoured), `ride_completion_location` (completion / arrival evidence within `integrity.ride_completion_flag_radius_m`, default 200 m; missing evidence flagged).
- **Stage 2 defect found and fixed:** an order created without some amount fields (rides omit `rider_tip`, `system_fee`) had them recorded as null while the database stored 0.00 → every such order would BLOCK on `amounts`. The snapshot now reads database-filled amounts; histories already recorded that way treat null ≡ 0.00 (only that case).
- **Test reconciliation (AGENTS §12):** three ride fixtures no longer hard-code `'fare' => 150` (they take the no-quote path); `test_book_recomputes_authoritative_fare_ignoring_client_value` became "refuses a confirmed fare that differs" + "ignores client distance / duration"; the PIN contract assertion now asserts its absence; the ride payment-intent test completes the ride first; the frontend PIN test asserts no PIN.
- **Tests added:** `RideHailingIntegrityTest` (15), contract +1, `book-ride-sheet-payment` +1.
- **Database (dev MariaDB):** `2026_11_11_000007` applied with `--path`; `deliveries.trip_evidence` (longtext/JSON, nullable) present; unrelated `2026_11_10_000001` still pending and untouched.
- **Checkpoint:** Laravel 1,017 passed / 6,503 assertions / 0 failures / 2 skipped (known environment skips); frontend 670 passed (95 files); `vite build` clean. Nothing committed, pushed or deployed.

---

# Stage 4 — post-build verification (2026-11-11, review points 1–4)

1. **Fare reconstruction — gap.** The quote stores the rates but `distance_km` rounded to 2 decimals, while the fare is computed from the exact distance: in a 2,000-quote sample 1,891 cannot be recomputed exactly (max ₱0.15). The fingerprint identifies the rates; it does not prove the fare.
2. **Commission snapshot — amounts fixed, inputs not.** Rides `max(₱20, 40% of fare)` at booking; food a flat ₱40.00 (`SmartDispatchService`). The amount is snapshotted on `deliveries.rider_commission` and earnings read it, so a later rule change cannot alter past earnings (changes to that column are ledgered). The rule inputs are stored only as a text label for rides, not at all for food.
3. **200 m destination rule — FLAG only (confirmed), but not accuracy-aware.** Missing evidence is a FLAG ("no evidence"); the check ignores the fix's accuracy and age, so a stale or inaccurate fix can raise a false FLAG.
4. **Refund states — requested is not persisted.** Refund rows are `failed` / `pending` / `succeeded`; payments `paid → pending_refund → refunded` (back to `paid` on failure); reconciliation re-queries `pending_refund`. The refund row is written only after PayMongo answers, and the provider request carries no idempotency key: a crash between PayMongo accepting a refund and our commit leaves no local trace, and a retry could issue a second provider refund (reconciliation would not see it).

# Stage 5 — Shared financial ledger: audit (2026-11-11)

| Structure | Today | Finding |
|---|---|---|
| `rider_earnings` (4 rows) | One row per (rider, order, `earned`); `delivery_fee`, `rider_tip`, `total_earning` | **Mutable**: `NearestRiderService::recordEarning` uses `updateOrCreate`. Commission and tip are not separate entries; no reversal or adjustment path. A refund after delivery leaves the earning `earned` (the cashout verifier excludes it, but nothing records the reversal; an already-paid earning has no claw-back record). |
| Balances | Derived by queries (`RiderPayoutService::getAvailableEarnings`) — no stored, editable balance ✓ | Derived from mutable rows, not from immutable entries. |
| Cashout reservation | `rider_payout_rider_earning` UNIQUE per earning + one live request per rider ✓; `items_snapshot` | Released by `detach()` (row **deleted**) on reject / fail / cancel — the reservation history survives only in `items_snapshot` and `activity_logs`. Paid = payout `paid` (pending / approved are never treated as paid ✓). |
| COD | `cod_settlements` / `order_settlements` (80/20, once), `rider_cash_funds` + `rider_cash_fund_transactions` (idempotency key), `rider_daily_cash_movements` (append-only design with `reverses_movement_id` / `adjusts_movement_id`; policy inactive), `cod_purchases` | Already separate from online earnings ✓; the daily-movements table is the pattern to reuse. COD earnings are kept from cash and never cashed out online ✓. |
| Restaurant side | `restaurant_wallet_transactions` with before / after balances | Out of rider scope. |

# Stage 5 — Shared financial ledger: built (2026-11-11)

Product-owner decisions (after review): **accepted orders must be fulfilled** — no restaurant rejection / cancellation (escalated), no 60-minute auto-cancel (flagged), no refund after acceptance; **food riders earn the full delivery fee** (before any delivery-fee promotion; history keeps ₱40; ride commission unchanged); refund **requested** state + idempotency key.

- **0a. Verification follow-ups.**
  - Ride quotes store `distance_km_exact` (9 decimals), `commission_rate` 0.4, `commission_minimum` 20 → new FLAG check `ride_fare` recomputes fare and commission (sample: 0 of 2,000 quotes off, was 1,891).
  - `ride_completion_location` is accuracy- and age-aware: a fix's distance is reduced by its accuracy radius, fixes older than `integrity.ride_evidence_max_age_s` (120 s) are reported as stale, the best fresh fix decides; still FLAG only.
  - Refunds (`PaymentRefundProcessor::initiateRefund`) run in three phases: under the payment lock record a `requested` refund row with a UUID `idempotency_key` (`refunds.idempotency_key`, UNIQUE) and commit; call PayMongo with header `Idempotency-Key`; settle the same row under the lock (failed / pending / succeeded — unchanged semantics). A `requested` row blocks any second refund; `payments:reconcile-refunds` escalates `requested` rows older than 10 minutes once (never retries automatically). Whether PayMongo honours `Idempotency-Key` is **to verify in their documentation**; the local guarantee does not depend on it. When a caller already holds a transaction the requested row is a savepoint (as before). Rows are now created / updated by id (the old `updateOrCreate(['provider_refund_id' => null])` could overwrite an unrelated null-id row).
- **0b. Acceptance rule** (`AcceptedOrderPolicy`, canonical `Order::hasAcceptedRider()`): `BusinessOwnerOrderController::updateStatus(cancelled)` (routed) and `rejectOrder` / `rejectItem` (not routed — defence in depth) → 422 + escalation; `AutoCancelUndeliveredOrder` flags once (`escalation.late_after_acceptance`), never cancels / refunds; `OrderRefundService` (order, group child, item) and `PaymentRefundProcessor` refuse with `blocked_after_acceptance` + escalation (financial). The tourist-owned `POST /payments/{number}/refund` therefore returns 422 once a rider has accepted. Escalations are `escalation` events in the transaction history → integrity FLAG `escalations`.
- **0c. Food commission:** `SmartDispatchService` (single order and group) sets `deliveries.rider_commission` = the order's delivery fee (was `40.00`).
- **1. Ledger:** `rider_earning_entries` (append-only: triggers + model guards; UNIQUE `idempotency_key`; no FKs so history survives) — `earning_posted`, `tip_posted`, `adjustment` (bucket earned), `cashout_reserved`, `reservation_released` (reserved), `payout_completed` (paid); signed amounts; service food / ride, channel online / cod; commission rule recorded on each posting (historical food earnings say "flat ₱40").
- **2. Posting:** `RiderEarning` created → commission + tip entries (same transaction). `RiderEarning` amounts are **write-once** (model refuses edits / deletes). `NearestRiderService::recordEarning` no longer `updateOrCreate`s: a recalculation posts a system adjustment (idempotent per recalculated total).
- **3. Balances:** `RiderEarningLedger` derives earned / open / paid / available per earning and online totals per rider (COD excluded). `RiderPayoutService` uses ledger amounts for availability, selection, request amount and the approval check; `RiderEarningVerifier` and the investigation financials read the ledger.
- **4. Cashout:** the pivot stays the "one live cashout per earning" lock; request → `cashout_reserved`; reject / fail / cancel → `reservation_released` (before the pivot detach, so releases are no longer lost); mark-paid → `payout_completed`. Pending / under review / approved are never counted as paid.
- **5. Adjustments:** `GET /api/admin/rider-earnings/{earning}/ledger`, `POST …/adjust` {amount ±, reason ≥ 5 chars, password; second staff email + password at or above `payouts.two_person_threshold`}; refused while the earning is in a live cashout, or if it would go negative, or for one's own earnings; activity log `earning.adjusted`. UI: Admin → Riders → rider → Recent deliveries → **Ledger** (`EarningLedgerPanel`).
- **6.** `earnings:ledger-backfill [--dry-run]` (idempotent; posts unposted earnings, records reservations / payouts of existing cashouts) — **not run on the dev database (4 earnings); back up first.** Integrity: `earning_ledger` (BLOCK: postings ≠ write-once row), `earning_ledger_posted` (FLAG: not yet posted), `escalations` (FLAG).
- **Test reconciliation (AGENTS §12):** `CodDeliverySettlementTest` expected ₱40 → now the delivery's commission (= order delivery fee); `PurchasingCashFlowTest` simulated a large earning by editing the row in-app → now on the row directly (test-only); `TransactionIntegrityTest` / `RideHailingIntegrityTest` corrected earnings by editing → now by ledger adjustment.
- **Tests added:** `FinancialLedgerTest` (11), `AcceptedOrderRuleTest` (7), `RideHailingIntegrityTest` +2, `FoodDeliveryIntegrityTest` +1, frontend `earning-ledger-panel` (3).
- **Database (dev MariaDB):** `2026_11_11_000008` applied with `--path`; triggers `rider_earning_entries_no_update` / `_no_delete`; UNIQUE `idempotency_key` on entries and refunds; live probe in a rolled-back transaction: UPDATE / DELETE refused (1644), duplicate key refused; nothing left behind.
- **Known limits:** the rider records page's day / all-time earnings totals still sum the write-once rows (adjustments show per delivery and in the ledger panel); restaurant / Tourism Office settlement for food never handed over is not automated (by decision) — escalations are the record.
- **Checkpoint:** Laravel 1,038 passed / 6,634 assertions / 0 failures / 2 skipped (known environment skips); frontend 673 passed (96 files); `vite build` clean. Nothing committed, pushed or deployed.

---

# Post-Stage 5 review (2026-11-11)

**PayMongo refund API — pre-existing defect found** (official reference read 2026-11-11: docs.paymongo.com "Create a Refund", "Refund Resource", "Idempotent Requests"):

- Documented: `POST /refunds` with `data.attributes` {`amount` (required, cents, ≥ 100), `payment_id` (required), `reason` (required: `duplicate` / `fraudulent` / `requested_by_customer` / `others`), `notes` (≤ 255), `metadata` (string values)}.
- `PaymongoService::createRefund` posts to `POST /v1/payments/{id}/refunds` (not documented), sends no `payment_id`, and a free-text `reason`. `listPaymentRefunds` also uses an undocumented nested path. Live refunds have therefore most likely never succeeded; the refund layer fails safe (payment stays `paid`, retryable; nothing marked refunded), but refunds owed before acceptance are not actually paid out. The test suite's fakes encode the nested URL, which is why tests passed.
- Idempotency: the general page says `Idempotency-Key` applies to resource creation (24-hour expiry, ≤ 255 chars, different parameters on a retry are rejected); the refund page does not list it. Our protection does not rely on it (the `requested` row blocks a second refund).

**Operational tasks (owner):**

1. *Earnings backfill:* back up the database → `php artisan earnings:ledger-backfill --dry-run` → inspect the 4 existing earnings (`rider_earnings`) → `php artisan earnings:ledger-backfill` → run it again and confirm "Posted 0 earnings" and no new `rider_earning_entries` rows.
2. *PayMongo test mode (after the refund fix):* with test keys, create a test payment, refund it once, then repeat the identical request with the same `Idempotency-Key` and confirm PayMongo returns the original refund (no second refund).

# Stage 6 — Cashout validation against the ledger: built (2026-11-12)

Decisions (2026-11-12): **FLAG** → staff may approve only after investigating and documenting the decision; **BLOCK** → the cashout stops until resolved; **an earning missing from the ledger** → its cashout stops until it is recorded.

- **0. PayMongo refund call fixed (pre-existing defect).** `PaymongoService::createRefund` now uses the documented `POST /v1/refunds` with `amount`, `payment_id`, `reason` mapped to PayMongo's list (`refundReason()`: duplicate / fraudulent / requested_by_customer / others), the free-text reason in `notes` (≤ 255) and `metadata.local_refund_key`; `Idempotency-Key` kept. The undocumented `listPaymentRefunds` was removed; `payments:reconcile-refunds` looks refunds up only by their recorded id (`GET /v1/refunds/{id}`) and otherwise leaves the payment `pending_refund` (counted unreachable). Test fakes in `OrderDeliveryScenariosTest`, `PaymentApiTest`, `RefundPathHardeningTest`, `RideHailingIntegrityTest` moved to the documented URL (AGENTS §12). **Owner:** confirm one refund in PayMongo test mode.
- **1. Ledger is the single source of rider totals.** `RiderEarningLedger::earned()` no longer falls back to the row (unposted = ₱0); `isPosted()` added. Rider records: day / lifetime totals, commission, tips, adjustments, COD vs online from ledger entries; "in cashout requests" and "paid out" from the ledger (`riderTotals`). `AdminRiderRecordsTest` fixture reconciled (an unbacked "paid ₱150" payout row no longer counts; the paid payout now goes through the ledger).
- **2. `CashoutValidator`** (stored in `rider_payout_validations`, append-only, migration `2026_11_12_000001`): per earning — posted (BLOCK), postings = write-once row (BLOCK), reserved for this request at its current ledger amount (BLOCK), not reserved / paid elsewhere (BLOCK), original transaction checks (BLOCK; message unchanged: "These earnings failed verification: …"), order history integrity (BLOCK → BLOCK, FLAG → FLAG); per request — reservations = amount (BLOCK), GCash destination unchanged since approval (BLOCK). Runs at request (BLOCK refuses the request), approval (stored *before* the approval transaction so refused attempts are kept; FLAG requires a decision note ≥ 10 characters, stored as `decision_note`), payment, and on demand (`POST /api/admin/payouts/{id}/validate`). The investigation page shows a **Ledger validation** panel (result, failed checks, decision, re-check) and the approve form requires the documented decision when flagged, disabled when blocked.
- **Integrity refinement:** a delivery recorded as created already delivered / completed counts as a completion record (lifecycle check).
- **3. Approved snapshot locked:** `RiderPayout` refuses changes to rider, amount, GCash number / name once approved or paid; a database-level change is caught at payment (`destination` BLOCK).
- **Tests added:** `CashoutValidationTest` (8), `AdminRiderRecordsTest` +1, frontend `cashouts` +3.
- **Database (dev MariaDB):** `2026_11_12_000001` applied with `--path`; triggers `rider_payout_validations_no_update` / `_no_delete`; live probe in a rolled-back transaction: UPDATE / DELETE refused (1644); nothing left behind.
- **Operational (owner):** back up → `earnings:ledger-backfill --dry-run` → inspect → run → rerun (expect "Posted 0"). Until then the 4 dev earnings show ₱0 in the ledger and cannot be cashed out (by decision).
- **Checkpoint:** Laravel 1,047 passed / 6,684 assertions / 0 failures / 2 skipped (known environment skips); frontend 676 passed (96 files); `vite build` clean. Nothing committed, pushed or deployed.

## Earnings ledger backfill — executed on dev (2026-11-12, owner-approved)

- **Backup first:** `C:\xampp\backups\track_tour_db-before-earnings-ledger-backfill-20261112-091718.sql` (520,191 bytes; `mysqldump --single-transaction --routines --triggers --events`; 115 tables, all 12 append-only triggers; dump completed). Restore: `C:\xampp\mysql\bin\mysql.exe -u root track_tour_db < <file>`.
- **Dry-run:** "4 earnings and 0 cashouts would be posted" — reviewed and approved by the owner.
- **Run 1:** "Posted 4 earnings; recorded 0 cashouts." **Run 2:** "Posted 0 earnings; recorded 0 cashouts." → 4 ledger rows, 4 distinct idempotency keys, all `earning_posted` with `backfilled = true` (entry ids start at 3: ids 1–2 were consumed by the earlier rolled-back trigger probes; no rows exist for them).
- **Result:** every earning's ledger total equals its row (#1 ₱40.00 food / COD, #2 ₱40.00 food / online, #3 ₱84.54 ride / COD, #4 ₱40.00 food / online; historical food earnings labelled "rule before 2026-11-11: flat ₱40"). Rider #5: online earned ₱80.00, available ₱80.00, cash kept ₱124.54.
- **Defect found during verification and fixed:** `RiderPayoutService::getAvailableEarnings` computed `held_total` with `diffKeys` (array positions) against a re-indexed collection, so an eligible earning could also appear as "held" (dev showed ₱40.00 held; now ₱0.00). Display-only — the cashable amount was correct. Now compared by earning id; `FinancialLedgerTest` reproduces the ordering.

## PayMongo test-mode refund check (2026-11-12)

The Stage 6 refund fix (documented `POST /v1/refunds` with `payment_id`, a fixed `reason`, and an `Idempotency-Key`) still has to be confirmed against PayMongo itself. Refund idempotency is not documented on the refund page. It is documented generally for resource creation (24 h). Our own `requested` refund row stays the main protection against duplicates either way.

Command: `php artisan paymongo:refund-check` (`app/Console/Commands/PaymongoRefundCheck.php`).

- Runs only with a `sk_test_…` key and never in production. It never prints the key and writes nothing to the database.
- Default flow: it creates a ₱100 GCash test payment intent and prints the PayMongo test page. The owner clicks "Authorize Test Payment" there.
  - `--card` uses PayMongo's test card instead, with no browser step.
  - `--payment=pay_…` reuses an existing test payment.
- It refunds ₱20 through the app's own `PaymongoService::createRefund`, then repeats the same request with the same key. The refund is partial on purpose: if the key were ignored, a second partial refund would succeed, so the repeat is a real test.
- It confirms the refund with `GET /v1/refunds/{id}` and counts the refunds on the payment.
  - PASS: the repeat returns the same refund or is refused.
  - FAIL: a second refund is created, and the command exits non-zero.
- Tests: `tests/Feature/PaymongoRefundCheckTest.php` (5, all PayMongo calls faked). Covers live-key refusal, full-refund refusal, the same refund returned, a refused repeat, and a second refund detected.
- Full suite after adding the command: 1,052 passed / 6,705 assertions / 0 failures / 2 skipped (known environment skips).
- Result against PayMongo test mode: **pending — run by the owner** (the GCash step needs a browser). Record the output and the dashboard confirmation here.

## PayMongo refund webhook — `payment.refund.updated` (2026-11-12)

**Found while checking the test-mode webhook.** The dashboard webhook (`hook_XQBJ…`, test mode, URL `…ngrok-free.dev/api/payments/webhook`) is subscribed to `payment.refund.updated`. The handler only knew `refund.*` and `payment.refunded`, so PayMongo's real refund event was stored and then ignored. Refunds settled only through `payments:reconcile-refunds`. The webhook was **disabled** at the time. It was left unchanged, as instructed.

**PayMongo payload (docs.paymongo.com → Developer tools → Webhooks → Events; Refund resource):** `data.attributes.data` is a **refund** resource: `{id: "ref_…", type: "refund", attributes: {amount, currency, payment_id, status, reason, notes, metadata, …}}`. Status is one of pending, processing, succeeded or failed. The `payment.refunded` payload is not documented.

**Audit findings (all fixed):**
1. `payment.refund.updated` was not dispatched.
2. The payment lookup used the refund's `ref_` id as if it were a payment reference, and never used `attributes.payment_id`.
3. `payment.refunded` took `data.id` as a refund id and forced `succeeded`. If PayMongo sends a payment resource (`pay_…`), that would create a full-amount ledger row keyed by the payment id and mark the payment refunded.
4. A webhook that arrives after `initiateRefund` records the `requested` row, but before phase 3 attaches the `ref_` id, was not matched. A second ledger row was created.
5. Phase 3 could overwrite a refund a webhook had already settled, for example downgrading `succeeded` to `pending`.
6. A refund created outside the app was recorded for the full payment amount, because `amount` was read from the wrong level.

**Changes**
- `app/Http/Controllers/Api/PaymentController.php`:
  - Adds `REFUND_EVENTS`, which includes `payment.refund.updated`.
  - `refundsFromWebhook` / `flattenRefund` read the documented refund resource. A payment resource's id is never used as a refund id. Only refund resources in its `refunds` list are applied; otherwise the event is logged and left to reconciliation.
  - The payment lookup for refund events now uses the refund's `payment_id` (taking the payment row lock), then the recorded `provider_refund_id`.
  - Status mapping: `pending` and `processing` stay pending; `succeeded` succeeds; `failed` fails and the payment returns to `paid` (retryable).
- `app/Services/PaymentRefundProcessor.php`:
  - `applyProviderStatus` gains a `localRefundKey` argument. Through `claimRequestedRefund`, it links the unlinked `requested` row by the `metadata.local_refund_key` we send to PayMongo. Otherwise it links the payment's single unlinked requested refund of the same amount.
  - Phase 3 returns the webhook-settled state unchanged when the row is no longer `requested`.
- Unchanged: signature verification, UNIQUE `provider_event_id` event idempotency, the no-downgrade rule, reconciliation, the failed refund's retry and manual-review path, and all non-refund events.

**Tests:** `tests/Feature/PaymongoRefundWebhookTest.php` (11). The payloads follow the documented refund resource and are signed like test mode (`t=…,te=…`). Cases covered:
- processing stays pending; succeeded; failed stays retryable;
- a late `failed` never downgrades a succeeded refund;
- a duplicate event is a no-op (refunded once);
- a requested row is settled by its key, with no second row;
- a webhook that settles first is not overwritten by phase 3;
- an unmatched payment or refund changes nothing;
- a refund made outside the app is recorded at its own amount;
- a payment resource is never taken for a refund;
- an invalid signature is rejected (400) before anything is recorded.

The existing `RefundPathHardeningTest` still passes (15).

**Full suite:** 1,063 passed / 6,759 assertions / 0 failures / 2 skipped (known environment skips). Frontend not affected (no frontend files changed). Nothing committed.

### Review follow-up (2026-11-12)

**Ambiguous matching (fixed).** The first version matched a webhook without our key to the payment's unlinked `requested` refund of the same amount. When there was no single match, it fell through and created a new ledger row. Phase 3 would then hit the UNIQUE `provider_refund_id` constraint when linking its own row.

`claimRequestedRefund` now behaves as follows:
- A `metadata.local_refund_key` decides on its own. A key that matches none of our unlinked requests is a different refund, so it is not claimed.
- Without a key, the payment's single unlinked requested refund (of the same amount, when the amount is known) is claimed.
- Two or more candidates are ambiguous. The refund is not recorded, linked or marked refunded; the request's own phase 3 links it, and `payments:reconcile-refunds` settles it.

Tests added (3): a single candidate is claimed by amount; equal amounts are never guessed; the key picks the right one among equal amounts.

**Partial refunds (pre-existing defect, open — needs a decision).** A probe on the current code refunded ₱20 of a ₱100 payment and got:
- `payment.status=refunded`, `order.payment_status=refunded`, `order.refund_status=refunded`, `order.refunded_amount=20`;
- a second ₱20 refund then returns `already_refunded` without calling PayMongo.

`finalizeRefunded` marks the whole payment and order refunded whenever any refund succeeds. Partial refunds do occur:
- item refunds from `BusinessOwnerOrderController::rejectItem` before rider acceptance;
- the tourist `POST /payments/{number}/refund` with an `amount`.

So after the first item refund, a second rejected item can no longer be refunded, and the order reads "refunded" though only part was returned. This was not changed in this fix. The probe was a temporary test and was deleted.

The live `paymongo:refund-check` does not exercise this. Its test payment is not a local payment, so its webhook is unmatched and changes nothing locally. The live check verifies the PayMongo API, the idempotency key, and webhook delivery and signature.

### Partial refunds — fixed (owner-approved 2026-11-12, no new status values)

Rule: `payment.status` and `order.payment_status` become `refunded` only when **PayMongo refunds that succeeded total the amount paid**. Until then they stay `paid` (or `pending_refund` while a refund is with PayMongo), and `refunded_amount` holds the running total. For a ₱100 payment:

| Event | Payment status | Refunded | Remaining |
|---|---|---|---|
| Paid | paid | ₱0 | ₱100 |
| ₱20 succeeds | paid | ₱20 | ₱80 |
| ₱30 succeeds | paid | ₱50 | ₱50 |
| ₱50 succeeds | refunded | ₱100 | ₱0 |

`app/Services/PaymentRefundProcessor.php`:
- `refundTotals(payment)` returns paid, succeeded, in flight and remaining, where remaining = paid − succeeded − in flight.
  - Only this payment's **PayMongo** refunds count (rows with a `ref_` id, plus `requested`). Local credit-ledger rows are excluded, as before.
  - Pending and processing refunds reserve an amount but are not counted as refunded. Failed refunds are not counted, which releases their reservation.
- `initiateRefund` phase 1 runs under the payment `lockForUpdate`. It computes `remaining`, refuses `amount > remaining` with the new result `exceeds_remaining` (no PayMongo call, `remaining` returned), and then inserts the `requested` reservation before the lock is released. A second simultaneous request therefore waits for the lock and sees the reservation. Other phase 1 behaviour:
  - A succeeded partial refund no longer blocks the next refund.
  - An in-flight refund of the same item, or another order-level refund, still returns `in_flight`. An item already refunded returns `already_refunded`.
  - A legacy `pending_refund` with no ledger row returns `in_flight`.
  - `pending_refund` payments may take a separate partial refund within the remaining amount.
- `syncPaymentStatus` derives the payment status: `refunded` only when fully refunded; `pending_refund` while a refund is pending; otherwise `paid`. It never downgrades `refunded`.
- `finalizeRefunded`:
  - `order.payment_status` and a Booking's `payment_status` become `refunded` only when fully refunded.
  - `refunded_amount` grows by this refund's amount, once.
  - `refund_status` is `pending` while another refund is in flight, else `refunded`.
- `applyProviderStatus`: a refund already `succeeded` is final. Any later event (succeeded again, pending, failed) changes and counts nothing.
- `applyProviderFailure` releases the reservation and re-derives the payment status.

Callers:
- **Tourist `POST /payments/{n}/refund`:** without an amount it refunds what remains. `exceeds_remaining` returns 422 ("The refund is more than the ₱X still refundable on this payment."). The order is cancelled only when the payment is fully refunded.
- **`OrderRefundService::refundPaidOrder`:** refunds what remains. The early `pending_refund` return is removed; the processor now decides under the lock.
- **`BusinessOwnerOrderController` item refund (standalone):** also runs while the payment is `pending_refund`.
- **`payments:reconcile-refunds`:** looks up **every** pending PayMongo refund of a payment, not only the latest.

Unchanged: the accepted-rider refund block, the `requested` / idempotency-key three phases, webhook signature and event idempotency, and group-checkout local refunds.

Tests: `tests/Feature/PartialRefundTest.php` (11, 110 assertions):
- two partials both succeed;
- partials complete the full refund;
- a refund over the remaining amount is rejected without PayMongo (processor and endpoint);
- an in-flight refund reserves its amount (not counted as refunded);
- a failed refund releases its amount;
- duplicate or repeated webhooks and reconciliation do not double-count;
- concurrent requests cannot exceed the amount paid;
- a full refund behaves as before (order cancelled);
- an endpoint partial does not cancel the order, and no amount means the rest;
- order cancellation refunds only what remains;
- no partial refund after rider acceptance.

The SQLite tests interleave the second request inside the PayMongo call. The real serialisation comes from the MariaDB row lock.

**Separate pre-existing finding (not changed).** For a **standalone** (non-group) paid order, `OrderRefundService::refundCancelledItem`, used by the tourist item cancel and the group item reject, records a local `succeeded` refund row without calling PayMongo. The tourist is told "The refund will be returned.", but no PayMongo refund is issued. Those rows are excluded from `refundTotals`, so a later order cancellation still refunds the full PayMongo balance. Needs an owner decision.

**Full suite after the partial-refund fix:** 1,077 passed / 6,885 assertions / 0 failures / 2 skipped (known environment skips). Refund-related classes: 234 passed / 2,223 assertions. No frontend files changed. Nothing committed. Live PayMongo check: pending (owner).

## Live test-mode result: PayMongo does NOT honour `Idempotency-Key` on refunds (2026-11-12)

`paymongo:refund-check` was run twice by the owner (GCash test payments of ₱100, partial refund ₱20, then the same request repeated with the same key). The idempotency check **failed both times**. Provider state, read afterwards with `GET /v1/payments/{id}` and `GET /v1/refunds/{id}` (read-only):

| Payment (test) | Refund | Status | Amount | Created (server time) | `metadata.local_refund_key` |
|---|---|---|---|---|---|
| pay_uhaKcjePwYRj1xyMgFyhSnyq | ref_tSgHqBdvQMv4hj7iCD19V9xH | succeeded | ₱20.00 | 02:35:38 | tt-refund-check-eede47f3-… |
| pay_uhaKcjePwYRj1xyMgFyhSnyq | ref_HG9UGbrKrCoMmuD2dhBPKTus | succeeded | ₱20.00 | 02:35:38 | tt-refund-check-eede47f3-… (same) |
| pay_MvERY9gocmcwEKkK5wyYhEnr | ref_KrJHtzYDLoha37Zu8EVK1NSB | succeeded | ₱20.00 | 02:36:22 | tt-refund-check-a5f34df1-… |
| pay_MvERY9gocmcwEKkK5wyYhEnr | ref_ysHcs9KVeuxRcBeyBUeNo28z | succeeded | ₱20.00 | 02:36:22 | tt-refund-check-a5f34df1-… (same) |

Both payments remain `paid` at PayMongo, with ₱40 of ₱100 refunded each. These are test payments and no real money moved, but the duplicates are real in the test environment.

**Conclusions**
- A repeated `POST /v1/refunds` with the same `Idempotency-Key` creates a second refund. The header gives no protection, so TrackTour must never send a second create for the same refund intent.
- PayMongo echoes our `metadata.local_refund_key` on the refund, and `GET /v1/payments/{id}` lists the payment's refunds with that metadata. A refund whose create response was lost can therefore be found by its key without creating another.

**Gap this exposes in the app (not yet changed).** `PaymongoService::createRefund` returns `null` for every non-success: a definitive rejection (4xx) and an uncertain outcome (timeout, connection error, 5xx). Phase 3 of `initiateRefund` then marks the `requested` row `failed`, which releases the reservation and leaves the payment refundable. After a timeout in which PayMongo did create the refund, a manual retry by staff or the tourist would send a new `POST` and refund twice, up to the payment amount. Nothing retries automatically. The scheduler only reconciles, and stale `requested` rows are escalated, never retried.

### Uncertain refund outcomes — fixed (owner-approved 2026-11-12)

PayMongo ignores `Idempotency-Key` on refunds (above), so a create whose outcome is unknown must never be treated as failed or sent again.

**`PaymongoService::createRefundOutcome`** classifies each create:
- **created:** a 2xx with a refund id.
- **rejected:** a 4xx carrying PayMongo's `errors` body, other than 408, 409, 425 or 429; or PayMongo not configured, in which case nothing was sent. Only these prove no refund exists.
- **uncertain:** everything else, conservatively. That covers timeouts and connection failures (`ConnectionException`), any other exception, 5xx, 429, 408, 409, 425, a 4xx without PayMongo's error body, and a 2xx without an id.

`createRefund()` remains a thin wrapper. `retrievePayment()` (documented `GET /v1/payments/{id}`) was added; its `refunds` list carries each refund's `metadata`, as seen live.

**`PaymentRefundProcessor`:**
- Phase 2 makes exactly one create call.
- Phase 3 handles each outcome:
  - **created:** as before.
  - **rejected:** the row becomes `failed` (`provider_rejected` recorded), the reservation is released, and the payment stays refundable. A retry is a new request.
  - **uncertain:** the row stays `requested`. Its amount stays reserved and it still blocks the same refund (`in_flight`). It is escalated once (`escalation.refund_provider_uncertain`, with `escalated_at` set so the 10-minute stale escalation does not repeat it), the order's `refund_status` becomes `pending`, and the call returns `pending`.
- **`resolveUnconfirmedRequest(refund)`** looks the request up on the payment's PayMongo refund list by `metadata.local_refund_key`.
  - A match is linked and its real status applied.
  - More than one match is linked to the first and escalated (`escalation.refund_duplicated_at_provider`).
  - No match leaves the request `requested`, reserved and escalated.
  - If PayMongo is unreachable, nothing changes.
  - It never creates a refund.

**`payments:reconcile-refunds`** first resolves every unlinked `requested` refund older than one minute; requests still in their own call are left alone. It never re-sends.

**Other changes**
- **Business-owner reject message:** a failed refund no longer claims it "will be retried automatically". It now reads: "The refund did not go through, so the payment has not been refunded yet. It needs to be retried."
- **`paymongo:refund-check`:** the known PayMongo behaviour is documented in the class, the run refuses without `--accept-duplicate-refund`, and a FAIL prints the known-behaviour note.

**Test drift reconciled (AGENTS §12).** Three tests faked a PayMongo **500** as a definite failure, expecting a 502 response and the payment refundable: `PaymentApiTest::test_refund_returns_502_on_paymongo_failure`, `RefundPathHardeningTest::test_provider_refund_failure_keeps_payment_paid_and_order_unrefunded` and `::test_cancelled_order_whose_refund_fails_is_never_marked_refunded`. A 500 is now uncertain by owner decision, so their fakes became a definite 400 with PayMongo's error body. Their assertions are unchanged, and the 500 case is covered as uncertain in the new tests.

**Tests:** `tests/Feature/RefundUncertainOutcomeTest.php` (16 cases, 9 of them from a data set):
- a timeout after PayMongo created the refund is held, a repeat is `in_flight`, and reconciliation finds it by key and links it as succeeded (₱20 counted once, payment still `paid`, one POST);
- a connection failure is held;
- 500, 502, 503, 504, 429, 408, 409, a 400 without an error body and a 200 without an id are each held, never re-sent, and keep their reservation (a larger refund is `exceeds_remaining`);
- a definite 400 rejection fails the refund, releases the reservation, and a retry is allowed;
- no matching refund means it stays held, escalated once, with no retry across two runs;
- PayMongo unreachable during reconciliation changes nothing;
- a request younger than one minute is not looked up;
- a refund PayMongo duplicated is linked once, counted once and escalated.

`PaymongoRefundCheckTest` gains the refusal-without-flag test (6 in total).

**Full suite after the uncertain-outcome fix:** 1,094 passed / 7,035 assertions / 0 failures / 2 skipped (known environment skips). Refund-related classes: 251 passed / 2,373 assertions. No frontend files changed. Nothing committed.

# Stage 7 — GCash group settlement: audit and policy (2026-11-17)

Read-only audit of how a GCash payment for a multi-restaurant group checkout reaches restaurant wallets. No code, migration or data was changed. Architecture confirmed and preserved: **one canonical order, one delivery, one rider, one delivery fee, several restaurant pickup stops**. `order_items.business_id` owns each item; `orders.business_id` is only the first restaurant.

## A. Current payment-to-wallet flow

1. `GroupOrderService::createGroup()` creates one `group_checkouts` row and one `orders` row; each item carries its restaurant.
2. `PaymentController::createIntent()` charges `group_checkouts.grand_total`; the `payments` row is `payable = GroupCheckout`.
3. The webhook verifies the signature, dedupes on `payment_webhook_events.provider_event_id` (UNIQUE, same transaction as the handler), checks `Payment::canApplyProviderVerdict()`, and `markPayablePaid()` marks the group and the order paid once. **Settlement is not triggered here.**
4. The rider completes the delivery. After commit, `DeliveryStatusChanged` fires and `SyncOrderStatusFromDelivery::handle()` sets the order `completed`, then calls `OrderSettlementService::recordGcashSettlement()`.
5. `recordGcashSettlement()` locks the order, returns any existing settlement for the order, checks `subtotal + delivery_fee + rider_tip + system_fee = total`, then `postSettlement()` writes one `order_settlements` row and one `ORDER_EARNING` wallet transaction for `orders.business_id`.
6. Delivery fee and tip reach the rider through the separate rider earning ledger.

## B. Confirmed findings

| # | Finding | Evidence | Severity |
|---|---|---|---|
| F1 | GCash settlement credits the **whole food subtotal** to the first restaurant; other restaurants get nothing. The `order_id` existence check then blocks them for ever. | `OrderSettlementService.php:83-134` (`recordGcashSettlement`), `:245-297` (`postSettlement` uses `$order->business_id`) | Critical |
| F2 | A paid order is not repriced when an item is cancelled before acceptance, so settlement pays the restaurant for food already refunded. | `OrderRefundService::refundCancelledItem()` reprices only unpaid orders (`:170`); `recordRefundDeduction()` skips orders with no settlement yet (`:34-36`) | High |
| F3 | A settlement failure (missing wallet `firstOrFail`, or the reconcile `LogicException`) leaves the order `completed` with no settlement. The listener skips orders already in the target status, there is no retry command and no integrity check, and the exception escapes the rider's request after commit. | `SyncOrderStatusFromDelivery.php:47-64`; no settlement code in `app/Console` or `app/Services/Integrity` | High |
| F4 | Refunds after settlement (possible for pickup orders; deliveries are blocked by `AcceptedOrderPolicy` once a rider accepts): a group payment's refund has `order_id = null` when no `forOrder` is passed (the staff refund endpoint passes none), so no wallet is reversed. When an order is known, the reversal hits `orders.business_id` and an arbitrary settlement row. | `PaymentRefundProcessor.php:141, :583`; `PaymentController::refund()` `:866`; `OrderSettlementService::recordRefundDeduction()` | Medium |
| F5 | No provider amount or currency check: every paid path marks the payment paid without comparing the provider amount to `payments.amount`. | `PaymentController::handlePaymentPaid()` `:568-590`, `handleCheckoutSessionCompleted()`, `handleCheckoutSessionPaymentPaid()`, `verifyAndConfirmPayment()` | Medium |
| F6 | GCash and COD use different commission formulas (section C). | `OrderSettlementService.php:124-131` vs `CodSettlementService::split()` | Policy |
| F7 | A GCash settlement row does not balance: `restaurant_amount + platform_amount ≠ settlement_base`, because the base includes the delivery fee and tip. COD enforces equality. | `recordGcashSettlement()` | Low |
| F8 | The schema already supports one row per restaurant: `2026_09_22_000002` replaced UNIQUE(`order_id`) with UNIQUE(`order_id`, `business_id`) on `order_settlements` and `cod_settlements`. | migration | Info |

Correctly protected, verified: duplicate webhooks (unique event id plus no-downgrade verdicts), repeated `recordGcashSettlement()` calls (order row lock, unique `settlement_number`, unique `(order_id, business_id)`), concurrent settlement (serialised by the order lock), and wallets auto-created on restaurant approval (`Business.php:571` → `RestaurantWalletService::ensureForBusiness`). No restaurant withdrawal path exists yet (`TYPE_WITHDRAWAL` is defined but unused), so wallets are ledger balances only.

## C. Exact commission formulas

Notation: `fee(x) = round(x × system_fee_percentage / 100, 2)` with `system_fee_percentage = 10`; `P = cod_platform_fee_percent = 20`. Restaurants are ordered by `business_id` ascending; the last absorbs rounding remainders.

**COD (existing; unchanged by this stage).** `CodSettlementService::businessBases()` and `split()`, for each restaurant `b` with active items:
- `F_b = Σ unit_price × (quantity − cancelled_quantity)` over `b`'s items
- `S = orders.system_fee` (unpaid COD orders are repriced on cancellation, so `S = fee(active subtotal)`)
- `share_b = round(S × F_b / orders.subtotal, 2)`; the last restaurant gets `S − Σ other shares`
- `base_b = F_b + share_b`  (Σ `base_b` = `orders.rider_financed_amount`)
- `platform_b = round(base_b × P / 100, 2)`, `restaurant_b = base_b − platform_b`

The 80/20 split therefore applies to **food plus the system fee**: the restaurant receives 80% of its food and 80% of its system-fee share; the platform receives 20% of each. At a 10% fee, the restaurant receives 88% of the menu price. In COD, the restaurant is also paid at the counter from Tourism Office purchasing cash (issued = Σ `base_b`, paid per receipt, unused cash returned), and its wallet records `restaurant_b`.

**GCash (current).** Restaurant (first only) = `orders.subtotal`; platform = `orders.system_fee`; base = `orders.total`. The restaurant receives no cash at pickup (`PickupSequenceService::paymentConfirmation()` is `null` for non-COD), so the wallet credit is its only payment.

**GCash (approved direction: consistent 80/20; base to be confirmed).** Same per-restaurant allocation as COD, but computed on active quantities because paid orders are not repriced: `S = fee(Σ F_b)` (the system fee retained after refunds) and the proration denominator is `Σ F_b`. Two candidate bases:
- **Option 1, identical to COD:** `base_b = F_b + share_b`; 80/20 on `base_b`.
- **Option 2, 80/20 on food only:** `restaurant_b = F_b − round(0.2 × F_b)`; `platform_b = round(0.2 × F_b) + share_b`.

Example: A ₱300, B ₱200, system fee ₱50, delivery fee ₱60, tip ₱0, captured ₱610.

| | A | B | Platform | Rider | Σ |
|---|---|---|---|---|---|
| Current code | 500 | 0 | 50 | 60 | 610 |
| Current GCash rule, correctly split | 300 | 200 | 50 | 60 | 610 |
| Option 1 (as COD) | 264 | 176 | 110 | 60 | 610 |
| Option 2 | 240 | 160 | 150 | 60 | 610 |

**Status: awaiting product-owner confirmation of Option 1 or Option 2, and that the new formula applies only to orders settled after deployment.**

## D. Policy decisions (product owner, 2026-11-17)

1. **Commission:** one consistent policy for GCash and COD, preferred 80/20; the base must be confirmed (section C), never assumed.
2. **Cancelled items:** refund the system fee belonging to cancelled items, subject to the approved refund calculation (section E).
3. **Historical mis-credits:** report first. No automatic debit of restaurant wallets, and no edits of historical financial rows. A correction needs Tourism Office approval and new, auditable adjustment entries (section G).
4. **Missing restaurant wallet:** all-or-nothing group settlement. Delivery completion must still succeed; the failure is recorded and safely retryable.
5. **Payment amount mismatch:** hold for review. A payment is not marked paid until the provider amount, currency and expected amount are verified.
6. **Refund deductions:** stay separately classified (`refunds.refund_deduction`); never recognised as platform revenue without an approved accounting policy.

Mandatory requirements: delivery completion is separate from settlement completion; failed attempts never block retries; retries create only missing allocations; adjustment and reversal entries are append-only; item refunds reverse against the right restaurant; whole-order refunds resolve the canonical group order; integrity checks cover missing and mismatched settlements; every allocation reconciles to the captured amount and refunds; architecture and COD behaviour are preserved.

## E. Refund calculation rules

Unchanged: no refund once a rider has accepted (`AcceptedOrderPolicy`); provider dedupe and the uncertain-outcome rules (Stage 5 and 6 sections above).

**Item cancellation before acceptance** (paid or unpaid), `q` units of an item at `unit_price`:
- `food_refund = round(unit_price × q, 2)`
- `deduction = round(food_refund × refunds.deduction_rate, 2)` (default 0), stored in `refunds.refund_deduction` and classified separately (D6)
- `fee_refund = fee(active subtotal before) − fee(active subtotal after)` (new, D2). Recomputing the fee telescopes, so cumulative fee refunds can never exceed the fee charged, and the retained fee always equals `fee(active subtotal)`.
- `refund = food_refund − deduction + fee_refund`
- The existing delivery-fee rule when the last active item is cancelled is unchanged.
- Proposed: the deduction applies to the food portion only, not to `fee_refund` (to be confirmed).

**Reversal after settlement** (pickup orders, or a refund made in the PayMongo dashboard and received by webhook):
- Resolve the order: `refunds.order_id`, else the payment's `GroupCheckout` → its canonical order.
- **Item refund** (`refunds.order_item_id` set): reverse only against `order_items.business_id`. The amount reversed is the allocation of the refunded food plus its fee share under the same split; the restaurant part is debited from that restaurant's wallet and the platform part is recorded as a platform reversal.
- **Amount or whole refund:** fraction `f = min(1, refund.amount / captured amount)`, applied to every restaurant and platform allocation (the last absorbs rounding). A full refund reverses everything.
- Each reversal is an append-only entry, idempotent per (refund, settlement row), never more than what remains of that allocation. Rider earnings reversal stays in the rider ledger (out of scope).

**Reconciliation identity per GCash order:** `verified captured amount − Σ succeeded refunds = Σ restaurant + Σ platform − Σ reversals + delivery_fee + rider_tip + Σ retained deductions`. A mismatch puts the settlement on hold.

## F. Settlement state transitions (GCash)

Delivery completion and settlement are separate. The order reaches `completed` regardless; settlement runs after commit and records its own state.

| From | Event | To |
|---|---|---|
| (none) | Order completed and GCash payment verified | `pending` |
| `pending` | Every restaurant allocation written and the identity holds (one transaction) | `settled` |
| `pending` | Retryable failure (missing wallet, lock timeout); nothing written | `failed`, attempts +1, error recorded, escalated once |
| `failed` | Scheduled or manual retry | `pending` |
| `pending` | Identity mismatch, an existing row that differs from the expected allocation (legacy), or payment held for review | `held`, escalated to the Tourism Office |
| `held` | Tourism Office resolves the cause (approved adjustment, or payment verified) | `pending` |
| `settled` | Refund reversal | stays `settled`; reversal entries appended |

A retry writes only the restaurants with no row. If any existing row differs from the expected allocation, nothing is written (`held`). COD keeps its existing atomic in-transaction settlement.

## G. Historical correction procedure

1. A **read-only report** lists every completed GCash order whose existing rows differ from the allocation under the policy in force when it was settled (legacy rule: each restaurant 100% of its own food). Columns: order, group, restaurants, expected per restaurant, recorded per restaurant, wallet effect, and the difference.
2. Report rows go to the Tourism Office as escalations. Nothing is debited or edited.
3. For an approved correction, the Tourism Office records approval (approver, reason, reference). Only then does a correction command write **new** adjustment entries: a debit for the over-credited restaurant, a credit for the under-credited one, linked to the original settlement row and the approval. Originals stay untouched.
4. Corrections are idempotent per (order, restaurant, approval), and the report re-runs clean afterwards.
5. If a debit would make a wallet negative, the correction is refused and escalated (a policy decision about negative balances is still open).

## H. Required regression tests

- Single restaurant GCash: unchanged, except the base chosen in C.
- Two restaurants: two rows, each wallet credited only its own items, and the identity holds.
- Three or more restaurants: fee rounding, with the remainder on the last restaurant.
- Repeated settlement adds no rows or transactions; concurrent attempts produce one set.
- Partly settled group: a retry writes only the missing restaurant.
- Legacy mismatched rows: a retry writes nothing, the order goes to `held`, and it appears in the report.
- Missing wallet: the delivery still completes, nothing is written, `failed` is set and escalated once, and a retry succeeds once the wallet exists.
- Paid item cancelled before acceptance: refund includes `fee_refund`, settlement excludes the cancelled food and fee, and the identity holds.
- Deduction rate above 0: the deduction is stored separately, not in `platform_amount`, and is counted in the identity.
- Pickup group refunded after settlement: an item refund reverses only its restaurant; a whole refund reverses every allocation proportionally; repeats are idempotent.
- Group refund through the staff endpoint (no `forOrder`) resolves the canonical order.
- Webhook amount or currency mismatch: the payment stays unpaid, an escalation is recorded, nothing is dispatched; the matching amount still marks it paid; the `checkAndConfirm` poll path behaves the same.
- Duplicate webhook remains a no-op (existing tests).
- Integrity check flags an unsettled completed order, a mismatched allocation, and an identity break.
- COD regression: the full COD and purchasing-cash suites stay green and unchanged.


## I. Ride hailing — one-time destination change (owner decisions 2026-11-17)

**Scope.**
- A tourist may change a ride's destination **once**: after pickup (delivery `picked_up` / `in_transit` / `en_route_destination`) and before arrival. Never after completion or cancellation.
- Only a **confirmed** change uses the allowance. Previews are not stored, and a refused or expired confirm stores nothing.
- No second booking or trip: the ride's `deliveries` row is updated in place to the new destination.

**Records.**
- `ride_destination_changes` (migration `2026_11_17_000004`) has one row per confirmed change; **UNIQUE `order_id`** means at most one per trip.
- The row keeps:
  - the original and new destination (address and coordinates), who requested the change, and when it was confirmed;
  - the booked fare and commission;
  - the fare configuration used: the ride's **booked** `base_fare` / `per_km` and the settings fingerprint;
  - the estimate, `max_fare`, the remaining-route source, the rider notification status and time, and the rider acknowledgement (kept separately);
  - the verified and unverified km, a track summary, and the computed, final, cap-adjusted fare;
  - the final commission and the review status with its reasons.
- Ledger events:
  - `ride_destination_changed`;
  - `ride_destination_acknowledged`;
  - `ride_fare_finalized`;
  - `order_amounts_changed`, which the observer records automatically.
- `ride_quoted` (the booking) is never modified.

**Revised estimate (preview, shown before confirming).**
```
travelled_km = verified GPS distance from the pickup to now (rules below)
remaining_km = road route (OSRM) from the rider's latest saved fix (≤120 s old) to the new destination;
               straight line only if the router is unavailable (labelled as such)
estimated    = round(max(base + round((travelled_km + remaining_km) × per_km, 2), base), 2)
max_fare     = round(estimated × 1.15, 2)
```
- The preview returns a signed (app-key encrypted) quote valid for 3 minutes.
- Confirming stores exactly the numbers the tourist saw. Changing them requires the app key.
- No fresh rider fix means no estimate (refused, and nothing is stored).

**Confirm.**
- One transaction:
  - lock the trip's `deliveries` row, then the order;
  - re-check that the change is allowed and that none exists;
  - create the row, update the delivery's destination, and write the ledger event.
- The `idempotency_key` is UNIQUE, so the same key returns the same change (`replayed`).
- A different second request gets **409**. A race that slips past the lock still hits the UNIQUE `order_id` and gets 409.
- After commit, the rider is pushed `ride.destination.changed` (rooms `user:{rider}`, `user:{tourist}`, `trip:{delivery}`).
- A failed push is recorded (`rider_notification_status = failed`) and never undoes the change. The rider app shows the change on its next poll until the rider taps **Got it**, which records the acknowledgement.

**Final fare.**
- It is computed in the rider's status transaction when the trip reaches `arrived_destination` (or `delivered` if arrival was skipped), **before** a cash amount is frozen. It is idempotent.
```
computed       = round(max(base + round(verified_km × per_km, 2), base), 2)
final          = min(computed, max_fare)
cap_adjustment = computed − final
commission     = round(max(20, final × 0.4), 2)          (booking rule, on the final fare)
```
- Order `subtotal`/`total`, the ride item and the delivery's `rider_commission` become the final values. So the following all use the final fare automatically, with no code change in those flows:
  - GCash payment (still after completion);
  - the cash due and cash settlement;
  - the rider earning;
  - platform revenue and reports.
- A closer destination can end below the booked fare. The only floor is the base fare.
- Rides without a change keep their booked fare: no final-fare step runs.

**GPS verification (verified distance).**
- Only the rider's **saved** fixes count (`rider_locations`). The server saves a fix only at ±50 m or better and refuses teleports. Fixes run in time order, starting from the pickup point at `picked_up_at`.

| Situation | Rule | Charged? |
|---|---|---|
| Jitter | Fix closer to the last counted point than max(10 m, the two fixes' mean accuracy). The anchor stays put. | No |
| Impossible jump | Segment faster than `tracking.max_speed_kph` (150). | No: counted as unverified, `jumps_excluded` |
| Gap | More than 60 s without a fix. | No: unverified, recorded with length and duration |
| Early end | Last fix more than 200 m short of the destination. | No: unverified |
| Normal segment | — | Yes |

- **Insufficient evidence policy.** Only verified distance is ever charged. The fare is marked `needs_review` when:
  - unverified distance exceeds 0.5 km or 15 % of the trip;
  - there are fewer than 2 fixes;
  - or a jump was excluded.

  A `needs_review` fare also writes an `escalation.ride_fare_review` activity log and flags the integrity check `ride_fare_gps`. There is no automatic fallback charge.
- The accuracy (best / worst / mean), first and last fix times, gaps, jumps and jitter counts are kept in `track_summary` and in the ledger.

**Integrity checks (FLAG).**
- `ride_fare`: still recomputes the booking quote. For a changed ride it no longer compares the quote with the order total.
- `ride_final_fare`: recomputes the final fare from the recorded verified km, rates and cap, and checks it against the order and the commission.
- `ride_commission`: follows the `ride_fare_finalized` commission.
- `ride_fare_gps`: flags a `needs_review` fare.

**Known limitations.**
- Distance is only as good as the saved GPS track. Indoors or under weak signal, real distance can go uncharged; such fares are flagged for review.
- There is no admin tool yet to adjust a reviewed fare.
- Changed rides are measured on the road track; unchanged rides keep their straight-line booking fare.


## J. Ride hailing — payment confirmed before completion (owner decision 2026-11-18)

**Rule.** The rider confirms the payment before completing a ride. The server enforces this in `RiderDeliveryController::updateStatus` → `RidePaymentService::confirmForCompletion`, before the status write, so a refusal changes nothing:
- **GCash:** `delivered` is refused until the order is `payment_status = paid` (PayMongo-verified, by webhook or the verify fallback) **and** the request carries `payment_confirmed: true`.
- **Cash:** `delivered` needs `payment_confirmed: true`. The cash settlement that follows still refuses less than `cash_due`.
- **Ledger:** each confirmation records `ride_payment_confirmed` (method, fare, payment status, rider).

**When GCash can be paid.**
- From the moment the ride reaches the destination (delivery `arrived_destination` / `delivered`, or the order completed). Before that, create-intent answers 422 "You can pay for this ride once you reach your destination."
- At that point the fare is final, including a changed destination's final fare (§I).
- A ride on cash cannot open a GCash checkout.
- A verified ride payment pushes `order.status.changed` to the rider and the tourist.

**Switch to cash.** `POST /api/rider/deliveries/{delivery}/ride-payment/cash`:
- Allowed only by the assigned rider, only at the drop-off, and only while the GCash ride is unpaid (no paid or authorized payment).
- Order `payment_method` becomes `cash`, and `deliveries.notes.payment_switched_to_cash` records when, who and from what.
- Records `ride_payment_switched_to_cash` in the ledger and the financial activity log.
- **A GCash payment that lands after the switch** keeps the ride on cash. It is recorded (`ride_payment_after_cash_switch`) and escalated (`escalation.ride_payment_after_cash_switch`, financial) for a **manual refund**: refunds after a rider accepted stay blocked by the accepted-order policy.

**Return pages.**
- PayMongo's success and cancel ("Return to merchant") URLs carry `kind=ride` for rides, and the payment status includes `order_type`.
- The return page then goes back to the ride (`/tourist/transport/tracking/{id}`) with ride wording, instead of the food order page.
- The ride status payload adds `at_drop_off`, `ride_completed` and `payment_switched_to_cash`. The tourist's screen shows "You've arrived!" with the next payment step until the rider completes the ride, and rating opens only after completion.


## K. Ride hailing — Stage A: confirmed pickup arrival and the pickup waiting fee (owner decisions 2026-11-18)

**Arrival**
- Rides no longer arrive automatically from the GPS heartbeat (`RiderMapController::applyProximityAndGetStatus` skips rides). Food keeps the geofence arrival.
- The rider confirms **I've arrived** (`PATCH /rider/deliveries/{d}/status` `arrived_pickup`). `RideTimeChargeService::confirmPickupArrival` checks the location with `DropoffLocationProof` (now accepting a target point and radius):
  - within `tracking.arrival_radius_meters` (100 m) of the pickup;
  - by the rider's fresh saved fix (≤120 s), or by the phone's own fix (≤30 s old, at most ±200 m, plausible).
- On success it records `ride_time_events` `pickup_arrival_confirmed` at the server time, with who, the location source and accuracy, and the reason. It is also written to the ledger (`ride_time_event`).
- `event_key` `pickup_arrival:{delivery}` is unique, so a repeated confirmation keeps the first time.
- A refused confirmation changes nothing.

**Drop-off.** A ride's arrival at the destination is the rider's **I've Arrived**, not the heartbeat. This fixes the gap where a changed destination's final fare was skipped by the automatic heartbeat arrival while GCash had already opened at the old fare. Payment opens only after the rider's arrival, which applies the final fare and the charges.

**Waiting fee**
- When the trip starts (`picked_up`, "Passenger on board"), `startTrip` records `trip_started` and, if arrival was confirmed, the charge:
```
waiting_seconds = trip_started.occurred_at − pickup_arrival_confirmed.occurred_at      (integer seconds, ≥ 0)
fee             = floor(max(0, waiting_seconds − 180) / 180) × ₱2
```
- Stored as `ride_additional_charges` `pickup_waiting`, with:
  - its start and end events, duration, free seconds, unit and rate;
  - the method, the amount, and status `approved`;
  - unique `charge_key` `pickup_waiting:{delivery}`.
- A free wait is still recorded (amount 0).
- No confirmed arrival (for example a ride already at the pickup before this change) means no fee.
- A tourist cancelling while the rider waits pays nothing.

**Total and commission**
- `orders.subtotal` stays the ride fare: the booked quote, or a changed destination's final fare (the 115% cap applies to that fare only).
- `orders.total = subtotal + approved charges`.
- Commission is `max(₱20, 40% × total)` (the existing rule, on the total).
- `applyCharges` runs when a charge is recorded and again after a destination change's final fare is applied. It is idempotent and does nothing when the charged amount is 0.
- It records `ride_charges_applied` (subtotal, charges, total, commission).

**Downstream**
- The GCash checkout lists "Ride Fare" plus one line per charge, summing to the total.
- The cash due is the total, so the settlement and rider earning follow the commission.
- The tourist status adds `ride_fare`, `additional_charges`, `charges_total` and `pickup_waiting`; `fare` is the total payable. The rider map adds `pickup_waiting` and `additional_charges`.

**Integrity**
- `ride_charges` (FLAG): total = subtotal + recorded charges = live approved charges, and the commission recomputes.
- `ride_commission` follows `ride_charges_applied`.
- `ride_fare` and `ride_final_fare` still check the fare against the subtotal.

**Not in this stage:** tourist-requested stops; excess travel time (not built: it cannot be told apart from traffic).


## L. Ride hailing — Stage B: cancellation penalty assessment (owner decisions 2026-11-18)

**Rule**
- Only a **tourist** cancellation (`TransportationService::cancelRide`, both tourist endpoints) of a ride a rider had accepted creates a penalty.
- `seconds = cancelled_at − deliveries.assigned_at` (integer). `≤ 300` is free; `> 300` means ₱50 owed to `compensated_rider_id` = the rider who accepted, never anyone else.
- Rider cancellations (`cancelRideByDriver`), admin and safety cancellations, and dispatch failures never reach the assessment.
- One row per cancelled ride: `ride_cancellation_penalties.cancelled_order_id` is unique, and the row is created with `firstOrCreate`. Each is written to the ledger (`ride_cancellation_penalty_assessed`) and the financial activity log.
- It is assessed inside the cancel transaction, on the locked rows.
- The penalty never touches any order amount.

**GPS findings before choosing a rule (dev data, 2026-11-18)**
- `rider_locations` had 282 rows and **none with `accuracy_m`**: the arrival "nudge" posts were sent without accuracy, and are now fixed to send it.
- Gaps between saved rows while active: median 70 s, p90 326 s. A standing-still rider refreshes the latest row instead of adding one.
- 5 accepted rides, each "arriving" 0–13 s after acceptance (desk tests).
- With no accuracy values and no real approaches, no movement threshold can be calibrated, so none is invented.

**Evidence hierarchy → status**
1. *Recent GPS*: at least one saved fix since acceptance, and the latest within 180 s before the cancel.
2. *Arrival*: a server-confirmed pickup arrival (Stage A event).

**owed** only when both hold. Otherwise **under_review**, with reasons and the evidence recorded:
- fix count and how many fixes carry accuracy;
- first and latest fix time and distance to the pickup;
- the latest fix's age and accuracy;
- the arrival time.

Movement toward the pickup is recorded but not judged automatically until real accuracy and frequency data support a threshold.

**Dispute**
- `POST /tourist/transport/trip/{id}/penalty/dispute` (own ride only; reason 5–500 characters) moves `owed` or `under_review` to `disputed`.
- Locked and idempotent. Ledger `ride_cancellation_penalty_disputed` plus an activity log entry.
- Under-review and disputed penalties are not outstanding: they are never collected and never block a booking.
- `GET /tourist/transport/penalties` lists them, with `outstanding_total` (owed only).

**Waiting overlap:** cancelling while the rider waits owes no waiting fee (Stage A), but this penalty may still apply. The two charges are separate.

**Not yet:** collection (Stage C), rider compensation and cashout (Stage D), Tourism Office review, waiver and dashboard (Stage E). Until Stage C, an owed penalty is shown but not collected, and booking is not blocked.


## M. Ride hailing — Stage C: collecting an owed cancellation penalty (owner decisions 2026-11-18)

**Rule**
- Only an **owed** penalty is collected. Under review, disputed and waived penalties are never collected or shown to a driver, and online payment is refused (422).
- It is never added to any order's amounts.

**Two ways to collect**
- **Cash:** the passenger's next driver collects it at the drop-off and confirms it separately from the fare.
  - Endpoint: `POST /rider/deliveries/{delivery}/cancellation-fee/collect {penalty_id}`.
  - Allowed only for the assigned driver, on a ride, at `arrived_destination` / `delivered` / `completed`.
  - The delivery and the penalty are locked. A repeat by the same driver on the same ride is a no-op; collecting a fee paid another way is refused (409).
  - Recorded: `collected_by`, `collection_order_id`, `collection_delivery_id`.
- **Online:** its own PayMongo payment (GCash or QR Ph).
  - `create-intent` with `payable_type=ride_penalty`: the tourist's own penalty only (otherwise 404), one line "Cancellation fee (ride …)", reference `CXL-{id}`.
  - `markPayablePaid` → `collectOnline()` inside the webhook or verify transaction, recording `collection_payment_id`.
  - A payment landing after the fee was already collected (e.g. in cash) is **never applied twice**. It raises a `penalty_double_payment` system incident and an activity-log entry for a manual refund.

**Linking (lazy)**
- An owed penalty is offered on the tourist's current ride and recorded against that ride only when collected (`dueOnRide`).
- A ride that is cancelled or completed without collecting it leaves the penalty owed for the next one. No attach or detach state can go stale.

**Records:** status becomes `collected`, with `collected_at` and `collection_method` (cash | online). Ledger `ride_cancellation_penalty_collected` on the cancelled order, plus an activity-log entry (financial).

**Cash remittance**
- The rider's daily receipt gains `cancellation_fees` (count, total, items with `owed_to_rider_id`).
- It is its own line, handed in with the remittance. It is not the rider's earnings, and it is kept **out of** the COD remittance and reconciliation figures, which are unchanged.
- Folding it into the expected remittance is a later decision.

**Tourist is told**
- An in-app notification when the penalty is created: owed ("applies… pay online or your next driver collects it in cash") or under review ("may apply… nothing is charged until then").
- Another when it is paid.
- The cancel response carries the penalty and its `notice`, and the ride page shows it as an alert straight away.

**Not yet:** paying the compensated rider (Stage D); the Tourism Office review, waiver and dashboard (Stage E).

**Migration:** `2026_11_18_000004_add_collection_to_ride_cancellation_penalties` (columns + foreign keys; applied to dev by path).


## N. Audit — Ride cancellation debt, waiting fees and destination change policy (2026-11-18)

Read-only audit of the policy pasted on 2026-11-18, checked against the code, migrations and tests (not earlier notes). **No code was changed for this audit.**

### N.1 What exists, what conflicts, what is missing

| # | Requirement | Status in the code | Notes |
|---|---|---|---|
| 1 | ₱50 after > 300 s; free before acceptance, within and at exactly 300 s; none for rider cancels | **Built** (Stage B): `RideCancellationPenaltyService::assess`, called only from `TransportationService::cancelRide` (tourist) | `cancelRideByDriver` and dispatch failure never assess. |
| 1 | "Do not auto-mark ordinary qualifying cancellations `under_review`" | **Conflict** | `judge()` returns `owed` only with a confirmed pickup arrival **and** recent GPS; everything else is `under_review` (owner decision earlier on 2026-11-18). Dev data: 1 penalty, `under_review` (no rider GPS since acceptance). |
| 1 | No penalty for an authorized Tourism Office cancellation | **N/A today** | There is no admin/office ride-cancel endpoint, so nothing to exempt yet. Any future one must not call `assess`. |
| 2 | One unique ₱50 tourist debt with the original rider | **Built**: `ride_cancellation_penalties` (`cancelled_order_id` unique, `compensated_rider_id`) | |
| 2 | Rider compensation obligation; office advance; recovery; never paid twice | **Missing** (planned Stage D) | No compensation, advance or recovery records. Rider earnings (`rider_earnings` + `rider_earning_entries` ledger) and cashouts (`RiderPayout`, `CashoutValidator`) exist. A compensation earning on a **cancelled** order would fail the validator's `source` / `integrity` checks today, so it needs its own verified branch. |
| 3 | Debt collected on the next ride (cash by the replacement rider; online via PayMongo, webhook-verified, idempotent; separately identifiable; no commission for the collector) | **Built for rides** (Stage C) | Cash: `collectCash` (lock, repeat-safe). Online: its own PayMongo payment (`payable_type=ride_penalty`, ledger, double-payment → incident). Daily receipt line `cancellation_fees`, not an earning. |
| 3 | Same for **food orders**; shown before confirmation | **Missing** | `dueOnRide` is rides only; food checkout (`TouristFoodCart`, `FoodController`/`GroupOrderService`) shows nothing. COD food drop-off has no collect step. |
| 3 | Office records recovery of an advanced compensation | **Missing** (with item 2) | |
| 4 | Pickup waiting: 3 min free, ₱2 per completed 3 min, from server-confirmed arrival, only if the passenger boards, none on a cancel | **Built** (Stage A): `RideTimeChargeService::waitingFee = intdiv(max(0,s−180),180)×2`, unique `charge_key`, first arrival kept | Matches the formula. Tests: `RidePickupWaitingTest`, plus "no waiting fee on cancel" in `RideCancellationPenaltyTest`. |
| 5 | Mid-trip stop: ₱2 per started minute, rider start/end, independent, no overlap or duplicates | **Missing** | Can reuse `ride_time_events` (unique `event_key`) and `ride_additional_charges` (unique `charge_key`). |
| 6 | Destination change: keep the original, completed portion from verified distance, remaining from current location by road route, no double charge, history, one-time rule | **Mostly built** (`RideDestinationChangeService`, 2026-11-17) | Original and history kept (`ride_destination_changes`, ledger). Preview = verified km so far + road-route remaining km, × per km + base. One change per trip. |
| 6 | "Applicable elapsed travel time" in both portions | **Gap / question** | Fares have **no per-minute rate** (base + per km only). |
| 6 | Revised total fixed at confirmation vs final fare | **Differs** | Today the final fare is re-measured from verified GPS at the drop-off, capped at 115% of the confirmed estimate (approved 2026-11-17). |
| 6/7 | Never accept an unverified route | **Conflict** | `TransportationService::getRoute` falls back to a **straight line** when OSRM fails, and the destination-change preview accepts it (`route_source = straight_line`). |
| 7 | Motorcycle ≤ 50 km, car ≤ 100 km (traveled + remaining road route) | **Missing** | No distance limit anywhere (booking or change). Ride vehicles: motorcycle, tricycle, car, van. |
| 8 | Rider accepts or declines the change before it applies | **Conflict** | Today the change applies on the tourist's confirmation; the rider only acknowledges ("Got it"). |
| 9 | "Existing 18% system deduction" on ride earnings | **Conflict** | No 18% exists. A ride's rider earning is `rider_commission = max(₱20, 40% of fare)` (`TransportationService`, `RideDestinationChangeService::commission`, `RideTimeChargeService`); food riders earn the full delivery fee. |
| 9 | Separate records for every money component | **Partly** | Fare, changes, waiting charges, penalty, collection: yes (rows + ledger). Compensation, advance, recovery, stops: no. |

### N.2 Proposed stages (each: migration, tests, reviewable diff, stop for review)

1. **C2 — penalty status policy.**
   - Every qualifying tourist cancellation is `owed`; the evidence is still recorded for reference.
   - `under_review` only through a dispute (`disputed`) or office action.
   - Files: `RideCancellationPenaltyService::assess/judge`, `RideCancellationPenalty` (statuses), `RideCancellationPenaltyTest`, cancel-dialog text (`CancellationPenaltyCard::cancellationFeeNote`), audit §L/§N.
2. **D — rider compensation, advance and recovery.**
   - New tables: `ride_cancellation_compensations` (penalty unique, rider, amount, status, earning id) and `office_cash_advances` / `office_recoveries`, or one `penalty_financial_events` table with typed rows.
   - The compensation is a `rider_earnings` row (its own type, no deduction) posted to `rider_earning_entries`.
   - `RiderEarningVerifier` / `CashoutValidator` get a compensation branch (verified against the penalty, not the cancelled order's sale).
   - Collection (`collectCash` / `collectOnline`) records the recovery when the office had advanced.
   - Never paid twice: unique per penalty, with locks.
   - Files: migration, models, `RideCancellationPenaltyService`, `RiderEarningVerifier`, `CashoutValidator`, `TransactionIntegrityService` (cancelled-order exception), rider earnings UI label, tests.
3. **F — debt on food orders.**
   - Food checkout shows the debt separately.
   - Online: its own PayMongo payment (Stage C path) at checkout.
   - COD: the food rider collects it at the drop-off (generalise `dueOnRide` → `dueOnDelivery`, food drop-off UI).
   - The group-order model and COD settlement are untouched.
   - Files: `RideCancellationPenaltyService`, `RiderMapController`, `RiderCancellationFeeController`, `TouristFoodCart`, food rider drop-off components, tests.
4. **G — distance limits and verified routes only.**
   - Per-vehicle maximum (config), checked at booking and at destination change against traveled + remaining road-route km.
   - A straight-line fallback is refused for the change and the limit check.
   - Files: `config/transport.php` (or the fare settings), `RideVehicles`, `TransportationService` (booking), `RideDestinationChangeService::preview/confirm`, `BookTransportRequest`, frontend messages, tests.
5. **H — rider approval of a destination change.**
   - New statuses `pending_rider` → `confirmed` | `declined` | `expired`.
   - The trip destination and fare update only after the rider accepts; a decline keeps the original and notifies the tourist.
   - Files: migration (status / timestamps), `RideDestinationChangeService` (`confirm` → `request`, new `riderDecide`), routes, `RiderDestinationChangeBanner` (Accept / Decline with route and fare), tourist change page (waiting / declined state), tests.
6. **I — mid-trip stops.**
   - Rider start/end endpoints, one open stop at a time, ₱2 × started minutes, server time, its own charge per stop.
   - The tourist sees a running timer and the itemised amount.
   - Files: `RideTimeChargeService` (`startStop` / `endStop` / `stopFee`), `RiderDeliveryController` or a new controller, routes, `GlobalRiderAlert` / trip panel, `TouristTransportTracking`, receipts, tests.
7. **J — destination-change fare model** (only if the answers change it): a time component and/or fixing the final fare at confirmation.
8. **E — Tourism Office dashboard:** review, waive, dispute resolution, advance and recovery screens.

### N.3 Open policy questions (answers decide the stages above)

1. **Ride earnings:** the policy says "18% system deduction"; the code pays the rider `max(₱20, 40% of fare)`. Which is right? Changing it affects every ride's earning, commission and integrity checks.
2. **Penalty status:** may every qualifying tourist cancellation be `owed` (evidence kept, tourist can dispute, office can waive)? What should happen to the existing `under_review` penalty?
3. **Compensation timing:** credit the original rider ₱50 immediately when the penalty is created (the office advances it automatically and recovers it on collection), or only when the office presses "Advance", or only when collected?
4. **Online debt on the next booking:** keep it as its own PayMongo payment shown at checkout (current Stage C, keeps the order's amounts and settlement untouched), or combine it into the same checkout session? Should a booking be allowed while debt is unpaid?
5. **Mid-trip stops:** must the tourist request or confirm a stop in the app before the rider's timer counts (protects against invented stops)? Any maximum stop length?
6. **Destination change fare:** keep the approved model (final fare re-measured from GPS at the drop-off, capped at 115%), or fix the final fare at confirmation (completed portion + remaining estimate)? With no per-minute rate today, is a time component wanted? At what rate?
7. **Vehicle limits:** what are the limits for tricycle and van? Apply the limits at booking as well as on a change?
8. **Rider approval:** how long does the rider have to answer (e.g. 60 s, then it expires)? Does a declined or expired request use up the tourist's one change?


## O. Ride hailing — Stage C2: penalty status policy (owner decisions 2026-11-18)

**Verified against the code before editing**
- `assess()` is called only from `TransportationService::cancelRide`, which both tourist cancel endpoints use.
- It runs inside that method's `DB::transaction`, on the locked order and delivery rows.
- `cancelRideByDriver` and dispatch failure never call it, and there is no admin or office ride-cancel path.
- `cancelled_order_id` is UNIQUE; `firstOrCreate` plus the unique-violation catch keeps one penalty per ride.
- The ride earnings formula is unchanged: `max(₱20, 40% of fare)`. **No 18% deduction is introduced.**

**Rule now**
- A tourist cancellation more than 300 s after `assigned_at` creates a ₱50 penalty with status **`owed`**.
- 300 s or less (exactly 300 s included) is free, and so is cancelling before acceptance. Rider cancellations are exempt; there is no administrative or safety cancellation path to exempt yet.
- No GPS progress or arrival confirmation is required.
- `judge()` still records the evidence (fix count and ages, distances to the pickup, accuracy, confirmed arrival) for reference only. `review_reasons` is empty, and `RECENT_FIX_SECONDS` was removed.
- `under_review` is no longer assigned automatically. **The existing historical under-review penalty is kept as it is**, never charged or changed automatically (no migration, no backfill).

**Disputes:** unchanged. A tourist can dispute an `owed` (or historical `under_review`) penalty, which becomes `disputed`.

**Waiver (new)**
- `POST /admin/ride-penalties/{id}/waive {reason}` (Bansud Tourism Office only; reason 5–500 characters).
- Allowed from `owed`, `under_review` and `disputed`. A `collected` penalty can't be waived (a refund is separate). Repeat-safe.
- Records `resolved_at`, `resolved_by` and `resolution_note`.
- **Immutable audit:** ledger event `ride_cancellation_penalty_waived` (from, reason, admin, tourist, compensated rider) plus an activity-log entry (financial). The tourist is notified ("₱50.00 cancellation fee waived… Reason: …").
- `GET /admin/ride-penalties?status=` lists them with counts and the evidence. UI: Admin › Riders › **Cancellation fees**.

**References kept:** `tourist_id` and `compensated_rider_id` (the original accepting rider) never change.

**Not in this stage:** nothing is collected or paid automatically. Collection stays the manual Stage C paths (next driver confirms cash; tourist pays online). Rider compensation is Stage D.

**Review checks (2026-11-18, `RidePenaltyC2VerificationTest`, 6 tests). No code change was needed.**
1. **Boundary on the server clock:** 299 s and 300 s are free; 301 s owes ₱50 (`seconds_after_acceptance` 301, `acceptance_at` = `assigned_at`). Device-sent `cancelled_at`, `client_time` and `seconds` are ignored.
2. **Repeated or concurrent cancellation:**
   - `cancelRide` re-reads the order and delivery under `lockForUpdate` inside the transaction, so a second request gets 422.
   - Result: one `ride_cancelled` event, one penalty, one `…assessed` event and one notification.
   - Re-running `assess` on the same ride returns the existing row and records nothing.
   - The DB unique index backs this, covered by `RideCancellationPenaltyTest`.
3. **Waiver vs payment:**
   - `collectOnline` re-reads the penalty under a row lock inside the webhook transaction and applies a payment only to an `owed` penalty.
   - When the office waives after the tourist opened GCash / QR Ph, the PayMongo notice leaves the penalty `waived` (no collection, no "paid" notification). The payment is recorded as received and escalated once (`penalty_double_payment`, "…after it was waived: refund ₱50.00").
   - A repeated notice changes nothing; distinct duplicate notices for an owed fee collect it once.
4. **Authorization:** both routes run behind `CheckRole:bansud_tourism_office` (exact role match). A municipal admin (`tourism_office`), a business owner, a rider and a tourist get 403 on list and waive.

The race and boundary tests were checked by deliberately breaking the code (removing the status re-check, and making exactly 300 s owe): each made its test fail.

**Still manual:** browser (dialog, alert, fee card, waive screen), phone layout, and a PayMongo sandbox payment with GCash and QR Ph, including a real duplicate webhook.


## P. Ride hailing — Stage D design: original-rider compensation, receipts, advances and payouts (2026-11-18)

**Status: design only, awaiting the owner's go.** No code, migrations or commits. It builds on the read-only Stage D audit and the owner's revised workflow. The five decisions below follow the reviewer's recommended defaults (2026-11-18).

### P.1 Principles

1. **Ownership.** The compensation belongs to the rider who accepted the cancelled booking: `ride_cancellation_penalties.compensated_rider_id`, which never changes. The rider who later collects cash only hands it in: no ownership, no commission, no earning.
2. **Exactly once.** One compensation per penalty (DB unique). It is created only when the full penalty is **received** (online: PayMongo-verified; cash: staff-confirmed receipt), or earlier by an explicit, approved **advance**, whichever comes first. A later receipt never credits the rider again.
3. **Existing systems unchanged:**
   - `rider_earnings` / `rider_earning_entries`;
   - `CashoutValidator` and `RiderEarningVerifier`;
   - the ride earnings formula `max(₱20, 40% of fare)`;
   - `RiderCashFundService` / daily COD reconciliation;
   - food settlement and the canonical group-order model.

   Compensation never appears in `rider_earnings`, so it can't be counted twice.
4. **Everything auditable.** Every collection, receipt, compensation, advance, recovery, void, write-off, reservation and payment is an append-only ledger entry. It is also a tamper-evident `TransactionLedger` event on the cancelled ride (the integrity checks ignore unknown event types, as verified) and an activity-log entry.

### P.2 Decisions (recommended defaults, 2026-11-18)

| # | Decision | Rule |
|---|---|---|
| 1 | Linking payouts | One office action pays the earnings cashout and its linked compensation payout. Each part has its own validator; database state changes are atomic. |
| 2 | Cash receipt | A batch receipt per rider remittance, listing every penalty separately. A receipt number is required. Partial amounts are allocated per penalty. |
| 3 | Compensation-only payout | Allowed, with no extra minimum. |
| 4 | Refunded penalty payment | Same as a waiver: void if not yet paid to the rider (releasing any reservation); write-off if already paid. |
| 5 | Advance | Optional and exceptional. Needs a reason, an authorised staff member and an advance payment reference, plus a second staff approval when the amount reaches the existing two-person threshold (`config('payouts.two_person_threshold')`, default ₱5,000). |

### P.3 Data model

**`ride_cancellation_penalties`: add receipt fields**
- `received_amount` (decimal; the sum of allocations) and `received_at` (set only when the full amount is received).
- Online: set automatically from the verified PayMongo payment (`collection_payment_id` and the provider reference).
- Cash: set from staff-confirmed receipt allocations.

**`penalty_cash_receipts`:** one row per rider remittance.
- `receipt_number` (unique), `collecting_rider_id`, `received_amount`, `received_by`, `received_at`, `note`.

**`penalty_cash_receipt_allocations`:** one row per penalty in a receipt.
- `receipt_id`, `penalty_id`, `amount`.
- The sum of a receipt's allocations equals its `received_amount`, and a penalty's allocations can never exceed `penalty_amount`.

**`rider_cancellation_compensations`:** one per penalty (`penalty_id` UNIQUE).
- Links and amount: `rider_id` (= `compensated_rider_id`), `cancelled_order_id`, `amount` (= `penalty_amount`).
- `funding`: `collection` | `advance`.
- `status`: `payable` | `held` | `reserved` | `paid` | `voided` | `written_off`.
- Advance fields: `advance_reason`, `advanced_by`, `advance_approved_by`, `advance_reference`.
- Timestamps: `earned_at`, `recovered_at`, `voided_at`, `written_off_at`, plus `resolution_reason`.

**`rider_compensation_entries`:** append-only (DB triggers refuse UPDATE/DELETE, as in `rider_earning_entries`), with a UNIQUE `idempotency_key`.
- Columns: `compensation_id`, `rider_id`, `entry_type`, `bucket` (`earned` | `reserved` | `paid` | `office`), signed `amount`, `payout_id`, `actor_id`, `details`.
- Entry types: `compensation_earned`, `advance_granted`, `advance_recovered` (office bucket, rider balance unchanged), `voided`, `written_off`, `reserved`, `reservation_released`, `paid`.

**`rider_compensation_payouts`:**
- `rider_id`, nullable `rider_payout_id` (the paired earnings cashout), `amount`, `status` mirroring `RiderPayout`, the review / approval / paid columns and the GCash evidence.
- Pivot `rider_compensation_payout_items` with `compensation_id` UNIQUE among live payouts: one live payout per compensation.

**`rider_payout_statements`:** the office's single payout action.
- `rider_id`, `rider_payout_id` (nullable), `rider_compensation_payout_id` (nullable), `total_amount`, `transfer_reference`, `transferred_total`, `status`, two-person approval columns.

### P.4 Flows

**Online penalty payment.** `collectOnline()`, already locked and webhook-verified, also:
1. sets `received_amount` / `received_at` from the verified payment;
2. then calls `RideCompensationService::onReceived()` in the same transaction.

If no compensation exists, it creates one (`collection`, `payable`) with entry `compensation_earned` +₱50. If it was advanced, it records `advance_recovered` (office bucket) and **no** rider credit. Duplicate PayMongo notices are no-ops (payment status, the unique compensation row, idempotency keys).

**Cash penalty payment**
1. The collecting rider confirms the collection (Stage C). The penalty becomes **collected, waiting for office receipt**: no compensation yet, and it's listed on that rider's daily receipt as "cancellation fees to hand in".
2. When the rider remits, staff record one **receipt** (number required), and allocate amounts per penalty up to what was actually received.
3. A penalty is marked received only when its allocations reach the full `penalty_amount`. Only then does `onReceived()` run (compensation or advance recovery as above). If ₱100 of ₱150 is handed in, two penalties are received and one stays outstanding.

**Advance (exceptional)**
- Allowed only while the penalty is `owed` (not disputed, waived or collected) and no compensation exists.
- Needs the penalty reference, original rider, amount, reason, authorising staff and advance reference, plus a second approver when the threshold applies.
- Creates the compensation (`advance`, `payable`) with entry `advance_granted` +₱50. It is paid out in the rider's next payout like any payable compensation. It is recovered only by a later full receipt, and never credits the rider twice.

**Waiver** (penalty `owed`, `under_review` or `disputed`; a collected penalty is never waived)
- No compensation: nothing.
- Compensation `payable` or `held`: `voided` (−₱50).
- `reserved`: release the reservation, then void.
- `paid`: `written_off` (office record); the rider keeps it.

**Refund of a penalty payment.** Linked to the penalty and the actual refund reference; the same rules as a waiver. Never deducted from unrelated future earnings.

**Dispute** (only an `owed` penalty can be disputed)
- An advanced compensation that isn't yet reserved or paid becomes `held`, and is excluded from payouts until resolved.
- Ordinary penalties need no routine review. Historical `under_review` rows are unchanged and get no compensation.

### P.5 Payouts: one office action, two validated parts, atomic state

**Request.** One request, in one transaction:
1. The existing `RiderPayoutService::requestPayout` creates the earnings cashout, unchanged, when the rider has eligible earnings.
2. `CompensationPayoutService` reserves all `payable` compensation into a compensation payout (`reserved` entries).
3. A `rider_payout_statements` row links them, with `total_amount = earnings + compensation`.

A compensation-only request creates only the compensation part.

**Validation.** The earnings part passes the **existing `CashoutValidator`**, unchanged. The compensation part passes the new **`CompensationPayoutValidator`**, which checks per compensation:
- it is owned by the original rider of its penalty;
- funding `collection` has a received penalty, and funding `advance` has its recorded approvals;
- it is not `held`, `voided` or `written_off`;
- it is reserved in this payout only, and its ledger reservation equals its amount;
- the cancelled booking's ledger passes `verifyOrder`.

Any BLOCK on either part stops the whole statement.

**`PayoutStatementService` (orchestration, no asynchronous listeners for money)**
- **Approve:** validates both parts, then calls the existing `approve()` and the compensation approve inside **one DB transaction**. If either throws, nothing changes. The two-person threshold is applied to the **statement total**.
- **Mark paid:** one manual GCash transfer with one reference.
  - Staff enter `transferred_total`, which must equal the statement total.
  - The existing `markPaid()` is called with the earnings part's own amount and the shared reference; its "amount equals approved amount" rule is unchanged.
  - The compensation part is marked paid with its amount and the same reference.
  - All of this happens in one transaction; any failure rolls both back.
- **Reject / failed transfer:** calls the existing `reject()` / `markFailed()` and releases every compensation reservation (`reservation_released`), so the compensation can be requested again.
- **Repeats:** state checks under row locks plus idempotency keys make a repeated approve or paid click a no-op. Compensation can never be paid twice.

**External money.** Payouts are manual GCash transfers (no disbursement API, so no payout callbacks). A transfer that didn't go through is recorded with **Mark failed**, which rolls the statement back to the rider's balance. The only provider callbacks are the PayMongo penalty payments, handled idempotently in P.4.

### P.6 Statements and screens

**Earnings statement** (`RiderStatementService`, read-only, from both ledgers). Lines:
- normal ride earnings;
- normal delivery earnings;
- cancellation compensation (each with its original booking reference);
- other adjustments;
- total payable;
- previously paid;
- remaining balance.

Cash-ride or COD earnings the rider kept are shown separately, as today.

**Rider:** read-only compensation history (original booking reference, amount, collection status, payable / paid / voided / written off) and the statement.

**Tourism Office**
- Cancellation fees page: tourist, original rider, booking reference, penalty collection status (online reference; cash: collecting rider, receipt number and allocations), compensation, **Record cash receipt** (batch) and **Advance** (exceptional, with approval).
- Rider statement page: the full statement, both ledgers, receipts.
- Payout review: the earnings part (existing checks), the compensation part (new checks), the statement total, the transfer reference and the confirmation.

### P.7 Transaction examples (₱50 penalty; Rider A accepted the cancelled booking)

1. **Online.** QR Ph paid, then PayMongo-verified:
   - the penalty is received;
   - A earns **+₱50 compensation**;
   - A's payout contains earnings ₱X + compensation ₱50, verified, and paid in one GCash transfer of ₱X+50.
   - A duplicate notice does nothing.
2. **Cash.** Rider B collects ₱50:
   - the penalty waits for office receipt, and B earns nothing;
   - B remits; staff record receipt R-1001 with an allocation of ₱50;
   - the penalty is received; A earns **+₱50**.
3. **Partial batch.** B collected 3 × ₱50 and remits ₱100 (receipt R-1002): two penalties are received (A1 and A2 each **+₱50**), and the third stays outstanding.
4. **Advance.** The office advances ₱50 to A (reason + approver):
   - A is paid it in the next payout;
   - the tourist pays later and it is received: **advance recovered**, and A **+₱0**.
5. **Waiver or refund after an advance.**
   - Not yet paid out: voided.
   - Reserved: released, then voided.
   - Paid out: written off, and A keeps it.
6. **Failed transfer.** Both parts are rolled back to the rider's balance; compensation is requestable again.

### P.8 Files (when approved)

- **New migration:** penalty receipt fields; the receipts, allocations, compensations, compensation entries (with triggers), compensation payouts (with items) and payout statements tables.
- **New models** for those tables.
- **New services:** `RideCompensationService`, `RideCompensationLedger`, `PenaltyCashReceiptService`, `CompensationPayoutService`, `CompensationPayoutValidator`, `PayoutStatementService`, `RiderStatementService`.
- **Small hooks**
  - `RideCancellationPenaltyService`: cash collection now waits for office receipt; `collectOnline` → `onReceived`; waiver void / write-off; dispute hold.
  - The rider cashout request goes through `PayoutStatementService`.
  - The admin payout actions go through it too.
  - `RiderCashFundService` daily receipt: Stage C's existing `cancellation_fees` line, unchanged.
- **Controllers / routes:** admin receipts, advance, statement and payout actions; rider statement and compensation history.
- **Frontend:** admin Cancellation fees (receipt, advance), admin rider statement and payout review, rider statement and compensation history.
- **Tests:**
  - exactly once;
  - duplicate notices;
  - waiver / dispute / refund races;
  - partial batch receipts;
  - advance approval and the threshold;
  - atomic approve / paid / reject / failed with one part failing;
  - double-click safety;
  - statement totals;
  - integrity / verifyOrder;
  - the existing earnings and cashout suites unchanged.
- **Docs:** this section, plus PROGRESS.


### P.9 Stage D1 — built (2026-11-18): compensation core

**Built:** P.3 tables except the payout tables (D2), P.4 flows, the admin endpoints, and tests. Not built yet: payouts and the statement (D2), screens (D3).

**Schema** — migration `2026_11_18_000005_create_ride_compensation_tables`, applied to dev by path:
- penalty fields `received_amount`, `received_at`, `received_by`, `refunded_at`, `refund_reference`;
- `penalty_cash_receipts` (unique `receipt_number`) and `penalty_cash_receipt_allocations` (unique receipt + penalty);
- `rider_cancellation_compensations` (unique `penalty_id`);
- `rider_compensation_entries` (append-only via triggers on SQLite and MySQL/MariaDB; unique `idempotency_key`).

**Services**
- `RideCompensationLedger`: keyed, repeat-safe writes; per-compensation and per-rider balances.
- `RideCompensationService`:
  - `onReceived`: create once, or recover an advance. A still-pending advance becomes collection-funded and is credited once.
  - `advance`: owed penalties only, with a reason and reference. Credited at once below the threshold; at or above it, `pending_approval` until a different signed-in staff member calls `approveAdvance`, the same two-person rule as payouts.
  - `onWaived` / `onRefunded`: void while unpaid, releasing any reservation first; write off once paid (office bucket, the rider keeps it). A never-credited pending advance is voided without a ledger reversal.
  - `onDisputed`: hold a payable advance.
- `PenaltyCashReceiptService`: batch receipt per rider remittance.
  - Each line must be a fee **this** rider collected in cash; lines must add up; never more than outstanding; locks taken in fixed order.
  - A penalty counts as received only at its full amount, and only then does compensation run.

**Hooks**
- `collectOnline` marks the penalty received (PayMongo-verified) and runs `onReceived`.
- `waive` runs `onWaived` and refuses `refunded` as well as `collected`.
- `dispute` runs `onDisputed`.
- New `recordRefund(reference, reason)` (status `refunded`) runs `onRefunded`.
- Cash collection by a later rider is unchanged; it now waits for the office's receipt before any compensation.

**Endpoints** (all `CheckRole:bansud_tourism_office`):
- `GET /admin/ride-penalties/cash-to-receive`
- `POST /admin/ride-penalties/cash-receipts`
- `POST /admin/ride-penalties/{id}/advance`
- `POST /admin/ride-compensations/{id}/approve-advance`
- `POST /admin/ride-penalties/{id}/refund`

`GET /admin/ride-penalties` gains the receipt, refund and compensation fields and `can_advance` / `can_refund`.

**Unchanged:** `rider_earnings`, `rider_earning_entries`, `CashoutValidator`, `RiderEarningVerifier`, `RiderPayoutService`, the ride earnings formula, `RiderCashFundService`, food settlement and group orders.

**Tests:** `RideCompensationTest` (14) covers:
- online exactly once with duplicate notices, owned by the original rider, `rider_earnings` untouched;
- cash only after the office receipt and never the collector's (wrong rider, sums, over-allocation and duplicate receipt refused);
- partial remittances allocated per fee;
- advance recovered online and by cash receipt, never credited twice;
- the two-person advance;
- paying before a pending advance is approved;
- waiver void and write-off;
- refund void and write-off;
- dispute hold;
- the append-only ledger;
- the integrity verdict unchanged;
- Bansud office only;
- historical under-review penalties get no compensation.

Two rules were checked by deliberately breaking the code (partial cash counted as full; an advance not recovered): each made its tests fail.


### P.10 Stage D2 — built (2026-11-18): payouts and the earnings statement

**Schema** — migration `2026_11_18_000006_create_rider_compensation_payouts`, applied to dev by path:
- `rider_compensation_payouts`:
  - linked to the existing cashout by a unique nullable `rider_payout_id`;
  - `active_key` unique: one live compensation payout per rider;
  - review, approval, paid (including `transferred_total`) and failure columns.
- `rider_compensation_payout_items`: `live_key` unique, so a compensation is in one live payout only.
- These two tables replace the planned `rider_payout_statements`: the link column ties the two parts together.

**`CompensationPayoutValidator`**, its own validator; `CashoutValidator` is unchanged. Per compensation it checks:
- **owner:** the payout's rider is the cancelled booking's original rider;
- **funded:** the penalty was fully received and not refunded, or the advance was approved;
- **standing:** reserved (or paid), not held, voided or written off, and the penalty not disputed;
- **single:** in no other payout;
- **ledger:** the entitlement and this payout's reservation equal the amount;
- **integrity:** the cancelled booking's history does not BLOCK.

Per payout it checks that the amount equals the sum of its items. Any failure blocks.

**`PayoutStatementService`** (one office action, atomic):
- **Without compensation**, every action calls the existing `RiderPayoutService` directly, so behaviour is identical, including the stored record of a refused validation.
- **With linked compensation**, both parts run in ONE transaction; the existing service's own transactions nest as savepoints.
  - Approve checks the compensation part first, then calls the existing `approve`.
  - If the existing earnings check refuses, its validation record (rolled back with the transaction) is stored again afterwards, so the audit trail matches the earnings-only behaviour.
- **Request.** With payable compensation, the existing `requestPayout` runs when the rider has eligible earnings. Then every payable compensation is reserved into a compensation payout linked to it, or a standalone one for a compensation-only request with no minimum.
- **Mark paid.** Staff enter the **transferred total**, which must equal earnings + compensation.
  - The two-person rule applies to that total.
  - The GCash reference must be unused on any earnings or compensation payout.
  - The existing `markPaid` records the earnings share under its own unchanged amount rule; the compensation part records its share, the transferred total and the same reference.
  - A repeated click is refused by the existing state check and never pays compensation twice.
- **Reject / failed / cancel** release every still-reserved compensation (back to payable, or held if disputed). Voided compensation stays voided and is released only once.
- **Compensation-only** payouts have their own actions (review, approve, reject, paid, failed, rider cancel). A compensation linked to a cashout refuses them: "use that cashout".

**`RiderStatementService`**, read-only from both ledgers:
- lines for ride earnings, delivery earnings, cancellation compensation and adjustments;
- cash kept (COD) separately;
- total earned, total payable now (earnings / compensation), previously paid (earnings / compensation), remaining balance;
- each compensation with its booking reference, funding, status, penalty status and paid amount.

**Endpoints**
- Rider: `GET /rider/earnings-statement` (`/earnings/statement` would be captured by the earlier `/earnings/{delivery}` route), `GET /rider/compensation-payouts`, `POST /rider/compensation-payouts/{id}/cancel`.
- Admin (Bansud office): `GET /admin/compensation-payouts` and `/{id}`, plus `start-review`, `approve`, `reject`, `mark-paid` (password, proof) and `mark-failed`; `GET /admin/riders/{rider}/statement`.
- The existing rider request / cancel and admin start-review / approve / reject / mark-paid / mark-failed now go through `PayoutStatementService`. The admin cashout detail gains `compensation_payout` (with validation) and `transfer_total`.

**Unchanged** (no diff since the last commit): `RiderPayoutService`, `CashoutValidator`, `RiderEarningVerifier`, `RiderEarningLedger`, the ride earnings formula, the COD cash fund, food settlement and group orders.

**Tests:** `PayoutStatementTest` (10):
- one request, one approval and one transfer pay both (wrong total refused; same reference; a repeat never pays twice; validation trail `request`, `approve`, `pay`);
- the compensation part refused (refunded meanwhile) means nothing is approved;
- the earnings part refused (tampered) means nothing is approved and the refusal is recorded;
- reject, failed and cancel release the compensation, which can be requested again (net reserved 0);
- the two-person rule on the combined total;
- a compensation-only payout (wrong amount refused, repeat-safe, no earnings cashout);
- a linked compensation only through its cashout;
- a waiver during a payout voids it, blocks payment and releases once;
- one live request per rider, and never in two payouts;
- the statement lines, paid amounts and remaining balance (rider and office; a rider can't read the office endpoint).

All existing payout, cashout and validation suites pass unchanged. Two rules were checked by deliberately breaking the code (skipping the compensation check before approval; dropping the transfer-total rule): each made its test fail.

## Q. Cancellation fee added to the next ride or food order payment (owner decisions 2026-11-23)

**Decisions.**
- A qualifying tourist cancellation is **owed** right away. There is no Tourism Office review and no tourist dispute; the office can still waive.
- An owed fee is added **automatically to the tourist's next payment**, whichever comes first: a ride or a food order.
- **Cash** (ride, or COD food): the driver or rider collects the fee with the fare or order. It is **not their earning**; they hand it in with their cash remittance.
- The fee belongs to the rider who **accepted the cancelled booking**. It is recorded in their earnings statement as a compensation (Stage D) and paid to them with their earnings.

**What changed.**
- **Status.** `RideCancellationPenaltyService::oweReviewed` turns any `under_review` / `disputed` penalty into `owed`. Each change is recorded in the ledger (`ride_cancellation_penalty_now_owed`) and the activity log, and a held compensation is released to `payable` (`RideCompensationService::onOwedAgain`). It runs once from migration `2026_11_23_000001` and is repeat-safe.
- **Dispute removed:** `POST /tourist/transport/trip/{id}/penalty/dispute`, `dispute()`, `onDisputed()`, and the tourist dispute form. `can_dispute` is always false.
- **Online.** `create-intent` for an `order` (ride or food) or a `group_order` adds one line per owed fee ("Cancellation fee (ride …)") to the **same PayMongo checkout**, recorded in `payment_penalty_items` (payment, penalty, amount; unique per pair).
  - On confirmation, `markPayablePaid` calls `applyOnlinePayment`: each fee is collected through `collectOnline`, once. A fee already paid in cash raises the existing `penalty_double_payment` incident for a manual refund.
  - The order's `paid_amount` is the payment **minus the fee portion**.
  - `PaymentRefundProcessor::refundTotals` excludes the fee portion, so refunding a food order never refunds a fee that was owed and paid.
- **Cash.** `dueOnDelivery` (rides and food) feeds the rider app's `cancellation_fee_due`. `collectCash` accepts a food delivery at the customer's door (`in_transit` onwards) as well as a ride at the destination.
  - The fee stays out of the COD payment records, so COD reconciliation (`RiderCashFundService`) is untouched. It appears on the collecting rider's daily receipt under `cancellation_fees`.
  - Compensation for the accepting rider starts when the office confirms the cash was received (unchanged Stage D rule).
- **Never collected:** a pickup food order paid in cash has no rider, so the fee stays owed for the next payment. The cart says so.
- **Tourist screens.**
  - Book a ride: a fee line, "Total to pay", and a Book button that includes the fee.
  - Food cart: fee line, Total Due and the pay buttons include it.
  - The banner and notifications say the fee is added to the next ride or food order payment.

**Tests.**
- `CancellationFeeNextPaymentTest`:
  - online ride: fee line, collected once, ride `paid_amount` = fare, compensation for the accepting rider;
  - food online: fee line, refund limit excludes it;
  - COD food: rider collects at the door, and it is not their compensation;
  - nothing owed: no line.
- Updated: penalty status (no dispute, `oweReviewed`), compensation release, waiver.
- Frontend: breakdown lines and total; banner and card copy.
- Full suites: Laravel 1,367 passed (2 skipped); Vitest 922 passed.

## R. Tourism Office earnings and commission specification (owner decisions 2026-11-23)

**Status:** specification agreed; build not started. Four stages, each reviewed before the next starts.

### R1. Commission rules

| Source | Rule | ₱ example |
|---|---|---|
| Food order (cash **and** GCash) | Tourist pays food + system fee (10% of food) on top. Split 80/20 on (food + fee): restaurant 80%, office 20%. Rider keeps the full delivery fee (§financial decision 2). | ₱100 food + ₱10 fee → restaurant ₱88, office ₱22 |
| Passenger ride | Driver earns max(₱20, 40% of fare); office gets the exact remainder (never a flat 60%). Waiting fees follow the same rule on the total. | ₱200 → driver ₱80, office ₱120; ₱50 → driver ₱20, office ₱30 |
| Fast Delivery | Becomes a fee (was a 100% rider tip): TrackTour 10%, rider 30%, office 60%. Tourist still chooses the amount (₱20–₱100); the available amounts are configurable by Bansud. The rider sees the exact peso amount of their 30% before accepting. | ₱50 → TrackTour ₱5, rider ₱15, office ₱30 |
| Rider online cash-out | Configurable fee, default 2% of the withdrawal, credited to the rider's municipality office. | ₱1,000 → fee ₱20 |
| TrackTour platform | Configurable, default 10% of each municipality's **net** earnings per period = office commissions − that office's recorded expenses. Never on gross sales; nothing when net ≤ 0. The office's 60% Fast Delivery share is **excluded** from this base (TrackTour already took its 10% of that fee). | — |
| Cancellation fee | 100% to the driver who accepted the cancelled booking (§Q). Never office income. | — |

Not revenue: rider earnings, restaurant payables, COD purchasing cash, rider cash advances / cash funds.

### R2. Attribution and authority

- Food → the restaurant's municipality; ride → the driver's municipality. The municipality is stored on the earnings record when the transaction completes and is never recomputed.
- Rates: Bansud sets district defaults, the TrackTour % and the Fast Delivery amounts. Each municipal office may override its own town's ride / food / Fast Delivery / cash-out rates. Food uses the restaurant's town rates; rides use the driver's town rates. Every ride and order keeps the rates it was booked with.
- Visibility: Bansud sees every municipality, the district total and every town's rates; a municipal office sees only its own.

### R3. Audit finding — cash rides (2026-11-23)

A cash ride is settled by `NearestRiderService` (cash payment + `cash_settled_at`), but `CodSettlementService::recordAllocations()` returns no allocation for `order_type = transport`. `RiderCashFundService::buildDailyReceipt()` then **excludes** the ride ("A completed order has no COD settlement allocation."). Result: the office's share of a cash ride fare is never recorded as owed and never appears in the rider's remittance. Required fix (stage 2): record the office share as an amount owed by the driver at completion, include it in the daily remittance, and recognise it as collected only when the remittance is verified.

### R4. Stages and guard rails

1. Rate settings (defaults, town overrides, snapshot on booking).
2. Calculation changes: GCash 80/20, Fast Delivery split, cash-out fee, cash-ride office share owed + remitted. Only for transactions created after release.
3. Earnings records: one record per completed, payment-verified transaction; refunds add a reversing entry; period TrackTour calculation; back-fill of history as read-only records.
4. Earnings page (mockup design) for Bansud and municipal offices; dashboard moves to the new records so rides count.

Guard rails: no edits to completed transactions; the rider earnings formula changes only where §R1 says so; PayMongo settlement changes are tested before release; cash advances and rider funds are never revenue; every entry goes to the tamper-evident ledger.

### R5. Stage 1 — rate settings (built 2026-11-24)

- `CommissionRateSettings`: rates in `tourism_settings` as `commission.<field>`. District defaults have `municipality_id` NULL; a town's own values have its id. Fallback per field: town → district → built-in (today's rules; the food rates follow `delivery.system_fee_percentage` / `delivery.cod_platform_fee_percent`).
  - Town fields: `ride_driver_percent` 40, `ride_driver_minimum` ₱20, `food_system_fee_percent` 10, `food_office_percent` 20, `fast_platform/rider/office_percent` 10/30/60, `cashout_fee_percent` 2.
  - District-only fields: `platform_net_percent` 10, `fast_amount_minimum` ₱20, `fast_amount_maximum` ₱100, `fast_amount_options` [25, 50, 100].
  - Rules: percentages 0–100; the Fast Delivery split must total 100% for the district and for every town after merging; Fast Delivery amounts sit inside min–max. Every change is written to the activity log with old → new values.
- Authority: Bansud (`/admin/commission-rates`) edits the district defaults and Bansud's own rates, and views every town. Editing another town's rates returns 403. A municipal office (`/municipal/commission-rates`) edits only its own town; district-only fields are ignored. Other towns are never returned to it.
- Snapshots: `commission_rate_snapshots` (write-once; update throws), plus ledger event `commission_rates_captured`.
  - Food: at checkout, one row per restaurant town (single and group checkout).
  - Rides: when a driver accepts (`applyAcceptedAssignment`, the shared accept path), with the driver's town.
- **No amount changes in Stage 1.** Fares, fees, settlements and earnings still use the existing formulas. Both pages say so.
- UI: Bansud → Financial management → Commission Rates (district defaults, Bansud's own rates, table of every town). Municipal → Finance → Commission Rates. Each card shows a worked peso example.
- Tests: `CommissionRateSettingsTest` (11) and `RideHailingAcceptanceTest::test_an_accepted_ride_keeps_the_drivers_town_commission_rates`; `tests/ui/commission-rates.test.tsx` (7).

### R6. Stage 1 follow-up: limits, snapshot protection, ride cap (built 2026-11-24)

Decided by the product owner after the Stage 1 review. Stage 2 waits until this is reviewed.

- **Limits for municipalities.** Bansud sets a lowest and highest value for every town rate (`commission.limits`, district row, JSON). Bansud saves them with the district defaults, and leaving them out of a save keeps the limits in force. Starting limits:

  | Rate | Default | Lowest | Highest |
  | --- | --- | --- | --- |
  | Driver share (`ride_driver_percent`) | 40% | 30% | 70% |
  | Driver minimum (`ride_driver_minimum`) | ₱20 | ₱10 | ₱50 |
  | Food system fee (`food_system_fee_percent`) | 10% | 0% | 20% |
  | Cash-out fee (`cashout_fee_percent`) | 2% | 0% | 5% |
  | Office food share; Fast Delivery shares | 20%; 10 / 30 / 60% | 0% | 100% (until Bansud narrows them) |

  - Checks: lowest ≤ highest; each district default sits inside its limit; a town's own value (and Bansud's own) must sit inside its limit, or the save is refused with the allowed range.
  - Narrowing a limit while a town's saved value is outside it is refused, and the message names the town. Bansud cannot change another town's rates, so that town's office changes its value first.
  - Fast Delivery: the split still totals exactly 100%, each share stays inside its limit, and the amounts stay inside the district range.
  - Limit changes are written to the activity log (`<field> limit: old → new`).
  - UI: the Bansud page has a "Limits for municipalities" table. Every town-rate field on both pages shows "Allowed …" and turns red when the value is outside the range.
- **Snapshots cannot be deleted.** The model refuses `delete()` as well as updates. The foreign keys are now `RESTRICT`, for both `order_id` and `municipality_id`, so the database refuses a hard delete of an order or town that has snapshots. Orders, businesses and municipalities are only soft-deleted by the app, so no app flow is affected. Database triggers were not added because Railway's MySQL may refuse to create them without SUPER, and tests run on SQLite. The migration was edited in place: it had never been deployed.
- **Ride cap.** Driver share = min(fare, max(₱20, 40% × fare)), so the office share is never negative. A single rule (`RideDestinationChangeService::commission`) is now used at booking, destination change, time charges and the integrity check. With the current fares (base ₱50 or more) no amount changes. `commission_rule` texts now read "…, at most the fare".
- **Kept:** a ledger failure while recording the rates stops the checkout or acceptance. An order never proceeds without its rate snapshot and audit record.
- **Recorded for Stage 2** (product owner, 2026-11-24):
  - Two-town group order: the first restaurant's town receives the office's 60% of the Fast Delivery fee, and its rates set the split.
  - The food system fee is calculated per restaurant with that restaurant's town rate, then 80/20 on each restaurant's (food + fee). Checkout preview, payment request, payout and ledger use the same calculation.
  - The TrackTour net percentage is locked at the start of each accounting period. A mid-period change applies from the next period. TrackTour share = max(0, net) × period rate.
- Tests: `CommissionRateSettingsTest` (17, +6, and the food test now also checks deletes) and `tests/ui/commission-rates.test.tsx` (9, +2).

## S. Dish sales: discounted item prices at checkout (owner decisions 2026-11-24)

**Decisions.**
- An owner (or Menu & Promotions staff) puts chosen dishes on sale: a % off (below 100%) or a ₱ amount off, for a period of Manila days.
- **The business pays for the discount.** The sale price is simply that order's unit price. The 10% system fee and the restaurant's share are worked out on the discounted food total. Delivery fees, the rider's delivery earning and tips are unchanged.
- Label promotions (badges such as "20% OFF" shown on a business) stay as they were and never change a price.

**What changed.**
- **One price calculation.** `App\Services\SalePricing` is the only code that works out a sale price. The tourist menus, the cart price refresh (`POST /tourist/food/availability` with `offering_ids`), both checkouts (`FoodController::orderFlat`, `GroupOrderService::createGroup`) and the final locked recheck all use it. Prices sent by the browser are never charged.
- **Price the tourist saw.** Each checkout line may carry `expected_unit_price`, the price the cart showed. It is only compared: if it differs from the server's price the checkout is refused (422, "The price of X changed to ₱Y…") and no order is created. Variation lines do not send it; their charged price is unchanged by this work (see risks).
- **Concurrency.** `CheckoutAvailabilityGuard` (inside the order transaction, rows locked in id order) re-quotes every locked dish and requires the same unit price **and** the same sale (`promotion_id`). Saving, ending or archiving a sale (`BusinessOwnerSaleController`) first locks the same dish rows in the same order, so a sale change either commits before a checkout's recheck (the checkout fails with "price changed") or waits until the order exists. A sale that starts or ends between the cart and the recheck likewise fails the checkout.
- **Never twice.** A dish is in at most one sale at a time. Overlapping periods are refused under the dish locks, so two concurrent saves cannot both pass. The discount lives only in `order_items.unit_price`; `orders.discount` / `group_checkouts.discount` stay 0 for dish sales.
- **Never free.** Saving a sale refuses any dish whose sale price would be ₱0 or less. A menu price change that would do the same to a running or upcoming sale is refused (`Offering::saving`, which covers every menu edit path). `SalePricing` also ignores a sale whose price would be under ₱0.01.
- **History.** `order_items` gained `original_unit_price` (menu price before the sale), `promotion_id` (nullOnDelete) and `sale_label` ("25% off · Weekend Sale"). Refunds, item cancellations, COD settlement, payouts and reports keep reading `unit_price` / `subtotal`, so they use the price actually charged. Ending or archiving a sale changes no existing order.
- **Old endpoints.** The label-promotion endpoints neither list nor change dish sales (422). An archived dish sale cannot be restored from the Archive (422), because restoring would skip the checks.
- **Dates.** A date without a time is a Manila day (start 00:00, end 23:59:59). A start earlier than now becomes now, so orders already placed are never presented as sale orders.

**Migration.** `2026_11_27_000001_add_item_sales_to_promotions`: `promotions.kind` (`label` default | `item_sale`), the `promotion_offering` pivot, and the three `order_items` columns. It adds columns only, and existing rows become `label`.

**Tests.** `DishSalesTest` (8):
- shown and charged price, system fee on the discounted total, order-item snapshot kept after archiving;
- group checkout;
- a cart price that is no longer current is refused;
- the locked recheck refuses a sale that started or ended mid-checkout;
- server validation;
- no overlapping sales;
- a menu price change cannot make a sale free, and the old endpoints cannot touch sales;
- owner and Menu & Promotions staff only.

Frontend: `tests/ui/promotions-sales.test.tsx` (5).

**Remaining risks.**
- **Pre-existing:** dish variations are shown at the variation's price but both checkouts charge the dish's base price (now the sale price while a sale runs). This work did not change that.
- The Food page's price sort uses the menu price, not the sale price.
