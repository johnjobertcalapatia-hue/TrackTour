Yes. Your flow is workable, but there are several places where the logic should be tightened before implementation—especially **COD credit accounting, order grouping, rider assignment, pickup confirmation, realtime GPS validation, and the relationship between restaurant orders and the original group checkout**.

The important thing is: **do not treat this as one delivery/order after checkout.** Treat checkout as one **Group Order**, which creates multiple independent **Restaurant Orders**, each with its own delivery and rider.

## 1. Recommended architecture

Your flow should become:

```text
TOURIST CART
    │
    ▼
GROUP CHECKOUT
    │
    ├── Payment: COD / GCash
    │
    ▼
GROUP ORDER
    │
    ├── Restaurant Order A
    │      ├── Items A1, A2
    │      ├── Restaurant A
    │      ├── Delivery Fee A
    │      ├── Rider A
    │      └── Delivery A
    │
    ├── Restaurant Order B
    │      ├── Items B1, B2
    │      ├── Restaurant B
    │      ├── Delivery Fee B
    │      ├── Rider B
    │      └── Delivery B
    │
    └── Restaurant Order C
           ├── Items C1...
           ├── Restaurant C
           ├── Delivery Fee C
           ├── Rider C
           └── Delivery C
```

This is consistent with your existing decision that **one restaurant gets one order even when it contains multiple menu items**.

---

# 2. Step 1 — Tourist creates the cart

The tourist can add:

```text
Restaurant A
    Burger ₱100
    Fries ₱50

Restaurant B
    Chicken ₱120

Restaurant C
    Coffee ₱80
```

The cart is still one checkout.

But internally, every cart item needs its own identity.

For example:

```text
cart_items

id
cart_id
menu_item_id
restaurant_id
quantity
unit_price
subtotal
```

Do not rely on the current menu price after checkout.

When checkout happens, **snapshot the price**.

For example:

```text
Order Item #101
Burger
unit_price = 100
quantity = 1
subtotal = 100
```

If the restaurant later changes Burger from ₱100 → ₱120, Order #101 must remain ₱100.

---

# 3. Step 2 — Checkout creates the Group Order

This is the central transaction.

Example:

```text
GROUP ORDER
TT-84062

Tourist:
John

Payment:
Cash on Delivery

Subtotal:
₱350

Restaurant A delivery fee:
₱50

Restaurant B delivery fee:
₱60

Restaurant C delivery fee:
₱45

Total:
₱505
```

Then create:

```text
restaurant_order A
restaurant_order B
restaurant_order C
```

Each restaurant order gets its own:

```text
restaurant_id
subtotal
delivery_fee
total
status
payment_status
rider_id
```

But the tourist still sees:

> **Order TT-84062**

with the restaurants underneath it.

---

# 4. COD vs GCash needs an important distinction

You currently describe:

> COD is group paid as one whole order.

That's fine.

But technically, the system should distinguish:

### Group payment

```text
payment_method = COD
payment_status = pending_cash_collection
```

Then each restaurant order inherits the group's payment responsibility.

For GCash:

```text
payment_method = GCASH
payment_status = paid
```

The important part is that **GCash should be paid before the restaurant/rider workflow starts**, while COD is a receivable that the rider collects.

---

# 5. Step 3 — Calculate each restaurant's delivery

This should happen **per restaurant order**, not once for the group.

Example:

```text
Restaurant A
distance = 3.2 km
delivery fee = ₱75

Restaurant B
distance = 5.1 km
delivery fee = ₱110
```

So:

```text
Restaurant A
subtotal       ₱150
delivery       ₱75
total          ₱225

Restaurant B
subtotal       ₱120
delivery       ₱110
total          ₱230
```

Group total:

```text
₱455
```

The delivery addresses can be the same tourist address, but the **pickup points are different**.

---

# 6. Step 4 — COD rider eligibility

This is one of the most important parts of your system.

For COD, the rider must pass all conditions:

```text
ONLINE
+
AVAILABLE
+
NO ACTIVE DELIVERY
+
ELIGIBLE SERVICE
+
ENOUGH CREDIT
+
VALID RIDER ACCOUNT
+
VALID REQUIRED DOCUMENTS
```

