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
