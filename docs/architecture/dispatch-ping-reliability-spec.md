# Dispatch PING Reliability — Specification & Checkpoint

**Status:** SPEC — DRAFT, NOT AGREED, NOT IMPLEMENTED.

This document records the findings of a read-only audit of the rider PING
delivery path and defines the agreed target sequence for hardening it. It
changes **no implementation**. Until this checkpoint is explicitly accepted,
nothing below the "Sequence" section is authorized work.

Related documents:

- `docs/architecture/delivery-offer-atomic-acceptance.md` — the offer/acceptance
  contract this spec builds on and must not disturb.
- `docs/business-rules/rider-dispatch.md` §3 — offer timing, re-dispatch, and the
  `ScheduledDispatchProcessor` vs `processTimeouts()` distinction.
- `docs/current-status/known-issues.md` — items 4 (poll-driven offer timeout) and
  5 (PING delivery honesty).

---

## 1. Scope

The concern is **rider PING delivery**, treated as a separate concern from
atomic acceptance.

```text
ORDER / DELIVERY
       ↓
Find eligible riders
       ↓
Create offer
       ↓
Create PING
       ↓
Send PING to rider
       ↓
Rider receives PING
       ↓
Rider accepts
       ↓
Atomic Acceptance
```

A PING is a **notification mechanism**, never the authority for assigning a
rider. The database remains authoritative for offer state, delivery assignment,
expiration, and rider eligibility.

**Central invariant (target):**

> Every created rider offer must have a durable PING delivery state, and a
> transient PING failure must never silently lose the rider's opportunity to
> receive the offer.

---

## 2. What exists today (audited, evidence-backed)

There is **no FCM/push channel** (`grep 'fcm|sendMulticast|messaging()'` → no
matches in `app/`). Notification = three channels:

| # | Channel | Code path | What "success" actually means |
|---|---|---|---|
| ~~1~~ | ~~Firebase **Realtime DB write** (`createRiderRequest`)~~ | **REMOVED** — `FirebaseService` and every RTDB mirror were deleted (ADR 003 amendment) | n/a |
| 2 | **WebSocket bridge** `POST /dispatch` → `emit('order_received_ping')` | `NearestRiderService::notifyDispatch` → `WebsocketNotifierService::notifyDispatch` → `socket-server.js:435-473`, `:387` | HTTP 200 from the Node bridge — level 2 |
| 3 | **HTTP polling** fallback | `/rider/dispatch/pending-request`, `/rider/dispatch/offers` reading `booking_dispatch_logs` | read-your-own-offer — the documented recovery path |

Gating: channel 1 no longer exists (`config('firebase.dispatch_enabled')` and
`$this->firebase->isConfigured()` were deleted with `config/firebase.php`);
channel 2 is always attempted.

### What is already correct (do not rebuild)

- **The offer row is created before any ping** — `BookingDispatchLog::create` at
  `NearestRiderService:551-557`, pings at `:566` / `:597`. A ping failure cannot
  lose the offer.
- **Poll recovery is explicit** — `NearestRiderService:697-699`: *"even if this
  fails, the HTTP poll … will surface the BookingDispatchLog created above."*
- **Duplicate offers are blocked** — `UNIQUE booking_dispatch_logs(delivery_id,
  rider_id)` plus the `alreadyDispatchedRiderIds` filter
  (`NearestRiderService:518-543`). Channel 1 is idempotent by construction
  (RTDB `PUT` to a fixed path).
- **Offer state ≠ assignment** — a ping never assigns; only atomic acceptance
  does. The acceptance/cancellation/COD paths are untouched by this spec.

---

## 3. Three reliability levels

```text
Level 1 — PING CREATED
Level 2 — PING ACCEPTED/EMITTED BY PROVIDER
Level 3 — RIDER DEVICE ACKNOWLEDGED
```

Current system reality:

```text
Level 1 — not recorded (no row)
Level 2 — not recorded; "200" is often meaningless (see G3)
Level 3 — no client-ack event exists at all
```

Level 3 requires a **new client→server ack event** and is a separate
frontend/client workstream. Until it exists, the system must never claim
"PING delivered successfully" — at most "the notification bridge
accepted/emitted the PING."

---

## 4. Findings (G1–G6)

