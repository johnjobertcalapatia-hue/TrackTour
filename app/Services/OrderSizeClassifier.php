<?php

namespace App\Services;

use App\Models\Order;
use App\Models\OrderItem;

/**
 * P5.2 basic order-size classification.
 *
 * Deliberately lightweight: this is NOT a weight/dimension or vehicle-capacity
 * engine. It only buckets an order into 'normal' or 'large' using the live item
 * quantity (and distinct line count) so unusually large orders can be surfaced
 * for operational review. Large orders are flag-only: they are still dispatched
 * through the normal pipeline; the one-active-delivery rule remains the only
 * hard dispatch constraint.
 *
 * Thresholds are configurable in config/delivery.php under `order_size`.
 */
class OrderSizeClassifier
{
    public const NORMAL = 'normal';
    public const LARGE = 'large';

    /** @var array<int, string> */
    public const SIZES = [self::NORMAL, self::LARGE];

    /**
     * Classify an order from its current items. Rejected items and cancelled
     * quantities are excluded so a shrunk order can fall back to 'normal'.
     */
    public function classify(Order $order): string
    {
        $quantity = 0;
        $lineItems = 0;

        /** @var OrderItem $item */
        foreach ($order->items()->get() as $item) {
            if ($item->isRejected()) {
                continue;
            }

            $active = $item->activeQuantity();
            if ($active <= 0) {
                continue;
            }

            $quantity += $active;
            $lineItems++;
        }

        $quantityThreshold = max(1, (int) config('delivery.order_size.large_item_quantity', 12));
        $lineThreshold = max(1, (int) config('delivery.order_size.large_line_items', 6));

        if ($quantity >= $quantityThreshold || $lineItems >= $lineThreshold) {
            return self::LARGE;
        }

        return self::NORMAL;
    }

    public function isLarge(Order $order): bool
    {
        return $this->classify($order) === self::LARGE;
    }

    /**
     * Recompute and persist the order's size_class tag. Only writes when the
     * class actually changed, so this is cheap to call on every item save.
     *
     * @return string the (possibly unchanged) size class
     */
    public function sync(Order $order): string
    {
        $class = $this->classify($order);

        if ($order->size_class !== $class) {
            $order->forceFill(['size_class' => $class])->save();
        }

        return $class;
    }

    /**
     * Dispatch-eligibility view for an order. Flag-only in P5.2: large orders
     * remain dispatchable (dispatchable = true) but are flagged so callers can
     * surface them for operational review. This is the seam a future hard gate
     * would extend, without touching the dispatch pipeline again.
     *
     * @return array{size_class: string, requires_review: bool, dispatchable: bool}
     */
    public function dispatchEligibility(Order $order): array
    {
        $class = $this->classify($order);

        return [
            'size_class' => $class,
            'requires_review' => $class === self::LARGE,
            'dispatchable' => true,
        ];
    }
}
