<?php

namespace App\Http\Controllers\Tourist;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderItemReview;
use App\Models\Review;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * POST /api/tourist/food/order/{order}/items/{item}/review
 *
 * "Write review" for one ordered dish (My Orders → To Review): star rating,
 * feedback, up to 5 photos of the food received, and optionally the rider's
 * stars. One review per ordered dish (UNIQUE order_item_id); sending again
 * updates it.
 *
 * It also refreshes the order's business review (`reviews`, one per order)
 * and the order's rating/delivery_rating, exactly the fields the existing
 * order rating uses, so restaurant ratings and rider ratings stay consistent.
 */
class OrderItemReviewController extends Controller
{
    public const MAX_PHOTOS = 5;

    public function store(Request $request, Order $order, OrderItem $item): JsonResponse
    {
        $user = $request->user();
        if (($order->user_id && $order->user_id !== $user->id) || (! $order->user_id && $order->customer_email !== $user->email)) {
            abort(403);
        }
        if ((int) $item->order_id !== (int) $order->id) {
            abort(404);
        }

        $validated = $request->validate([
            'rating' => ['required', 'integer', 'min:1', 'max:5'],
            'review' => ['nullable', 'string', 'max:1000'],
            'delivery_rating' => ['nullable', 'integer', 'min:1', 'max:5'],
            'images' => ['nullable', 'array', 'max:'.self::MAX_PHOTOS],
            'images.*' => ['image', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
        ]);

        $deliveryStatus = $order->activeDelivery()?->status;
        $deliveryStatus = $deliveryStatus instanceof \BackedEnum ? $deliveryStatus->value : $deliveryStatus;
        if (! in_array($order->status, ['delivered', 'completed'], true) && ! in_array($deliveryStatus, ['delivered', 'completed'], true)) {
            return $this->errorResponse('You can review your food once it has been delivered.', 422);
        }
        if ((int) $item->quantity - (int) ($item->cancelled_quantity ?? 0) <= 0) {
            return $this->errorResponse('This item was cancelled, so it cannot be reviewed.', 422);
        }

        $paths = [];
        foreach ($request->file('images', []) as $file) {
            $paths[] = $file->store('review-photos', 'public');
        }

        try {
            $review = DB::transaction(function () use ($order, $item, $user, $validated, $paths) {
                $lockedOrder = Order::query()->lockForUpdate()->findOrFail($order->id);
                $businessId = $item->business_id ?? $lockedOrder->business_id;

                $existing = OrderItemReview::where('order_item_id', $item->id)->first();
                $review = OrderItemReview::updateOrCreate(
                    ['order_item_id' => $item->id],
                    [
                        'order_id' => $lockedOrder->id,
                        'offering_id' => $item->offering_id,
                        'business_id' => $businessId,
                        'user_id' => $user->id,
                        'rating' => $validated['rating'],
                        'review' => $validated['review'] ?? null,
                        // New photos replace the old ones when sent; otherwise keep them.
                        'images' => $paths !== [] ? $paths : ($existing?->images ?? null),
                    ],
                );

                // Keep the order-level rating fields in step (existing order rating semantics).
                $avg = (int) round(OrderItemReview::where('order_id', $lockedOrder->id)->avg('rating'));
                $deliveryRating = $validated['delivery_rating'] ?? $lockedOrder->delivery_rating;
                $lockedOrder->update(['rating' => $avg, 'delivery_rating' => $deliveryRating]);

                Review::updateOrCreate(
                    ['order_id' => $lockedOrder->id],
                    [
                        'business_id' => $lockedOrder->business_id ?? $businessId,
                        'user_id' => $user->id,
                        'rating' => $avg,
                        'food_rating' => $avg,
                        'delivery_rating' => $deliveryRating,
                        'review' => $validated['review'] ?? Review::where('order_id', $lockedOrder->id)->value('review'),
                        'status' => 'pending',
                    ],
                );

                return [$review, $existing?->images ?? []];
            });
        } catch (\Throwable $e) {
            Storage::disk('public')->delete($paths);
            throw $e;
        }

        [$saved, $oldImages] = $review;
        // Replaced photos are removed from storage.
        if ($paths !== [] && $oldImages) {
            Storage::disk('public')->delete(array_values(array_diff($oldImages, $paths)));
        }

        return $this->successResponse([
            'id' => $saved->id,
            'order_item_id' => $saved->order_item_id,
            'rating' => $saved->rating,
            'review' => $saved->review,
            'images' => $saved->images ?? [],
        ], 'Thank you for your review!');
    }
}