| ID | Finding | Evidence |
|----|---------|----------|
| **G1** | `dispatch_status = 'notified'` is written **before** any ping attempt and never revised — the DB asserts "notified" with zero proof. A failed PING is treated as a successful notification. | `NearestRiderService:561-564`, `:692-695` |
| **G2** | Ping results are **discarded at every call site**. `notifyDispatch(): bool` and `createRiderRequest(): bool` are fire-and-forget; failures produce only `Log::warning` + `report()`. No record, no retry, no `attempt_count`. | `NearestRiderService:567`, `:597`, `:700`, `:729`; `WebsocketNotifierService:47-52` |
| **G3** | The bridge **always answers `200 "Dispatch ping sent."`** — even when there are zero eligible riders (`socket-server.js:354-361` early-returns before the handler replies), when the intended rider is not connected (`:346`) or busy, and when it then falls back to a *different* rider (`:367-369`). `notifyDispatch() === true` is frequently a false positive. | `socket-server.js:466-467` |
| **G4** | The socket engine pings **one** target per call, while Laravel loops over up to 5 riders issuing one `POST /dispatch` each; each call `activeTrips.set(deliveryId, …)` (`:375`), so the last writer overwrites the previous. Cross-talk is possible when the preferred rider is not on the radar. | `socket-server.js:330-393`; `NearestRiderService:540-609` |
| **G5** | **No ping-delivery record exists.** No `ping_id / status / attempt_count / last_attempt_at / delivered_at / failure_reason`. The only queryable state is the *offer's* `response` — a different fact (the conflation this spec exists to prevent). | `booking_dispatch_logs` schema |
| **G6** | `dispatch_failed` is emitted to `trip:{deliveryId}` — a room nobody has joined at offer time (rooms are joined post-assignment with a trip token), so the failure signal has no consumer. | `socket-server.js:356-359` |

---

## 5. Target PING behavior

```text
Create Offer (durable)      ← already true today
    ↓
Send PING
    ↓
 ┌─────────┴──────────┐
FAIL                 SUCCESS
  ↓                    ↓
Record failure      Record acceptance (level 2)
  ↓                    ↓
Bounded retry       Rider receives PING
(backoff)               ↓
  ↓                 Rider accepts
PING delivered          ↓
                    ATOMIC ACCEPTANCE → ONE WINNER
```

Rules:

1. **A failed PING must not be treated as a successful rider notification.**
2. **Offer existence and PING delivery are separate facts.** PING failure must
   never flip an offer to `accepted`, `declined`, or `timeout`.
3. **Bounded retries with backoff** — never an infinite loop.
4. **Idempotency key** `delivery_id + rider_id + offer_id` (reusing the existing
   `UNIQUE(delivery_id, rider_id)`) so retries cannot produce duplicate logical
   notifications.
5. **Notification failure must never break acceptance.** The atomic acceptance
   boundary (`NearestRiderService`, one-active-delivery-per-rider) is unchanged.

---

## 6. Test matrix (P1–P12) — current coverage

| Test | Condition | Expected | Coverage today |
|------|-----------|----------|----------------|
| P1 | PING succeeds first attempt | Rider receives PING | ⚠️ Partial — `DeliveryOfferConcurrencyTest:100-101` mocks `notifyDispatch → true`; nothing asserts delivery; Firebase force-disabled (`:61`) |
| P2 | Temporary PING failure | Retry | ❌ No retry mechanism exists |
| P3 | PING fails then succeeds | Exactly one logical PING | ❌ No retry, no ping identity |
| P4 | All retries fail | Failure recorded, no silent loss | ❌ Only `Log::warning` — silent today |
| P5 | Duplicate retry | No duplicate logical offer | ✅ Offer-level (`UNIQUE` + `alreadyDispatchedRiderIds`); ⚠️ No ping-level record |
| P6 | Rider accepts after successful PING | Atomic acceptance succeeds | ✅ Concurrency tests A, G, H |
| P7 | Rider unavailable before PING | Rider excluded | ✅ `test_offline_and_non_matching_riders_are_not_offered` |
| P8 | Offer cancelled while PING pending | PING not actionable | ✅ `response !== 'pending'` re-check + `removeRiderRequest` (test B) |
| P9 | Offer times out while delivery retrying | Non-actionable | ✅ Timeout (test H); ⚠️ "while retrying" N/A — nothing retries |
| P10 | Multiple riders receive same order | Each gets own offer/PING | ⚠️ Offers ✓ (wave test); PINGs ✗ (G4) |
| P11 | One rider accepts | Remaining offers cancelled | ✅ Tests A, C |
| P12 | Notification provider unavailable | Failure recorded/retried, not silently lost | ❌ G2 |

