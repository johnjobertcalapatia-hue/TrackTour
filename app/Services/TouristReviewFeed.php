<?php

namespace App\Services;

use App\Enums\DiscoveryGroup;
use App\Models\Business;
use App\Models\Order;
use App\Models\OrderItemReview;
use App\Models\Review;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * Everything a tourist has reviewed, as one list grouped by what was
 * reviewed (My Reviews tabs):
 *  - food        — each dish (order_item_reviews);
 *  - restaurant  — the restaurant of a food order, or a dining business (reviews);
 *  - rider       — the delivery rider of a food order (orders.delivery_rating)
 *                  and the driver of a ride (transport orders.rating);
 *  - resort      — accommodation businesses (resorts, hotels, homestays…);
 *  - attraction  — tourist spots;
 *  - other       — any other business (shown under "All" only).
 * Business categories follow DiscoveryGroup, the same grouping Explore uses.
 */
class TouristReviewFeed
{
    public const CATEGORIES = ['food', 'restaurant', 'rider', 'resort', 'attraction'];

    /** Newest reviews kept per source (a tourist's own history: small). */
    private const LIMIT = 200;

    /**
     * @return array{items: list<array<string, mixed>>, counts: array<string, int>}
     */
    public function for(User $user): array
    {
        $items = collect()
            ->concat($this->dishes($user))
            ->concat($this->businesses($user))
            ->concat($this->deliveryRiders($user))
            ->concat($this->rides($user))
            ->sortByDesc('created_at')
            ->values();

        $counts = ['all' => $items->count()];
        foreach (self::CATEGORIES as $category) {
            $counts[$category] = $items->where('category', $category)->count();
        }

        return [
            'items' => $items->map(fn (array $item) => [...$item, 'created_at' => $item['created_at']?->toIso8601String()])->all(),
            'counts' => $counts,
        ];
    }

    private function dishes(User $user): Collection
    {
        $reviews = OrderItemReview::where('user_id', $user->id)
            ->with(['offering:id,name', 'orderItem'])
            ->latest()->limit(self::LIMIT)->get();
        $businesses = Business::whereIn('id', $reviews->pluck('business_id')->filter()->unique())->pluck('business_name', 'id');
        // A dish review is moderated with its order's restaurant review.
        $statuses = Review::whereIn('order_id', $reviews->pluck('order_id')->filter()->unique())->pluck('status', 'order_id');

        return $reviews->map(fn (OrderItemReview $r) => [
            'key' => 'food-'.$r->id,
            'category' => 'food',
            'title' => $r->offering?->name ?? $r->orderItem?->product_name ?? 'Dish',
            'subtitle' => $businesses[$r->business_id] ?? null,
            'rating' => (int) $r->rating,
            'comment' => $r->review,
            'images' => array_values(array_filter((array) $r->images, 'is_string')),
            'tags' => [],
            'details' => [],
            'would_recommend' => null,
            'status' => $statuses[$r->order_id] ?? null,
            'link' => $r->offering_id ? "/tourist/food/item/{$r->offering_id}" : null,
            'created_at' => $r->created_at,
        ]);
    }

    private function businesses(User $user): Collection
    {
        $reviews = Review::where('user_id', $user->id)
            ->with(['business:id,business_name,business_category_id', 'business.category:id,name', 'order:id,order_type,order_number'])
            ->latest()->limit(self::LIMIT)->get();

        return $reviews->map(function (Review $r) {
            $details = [];
            foreach (['food_rating' => 'Food', 'service_rating' => 'Service', 'cleanliness_rating' => 'Cleanliness', 'atmosphere_rating' => 'Atmosphere', 'value_rating' => 'Value'] as $field => $label) {
                if ($r->{$field}) {
                    $details[] = ['label' => $label, 'value' => $r->{$field}.'/5'];
                }
            }

            return [
                'key' => 'business-'.$r->id,
                'category' => $this->businessCategory($r),
                'title' => $r->business?->business_name ?? 'Business',
                'subtitle' => $r->order?->order_number ? 'Order '.$r->order->order_number : $r->business?->category?->name,
                'rating' => (int) $r->rating,
                'comment' => $r->review,
                'images' => [],
                'tags' => [],
                'details' => $details,
                'would_recommend' => $r->would_recommend,
                'status' => $r->status,
                'link' => $r->business_id ? "/tourist/explore/{$r->business_id}" : null,
                'created_at' => $r->created_at,
            ];
        });
    }

    private function businessCategory(Review $review): string
    {
        // A review left on a food order is always about the restaurant, even
        // for a hotel-and-restaurant business.
        if ($review->order && $review->order->order_type !== 'transport') {
            return 'restaurant';
        }

        return match (DiscoveryGroup::fromCategoryName($review->business?->category?->name)) {
            DiscoveryGroup::Spot => 'attraction',
            DiscoveryGroup::Accommodation => 'resort',
            DiscoveryGroup::Dining => 'restaurant',
            DiscoveryGroup::Other => 'other',
        };
    }

    /** The rider's rating on a delivered food order. */
    private function deliveryRiders(User $user): Collection
    {
        $orders = Order::where('user_id', $user->id)
            ->where('order_type', '!=', 'transport')
            ->whereNotNull('delivery_rating')
            ->with('delivery.rider.profile')
            ->latest('updated_at')->limit(self::LIMIT)->get();
        $ratedAt = Review::whereIn('order_id', $orders->pluck('id'))->pluck('updated_at', 'order_id');

        return $orders->map(fn (Order $o) => [
            'key' => 'delivery-rider-'.$o->id,
            'category' => 'rider',
            'title' => $this->riderName($o->delivery?->rider, 'Your delivery rider'),
            'subtitle' => 'Food delivery · '.$o->order_number,
            'rating' => (int) $o->delivery_rating,
            'comment' => null,
            'images' => [],
            'tags' => [],
            'details' => [],
            'would_recommend' => null,
            'status' => null,
            'link' => "/tourist/orders/{$o->id}/details",
            'created_at' => $ratedAt[$o->id] ?? $o->updated_at,
        ]);
    }

    /** The driver's rating on a completed ride. */
    private function rides(User $user): Collection
    {
        $orders = Order::where('order_type', 'transport')
            // Rides are matched by email when rated (TransportController::rateTrip).
            ->where(fn ($q) => $q->where('user_id', $user->id)->orWhere(fn ($q) => $q->whereNull('user_id')->where('customer_email', $user->email)))
            ->whereNotNull('rating')
            ->with('delivery.rider.profile')
            ->latest('updated_at')->limit(self::LIMIT)->get();

        return $orders->map(fn (Order $o) => [
            'key' => 'ride-'.$o->id,
            'category' => 'rider',
            'title' => $this->riderName($o->delivery?->rider, 'Your driver'),
            'subtitle' => 'Ride · '.$o->order_number,
            'rating' => (int) $o->rating,
            'comment' => $o->review,
            'images' => [],
            'tags' => array_values(array_filter((array) $o->rating_tags, 'is_string')),
            'details' => [],
            'would_recommend' => null,
            'status' => null,
            'link' => "/tourist/transport/trips/{$o->id}",
            'created_at' => $o->updated_at,
        ]);
    }

    private function riderName(?User $rider, string $fallback): string
    {
        if (! $rider) {
            return $fallback;
        }
        // full_name falls back to the email address: never show a rider's email.
        $name = trim((string) $rider->full_name);
        if ($name === '' || $name === $rider->email) {
            $name = trim((string) $rider->name);
        }

        return $name !== '' && $name !== $rider->email ? $name : $fallback;
    }
}
