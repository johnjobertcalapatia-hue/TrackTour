# P11 Recon / Operations Audit

> Scope: **audit only** (read-only). No production or schema changes were made.
> Baseline to preserve: **248 tests / 1,035 assertions / 0 failures / 2 skipped**.
> Purpose: document per-workflow current implementation, gaps, severity, affected
> files/routes, existing test coverage, and proposed P11 scope, so that P11 work
> can be selected from evidence rather than assumption.

Status legend per finding: **[HIGH]** / **[MED]** / **[LOW]**.

---

## 0. The operations contract being audited

Target flow (per product owner, corrected):

> tourist places order → restaurant order(s) created → **dispatch rider** →
> **rider accepts** → restaurant is authorized to **prepare** → prepare →
> ready → rider goes to restaurant → pickup → navigate → arrived → delivered/completed

Two invariants this audit was asked to verify in code:

1. **Rider acceptance gates restaurant preparation** (no cooking until a rider is assigned).
2. Multi-restaurant orders: each restaurant gets its own dispatched rider (verified: delivery created per sub-order, `RestaurantSubOrderItemsLifecycleTest`).

Every transition was checked for (a) DB state, (b) authorization, (c) realtime behavior, (d) failure/retry.

---

## 1. Order creation & payment gate

**Current implementation:**
- Non-cash order starts `pending_payment`; payment confirmation flips it to `waiting_restaurant` and sets `acceptance_deadline` (~10 min). Cash orders start `waiting_restaurant` directly.
  - `app/Services/GroupOrderService.php:165`, `app/Http/Controllers/Api/PaymentController.php` (comment ~L615: "Delivery is created ONLY when the restaurant accepts").
- (a) DB: `orders.status`, `payment_status='pending_payment'|'waiting_restaurant'`.
- (b) Auth: customer-owned order; payment routes public (`routes/api.php:91-95`), CSRF-excluded (`bootstrap/app.php:36-39`).
- (c) Realtime: `OrderStatusChanged` → `SendOrderStatusNotification` is registered but only ever dispatched by the two auto-cancel schedulers. Placement produces **no** realtime notification.
- (d) Failure: `AutoRejectWaitingOrder` (everyMinute, 10-min) auto-rejects/refunds unreplied orders (`app/Console/Commands/AutoRejectWaitingOrder.php:118`).

**Gaps:**
- **[MED]** `OrderCreated` event / `SendOrderCreatedNotifications` listener are registered (`app/Providers/EventServiceProvider.php`) but **never dispatched** — business "New Order Received" DB/realtime notification never fires.
- **[MED]** Payment webhook idempotency = single `status === 'paid'` short-circuit (TOCTOU vs concurrent `checkAndConfirm`/`paymongoReturn`); `payments` table has no unique constraint on `(payable_type, payable_id)` or `provider_payment_id` → duplicate pending Payments / duplicate PayMongo sessions possible. — **RESOLVED in P11.4**: webhook handling is now exactly-once (see §5/PROGRESS P11.4); `payments` gained UNIQUE `provider_payment_id`/`provider_source_id` (provider intents/sessions are globally unique, so a provider retry can never alias a second payment row; multiple NULLs — COD/local rows — never collide). A UNIQUE `(payable_type, payable_id)` was intentionally **not** added because multiple `pending` payment attempts per payable are legitimate retries by design; the one-authoritative-paid rule is enforced at the transition: `markPayablePaid`'s authoritative-once guard + `Payment::canApplyProviderVerdict` under a row-lock.

**Coverage:** `PaymentApiTest.php` (hooks/callbacks for Order & Booking, idempotent webhook at :734-767). **No `group_order` payment coverage**, no `system_fee_total` collection test.

---

## 2. Restaurant acceptance

**Current implementation:** `BusinessOwnerOrderController::acceptOrder` (L100) → order `preparing`, items `preparing`, `accepted_at`, `preparation_started_at`, `predicted_ready_at`; payment `authorized`→`paid` (L136-142); then `SmartDispatchService::scheduleDispatch` (L151).
- (a) DB: order+items `preparing`, delivery row with `dispatch_status='scheduled'`.
- (b) Auth: owner check only (`order->business->owner_id !== user()->id`, L102) + state guard (`status !== 'waiting_restaurant'`, L106). **No rider check.**
- (c) Realtime: `OrderStatusChanged` **not** dispatched here (accepted/preparing stages invisible to DB notifications / realtime).
- (d) Failure: dispatch wrapped in try/catch + `Log::warning` (L152-157), non-fatal.

