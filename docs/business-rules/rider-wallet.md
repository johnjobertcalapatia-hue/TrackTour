# Rider Wallet & Financial Rules

## 1. Credit Wallet Architecture

Every rider maintains a prepaid credit balance stored in `rider_credits` and logged in `rider_credit_transactions`. This credit wallet acts as financial collateral for Cash on Delivery (COD) deliveries.

### Balance Definitions:
- **`total_credits`**: The total cash value deposited by the rider into the platform.
- **`reserved_credits`**: Funds temporarily locked as collateral for in-progress COD deliveries.
- **`minimum_reserve`**: Minimum buffer required to remain eligible for dispatches (default `₱0.00` or configured platform minimum).
- **`usable_balance`**: Formula:
  $$\text{usable\_balance} = \max(0, \text{total\_credits} - \text{minimum\_reserve} - \text{reserved\_credits})$$

---

## 2. COD Credit Reservation (At Dispatch Acceptance)

When a rider accepts a COD delivery:
1. The required financed amount is:
   $$\text{settlement\_base} = \text{order.subtotal} + \text{order.system\_fee}$$
2. The system checks:
   $$\text{usable\_balance} \ge \text{settlement\_base}$$
3. If insufficient, acceptance is blocked with an `ineligible` error.
4. If eligible, `reserved_credits` is incremented by `settlement_base`, locking that amount from being used on other deliveries.
5. If the order is subsequently cancelled before pickup or delivery, `releaseCodCredit()` unlocks the reserve, restoring usable balance.

---

## 3. COD Settlement & Revenue Allocation (At Delivery)

When the rider successfully hands food to the customer and marks the delivery `delivered`:
1. **Cash Collection**: The rider collects 100% of physical cash from the tourist:
   $$\text{cash\_collected} = \text{food subtotal} + \text{system fee} + \text{delivery fee} + \text{rider tip}$$
2. **Credit Finalization**:
   - The rider keeps the collected cash in hand.
   - The platform finalizes the credit lock: `total_credits` is decremented by `settlement_base`, and `reserved_credits` is released.
3. **Auditable Settlement Allocation (`cod_settlements`)**:
   Inside the atomic settlement transaction, `CodSettlementService` splits the `settlement_base`:
   - **Restaurant Share (80%)**: Credited to the restaurant's payable balance.
   - **Tourism Office / Platform Share (20%)**: Retained by the municipality of Bansud as platform commission.
   - *Note*: Fast delivery tips and delivery commissions are excluded from the settlement split and belong 100% to the rider.

---

## 4. Rider Earnings & Payout Workflow

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