For example:

```text
Rider #14

Online: YES
Available: YES
Current Delivery: NONE
Food Delivery: YES
Credits: ₱500
Required reserve: ₱200

ELIGIBLE
```

But:

```text
Rider #18

Online: YES
Available: YES
Current Delivery: NONE
Credits: ₱150

NOT ELIGIBLE FOR COD
```

That rider can still receive **GCash-paid deliveries**, assuming the other requirements are satisfied.

This distinction is important.

---

# 7. Do NOT actually "deduct ₱200" when dispatching

Your description says the rider needs ₱200 reserve.

I recommend treating this as:

> **required available credit**, not an immediate deduction.

Example:

```text
Rider credit balance = ₱500

COD order = ₱250

Reserve requirement = ₱200
```

He can accept.

But you need to define whether the system allows:

```text
₱500 - ₱250 = ₱250
```

after accepting, or only after successful delivery.

I recommend:

### At assignment

Reserve the required amount.

```text
available_credit = ₱500
reserved_credit = ₱250
usable_credit = ₱250
```

Then if the delivery succeeds:

```text
reserved ₱250
        ↓
settled
```

This prevents the same rider from being assigned multiple COD orders simultaneously and exceeding his financial capacity.

This is especially important if you later allow multiple deliveries.

---

# 8. Rider dispatch

The system calculates eligible riders.

Conceptually:

```text
Find riders where:

online = true
available = true
active_delivery_count = 0
service_type supports food
account_status = approved
documents = valid
```

For COD additionally:

```text
available_credit >= required_credit
```

Then calculate distance from rider → restaurant.

You can use the Haversine formula for this.

Conceptually:

```text
distance(rider, restaurant)
```

Then sort:

```text
nearest eligible rider
        ↓
second nearest
        ↓
third nearest
```

---

# 9. Rider ping

The system sends:

```text
NEW DELIVERY REQUEST
```

to the first rider.

For example:

```text
Food Delivery

Pickup:
Restaurant A

Drop-off:
Batingan, Gloria

Delivery fee:
₱80

Payment:
Cash on Delivery

Estimated distance:
4.3 km

[ ACCEPT ] [ REJECT ]
```

The request needs an expiration time.

For example:

```text
expires_at = now + 30 seconds
```

If:

```text
ACCEPT
```

→ assign rider.

If:

```text
REJECT
```

→ next eligible rider.

If:

```text
TIMEOUT
```

→ next eligible rider.

---

# 10. Important race-condition protection

You need to prevent this:

```text
Rider A sees order
Rider B sees order

Rider A clicks ACCEPT
Rider B clicks ACCEPT
```

Only one can win.

Your backend needs an atomic assignment.

Conceptually:

```text
if delivery.status == OFFERED
    assign rider
else
    reject acceptance
```

The database transaction should lock the delivery record while assignment occurs.

This is critical.

---

# 11. After rider accepts

Your proposed transition:

```text
Waiting for Rider
       ↓
Preparing
```

is reasonable.

But I would separate **rider assignment** from **restaurant preparation**.

Use:

```text
delivery.status = assigned
restaurant_order.status = preparing
```

rather than making everything one status.

You therefore have two independent state machines.

### Restaurant order

```text
PENDING
↓
PREPARING
↓
READY
↓
PICKED_UP
↓
DELIVERING
↓
DELIVERED
```

### Delivery

```text
SEARCHING_RIDER
↓
OFFERED
↓
ASSIGNED
↓
RIDER_AT_PICKUP
↓
PICKED_UP
↓
IN_TRANSIT
↓
RIDER_AT_DROPOFF
↓
COMPLETED
```

This is much cleaner.

---

# 12. Restaurant responsibility

Your rule is correct:

> The restaurant cannot mark the restaurant order Ready until every item belonging to that restaurant is ready.

Example:

```text
Restaurant A

Burger       READY
Fries        READY
Milkshake    PREPARING
```

Therefore:

```text
Restaurant Order A
= PREPARING
```

Not ready yet.

Once:

```text
Burger       READY
Fries        READY
Milkshake    READY
```