**Gaps:**
- **[HIGH → FIXED in P11.2]** **Rider-acceptance gate was absent.** `acceptOrder` / `startPreparation` (L292-294, only blocks `ready`) / `markReady` (L331-333, only requires `accepted|preparing`) / both kitchen controllers never checked `delivery.rider_id` or dispatch acceptance. Now implemented: `Order::hasAcceptedRider()` + `requiresAcceptedRider()` gate every prep-reaching path in `BusinessOwnerOrderController`, `BusinessOwnerKitchenController`, and (as of P11.2) the routed API staff endpoint `StaffDashboardApiController::updateOrderStatus`. Food cannot be prepared or marked ready without an accepted rider. See §7c.
- **[MED]** `acceptAll` sets `payment_status='paid'` **unconditionally** (`BusinessOwnerOrderController.php:419`) — even for COD orders with no paid Payment. `acceptOrder` only flips to `paid` when an `authorized` Payment exists, but `CompletionConsistencyTest` expects COD `payment_status='paid'` only after cash settlement. — **RESOLVED in P11.6**: `acceptAll` **and** `acceptItem` now only write `payment_status='paid'` when an actually-`authorized` online payment is captured (matched to `acceptOrder`); COD stays `pending` until the rider settles cash at delivery (`settleCodDelivery`). Covered by `test_cod_accept_all_keeps_payment_pending`, `test_cod_item_accept_keeps_payment_pending`, and the positive control `test_prepaid_item_accept_captures_authorized_payment`.
- **[LOW]** `DeliveryAssigned` event + `SendDeliveryAssignedNotification` are dead code — registered, never dispatched. — **RESOLVED in P11.5**: `DeliveryAssigned` fires on successful rider acceptance in `NearestRiderService` (accept branch, non-offer), and `ForwardStatusEventsToBridge` bridges it to the socket engine. `SendDeliveryAssignedNotification` (DB/FCM listener) is unaffected but is itself wired through the same accept path via the registered listener (notification + bridge both fire once after the `withEvents(false)` duplicate fix, see §7d).

**Coverage:** `RestaurantSubOrderItemsLifecycleTest.php` (HTTP routes, P11.2 rider-gated prep with two independent restaurants), `RiderAcceptanceGateTest.php` (new in P11.2: 422-until-accept, authorization-after-accept, claim rules, multi-restaurant independence, decline re-offer, no-rider block), `GroupItemRejectionRefundTest.php` (HTTP reject). **No coverage** for `startPreparation`, `markReady`, `acceptAll`, kitchen endpoints beyond the P11.2 gate tests, or the staff-gate regression alone.

---

## 3. Dispatch & rider acceptance

**Current implementation:**
- Dispatch scheduling gated on restaurant accept: `ScheduledDispatchProcessor` skips non-dispatchable orders; `DISPATCHABLE_ORDER_STATUSES = ['preparing', 'ready']` (`app/Services/ScheduledDispatchProcessor.php:37`).
- Dispatch-on-ready: `markReady` / `updateStatus` fire `dispatchNow` when `delivery.dispatch_status === 'scheduled'` (`BusinessOwnerOrderController.php:350`, twin at L82).
- Rider offer: `BookingDispatchLog` row `response='pending'` + `delivery.dispatch_status='notified'`, `dispatch_expires_at`. `DISPATCH_TIMEOUT_SECONDS = 120`.
- Accept (inside `DB::transaction` + `lockForUpdate` on delivery and rider): sets `rider_id`, `status='assigned'`, clears dispatch status; rider `busy`; one-active-delivery via `COD_ACTIVE_STATUSES`; COD eligibility via `reserveCodCredit` (`app/Services/NearestRiderService.php:682-721`).
- Decline/timeout re-dispatch only if `dispatch_status in ['notified','waiting_for_rider']` (L662, L781).
- Trip lifecycle driven by `TripStatus` enum: `assigned → en_route_pickup → arrived_pickup → picked_up → in_transit → en_route_destination → arrived_destination → delivered → completed`.
- (c) Realtime: `DeliveryStatusChanged` → `SyncOrderStatusFromDelivery` (sync status map) + `SendDeliveryStatusNotification` (queued). `WebsocketNotifierService::notifyTripAssigned` best-effort, L759-763. `DeliveryAssigned` never dispatched.
- (d) Failure: `AutoCancelUndeliveredOrder` (everyMinute, 60-min); scheduler retries; `AutoRejectWaitingOrder`.

**Gaps:**
- **[HIGH → RESOLVED by P11.2 design]** **Rider can accept before food is ready.** Under the pre-P11.2 flow `handleRiderResponse` accept branch never read `$delivery->order->status`. P11.2 deliberately reverses the ordering: dispatch is scheduled at order placement (`waiting_restaurant`), so a rider is offered AND expected to accept **before** the restaurant accepts/prepares; the restaurant-side gate (§2) then guarantees no cooking until that rider is assigned. Accept-before-ready is now the intended sequence, not a leak.
- **[MED]** If `dispatch_status` drifts outside `['notified','waiting_for_rider']`, timeout/decline re-dispatch is silently dropped (L662, L781).
- **[MED]** `completed`/`cancelled` PATCH (`UpdateOrderStatusRequest` `in:preparing,ready,completed,cancelled`, `authorize() => true`) can be applied while a delivery is mid-flight — order/delivery divergence risk.