Honest summary: the **offer** invariants (P5–P11) are largely proven. The
**delivery-of-ping** invariants (P1–P4, P10, P12) have no mechanism and no
tests — and G1/G3 mean the system currently *claims* success it never verified.
`notifyDispatch()` is only ever mocked returning `true`; no test exercises a
ping failure.

---

## 7. Sequence (the agreed roadmap)

```text
NOW
 ├─ Fix rider-dispatch.md scheduler wording                    ✅ DONE
 ├─ Document PING Reliability Checkpoint (this document)       ✅ DONE
 └─ Preserve current offer/acceptance architecture             (constraint)
          ↓
   CHECKPOINT AGREEMENT  ← ← ← awaiting explicit acceptance
          ↓
   G1 FIX — honest notification state
   (distinguish OFFER CREATED → PING ATTEMPTED → PING ACCEPTED BY BRIDGE,
    never bare 'notified')
          ↓
   G3 FIX — honest bridge response
   { targetRiderId, pingable, emitted, … } instead of unconditional 200
          ↓
   P1–P12 TESTS — deliberate SUCCESS / FAILURE / RETRY / DUPLICATE /
   WRONG RIDER / OFFLINE / CANCELLED / TIMEOUT / MULTI-RIDER / PROVIDER
   FAILURE cases; existing acceptance/concurrency tests untouched
          ↓
   EVALUATE PERSISTENCE (decision, see §8)
          ↓
   RETRY + EXPONENTIAL BACKOFF
          ↓
   CLIENT ACK (Level 3) — separate frontend workstream
```

Related tracked issue, independent of the above:
**offer timeout is poll-driven** (`processTimeouts()` has no scheduled runner —
only `RiderDispatchController:19` / `:53` call it). See
`docs/current-status/known-issues.md` item 4.

---

## 8. Persistence — decision deliberately deferred

**No new table is created at this stage.** The choice is deferred until G1/G3
and the P1–P12 tests clarify exactly what must be persisted.

**Option A — columns on `booking_dispatch_logs`** (one logical PING state per
rider offer):

```text
delivery_id, rider_id, response,
ping_status, ping_attempts, ping_last_attempt_at,
ping_delivered_at, ping_failure_reason
```

**Option B — sibling `dispatch_pings` table** (independent records per channel
and per attempt):

```text
ping_id, delivery_id, rider_id, offer_id, channel,
status (PENDING / SENDING / DELIVERED / FAILED / CANCELLED),
attempt_count, last_attempt_at, delivered_at, failure_reason
```

Better suited to the current 2–3 channels (Firebase RTDB, WebSocket bridge,
polling) and to future channels/retries.

---

## 9. Do-not-touch list

This work must not modify:

- atomic acceptance (`NearestRiderService` transaction/outcome mapping)
- `deliveries.rider_id` and delivery ownership
- the offer state machine (`pending / accepted / declined / cancelled / timeout`)
- cancellation logic
- the ALL-COLLECTED rider gate
- COD settlement / rider earnings / payouts
- `SmartDispatchService`, payment idempotency, refund processing, GPS token
  security, existing Socket.IO infrastructure

Fix the smallest authoritative layer; prefer targeted fixes over rewrites.

---

## 10. Verification evidence

This spec is based on a read-only inspection of:

- `app/Services/NearestRiderService.php` (dispatch wave, ping calls,
  `processTimeouts`, `redispatchIfOffered`, `notifyOfferCancelled`)
- `app/Services/WebsocketNotifierService.php` (`notifyDispatch` and siblings)
- ~~`app/Services/FirebaseService.php`~~ (deleted with the Firebase removal; RTDB
  channel 1 above no longer exists)
- `app/Services/ScheduledDispatchProcessor.php` + `routes/console.php`
  (confirmed: scheduled-delivery dispatch only, no offer-timeout runner)
- `app/Http/Controllers/Rider/RiderDispatchController.php` (the only
  `processTimeouts()` call sites)
- `socket-server.js` (`/dispatch` handler, `startDispatchChallenge`, target
  selection, unconditional 200)
- `tests/Feature/DeliveryOfferConcurrencyTest.php` (scenarios A–H; websocket
  mocked returning `true`; Firebase disabled)
- Test suite grep: no test returns `false` from `notifyDispatch`.

No code was changed as part of this audit.