then:

```text
Restaurant Order A
        ↓
READY
```

This prevents the rider from arriving and waiting unnecessarily.

---

# 13. Individual item state

Keep the item-level status.

For example:

```text
order_items

101 Burger
status = ready

102 Fries
status = ready

103 Milkshake
status = preparing
```

Then restaurant-level status is calculated from those items.

Something like:

```text
ALL items ready
        ↓
restaurant_order = READY
```

This is better than allowing the restaurant employee to manually create inconsistent states.

---

# 14. Preparation prediction

Your existing preparation prediction system fits here.

When:

```text
restaurant_order → PREPARING
```

record:

```text
preparation_started_at
```

When each item becomes ready:

```text
ready_at
```

Then when the entire restaurant order becomes ready:

```text
actual_preparation_seconds
```

can be calculated.

Your existing requirement of having enough historical records before enabling automatic prediction is sensible.

The flow becomes:

```text
Historical records
       ↓
Prediction available?
       ↓
YES → estimated preparation time
NO  → default preparation time
```

The predicted time can also improve rider dispatch timing.

---

# 15. Rider should NOT necessarily arrive immediately

This is an important optimization.

If:

```text
Food preparation = 15 minutes
```

and rider is already at the restaurant in 2 minutes, you create:

```text
Rider waiting
```

which is bad operationally.

Instead:

```text
Restaurant accepts
       ↓
Estimate preparation
       ↓
Dispatch/route timing
       ↓
Rider arrives near readiness
```

Your previous idea of allowing a 2–3 minute buffer makes sense.

---

# 16. Pickup geofence

Your 50–100m idea is useful.

But don't make GPS distance alone automatically confirm pickup.

Instead:

```text
Rider location
      ↓
within pickup radius?
      ↓
YES
      ↓
SHOW ARRIVAL ALERT
```

Example:

> 📍 You've arrived at the pickup point.

Then:

```text
[ Confirm Pickup ]
```

The button should be the actual transition.

---

# 17. Pickup confirmation

When rider confirms:

```text
delivery.status = PICKED_UP

restaurant_order.status = PICKED_UP

rider.status = ON_DELIVERY
```

Then:

```text
delivery.status = IN_TRANSIT
```

The tourist receives:

> Your order has been picked up and is on the way.

---

# 18. Realtime rider tracking

Your WebSocket architecture is appropriate here.

The flow should be:

```text
Rider phone/browser
      │
      │ GPS
      ▼
WebSocket server
      │
      ├── Tourist
      │
      └── Backend
```

The tourist sees:

```text
Restaurant
    ↓
    🛵
    ↓
Destination
```

The rider sees the navigation map.

---

# 19. Don't treat every GPS jump as spoofing

This is a very important correction.

If the rider loses internet:

```text
GPS:
A → B → C → [NO INTERNET] → F
```

the server might see:

```text
C → F
```

as a huge jump.

That does **not automatically mean spoofing**.

The rider could genuinely have moved while offline.

So you need:

### Device-side location history

Store recent GPS samples locally.

When connectivity returns:

```text
queued GPS points
       ↓
WebSocket
       ↓
server
```

Then the server can reconstruct the actual movement.

---

# 20. Haversine is correct—but not enough by itself

Yes, Haversine is appropriate for calculating geographic distance between two coordinates.

But spoof detection should use:

```text
distance
+
time
+
speed
+
accuracy
+
timestamp
+
GPS continuity
```

For two points:

```text
distance = Haversine(point1, point2)

elapsed = timestamp2 - timestamp1

speed = distance / elapsed
```

Then compare with reasonable motorcycle movement thresholds.

Example:

```text
Previous point:
14:00:00

Next point:
14:00:05

Distance:
3.5 km

Calculated speed:
2,520 km/h
```

That is physically implausible.

Flag it.

But don't immediately say:

> Rider is cheating.

Instead:

```text
location_integrity_status = suspicious
```

and collect evidence.

---

# 21. Use multiple levels of GPS anomaly detection

I recommend:

```text
NORMAL
```

```text
LOW_ACCURACY
```

```text
GPS_GAP
```

