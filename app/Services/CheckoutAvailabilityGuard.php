<?php

namespace App\Services;

use App\Models\Business;
use App\Models\Offering;
use InvalidArgumentException;

/**
 * Final checkout revalidation (Stage 3). Called INSIDE the order-creation
 * transaction, after the friendly pre-checks. It locks the ordered menu
 * items (in id order, so two checkouts never deadlock each other) and
 * re-reads them, so an item switched to Unavailable — or re-priced — after
 * the cart was built can never be ordered:
 *
 *   - a toggle that committed first is seen here and the checkout fails (422),
 *     rolling back the whole order (no partial order is left);
 *   - a toggle that arrives later waits for this row lock, then applies to
 *     future checkouts only. Accepted orders are never changed by it.
 *
 * Availability is a manual Yes/No flag; there are no stock quantities.
 *
 * Dish sales (Promotions Part A): the expected price of each line is worked out
 * again here from the LOCKED dish (SalePricing). Saving, ending or archiving a
 * sale locks the same dish rows first, so a sale change either commits before
 * this check (and the checkout fails with "price changed") or waits until the
 * order exists. A sale that starts or ends between the cart and this check
 * likewise fails the checkout instead of charging a price nobody saw.
 */
class CheckoutAvailabilityGuard
{
    /**
     * @param  list<array{offering_id: int, unit_price: mixed, promotion_id?: int|null, business_id?: int|null}>  $items
     * @param  int|null  $businessId  restaurant for single-restaurant checkouts (items carry their own otherwise)
     */
    public function assertOrderable(array $items, ?int $businessId = null): void
    {
        $ids = array_values(array_unique(array_map(fn ($i) => (int) $i['offering_id'], $items)));
        sort($ids);
        $locked = Offering::query()->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get()->keyBy('id');

        $quotes = app(SalePricing::class)->quoteMany($locked->values());

        $checkedBusinesses = [];
        foreach ($items as $item) {
            $offering = $locked->get((int) $item['offering_id']);
            $expectedBusiness = (int) ($item['business_id'] ?? $businessId);
            if ($offering === null || (int) $offering->business_id !== $expectedBusiness) {
                throw new InvalidArgumentException('An item in your cart is no longer on the menu. Please remove it before continuing.');
            }
            if (! $offering->is_available || in_array($offering->status, ['archived', 'hidden'], true)) {
                throw new InvalidArgumentException($offering->name.' is no longer available. Please remove it from your cart.');
            }
            $quote = $quotes[(int) $offering->id];
            if (round((float) $quote['unit_price'], 2) !== round((float) $item['unit_price'], 2)
                || (int) ($quote['promotion_id'] ?? 0) !== (int) ($item['promotion_id'] ?? 0)) {
                throw new InvalidArgumentException('The price of '.$offering->name.' changed. Please review your cart before placing the order.');
            }

            if (! isset($checkedBusinesses[$expectedBusiness])) {
                $business = Business::find($expectedBusiness);
                if (! $business || ! $business->isAcceptingOrders()) {
                    throw new InvalidArgumentException(($business?->business_name ?? 'A restaurant').' stopped accepting orders. Please remove its items before continuing.');
                }
                $checkedBusinesses[$expectedBusiness] = true;
            }
        }
    }
}
