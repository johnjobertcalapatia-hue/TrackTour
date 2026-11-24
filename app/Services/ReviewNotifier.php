<?php

namespace App\Services;

use App\Models\Business;
use App\Models\Order;
use App\Models\OrderItemReview;
use App\Models\Review;
use App\Models\User;

/**
 * Tells a business owner when a customer rates them: a restaurant review or a
 * dish review. Reviews on the same order fold into one unread notification.
 * Never allowed to break a review write — failures are only reported.
 */
class ReviewNotifier
{
    public function __construct(private InboxNotifier $inbox) {}

    public function businessReview(Review $review): void
    {
        if ($review->status === 'rejected') {
            return;
        }

        $this->send(
            (int) $review->business_id,
            $review->order_id ? (int) $review->order_id : null,
            $review->user_id ? (int) $review->user_id : null,
            (int) $review->rating,
            $review->review,
            ['review_id' => $review->id],
        );
    }

    public function itemReview(OrderItemReview $review): void
    {
        $this->send(
            (int) $review->business_id,
            (int) $review->order_id,
            $review->user_id ? (int) $review->user_id : null,
            (int) $review->rating,
            $review->review,
            ['order_item_review_id' => $review->id],
            $review->orderItem?->product_name,
        );
    }

    private function send(int $businessId, ?int $orderId, ?int $userId, int $rating, ?string $text, array $ref, ?string $dish = null): void
    {
        try {
            $business = Business::find($businessId);
            if (! $business?->owner_id) {
                return;
            }

            $customer = ($userId ? User::whereKey($userId)->value('name') : null) ?: 'A customer';
            $orderNumber = $orderId ? Order::whereKey($orderId)->value('order_number') : null;
            $what = $dish ? "rated {$dish}" : "rated {$business->business_name}";
            $message = "{$rating}★".($orderNumber ? " · Order #{$orderNumber}" : '').($text ? ' — "'.\Illuminate\Support\Str::limit($text, 100).'"' : '');

            $this->inbox->notify(
                (int) $business->owner_id,
                'review_received',
                "{$customer} {$what}",
                $message,
                array_merge(['business_id' => $business->id, 'order_id' => $orderId], $ref),
                // Several dish reviews on one order become one notification.
                $orderId ? ['order_id', 'business_id'] : [],
            );
        } catch (\Throwable $e) {
            report($e);
        }
    }
}