```text
UNREALISTIC_SPEED
```

```text
TELEPORTATION
```

```text
SUSPICIOUS
```

This gives you an audit trail.

For example:

```text
Rider #14
14:05:12 → 14:05:17
distance = 4.2 km
speed = 3,024 km/h

Flag:
TELEPORTATION
```

That can later be reviewed.

---

# 22. Drop-off geofence

When:

```text
distance(rider, destination) <= configured radius
```

show:

> 📍 You've arrived at the drop-off point.

Then:

```text
[ Confirm Delivered ]
```

Do not automatically mark it delivered merely because GPS entered the radius.

The rider needs to confirm the physical handoff.

---

# 23. COD completion

For COD:

```text
Rider arrives
      ↓
Customer gives cash
      ↓
Rider confirms cash received
      ↓
Delivery completed
```

Then:

```text
payment_status = PAID_CASH
delivery.status = COMPLETED
restaurant_order.status = COMPLETED
```

This should be an auditable financial event.

---

# 24. Your 20% system deduction needs clarification

You said:

> orders payment will be deduct 20% for the system

This should not be mixed into rider credits.

Use separate accounting records.

For example:

```text
COD collected
₱300

Platform share
₱60

Restaurant/merchant amount
₱240
```

But the exact commercial split should be defined explicitly because your delivery fee, restaurant proceeds, platform commission, and rider earnings are different financial concepts.

Do **not** simply do:

```text
order.total × 20%
```

unless that is explicitly your platform commission rule.

Instead have a financial ledger.

---

# 25. Rider credit system

This is one of the areas I'd change most from your current description.

Don't simply maintain:

```text
rider.credit = 500
```

and randomly subtract values.

Create a ledger.

Example:

```text
rider_credit_transactions

id
rider_id
delivery_id
type
amount
balance_after
reference
created_at
```

Types:

```text
TOP_UP
COD_RESERVATION
COD_SETTLEMENT
COD_RELEASE
ADJUSTMENT
REFUND
```

Then you have an auditable financial history.

---

# 26. COD reserve

Example:

Rider starts with:

```text
Credit = ₱500
```

COD delivery:

```text
Customer payable = ₱300
```

System:

```text
Available credit = ₱500
Reserved = ₱300
Available = ₱200
```

After successful delivery:

```text
COD settlement
```

The ₱300 becomes the platform/merchant receivable according to your accounting model.

If delivery fails:

```text
COD reservation released
```

This is much safer than simply subtracting credits.

---

# 27. ₱200 threshold

Your rule can be implemented as:

```text
COD eligible if available_credit >= ₱200
```

But you should decide whether:

```text
₱200
```

means:

### Option A

Minimum balance to receive **any** COD.

or:

### Option B

Minimum balance after reserving the current COD amount.

I recommend documenting the rule precisely.

For example:

```text
available_credit >= required_reserve
```

Then the UI can clearly say:

> COD unavailable — top up ₱150 to continue accepting COD deliveries.

---

# 28. GCash delivery

For GCash:

```text
Tourist
   ↓
PayMongo
   ↓
Payment successful
   ↓
Group Order PAID
   ↓
Restaurant Orders PAID
   ↓
Dispatch
```

The rider doesn't need to collect cash.

Therefore the rider's COD credit isn't consumed.

The rider still earns:

```text
delivery earnings
+
tips
```

---

# 29. Rider earnings should be separate from rider credits

This is another critical separation.

You should have:

### Rider credit

Money used to support COD settlement/eligibility.

### Rider earnings

Money the rider has earned.

These are **not the same wallet**.

Example:

```text
Rider Credit
₱500

Rider Earnings
₱1,250
```

Don't merge them.

---

# 30. Rider earnings

For each completed delivery:

```text
delivery_fee
+
tip
=
rider_earning
```

Example:

```text
Delivery fee     ₱80
Tip              ₱50
--------------------
Rider earning   ₱130
```

Create an earnings record:

```text
rider_earnings

id
rider_id
delivery_id
delivery_fee
tip
total
status
created_at
```

---

# 31. Tips

Your proposed:

```text
minimum ₱20
maximum ₱100
```

can be enforced at checkout.

