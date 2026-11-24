<?php

namespace App\Http\Controllers;

use App\Models\Booking;
use App\Models\Business;
use App\Models\ChatRoom;
use App\Models\Notification;
use App\Models\Order;
use App\Models\OrderItemReview;
use App\Models\Review;
use App\Models\SystemNotice;
use App\Services\OrderChatService;
use App\Support\NotificationCategory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/**
 * Business owner Notifications module: tabs (All, Orders & Bookings, Messages,
 * Reviews, System) with unread counts, and a detail page per notification that
 * shows the record it is about. Every linked record is re-checked against the
 * owner's businesses when shown, so a notification never opens someone else's
 * order, booking, conversation or review.
 */
class BusinessOwnerNotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'category' => ['nullable', Rule::in(['all', ...NotificationCategory::CATEGORIES])],
            'unread' => ['nullable', 'boolean'],
            'page' => ['nullable', 'integer', 'min:1'],
            'perPage' => ['nullable', 'integer', 'min:1', 'max:50'],
        ]);
        $user = $request->user();
        $category = $validated['category'] ?? 'all';

        $page = $user->notifications()
            ->when($category !== 'all', fn ($q) => $q->whereIn('type', NotificationCategory::types($category)))
            ->when($request->boolean('unread'), fn ($q) => $q->whereNull('read_at'))
            ->latest()
            ->latest('id')
            ->paginate((int) ($validated['perPage'] ?? 20));

        return response()->json([
            'success' => true,
            'message' => 'Success',
            'data' => collect($page->items())->map(fn (Notification $n) => $this->row($n))->all(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
                'unread_counts' => $this->unreadCounts($request),
            ],
        ]);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $notification = $request->user()->notifications()->findOrFail($id);
        if (! $notification->read_at) {
            $notification->update(['read_at' => now()]);
        }

        return $this->successResponse([
            'notification' => $this->row($notification),
            'subject' => $this->subject($request, $notification),
        ]);
    }

    public function markRead(Request $request, int $id): JsonResponse
    {
        $notification = $request->user()->notifications()->findOrFail($id);
        $notification->update(['read_at' => now()]);

        return $this->successResponse(null, 'Notification marked as read.');
    }

    public function markAllRead(Request $request): JsonResponse
    {
        $request->validate(['category' => ['nullable', Rule::in(['all', ...NotificationCategory::CATEGORIES])]]);
        $category = $request->input('category', 'all');

        $request->user()->notifications()
            ->whereNull('read_at')
            ->when($category !== 'all', fn ($q) => $q->whereIn('type', NotificationCategory::types($category)))
            ->update(['read_at' => now()]);

        return $this->successResponse(null, 'All notifications marked as read.');
    }

    private function row(Notification $n): array
    {
        return [
            'id' => $n->id,
            'type' => $n->type,
            'category' => NotificationCategory::forType($n->type),
            'title' => $n->title,
            'message' => $n->message,
            'read_at' => $n->read_at?->toISOString(),
            'created_at' => $n->created_at?->toISOString(),
            'has_detail' => ! empty($n->data),
        ];
    }

    private function unreadCounts(Request $request): array
    {
        $byType = $request->user()->notifications()->whereNull('read_at')
            ->selectRaw('type, COUNT(*) as aggregate')->groupBy('type')->pluck('aggregate', 'type');

        $counts = ['all' => (int) $byType->sum()];
        foreach (NotificationCategory::CATEGORIES as $category) {
            $counts[$category] = (int) $byType->only(NotificationCategory::types($category))->sum();
        }

        return $counts;
    }

    private function ownedBusinessIds(Request $request): array
    {
        return Business::where('owner_id', $request->user()->id)->pluck('id')->map(fn ($id) => (int) $id)->all();
    }

    /** The record this notification is about, or null when it has none / is no longer yours. */
    private function subject(Request $request, Notification $n): ?array
    {
        $data = $n->data ?? [];
        $category = NotificationCategory::forType($n->type);

        return match (true) {
            $category === 'messages' && isset($data['room_id']) => $this->conversationSubject($request, (int) $data['room_id']),
            $category === 'reviews' => $this->reviewSubject($request, $data),
            isset($data['notice_id']) => $this->noticeSubject((int) $data['notice_id']),
            isset($data['order_id']) => $this->orderSubject($request, (int) $data['order_id']),
            isset($data['booking_id']) => $this->bookingSubject($request, (int) $data['booking_id']),
            default => null,
        };
    }

    private function orderSubject(Request $request, int $orderId): ?array
    {
        $order = Order::with('items')->find($orderId);
        if (! $order || ! $order->isManagedBy($request->user())) {
            return null;
        }

        // Group checkout: only this owner's items, never the other restaurants'.
        $mine = $this->ownedBusinessIds($request);
        $items = $order->items->filter(fn ($item) => in_array((int) ($item->business_id ?? $order->business_id), $mine, true))->values();

        return [
            'kind' => 'order',
            'id' => $order->id,
            'order_number' => $order->order_number,
            'status' => $order->status,
            'customer_name' => $order->customer_name,
            'order_type' => $order->order_type,
            'payment_method' => $order->payment_method,
            'payment_status' => $order->payment_status,
            'created_at' => $order->created_at?->toISOString(),
            'items' => $items->map(fn ($item) => [
                'name' => $item->product_name,
                'quantity' => (int) $item->quantity,
                'subtotal' => (float) $item->subtotal,
            ])->all(),
            'items_total' => round((float) $items->sum('subtotal'), 2),
            'shared_with_other_restaurants' => $items->count() < $order->items->count(),
            'link' => "/business-owner/orders/{$order->id}",
        ];
    }

    private function bookingSubject(Request $request, int $bookingId): ?array
    {
        $booking = Booking::with('business:id,owner_id,business_name')->find($bookingId);
        if (! $booking || (int) $booking->business?->owner_id !== (int) $request->user()->id) {
            return null;
        }

        return [
            'kind' => 'booking',
            'id' => $booking->id,
            'booking_number' => $booking->booking_number,
            'status' => $booking->status,
            'customer_name' => $booking->customer_name,
            'business_name' => $booking->business?->business_name,
            'check_in_date' => $booking->check_in_date?->toDateString(),
            'check_out_date' => $booking->check_out_date?->toDateString(),
            'total_amount' => (float) $booking->total_amount,
            'link' => "/business-owner/bookings/{$booking->id}",
        ];
    }

    private function conversationSubject(Request $request, int $roomId): ?array
    {
        $chat = app(OrderChatService::class);
        $room = ChatRoom::with(['order', 'business'])->find($roomId);
        if (! $room || ! $chat->canAccess($request->user(), $room)) {
            return null;
        }

        $recent = $room->messages()->latest('id')->limit(3)->get()->reverse()->values();

        return [
            'kind' => 'conversation',
            ...$chat->summary($room, $request->user()),
            'recent' => $recent->map(fn ($m) => [
                'id' => $m->id,
                'message' => $m->message,
                'is_mine' => (int) $m->sender_id === (int) $request->user()->id,
                'created_at' => $m->created_at?->toISOString(),
            ])->all(),
            'link' => "/business-owner/notifications/messages/{$room->id}",
        ];
    }

    private function reviewSubject(Request $request, array $data): ?array
    {
        $mine = $this->ownedBusinessIds($request);
        $businessId = (int) ($data['business_id'] ?? 0);
        if (! in_array($businessId, $mine, true)) {
            return null;
        }

        $orderId = $data['order_id'] ?? null;
        $restaurant = $orderId
            ? Review::where('order_id', $orderId)->where('business_id', $businessId)->where('status', '!=', 'rejected')->first()
            : (isset($data['review_id']) ? Review::where('id', $data['review_id'])->where('business_id', $businessId)->where('status', '!=', 'rejected')->first() : null);
        $dishes = $orderId
            ? OrderItemReview::with('orderItem:id,product_name')->where('order_id', $orderId)->where('business_id', $businessId)->get()
            : collect();

        if (! $restaurant && $dishes->isEmpty()) {
            return null;
        }

        $userId = $restaurant?->user_id ?? $dishes->first()?->user_id;

        return [
            'kind' => 'review',
            'business_id' => $businessId,
            'business_name' => Business::whereKey($businessId)->value('business_name'),
            'customer_name' => ($userId ? \App\Models\User::whereKey($userId)->value('name') : null) ?: 'Customer',
            'order_number' => $orderId ? Order::whereKey($orderId)->value('order_number') : null,
            'restaurant' => $restaurant ? [
                'rating' => (int) $restaurant->rating,
                'comment' => $restaurant->review,
                'created_at' => $restaurant->created_at?->toISOString(),
            ] : null,
            'dishes' => $dishes->map(fn (OrderItemReview $r) => [
                'name' => $r->orderItem?->product_name ?? 'Dish',
                'rating' => (int) $r->rating,
                'comment' => $r->review,
                'images' => collect($r->images ?? [])->map(fn ($path) => Storage::disk('public')->url($path))->all(),
                'created_at' => $r->created_at?->toISOString(),
            ])->all(),
            'link' => '/business-owner/notifications?tab=reviews',
        ];
    }

    private function noticeSubject(int $noticeId): ?array
    {
        $notice = SystemNotice::find($noticeId);

        return $notice ? ['kind' => 'system_notice', ...$notice->toSummary()] : null;
    }
}