**Coverage:** `ScheduledDispatchProcessorTest`, `OrderSizeDispatchEligibilityTest`, `ConcurrencyLockTest` (lockForUpdate; two-riders-same-delivery), `OneActiveDeliveryTest`, `ReadyToDeliveredOrderSyncTest` (HTTP rider status sync), `GroupedOrderDeliveryLifecycleTest` (calls services directly, not HTTP), `CodDeliverySettlementTest`, and P11.2's `RiderAcceptanceGateTest` (decline re-offer, no-rider block, claim/race rejection). **No test** covers prep-gate for `markReady` item-level kitchen paths beyond the P11.2 gate tests, dispatch drift, or offer timeout re-dispatch edge cases. **P11.6 added** the multi-item WITH-rider regression pair (`acceptItem`/`rejectItem` with an accepted rider can no longer flip a pending-sibling order to `preparing` — `Order::refreshStatusFromItems` now requires an item actually `preparing`; see §7d) plus the COD-vs-prepaid `payment_status` capture tests (see §2).

---

## 4. Realtime / WebSocket infrastructure

**Current implementation:**
- **No Pub/Sub provider configured:** no `config/broadcasting.php`, no `routes/channels.php`; `.env.example` `BROADCAST_CONNECTION=log` → all 11 `ShouldBroadcast` events resolve to a null driver and are **silently discarded**. Broadcast channels are dead code.
- Custom Node socket.io server: `socket-server.js` (port 3001, HTTP bridge 3002), `socket-token.js` (HMAC trip tokens), `config/socket.php` (bridge_secret). Handlers: `driver_go_online` (:102), `join_trip_room` (:128), emits `order_received_ping` (:186,309), `rider_location_stream` (:247).
- Frontend (`frontend/src`): `shared/services/socket.ts` (`socket.io-client`, base `http://localhost:3001`); fallbacks — 4-second HTTP poll for pending deliveries (`RiderDispatchNotification.tsx:79-92`), location-poll fallback + reconnect `attempts:5 delay:2000` (`useCustomerMapSocket.ts:1-5,59-75`).
- `WebsocketNotifierService::notifyDispatch` is the only real dispatch path.

**Gaps:**
- **[HIGH → RESOLVED in P11.5]** **No restaurant→customer realtime on any restaurant transition.** `restaurant_accepted_order` emit in `frontend/.../useMerchantSocketNotifier.ts` has **no server handler** (silent no-op). Business accept/prepare/ready send nothing to sockets or DB notifications; frontend order feeds must poll. Now: canonical `OrderStatusChanged` dispatches at every restaurant transition and `DeliveryAssigned` at rider acceptance, forwarded over the single `/event` bridge (PHP → Node) into audience rooms `business:{id}` / `user:{id}` / `rider:{id}` / `trip:{id}` via `ForwardStatusEventsToBridge`. Frontend consumers: `useBusinessSocketNotifier` (kitchen, Live/Polling indicator) and `useUserSocketNotifier` (tourist order status, terminal cancel exit). HTTP polling remains the recovery fallback (see §7d).
- **[MED]** Reconnect/crash recovery is client-side only (2s x 5 attempts + poll fallbacks). No server-side redelivery/reconciliation; a trip token lost on reconnect relies on the poll fallback. **Note (P11.5):** by design the HTTP/API layer remains the recovery source of truth (AGENTS §8.7); the socket engine keeps only transient RAM, and `/event` + `/trip/cancel` are now no-op-safe under duplicates, so reconnect-driven re-polls stay consistent.
- **[LOW]** Null-driver broadcast silently swallows all `ShouldBroadcast` events. **Note (P11.5):** the live socket path is the deliberate direct bridge (`WebsocketNotifierService` → `/event`), independent of the null broadcast driver.

**Coverage (P11.5):** `tests/Feature/RealtimeCompletenessTest.php` (7 tests / 49 assertions, HTTP-faked bridge): rider-accept fan-out to audience rooms, duplicate-accept = single event, restaurant transition ordering, multi-restaurant room isolation, cancel bridging + terminal no-op, per-role token endpoints. JS: `tests/js/socket-realtime.test.js` (7 tests: room validation/dedup, per-room fan-out, unauthorized-rooms-never-emitted, terminal completion/cancel emit + RAM eviction + rider release, duplicate-terminal no-op) and user-token cases in `tests/js/socket-token.test.js` (6) — **43 node tests pass**.

---

## 5. Payments & refunds

