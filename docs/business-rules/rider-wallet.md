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