For example:

```text
No tip
₱20
₱40
₱60
₱80
₱100
```

The tip should be associated with the **specific restaurant delivery**, not just the group order, because each restaurant has its own rider.

For example:

```text
Restaurant A → Rider #14 → ₱50 tip

Restaurant B → Rider #18 → ₱20 tip
```

This is much cleaner.

---

# 32. Fast Delivery

You mentioned:

> tips will be given when fast delivery is activated

I'd separate these concepts.

Fast delivery should affect:

```text
dispatch priority
ETA
possibly delivery fee
```

A tip should be optional and independent.

Otherwise your financial logic becomes confusing.

You can have:

```text
Fast Delivery
      ↓
Priority/optimized dispatch
```

and:

```text
Tip
      ↓
Rider earning
```

---

# 33. Instant cash out

The rider's earnings can become:

```text
EARNED
 ↓
AVAILABLE
 ↓
CASHOUT_REQUESTED
 ↓
PROCESSING
 ↓
PAID
```

For PayMongo integration, make the payout state asynchronous.

Do not assume:

```text
API request successful = money already received
```

Store the provider transaction/reference ID.

For example:

```text
payouts

id
rider_id
amount
provider
provider_reference
status
requested_at
completed_at
```

---

# 34. Your complete lifecycle

Putting everything together:

```text
TOURIST
│
├── Add items
│
├── Cart groups items by restaurant
│
└── Checkout
       │
       ▼
GROUP ORDER CREATED
       │
       ├── Payment = COD
       │
       │
       └── OR Payment = GCASH
       │
       ▼
RESTAURANT ORDERS CREATED
       │
       ├──────────────┐
       ▼              ▼
Restaurant A      Restaurant B
       │              │
       ▼              ▼
Calculate fee    Calculate fee
       │              │
       ▼              ▼
Find riders      Find riders
       │              │
       ▼              ▼
Offer Rider A    Offer Rider B
       │              │
       ▼              ▼
Accept           Accept
       │              │
       ▼              ▼
Preparing        Preparing
       │              │
       ▼              ▼
All items ready  All items ready
       │              │
       ▼              ▼
READY            READY
       │              │
       ▼              ▼
Rider arrives    Rider arrives
       │              │
       ▼              ▼
Pickup confirm   Pickup confirm
       │              │
       ▼              ▼
IN TRANSIT       IN TRANSIT
       │              │
       ▼              ▼
Realtime GPS     Realtime GPS
       │              │
       ▼              ▼
Dropoff geofence Dropoff geofence
       │              │
       ▼              ▼
Confirm delivery Confirm delivery
       │              │
       ▼              ▼
COD collection  Already paid
       │              │
       ▼              ▼
Settlement       Settlement
       │              │
       └──────┬───────┘
              ▼
        GROUP ORDER
          COMPLETED
```

---

# 35. Database structure I recommend

Your current system can evolve toward this:

### `group_orders`

```text
id
order_number
tourist_id
delivery_address_id
payment_method
payment_status
subtotal
delivery_fee
tip_total
total
status
created_at
updated_at
```

### `orders`

Your existing restaurant order table:

```text
id
group_order_id
restaurant_id
subtotal
delivery_fee
total
status
payment_status
created_at
updated_at
```

### `order_items`

```text
id
order_id
menu_item_id
item_name_snapshot
unit_price
quantity
subtotal
status
preparation_started_at
ready_at
```

The snapshots are important.

---

# 36. `deliveries`

```text
id
order_id
rider_id
pickup_latitude
pickup_longitude
dropoff_latitude
dropoff_longitude

status

assigned_at
accepted_at
arrived_pickup_at
picked_up_at
arrived_dropoff_at
delivered_at

payment_method
cash_collected
```

---

# 37. `delivery_offers`

This table is very important for your dispatch system.

```text
id
delivery_id
rider_id

distance_to_pickup
eligibility_snapshot

status

offered_at
expires_at
responded_at
```

Status:

```text
PENDING
ACCEPTED
REJECTED
EXPIRED
CANCELLED
```

This lets you prove exactly what happened during dispatch.

---

# 38. `rider_locations`