**Current implementation:**
- `PaymentController::createIntent` (allowed types `order,booking,group_order`; group branch `:87-129` charges group-level `system_fee_total` `:113-116`); gateways via `PaymongoService` (checkout/intent/refund), singleton `AppServiceProvider.php:74`.
- Persistence: `payments` morph (amount/method/provider/status/metadata), `payment_number` unique.
- `checkAndConfirm` `:451`, `paymongoReturn` `:211`, `markPayablePaid` `:597`, group fan-out `:616`.
- Refunds: `OrderRefundService` — `refundPaidOrder` calls PayMongo `createRefund`; `refundPaidGroupChild` records a local `refunds` ledger row with **no PayMongo money movement** (group paid as one transaction).
- (d) Failure: no `refund.updated`/`refund.failed` webhook handler; no scheduler reconciliation → `pending_refund` rows never resolve.

**Gaps:**
- **[HIGH]** **Refund silent failure** — **RESOLVED in P11.3**: `OrderRefundService::refundPaidOrder` now delegates to `PaymentRefundProcessor`, which never marks the order `refunded` unless PayMongo reports `SUCCESS`; provider failure/null books a `failed` ledger row and leaves the payment `paid` (retryable). The old "set `cancelled` + mark `refunded` regardless" behavior is gone.
- **[HIGH]** **`pending_refund` never reconciled** — **RESOLVED in P11.3**: `PaymentController::handleRefundWebhook` (event-type-authoritative, idempotent via `applyProviderStatus`, no downgrade of `refunded`) plus scheduled `ReconcilePendingRefunds` command (`payments:reconcile-refunds`, every 30 min) which re-queries the provider via `PaymongoService::retrieveRefund`/`listPaymentRefunds` and never blind-flips or issues refunds.
- **[MED]** Group-item refunds are local-ledger only (no gateway movement) by design — **confirmed intentional, unchanged**: `refundPaidGroupChild`/`refundCancelledItem` remain store-credit-ledger semantics (group paid as one transaction). Webhook/return double-mark race remains bounded by the processor's row-lock + active-refund guard; the unique-constraint backstop is still scoped to P11.5 (see §1).

**Coverage:** `PaymentApiTest.php` (idempotent webhook, order/booking intents); `GroupItemRejectionRefundTest.php` (asserts `refunded_amount=120.00`); **P11.3 adds** `RefundPathHardeningTest.php` — 15 tests / 83 assertions covering success-finalize, provider-failure-stay-paid, pending → `pending_refund`, succeeded/failed webhooks idempotent incl. duplicate replay and late-`failed`-never-downgrades, already-refunded/in-flight rejection with no duplicate provider call, reconciliation finalize/revert/unreachable, and cancelled-order finals. **P11.4 adds** `PaymentIdempotencyTest.php` — 13 tests / 59 assertions covering same-webhook-twice no-op, concurrent duplicate event INSERT blocked by UNIQUE, already-committed event no-op, three distinct events converging to one payable finalization, paid-cannot-downgrade / failed-retry-allowed / refunded-resurrection-blocked / in-flight-refund blocked via `canApplyProviderVerdict`, `verifyAndConfirm` cannot resurrect refunded, duplicate provider intent rejected at DB, duplicate checkAndConfirm applies once, webhook transaction rollback + retry-after-crash, and legacy no-event-id payload dedup by resource. Group gateway refunds remain intentionally uncovered (out of scope by design).

---

## 6. Money flow — COD, earnings, payouts

**Current implementation:**
- Order money columns: `subtotal, delivery_fee, rider_tip, discount, system_fee, rider_financed_amount, rider_delivery_earnings, total, paid_amount, refunded_amount`. Group: `subtotal, delivery_total, system_fee_total, rider_tip, discount, grand_total, paid_amount, refunded_amount`.
- Fee config `config/delivery.php`: `system_fee_percentage 10.00`, `base_fare 40`, `included_km 2`, `per_km 15`, `minimum_fee 40`.
- COD: `NearestRiderService::settleCodDelivery` (`:915`, transaction + delivery lock `:950-951`, status re-check `:963-966` idempotent) → `finalizeCredits` → `recordCashPayment` (creates `Payment(method=cash, provider=rider, amount=order.total, status=paid)`) → order `completed/payment_status=paid/paid_amount=total` → `recordEarning` → delivery `completed`, `cod_credit_reserved=0`.
- Reserve/release: `reserveCodCredit :254`, `releaseCodCredit :313`.
- `RiderCredit` (`app/Models/RiderCredit.php`): `usable = max(0, total − minimum_reserve − reserved)`; ledger `rider_credit_transactions`.
- Earnings: `RiderEarning::updateOrCreate(['rider_id','order_id','status'=>'earned'])`; `total_earning = rider_commission/delivery_fee + rider_tip` (`:1068-1082`); idempotent via `UNIQUE(rider_id, order_id, status)`.
- Payouts: `RiderPayoutService` — `requestPayout` (rider `lockForUpdate` `:73`, one-live-payout `:79-85`, `active_payout_key=rider->id` `:100`, pivot `syncWithoutDetaching` `:104-106`); `approve :120-134`, `markPaid :163-179`; payout pivot `UNIQUE(rider_earning_id)` idempotency barrier.
- System-fee accounting: `AdminReportController::system` reports only user/business/order counts — **no** `system_fee` aggregation, no COD receivable tracking.

