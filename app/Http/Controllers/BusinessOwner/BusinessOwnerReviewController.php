<?php

namespace App\Http\Controllers\BusinessOwner;

use App\Http\Controllers\Controller;
use App\Models\Business;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/**
 * Notifications → Reviews & Ratings: every customer review of this owner's
 * businesses, restaurant reviews and dish reviews together, with a rating
 * summary. Rejected reviews are left out. Restaurant reviews are listed while
 * still "pending" too, since nothing in the app approves them yet.
 */
class BusinessOwnerReviewController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'business_id' => ['nullable', 'integer'],
            'rating' => ['nullable', 'integer', 'between:1,5'],
            'kind' => ['nullable', Rule::in(['all', 'restaurant', 'food'])],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $businessIds = Business::where('owner_id', $request->user()->id)
            ->when($validated['business_id'] ?? null, fn ($q, $id) => $q->whereKey($id))
            ->pluck('id')
            ->all();
        $kind = $validated['kind'] ?? 'all';

        $all = DB::query()->fromSub($this->union($businessIds, $kind), 'r');

        $distribution = (clone $all)->selectRaw('rating, COUNT(*) as aggregate')->groupBy('rating')->pluck('aggregate', 'rating');
        $count = (int) $distribution->sum();
        $average = $count ? round((clone $all)->avg('rating'), 1) : 0;

        $page = (clone $all)
            ->when($validated['rating'] ?? null, fn ($q, $rating) => $q->where('rating', $rating))
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate(10);

        return response()->json([
            'success' => true,
            'message' => 'Success',
            'data' => collect($page->items())->map(fn ($r) => [
                'key' => "{$r->kind}-{$r->id}",
                'kind' => $r->kind,
                'business_id' => (int) $r->business_id,
                'business_name' => $r->business_name,
                'item_name' => $r->item_name,
                'rating' => (int) $r->rating,
                'comment' => $r->review,
                'customer_name' => $r->customer_name ?: 'Customer',
                'order_number' => $r->order_number,
                'images' => collect(json_decode((string) $r->images, true) ?: [])->map(fn ($path) => Storage::disk('public')->url($path))->values()->all(),
                'created_at' => $r->created_at ? \Illuminate\Support\Carbon::parse($r->created_at)->toISOString() : null,
            ])->all(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
                'summary' => [
                    'average' => $average,
                    'count' => $count,
                    'distribution' => collect(range(5, 1))->mapWithKeys(fn ($star) => [$star => (int) ($distribution[$star] ?? 0)])->all(),
                ],
            ],
        ]);
    }

    private function union(array $businessIds, string $kind): Builder
    {
        $restaurant = DB::table('reviews')
            ->join('businesses', 'businesses.id', '=', 'reviews.business_id')
            ->leftJoin('users', 'users.id', '=', 'reviews.user_id')
            ->leftJoin('orders', 'orders.id', '=', 'reviews.order_id')
            ->whereIn('reviews.business_id', $businessIds)
            ->where('reviews.status', '!=', 'rejected')
            ->selectRaw("'restaurant' as kind, reviews.id as id, reviews.business_id as business_id, businesses.business_name as business_name, NULL as item_name, reviews.rating as rating, reviews.review as review, users.name as customer_name, orders.order_number as order_number, NULL as images, reviews.created_at as created_at");

        $food = DB::table('order_item_reviews')
            ->join('businesses', 'businesses.id', '=', 'order_item_reviews.business_id')
            ->leftJoin('users', 'users.id', '=', 'order_item_reviews.user_id')
            ->leftJoin('orders', 'orders.id', '=', 'order_item_reviews.order_id')
            ->leftJoin('order_items', 'order_items.id', '=', 'order_item_reviews.order_item_id')
            ->whereIn('order_item_reviews.business_id', $businessIds)
            ->selectRaw("'food' as kind, order_item_reviews.id as id, order_item_reviews.business_id as business_id, businesses.business_name as business_name, order_items.product_name as item_name, order_item_reviews.rating as rating, order_item_reviews.review as review, users.name as customer_name, orders.order_number as order_number, order_item_reviews.images as images, order_item_reviews.created_at as created_at");

        return match ($kind) {
            'restaurant' => $restaurant,
            'food' => $food,
            default => $restaurant->unionAll($food),
        };
    }
}