For your WebSocket tracking:

```text
id
rider_id
delivery_id
latitude
longitude
accuracy
speed
heading
recorded_at
received_at
integrity_status
```

Don't overwrite everything.

You want a location history for completed deliveries.

---

# 39. `rider_credit_transactions`

```text
id
rider_id
delivery_id
type
amount
balance_before
balance_after
reference
created_at
```

---

# 40. `rider_earnings`

```text
id
rider_id
delivery_id
delivery_fee
tip
total
status
created_at
```

---

# 41. `rider_payouts`

```text
id
rider_id
amount
provider
provider_reference
status
requested_at
completed_at
```

---

# 42. WebSocket events

Your existing WebSocket architecture can be organized around events like:

### Dispatch

```text
delivery_offer
delivery_offer_expired
delivery_accepted
delivery_rejected
```

### Restaurant

```text
restaurant_order_accepted
item_preparing
item_ready
restaurant_order_ready
```

### Pickup

```text
rider_arrived_pickup
pickup_confirmed
```

### Tracking

```text
rider_location_update
rider_location_stream
```

### Drop-off

```text
rider_arrived_dropoff
delivery_confirmed
```

### Payment

```text
cash_received
delivery_settled
rider_earning_created
```

---

# 43. Notifications

Don't make every event a giant popup.

### Rider

Use your global floating alert for:

```text
New delivery request
You've arrived at pickup
You've arrived at destination
```

### Restaurant

Use operational notifications:

```text
New order
Item ready
All items ready
Rider arriving
```

### Tourist

Use order tracking updates:

```text
Order confirmed
Restaurant preparing
Rider assigned
Rider picked up
Rider nearby
Delivered
```

---

# 44. Failure cases you need to implement

Before calling the system complete, test these:

### No rider

```text
Restaurant ready
↓
No eligible riders
↓
Retry dispatch
↓
Still none
↓
Order requires intervention/cancellation policy
```

### Rider rejects

```text
Rider A rejects
↓
Rider B offered
```

### Rider timeout

```text
Rider A doesn't respond
↓
offer expires
↓
Rider B
```

### Restaurant rejects item

You already have item-level rejection/refund logic. The restaurant order must recalculate appropriately.

### Restaurant never responds

Your auto-cancellation policy kicks in.

### Rider accepts but goes offline

```text
assigned
↓
rider offline
↓
timeout/reassignment policy
```

### GPS unavailable

Don't mark the rider as spoofing immediately.

### Internet interruption

Queue GPS points client-side.

### Customer doesn't answer

You need a failed-delivery state.

### Customer doesn't have enough cash

You need a COD failure workflow.

### Rider reports wrong cash amount

Financial audit trail is required.

### Payment provider failure

GCash must not transition to paid until confirmed.

---

# 45. One major issue: COD with multiple restaurants

This is the biggest business-logic issue in your flow.

Suppose:

```text
Restaurant A = ₱300
Restaurant B = ₱500
Restaurant C = ₱200
```

The tourist pays:

```text
₱1,000
```

But three different riders collect money independently.

Then the system must know exactly how much each rider is supposed to collect.

Therefore:

```text
Restaurant A Delivery
cash_due = ₱300

Restaurant B Delivery
cash_due = ₱500

Restaurant C Delivery
cash_due = ₱200
```

Do **not** make the rider look at the overall group total.

Each delivery gets its own:

```text
cash_due
```

This is essential.

---

# 46. Even better: separate "order total" from "cash due"

For every restaurant order:

```text
subtotal
delivery_fee
tip
discount
total
cash_due
```

For example:

```text
Restaurant A

Food subtotal       ₱250
Delivery fee         ₱50
Tip                  ₱20
-------------------------
Cash due             ₱320
```

Then the rider sees:

> **Collect ₱320**

and not the entire group order amount.

---

# 47. COD accounting example

Suppose:

```text
Restaurant A
Food = ₱250
Delivery = ₱50
Tip = ₱20

Total = ₱320
```

Customer gives rider:

```text
₱500
```

Rider records:

```text
cash_received = ₱500
change_given = ₱180
cash_due = ₱320
```