**Gaps:**
- **[HIGH]** **COD financed amount is never recovered.** `RiderCredit::finalize` (`:172-194`) decrements only `reserved_credits`; `balance_after == balance_before` (confirmed at `:187`); `total_credits` never charged. On every COD delivery the rider keeps cash (food+system_fee+delivery+tip) AND the full credit balance; `rider_financed_amount` is stored but never recovered. Platform+restaurant absorb the loss. Reserve only limits concurrent COD jobs.

  > **RECON FINDING CORRECTED during the P11 implementation audit** (user-confirmed accounting): the finding above was **wrong** — `RiderCredit::finalize()` **does** deduct `total_credits` (by the exact reserved amount) as part of the COD settlement transaction, so the rider's wallet is charged exactly once and the credit is recovered. What was actually missing is the **restaurant/platform settlement allocation** — on settlement the financed amount must split 80% to the restaurant and 20% to the Tourism Office, recorded in an auditable ledger. P11.1 adds exactly that (see §7b below); it does **not** re-implement the credit deduction, so no double-debit is introduced. The practical effect on the performance baseline stands (reserve limits concurrent COD jobs), but the "platform+restaurant absorb the loss / stored-but-never-recovered" language is **retracted**.
- **[MED]** Payout status transitions not atomic: `approve` / `markPaid` run no transaction, no `lockForUpdate`; `reject`/`cancel` lock nothing. Concurrent approve+markPaid (or approve+reject) can both pass the read-outside-lock guard. `UNIQUE(active_payout_key)` stops two live payouts, not divergent states on one.
- **[MED]** No platform accounting of `system_fee`/`system_fee_total` or COD receivables — the HIGH leak is invisible to admin reporting.
- **[LOW]** Earnings dashboard (`delivery.rider_commission + order.rider_tip`) vs payout-available (`rider_earnings` ledger) diverge; `getAvailableEarnings` fallback `total_earning ?? rider_tip` vs model `total_earning` only; unused `rider_credits.available_credits` column.

**Coverage:** `CodDeliverySettlementTest` (reserve/settle/idempotency), `RiderPayoutTest` (one-live-payout), `ConcurrencyLockTest` (409 lines), `FastDeliveryTipTest` (prepaid+COD tips), `CompletionConsistencyTest`, `GroupOrderServiceTest`, `GroupItemRejectionRefundTest`. **P11.1 adds** `CodFinancialSettlementTest` (credit-debit-on-settlement + settlement allocation assertions, system-fee-free base, platform-fee exclusion — see §7b). **Remaining gaps:** payout-transition atomicity (§6 MED), platform `system_fee` aggregation.

---

## 7d. P11.5 implementation — realtime completeness (done)

Addressed **Ranked candidate #4** on top of the existing Zero-DB Socket.IO architecture (never rebuilt):

- **Single bridge path:** canonical events `OrderStatusChanged` / `DeliveryAssigned` / `DeliveryStatusChanged` → listener `ForwardStatusEventsToBridge` → `WebsocketNotifierService::notifyStatusEvent` → `POST /event` (shared-secret verified) → `routeStatusEvent` fans out to each **audience room** `business:{id}` / `user:{id}` / `rider:{id}` / `trip:{id}` with an enriched payload (order/business/user/rider/delivery ids, new status, `trip`). Cancellation → `notifyTripCancelled` → `/trip/cancel` → `applyTripTerminal` (RAM trip marked terminal, radar rider released to `available`, `trip_cancelled` + `dispatch_status_update` emitted, room members + RAM evicted; duplicate terminal calls are harmless no-ops).
- **Authoritative dispatch points (single-fire):** `DeliveryAssigned` in `NearestRiderService` accept branch; `OrderStatusChanged` in `BusinessOwnerOrderController` (acceptOrder→preparing, assignRider→accepted, startPreparation, markReady, acceptAll, acceptItem, rejectOrder→rejected), `BusinessOwnerKitchenController::updateStatus`, and `Order::refreshStatusFromItems`; `cancelDelivery()` bridges `notifyTripCancelled` only on real cancels (terminal = no-op, single fire for all canonical cancel callers).
- **Tokens & channels:** `SocketTokenController` mints `POST /api/socket/user-token` (`user:{id}`, `TripTokenService::issueUserToken`) and `POST /api/business-owner/socket/token?business_id=` (`business:{id}`); `SocketChannelAuthorizer` enforces per-role scoping; `routes/channels.php` + rewritten `BroadcastServiceProvider` (Laravel 12.62 removed the legacy base class); client joins via `join_user_room` (verified HMAC) / `join_business_room`.
- **Root-cause duplicate fix:** every listener fired twice because Laravel 12's `Application::configure()` enables event **discovery** while all 12 listeners are also in `$listen` (raw listener count = 4/event). `bootstrap/app.php` → `->withEvents(false)`; verified: exactly one `/event` per acceptance (<span data-type="role">rider</span> regression in `RealtimeCompletenessTest`).
- **Frontend:** `useBusinessSocketNotifier` (kitchen, query invalidation + Live/Polling indicator), `useUserSocketNotifier` (tourist status, query invalidation + terminal cancel exit that hides live tracking), `useCustomerMapSocket` `tripCancelled`; HTTP polling remains the recovery fallback everywhere (socket never authoritative — AGENTS §8.7).
- **Tests:** PHP `RealtimeCompletenessTest` 7 / 49 assertions + JS `socket-realtime.test.js` 7 + `socket-token` user-token cases 6 → **43 node tests**. Near-miss fixed while testing: `applyTripTerminal` radar key normalization (`String(freedRiderId)`) for numeric bridge ids.
- **Full suite: 297 passed / 1,418 assertions / 0 failures / 2 skipped** (292 + 7 new PHP; 1,369 + 49 new assertions) — including the `withEvents(false)` change re-run across the entire suite.

