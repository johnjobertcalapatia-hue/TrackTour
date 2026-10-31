# Rider Wallet & Financial Rules

> **Architecture note (P11 clean-up):** the former prepaid rider-credit wallet
> (`rider_credits`, `rider_credit_transactions`, `rider_top_ups`,
> `deliveries.cod_credit_reserved`) has been **removed**. COD is now
> **credit-free**: no wallet balance is checked, reserved, or deducted for a
> COD dispatch or settlement. This document describes the current authority.

## 1. Rider Financial Concepts

- **COD cash**: physical cash the tourist hands to the rider at delivery. The
  rider keeps it (not remitted to TrackTour).
- **Rider earnings**: `delivery commission + eligible tip`, recorded in
  `rider_earnings`. COD cash is **not** rider earnings.
- **Rider credit**: removed. There is no prepaid financing ledger for COD.

The current dispatch has no COD credit-eligibility step. `NearestRiderService`
returns a credit-free `getCodEligibility()` (no `available_working_credit`,
`enough_credits`, etc.) and COD riders are not filtered by wallet balance.

---

## 2. COD Settlement & Revenue Allocation (At Delivery)

When the rider hands food to the customer and the delivery is settled:

1. **Cash Collection**: the rider collects 100% of physical cash from the
   tourist:
   $$\text{cash\_collected} = \text{food subtotal} + \text{system fee} + \text{delivery fee} + \text{rider tip}$$
2. The rider keeps the collected cash.
3. **Auditable Settlement Allocation (`cod_settlements`)** — booked by
   `CodSettlementService` inside the atomic settlement transaction. The split
   base is the rider-financed/restaurant-platform amount:
   $$\text{settlement\_base} = \text{order.subtotal} + \text{order.system\_fee}$$
   - **Restaurant Share (80%)**: credited to the restaurant's payable balance.
   - **Tourism Office / Platform Share (20%)**: retained by the municipality of
     Bansud as platform commission.
   - *Note*: the fast-delivery tip and delivery commission are excluded from
     the settlement split and belong 100% to the rider.
4. No rider-credit deduction occurs at settlement. The authoritative invariant:
   $$\text{delivery.cod\_credit\_reserved} = \text{order.rider\_financed\_amount} = \text{restaurant share} + \text{Tourism Office share}$$
   (with `cod_credit_reserved` removed, the base is simply
   `order.rider_financed_amount`).

---

## 3. Rider Earnings & Payout Workflow

### Earnings Generation:
- On every completed delivery (Prepaid or COD), a row is recorded in `rider_earnings`:
  $$\text{total\_earning} = \text{delivery\_commission} + \text{rider\_tip}$$
- Backstopped by a database unique constraint: `UNIQUE(rider_id, order_id, status)`.

### Payout Lifecycle (`RiderPayoutService`):
1. **Request**: Rider requests payout of all unencumbered earnings (`GET /rider/payouts/available`).
2. **Locking**: An active payout is created in `rider_payouts` with status `pending`. Earnings are linked via pivot `rider_payout_rider_earning`.
3. **Double-Draw Prevention**:
   - Pivot table enforces `UNIQUE(rider_earning_id)` so an earning cannot be submitted into multiple payouts.
   - Rider row holds `active_payout_key` ensuring only one active payout request exists at any time.
4. **Approval & Disbursement**:
   - Admin reviews the request (`approved`).
   - Admin disburses funds offline (GCash / Bank Transfer) and confirms `markPaid()`.
   - If rejected or cancelled, earnings are detached from the pivot and returned to the rider's available balance.

## 4. Approved COD Cash-Fund Policy Transition

The Tourism Office has approved a future daily cash-fund liquidation and COD
remittance workflow. The legacy ownership rule in sections 1–2 remains active
until an authorized Tourism Office administrator configures and approves a
Philippine-local effective date. The new policy is not activated by the cash
ledger foundation alone.

Under the approved future policy:

- Daily remittance is based on verified physical COD collections, less
  authoritative rider delivery-fee earnings, rider tips, verified personal
  restaurant-purchase contributions, and other explicitly approved rider
  entitlements. A negative balance is payable to the rider, not a negative
  remittance.
- Unused Tourism Office purchasing cash is returned separately from COD
  remittance. These amounts must not be double-counted.
- The existing configured COD 80/20 allocation remains a separate accounting
  calculation. It is not deducted again from physical COD remittance.
- A canonical group delivery is assigned to the Philippine-local date of its
  final successful completion. Pre-effective-date completed deliveries remain
  under the legacy policy, including those whose COD collection is unsettled.
- Actual restaurant purchase amounts must reconcile exactly to verified
  Tourism Office cash used plus verified rider personal contribution and must
  have private receipt evidence.

The current implementation records Tourism Office cash issuances and rider
receipt acknowledgements in a cash-fund ledger. Riders can submit actual
restaurant purchase funding and private receipt evidence; the Tourism Office
verifies or rejects those claims. A read-only daily receipt preview is
available to the rider and the municipality-scoped Tourism Office. It uses
successful COD cash payments, authoritative rider earnings, verified personal
purchase contributions, and existing COD settlement allocations. It reports
net COD due separately from tourist cash tender and change. The preview does
not record remittance, cash received, cash returned, reimbursement, or a daily
close. Its cumulative unreturned fund balance is informational and carried
forward; it is not included in COD remittance.

The new ownership policy remains inactive. Do not treat the preview as a
financial receipt, permission to change the legacy COD cash ownership behavior,
or authorization to deploy/activate the policy. Rider submission and Tourism
Office verification/close screens now exist, backed by revisioned daily
reconciliation records and append-only audit events. However, all mutations are
server-gated by `cod_cash.reconciliation_enabled` and an approved effective
date; both remain disabled/unset by default. A pre-effective date remains under
the legacy policy and does not receive a remittance calculation from the future
workflow.

The new records capture rider-reported remittance/returned cash and the
Tourism Office's independently counted amounts; they do not prove a bank
transfer or activate the new cash-ownership policy. The reconciliation migration
has been exercised through SQLite tests only. MySQL row-lock concurrency,
production migration, and policy activation remain deferred pending explicit
approval and database verification.