Your system should record the actual transaction.

This protects both the rider and the platform.

---

# 48. Recommended implementation order

Don't implement all of this simultaneously.

### Phase 1 — Order foundation

Implement:

```text
Cart
↓
Group Order
↓
Restaurant Orders
↓
Order Items
```

Test:

```text
Restaurant A + Restaurant B
```

and verify the correct grouping.

---

### Phase 2 — Financial calculation

Implement:

```text
restaurant subtotal
delivery fee
tip
cash_due
group total
```

Test COD and GCash separately.

---

### Phase 3 — Rider eligibility

Implement:

```text
online
available
service eligibility
document validity
active delivery
credit balance
COD eligibility
```

---

### Phase 4 — Dispatch

Implement:

```text
nearest rider
↓
offer
↓
accept/reject
↓
timeout
↓
next rider
```

Then add atomic locking.

---

### Phase 5 — Restaurant preparation

Implement:

```text
accepted
↓
preparing
↓
item ready
↓
ALL items ready
↓
restaurant order ready
```

Integrate your preparation prediction afterward.

---

### Phase 6 — Pickup

Implement:

```text
GPS
↓
50–100m
↓
arrival alert
↓
confirm pickup
```

---

### Phase 7 — Realtime tracking

Implement:

```text
WebSocket
↓
GPS stream
↓
tourist map
↓
rider map
```

Then add offline buffering.

---

### Phase 8 — GPS integrity

Implement:

```text
Haversine
+
time difference
+
speed
+
accuracy
+
GPS gaps
+
location history
```

Do this **after basic tracking works**.

---

### Phase 9 — Drop-off

Implement:

```text
50–100m
↓
arrival alert
↓
Confirm delivered
```

---

### Phase 10 — COD settlement

Implement:

```text
cash due
↓
cash received
↓
change
↓
settlement
↓
credit transaction
↓
restaurant/platform accounting
```

---

### Phase 11 — Rider earnings

Implement:

```text
delivery completed
↓
earning created
↓
tip included
↓
available balance
```

---

### Phase 12 — PayMongo payout

Finally:

```text
available earnings
↓
cash out
↓
PayMongo
↓
provider transaction
↓
payout status
```

---

# 49. Final state model

I recommend your implementation ultimately use these independent states:

```text
GROUP ORDER
────────────────────
PENDING
PARTIALLY_PROCESSING
PARTIALLY_COMPLETED
COMPLETED
CANCELLED
```

### Restaurant Order

```text
PENDING
PREPARING
READY
PICKED_UP
DELIVERING
DELIVERED
CANCELLED
REFUNDED
```

### Delivery

```text
SEARCHING_RIDER
OFFERED
ASSIGNED
RIDER_AT_PICKUP
PICKED_UP
IN_TRANSIT
RIDER_AT_DROPOFF
COMPLETED
FAILED
CANCELLED
```

### Item

```text
PENDING
ACCEPTED
PREPARING
READY
REJECTED
REFUNDED
```

### Payment

```text
PENDING
PROCESSING
PAID
CASH_COLLECTED
FAILED
REFUNDED
```

### Rider offer

```text
PENDING
ACCEPTED
REJECTED
EXPIRED
CANCELLED
```

This separation will make your Laravel implementation **far more reliable** than trying to make one `orders.status` field represent everything.

---

## The most important architectural rule

Your system should think of the transaction like this:

```text
                    GROUP ORDER
                         │
             ┌───────────┴───────────┐
             │                       │
       RESTAURANT A             RESTAURANT B
             │                       │
       Restaurant Order        Restaurant Order
             │                       │
         Delivery A              Delivery B
             │                       │
          Rider A                  Rider B
             │                       │
         Preparation            Preparation
             │                       │
          Pickup A                Pickup B
             │                       │
        Tracking A              Tracking B
             │                       │
        Delivery A              Delivery B
             │                       │
        Settlement              Settlement
```

**The tourist sees one checkout/order experience, but the backend operates each restaurant fulfillment as an independent operational unit.**

That is the key design decision that makes your multi-restaurant COD + separate riders + separate delivery fees + individual item tracking flow manageable.