---

## 7e. P11.6 implementation — acceptance-gate regression (done)

Follow-up hardening on the item-level gate (found during the P11.5 verification sweep), closing two `acceptItem()`/`rejectItem()` state-transition defects:

- **`Order::refreshStatusFromItems` rule 3**: `preparing` was reachable with only `pending` items (whenever a rider had accepted), so a **rejectItem** on one pending item flipped the whole `waiting_restaurant` order to `preparing` (a refusal authorized cooking) and an **acceptItem** with pending siblings also jumped to `preparing` (the P11.2 invariant "item-accept alone never reaches preparing" held only for single-item orders). Now `preparing` requires `preparingCount > 0` — the kitchen must actually have started an item. Accepted/pending-only sets settle on `accepted`; nothing accepted → stays `waiting_restaurant`. Explicit prep entry-points (`acceptOrder`, `acceptAll`, `startPreparation`, kitchen item/order update) unchanged.
- **`acceptItem`/`acceptAll` `payment_status`**: removed the unconditional `'paid'` stamp on COD orders (recon §2 MED) — only an actually-`authorized` online payment captures to `paid` (matches `acceptOrder`); COD remains `pending` until the rider settles cash at delivery.
- **Tests**: `RiderAcceptanceGateTest` grows to **14 tests / 139 assertions** (with-rider multi-item accept/reject never → `preparing`, then real prep; COD item-accept + acceptAll keep `payment_status=pending`; prepaid authorized-payment positive control still captures `paid`). No-rider multi-item regressions remain green.
- **Full suite after P11.6: 305 passed / 1,479 assertions / 0 failures / 2 skipped.**

---

## 7c. P11.2 implementation — rider-acceptance gate before preparation (done)

**Ranked candidate #2**, implemented and formally verified on top of P11.1:

- **Gate rule:** `NO ACCEPTED RIDER ⇒ NO PREPARATION`. `Order::hasAcceptedRider()` (delivery assigned) feeds `requiresAcceptedRider()` in `BusinessOwnerOrderController` — `acceptOrder`, `startPreparation`, `markReady`, `acceptAll`, `updateStatus`→preparing/ready, `updateItemStatus`→preparing/ready — and `BusinessOwnerKitchenController` (`updateStatus`, `updateItemStatus`).
- **Staff hole closed:** the routed API staff endpoint `StaffDashboardApiController::updateOrderStatus` (`PATCH /staff/orders/{order}/status`) accepted `preparing`/`ready` without a rider; now gated. (Legacy Blade `StaffDashboardController` is unrouted/dead.)
- **Sequence inversion resolved:** dispatch fires at order placement (`GroupOrderService` → `waiting_restaurant`), riders accept before the restaurant accepts; `scheduleDispatch`/`dispatchNow` are no-op when a delivery/rider already exists, so no double-dispatch on accept.
- **Concurrency-safe accept:** delivery row-lock + COD credit reserve inside `handleRiderResponse`; one offer per rider (`UNIQUE delivery_id, rider_id`); already-assigned accept rejected.
- **Tests:** `RiderAcceptanceGateTest` **6 tests / 78 assertions** (endpoint 422s until accept, authorized after; `accepted`-without-rider still blocked; only the offered rider may claim; multi-restaurant independence + permanent delivery↔rider binding + no cross-restaurant claims; decline re-offers to next eligible rider with no duplicate offer; `no_rider_available` blocks forever). `ConcurrencyLockTest::test_two_riders_accepting_the_same_prepaid_delivery_claim_it_once` covers the two-rider `already_assigned` race. **Full suite after P11.2: 264 tests / 1,227 assertions / 0 failures / 2 skipped.**

