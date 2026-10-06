# TrackTour Engineering Documentation

Welcome to the **TrackTour** engineering documentation repository and Obsidian knowledge base.

TrackTour is a tourism promotion and multi-restaurant food delivery web application built specifically for the municipality of **Bansud, Oriental Mindoro**. It connects tourists, local tourism businesses, restaurants, riders, and the Bansud Municipal Tourism Office.

---

## 📚 Knowledge Base Structure

```text
docs/
├── README.md                      # This documentation index & guide
│
├── architecture/                  # System, backend, frontend, and realtime architectures
│   ├── system-architecture.md     # High-level architecture, actors, and topology
│   ├── backend-architecture.md    # Laravel 12 API, services, DB transactions, locking
│   ├── frontend-architecture.md   # React, Vite, Tailwind, role dashboards, state
│   ├── realtime-architecture.md   # Node Socket.IO, HMAC trip tokens, GPS tracking
│   └── ride-hailing-ui-spec.md    # Screen-by-screen UI spec for the Transport ride feature
│
├── business-rules/                # Authoritative domain rules & state invariants
│   ├── food-delivery.md           # Group checkout, multi-vendor rules, preparation gating
│   ├── rider-dispatch.md          # Smart dispatching, 1-active-delivery, size classes
│   ├── rider-wallet.md            # Credit reserve, COD settlement, payouts ledger
│   ├── payment-rules.md           # PayMongo idempotency, split transactions, refunds
│   └── order-lifecycle.md         # End-to-end order/delivery state machine & gates
│
├── decisions/                     # Architecture Decision Records (ADRs)
│   ├── 001-group-checkout.md      # Multi-restaurant single checkout architecture
│   ├── 002-one-order-per-restaurant.md # Independent orders & deliveries per restaurant
│   ├── 003-websocket-not-firebase.md   # Custom Node.js Socket.IO server vs Firebase
│   └── 004-cod-credit-reserve.md  # Rider credit reserve for COD financial integrity
│
├── current-status/                # Project phase checkpoints and roadmaps
│   ├── completed.md               # Implemented milestones (P1 through P11.4)
│   ├── known-issues.md            # Audited technical debt, dead code, edge cases
│   └── roadmap.md                 # Immediate (P11.5) and upcoming priorities
│
└── testing/                       # Test specifications, suites, and harnesses
    ├── dispatch-tests.md          # Concurrency, timeout, and dispatch rule suites
    ├── payment-tests.md           # PayMongo, COD settlement, tips, and refund tests
    └── e2e-tests.md               # End-to-end lifecycle and Socket.IO Node tests
```

---

## 🧭 Developer & Agent Reading Order

Before making architectural or code modifications:

1. **Read `AGENTS.md`** at the project root for strict operational guidelines and testing conventions.
2. **Review `docs/business-rules/`** to understand domain invariants (such as *rider acceptance gating kitchen preparation* and *one active delivery per rider*).
3. **Consult `docs/decisions/` (ADRs)** to understand *why* the architecture is structured this way before proposing changes.
4. **Check `docs/current-status/completed.md` and `docs/current-status/known-issues.md`** to avoid breaking existing green baselines.
5. **Always maintain the test baseline**: Run the relevant test suite in `tests/` before committing.

---

## 🔑 Core Invariants At A Glance

- **Group Checkout**: Tourists experience 1 checkout across multiple restaurants. The backend creates 1 `group_checkouts` record, 1 `orders` record per restaurant, and 1 independent `deliveries` record per order.
- **Rider Gate on Food Preparation**: A restaurant must **never** start cooking until a rider has accepted the delivery offer. Unauthorized preparation attempts fail with HTTP `422 Unprocessable Entity`.
- **One Active Delivery Per Rider**: A rider may receive multiple dispatch offers simultaneously, but can accept only **one** active delivery at a time.
- **COD Credit Reserve**: A rider must hold sufficient wallet credits to accept a Cash on Delivery order. The order's cash value is reserved, protecting restaurants and the platform against loss.
- **Trip Token Authorization**: Real-time GPS tracking rooms require an HMAC-SHA256 token minted by Laravel with strict expiry and subject verification.