- **P11.5 gap-audit follow-up — item accept/reject drift (fixed):** the P11.5 realtime audit verified a bypass of this gate: `acceptItem()`/`rejectItem()` (and item-status/kitchen endpoints) had no rider check, and `Order::refreshStatusFromItems()` rule 3 then flipped a multi-item delivery order to `preparing` when a sibling item stayed `pending` with `delivery.rider_id = NULL`. Existing tests missed it (single-item test only). Fixed at the smallest authoritative layer — rule 3 now permits `preparing` only when `order_type !== 'delivery' || hasAcceptedRider()` — so the invariant `hasAcceptedRider() === false ⇒ preparing prohibited` holds for every caller, and `OrderStatusChanged` can never announce an invalid `preparing`. Item-level accept/reject pre-rider remains allowed (stops at `accepted`/`waiting_restaurant`). `RiderAcceptanceGateTest` grew to **9 tests / 107 assertions** (3 new regression tests incl. no-invalid-broadcast asserts). Full suite: **300 passed / 1,447 assertions / 0 failures / 2 skipped**.

---

## 7. Cross-slice observations

- **Dead realtime paths cluster:** `OrderCreated`, `BookingCreated`, `BookingStatusChanged`, `UserRegistered`, `BusinessApproved`, `BusinessRejected`, `ReviewCreated` events are registered but never dispatched; their listeners (and all `Notification::create` writes) never run. `DeliveryAssigned` and the scheduler-driven `OrderStatusChanged` are now **live** (P11.5): `DeliveryAssigned` on rider acceptance; `OrderStatusChanged` on every restaurant transition (accept/prepare/ready/acceptAll/acceptItem/reject) and the kitchen update routes — forwarded to the socket engine over the `/event` bridge. Container/payment/broadcast-mapping listeners and the never-dispatched events above remain registered-but-inert (out of scope).
- **Post-commit gap:** terminal `DeliveryStatusChanged` dispatch fires after the DB transaction commits (`NearestRiderService.php:1021`); a crash in between leaves order/delivery synced in DB but realtime stale.
- **Authz summary is consistent:** every state endpoint checks ownership (`business->owner_id`, rider ownership of delivery, admin role). The gaps are **gating/stateness** (missing rider-acceptance gate, no prior-state guards, unconditional `acceptAll` 'paid'), not authorization holes.
- Console `routes/console.php`: `CleanupRiderLocations` daily, `CheckExpiredDocuments` 6h, auto-reject + auto-cancel + dispatch everyMinute.
- `.env` secrets (PAYMONGO/SOCKET_BRIDGE) look placeholder-short — deployment/environment concern, not a code bug (noted, not printed).

---

## 7b. P11.1 implementation — COD credit settlement & Tourism Office revenue (done)

Addressed **Ranked candidate #1** with the corrected accounting (see §6 finding note). The rider's credit deduction already happens once inside `RiderCredit::finalize()` during `settleCodDelivery`; P11.1 adds the **auditable settlement allocation** that was missing, fully inside the existing COD settlement transaction + delivery row-lock:

- **Split model (config-driven, never hard-coded):** `settlement_base = delivery.cod_credit_reserved == order.rider_financed_amount` (subtotal + system_fee); `platform_fee = base × cod_platform_fee_percent` (`COD_PLATFORM_FEE_PERCENT=20` in `.env`/`.env.example`, default in `config/delivery.php`); `restaurant_share = base − platform_fee` (default 80/20). Fast-delivery tips and delivery fees are **never** part of `settlement_base`.
- **Ledger:** new `cod_settlements` table (migration `2026_09_20_000003`): `settlement_number` (unique), `order_id` (**UNIQUE** idempotency backstop), `delivery_id`, `business_id`, `rider_id`, `settlement_base`, `restaurant_share`, `platform_fee`, `status` (`settled`/`paid`), `settled_at`. `CodSettlement` model + `CodSettlementService` (`split()`, `settlementBaseFor()` with mismatch/zero guards, `record()` inside the caller's transaction, `restaurantLedger()`, `tourismOfficeLedger()`).
- **One canonical path:** `NearestRiderService::settleCodDelivery` books the settlement between `finalizeCredits` and `recordCashPayment`; the return payload now carries `settlement_id`, `settlement_base`, `restaurant_share`, `platform_fee`. Cancellation books nothing (reserve released via `COD_RELEASE`); unreserved deliveries throw.
- **Reporting endpoints:** `GET /business-owner/reports/cod-settlements` (restaurant receivable ledger + totals) and `GET /admin/reports/cod-settlements` (Tourism Office ledger with source order/delivery/restaurant/rider).
- **Tests:** `CodFinancialSettlementTest` **10 passed / 112 assertions** (80/20 split, base==reserved==financed, single deduction, cash-not-remittance + earnings separation, idempotency + unique backstop, insufficient-credit blocks, cancellation books nothing, multi-restaurant independence, config-driven split incl. 10% override, fast-delivery tip exclusion).
- **Verification pass (green):** full suite **258 tests / 1,149 assertions / 0 failures / 2 skipped**. `RestaurantSubOrderItemsLifecycleTest` was reconciled to the live P11.2 rider-gated flow (dispatch-at-creation + rider-acceptance gate before restaurant accept/prepare): it asserts both deliveries exist in `notified` state at `waiting_restaurant` creation, rider A claims sub-order A and rider B claims sub-order B via `cancelOtherPendingOffers` re-offer, and each delivery stays bound to its accepted rider. Its `makeRider` now funds `rider_credits` (10,000) and sets `rider_status=available` so `reserveCodCredit` eligibility holds — without those the accept path failed `ineligible` and the codebase's failed-accept re-dispatch (`NearestRiderService.php:763`) hit the UNIQUE `(delivery_id, rider_id)` guard. This is **test-data drift**, not a P11.1 app defect.
- **Deferred (LOW, spec §5 completeness):** `rider_credit_transactions` stores `order_id` but no `delivery_id`. Reconstructable 1:1 via UNIQUE `deliveries.order_id`; `cod_settlements` already carries `delivery_id`. A nullable `delivery_id` column (migration + threading through `RiderCredit`/`RiderCreditService`/`NearestRiderService`) is documented, not implemented.

---

| # | Candidate | Severity | Target files |
|---|---|---|---|
| 1 | **COD credit settlement allocation** (recon finding corrected) — `RiderCredit::finalize` already debits `total_credits`; the missing piece was the auditable 80/20 restaurant/Tourism-Office settlement split + reporting. **Implemented as P11.1** | HIGH | `CodSettlementService` (new), `NearestRiderService.php` (settleCodDelivery), `CodSettlement` model + migration, `BusinessOwnerReportController`/`AdminReportController` |
| 2 | **Rider-acceptance gate before preparation** — gate `startPreparation`/`markReady`/kitchen on assigned rider; also gate rider accept on order state (accept-before-ready). **Implemented as P11.2** | HIGH | `BusinessOwnerOrderController`, `BusinessOwnerKitchenController`, `StaffDashboardApiController`, `NearestRiderService::handleRiderResponse`, `Order::canPrepare` |
| 3 | **Refund-path hardening** — refund.updated/failed webhooks, `pending_refund` reconciliation scheduler, stop marking order `refunded` when gateway call fails. **Implemented as P11.3** | HIGH | `PaymentRefundProcessor` (new), `OrderRefundService`, `PaymentController`, `ReconcilePendingRefunds`, `routes/console.php` |
| 4 | **Realtime completeness** — dispatch `DeliveryStatusChanged`/notifications on restaurant accept/prepare/ready; wire `restaurant_accepted_order` server handler; decide fate of dead events/listeners. **Implemented as P11.5** | MED | Event/Listener layer, `socket-server.js`, business controller transitions |
| 5 | **Payment idempotency** — webhook exactly-once (payment_webhook_events UNIQUE event id + row-lock + transaction), unique provider refs, state-machine downgrade guard. **Implemented as P11.4** | MED | `PaymentController`, `PaymentWebhookEvent` + migration, `Payment::canApplyProviderVerdict` |
| 6 | **State-machine hardening** — prior-state guards on item transitions, terminal-revival protection, pre-pickup delivery-state check on `completed/cancelled` PATCH, conditional `acceptAll` payment_status | MED | `BusinessOwnerOrderController`, `OrderItem`/`Order` state helpers |
| 7 | **Payout transition atomicity** — transactions + `lockForUpdate` on approve/markPaid/reject/cancel | MED | `RiderPayoutService` |
| 8 | **Admin system-fee / COD receivable reporting** | MED | `AdminReportController::system` |
| 9 | Settlement/report parity (dashboard vs payout ledger), dead schema column, magic numbers | LOW | `RiderController`, `RiderPayoutService`, `SmartDispatchService` |

Proposed P11 scope suggestion (subject to owner decision): **1 → 2 → 3** are the money-safety and operations-core fixes; **4–5** close the realtime/idempotency holes; **6–7** are defensive hardening sharing the same touchpoints. All keep the 248-test / 1,035-assertion baseline green and add tests for each previously-untested path named in §Coverage. **P11.1 (candidate #1), P11.2 (candidate #2), P11.3 (candidate #3), P11.4 (candidate #5) and P11.5 (candidate #4) are complete** — see §7b, §7c, §7d, §5 and PROGRESS. **P11.6 (acceptance-gate regression, §7e) and P11.7 (final system verification, PROGRESS) are complete** — as of the P11.7 revision the suite is **305 passed / 1,479 assertions / 0 failures / 2 skipped** and the **delivery/dispatch/payment/realtime phase is declared finished**. Remaining candidates **6 (state-machine hardening — prior-state guards, terminal-revival protection, conditional order-status PATCH guards)** and **7 (payout transition atomicity)** are documented, deferred to the Admin-phase maintenance window, and will be tracked there alongside the Tourism Office governance/monitoring build.