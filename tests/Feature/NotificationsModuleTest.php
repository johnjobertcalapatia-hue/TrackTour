<?php

namespace Tests\Feature;

use App\Events\OrderCreated;
use App\Listeners\SendOrderCreatedNotifications;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Notification;
use App\Models\Offering;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderItemReview;
use App\Models\Review;
use App\Models\SystemNotice;
use App\Models\User;
use App\Services\ReviewNotifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Business owner Notifications module: detail page per notification, tabs with
 * unread counts, chat per order (Messages & Concerns), reviews & ratings, and
 * system maintenance notices sent by the admin.
 */
class NotificationsModuleTest extends TestCase
{
    use RefreshDatabase;

    private User $grillOwner;

    private User $cafeOwner;

    private User $tourist;

    private Business $grill;

    private Business $cafe;

    private Order $order;

    private OrderItem $sisig;

    private OrderItem $latte;

    protected function setUp(): void
    {
        parent::setUp();
        $town = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $this->grillOwner = $this->user('grill@example.com', 'business_owner');
        $this->cafeOwner = $this->user('cafe@example.com', 'business_owner');
        $this->tourist = $this->user('maria@example.com', 'tourist', 'Maria Santos');
        $this->grill = $this->business($this->grillOwner, 'Ekslusibo Grill', $town);
        $this->cafe = $this->business($this->cafeOwner, 'Kape Bansud', $town);

        // Group checkout: one canonical order (the grill's) with an item from each restaurant.
        $this->order = Order::create([
            'order_number' => 'TT-10024', 'business_id' => $this->grill->id, 'user_id' => $this->tourist->id,
            'customer_name' => 'Maria Santos', 'customer_email' => 'maria@example.com', 'order_type' => 'delivery',
            'payment_method' => 'gcash', 'payment_status' => 'paid', 'status' => 'preparing', 'subtotal' => 340, 'delivery_fee' => 0, 'total' => 340,
        ]);
        $this->sisig = $this->item($this->grill, 'Sisig', 220);
        $this->latte = $this->item($this->cafe, 'Latte', 120);
    }

    private function user(string $email, string $role, ?string $name = null): User
    {
        return User::create(['email' => $email, 'name' => $name ?? Str::before($email, '@'), 'password' => Hash::make('Password123!'), 'role' => $role, 'account_status' => 'approved']);
    }

    private function business(User $owner, string $name, Municipality $town): Business
    {
        return Business::create(['owner_id' => $owner->id, 'business_category_id' => BusinessCategory::firstOrCreate(['name' => 'Restaurant'])->id, 'municipality_id' => $town->id, 'business_name' => $name, 'status' => 'approved', 'latitude' => 12.86, 'longitude' => 121.45]);
    }

    private function item(Business $business, string $name, float $price): OrderItem
    {
        $offering = Offering::create(['business_id' => $business->id, 'name' => $name, 'price' => $price, 'is_available' => true, 'status' => 'available']);

        return OrderItem::create(['order_id' => $this->order->id, 'business_id' => $business->id, 'offering_id' => $offering->id, 'product_name' => $name, 'quantity' => 1, 'unit_price' => $price, 'subtotal' => $price, 'status' => 'preparing']);
    }

    private function as(User $user)
    {
        return $this->actingAs($user, 'sanctum');
    }

    // ── Detail page ───────────────────────────────────────────────────────

    public function test_order_notification_opens_its_order_showing_only_this_restaurants_items(): void
    {
        (new SendOrderCreatedNotifications)->handle(new OrderCreated($this->order, $this->cafe, $this->tourist));
        $notification = Notification::where('user_id', $this->cafeOwner->id)->firstOrFail();
        $this->assertSame(['order_id' => $this->order->id, 'business_id' => $this->cafe->id], $notification->data);

        $res = $this->as($this->cafeOwner)->getJson("/api/business-owner/notifications/{$notification->id}")->assertOk();
        $res->assertJsonPath('data.notification.category', 'orders')
            ->assertJsonPath('data.subject.kind', 'order')
            ->assertJsonPath('data.subject.order_number', 'TT-10024')
            ->assertJsonPath('data.subject.items.0.name', 'Latte')
            ->assertJsonPath('data.subject.shared_with_other_restaurants', true)
            ->assertJsonPath('data.subject.link', "/business-owner/orders/{$this->order->id}");
        $this->assertCount(1, $res->json('data.subject.items'), 'the grill\'s Sisig is never shown to the cafe');
        $this->assertNotNull($notification->fresh()->read_at, 'opening it marks it read');
    }

    public function test_a_notification_never_opens_someone_elses_record(): void
    {
        $mine = Notification::create(['user_id' => $this->grillOwner->id, 'title' => 'x', 'message' => 'y', 'type' => 'order_created', 'data' => ['order_id' => $this->order->id]]);
        // Another owner's notification is not found at all.
        $this->as($this->cafeOwner)->getJson("/api/business-owner/notifications/{$mine->id}")->assertNotFound();

        // A notification pointing at an order this owner has nothing in shows no subject.
        $other = Order::create(['order_number' => 'TT-9', 'business_id' => $this->grill->id, 'user_id' => $this->tourist->id, 'customer_name' => 'X', 'customer_email' => 'x@example.com', 'order_type' => 'delivery', 'payment_method' => 'gcash', 'payment_status' => 'paid', 'status' => 'completed', 'subtotal' => 1, 'delivery_fee' => 0, 'total' => 1]);
        $stray = Notification::create(['user_id' => $this->cafeOwner->id, 'title' => 'x', 'message' => 'y', 'type' => 'order_created', 'data' => ['order_id' => $other->id]]);
        $this->as($this->cafeOwner)->getJson("/api/business-owner/notifications/{$stray->id}")->assertOk()->assertJsonPath('data.subject', null);

        // Older notifications without a link still open (title + message only).
        $old = Notification::create(['user_id' => $this->cafeOwner->id, 'title' => 'Old', 'message' => 'Before links', 'type' => 'order_created']);
        $this->as($this->cafeOwner)->getJson("/api/business-owner/notifications/{$old->id}")->assertOk()
            ->assertJsonPath('data.notification.message', 'Before links')->assertJsonPath('data.notification.has_detail', false);
    }

    public function test_tabs_filter_by_category_with_unread_counts(): void
    {
        foreach (['order_created', 'order_created', 'message_received', 'review_received', 'system_maintenance', 'welcome'] as $type) {
            Notification::create(['user_id' => $this->cafeOwner->id, 'title' => $type, 'message' => '-', 'type' => $type]);
        }
        Notification::where('type', 'welcome')->update(['read_at' => now()]);

        $all = $this->as($this->cafeOwner)->getJson('/api/business-owner/notifications')->assertOk();
        $this->assertSame(['all' => 5, 'orders' => 2, 'messages' => 1, 'reviews' => 1, 'system' => 1], $all->json('meta.unread_counts'));
        $this->assertSame(6, $all->json('meta.total'));

        $this->assertSame(2, $this->as($this->cafeOwner)->getJson('/api/business-owner/notifications?category=system')->json('meta.total'));
        $this->as($this->cafeOwner)->getJson('/api/business-owner/notifications?category=nope')->assertStatus(422);

        $this->as($this->cafeOwner)->patchJson('/api/business-owner/notifications/read-all', ['category' => 'orders'])->assertOk();
        $counts = $this->as($this->cafeOwner)->getJson('/api/business-owner/notifications')->json('meta.unread_counts');
        $this->assertSame([3, 0, 1], [$counts['all'], $counts['orders'], $counts['messages']], 'marking one tab read leaves the others');
    }

    // ── Chat per order ────────────────────────────────────────────────────

    public function test_tourist_messages_one_restaurant_in_a_group_order_and_only_that_owner_sees_it(): void
    {
        $restaurants = $this->as($this->tourist)->getJson("/api/tourist/orders/{$this->order->id}/chats")->assertOk()->json('data');
        $this->assertEqualsCanonicalizing(['Ekslusibo Grill', 'Kape Bansud'], array_column($restaurants, 'business_name'));

        $roomId = $this->as($this->tourist)->postJson("/api/tourist/orders/{$this->order->id}/chats", ['business_id' => $this->cafe->id])->assertOk()->json('data.room_id');
        $this->assertSame($roomId, $this->as($this->tourist)->postJson("/api/tourist/orders/{$this->order->id}/chats", ['business_id' => $this->cafe->id])->json('data.room_id'), 'reopening returns the same conversation');

        $this->as($this->tourist)->postJson("/api/tourist/chats/{$roomId}/messages", ['message' => 'Can the latte be less sweet?'])->assertCreated();
        $this->as($this->tourist)->postJson("/api/tourist/chats/{$roomId}/messages", ['message' => 'Thank you!'])->assertCreated();

        // One unread notification for the cafe owner, updated by the second message.
        $notes = Notification::where('user_id', $this->cafeOwner->id)->where('type', 'message_received')->get();
        $this->assertCount(1, $notes);
        $this->assertSame('New message from Maria Santos', $notes[0]->title);
        $this->assertStringContainsString('Thank you!', $notes[0]->message);
        $this->assertSame(0, Notification::where('user_id', $this->grillOwner->id)->count(), 'the other restaurant hears nothing');

        $list = $this->as($this->cafeOwner)->getJson('/api/business-owner/conversations')->assertOk();
        $list->assertJsonPath('data.0.id', $roomId)->assertJsonPath('data.0.unread', 2)->assertJsonPath('data.0.customer_name', 'Maria Santos');
        $this->assertSame(0, $this->as($this->grillOwner)->getJson('/api/business-owner/conversations')->json('meta.total'));

        $thread = $this->as($this->cafeOwner)->getJson("/api/business-owner/conversations/{$roomId}")->assertOk();
        $this->assertSame(['Can the latte be less sweet?', 'Thank you!'], array_column($thread->json('data.messages'), 'message'));
        $thread->assertJsonPath('data.messages.0.sender_name', 'Maria Santos');
        $this->assertSame(0, $this->as($this->cafeOwner)->getJson('/api/business-owner/conversations')->json('data.0.unread'), 'reading clears unread');

        $this->as($this->cafeOwner)->postJson("/api/business-owner/conversations/{$roomId}/messages", ['message' => 'Sure, noted!'])->assertCreated();
        $reply = Notification::where('user_id', $this->tourist->id)->where('type', 'message_received')->firstOrFail();
        $this->assertSame('Kape Bansud replied', $reply->title);
        $this->as($this->tourist)->getJson("/api/tourist/chats/{$roomId}")->assertOk()
            ->assertJsonPath('data.messages.2.message', 'Sure, noted!')
            ->assertJsonPath('data.messages.2.sender_name', 'Kape Bansud');

        // The message notification opens the conversation.
        $this->as($this->cafeOwner)->getJson("/api/business-owner/notifications/{$notes[0]->id}")->assertOk()
            ->assertJsonPath('data.subject.kind', 'conversation')
            ->assertJsonPath('data.subject.link', "/business-owner/notifications/messages/{$roomId}");
    }

    public function test_conversations_are_closed_to_everyone_else(): void
    {
        $roomId = $this->as($this->tourist)->postJson("/api/tourist/orders/{$this->order->id}/chats", ['business_id' => $this->cafe->id])->json('data.room_id');
        $stranger = $this->user('stranger@example.com', 'tourist');

        $this->as($stranger)->getJson("/api/tourist/orders/{$this->order->id}/chats")->assertNotFound();
        $this->as($stranger)->postJson("/api/tourist/orders/{$this->order->id}/chats", ['business_id' => $this->cafe->id])->assertNotFound();
        $this->as($stranger)->getJson("/api/tourist/chats/{$roomId}")->assertNotFound();
        $this->as($stranger)->postJson("/api/tourist/chats/{$roomId}/messages", ['message' => 'hi'])->assertNotFound();
        // The grill is in the same order but this is the cafe's conversation.
        $this->as($this->grillOwner)->getJson("/api/business-owner/conversations/{$roomId}")->assertNotFound();
        $this->as($this->grillOwner)->postJson("/api/business-owner/conversations/{$roomId}/messages", ['message' => 'hi'])->assertNotFound();

        $outsider = $this->business($this->user('other@example.com', 'business_owner'), 'Other', Municipality::first());
        $this->as($this->tourist)->postJson("/api/tourist/orders/{$this->order->id}/chats", ['business_id' => $outsider->id])->assertStatus(422);
        $this->as($this->tourist)->postJson("/api/tourist/chats/{$roomId}/messages", ['message' => '   '])->assertStatus(422);
        $this->as($this->tourist)->postJson("/api/tourist/chats/{$roomId}/messages", ['message' => str_repeat('a', 2001)])->assertStatus(422);

        $ride = Order::create(['order_number' => 'TT-RIDE', 'business_id' => $this->grill->id, 'user_id' => $this->tourist->id, 'customer_name' => 'Maria', 'customer_email' => 'maria@example.com', 'order_type' => 'transport', 'payment_method' => 'cash', 'payment_status' => 'pending', 'status' => 'completed', 'subtotal' => 50, 'delivery_fee' => 0, 'total' => 50]);
        $this->as($this->tourist)->getJson("/api/tourist/orders/{$ride->id}/chats")->assertNotFound();
    }

    // ── Reviews & ratings ─────────────────────────────────────────────────

    public function test_reviews_notify_the_owner_and_fold_per_order(): void
    {
        Review::create(['business_id' => $this->grill->id, 'user_id' => $this->tourist->id, 'order_id' => $this->order->id, 'rating' => 4, 'review' => 'Tasty', 'status' => 'pending']);
        $dish = OrderItemReview::create(['order_item_id' => $this->sisig->id, 'order_id' => $this->order->id, 'offering_id' => $this->sisig->offering_id, 'business_id' => $this->grill->id, 'user_id' => $this->tourist->id, 'rating' => 5, 'review' => 'Crispy']);
        app(ReviewNotifier::class)->itemReview($dish);

        $notes = Notification::where('user_id', $this->grillOwner->id)->where('type', 'review_received')->get();
        $this->assertCount(1, $notes, 'reviews on one order fold into one notification');
        $this->assertSame('Maria Santos rated Sisig', $notes[0]->title);

        $detail = $this->as($this->grillOwner)->getJson("/api/business-owner/notifications/{$notes[0]->id}")->assertOk();
        $detail->assertJsonPath('data.subject.kind', 'review')
            ->assertJsonPath('data.subject.restaurant.rating', 4)
            ->assertJsonPath('data.subject.dishes.0.name', 'Sisig')
            ->assertJsonPath('data.subject.dishes.0.rating', 5);

        // A rejected review never notifies.
        Review::create(['business_id' => $this->cafe->id, 'user_id' => $this->tourist->id, 'rating' => 1, 'review' => 'spam', 'status' => 'rejected']);
        $this->assertSame(0, Notification::where('user_id', $this->cafeOwner->id)->count());
    }

    public function test_reviews_tab_lists_restaurant_and_dish_reviews_of_my_businesses_only(): void
    {
        Review::create(['business_id' => $this->grill->id, 'user_id' => $this->tourist->id, 'order_id' => $this->order->id, 'rating' => 4, 'review' => 'Tasty', 'status' => 'pending']);
        Review::create(['business_id' => $this->grill->id, 'user_id' => $this->tourist->id, 'rating' => 1, 'review' => 'spam', 'status' => 'rejected']);
        OrderItemReview::create(['order_item_id' => $this->sisig->id, 'order_id' => $this->order->id, 'offering_id' => $this->sisig->offering_id, 'business_id' => $this->grill->id, 'user_id' => $this->tourist->id, 'rating' => 5, 'review' => 'Crispy']);
        OrderItemReview::create(['order_item_id' => $this->latte->id, 'order_id' => $this->order->id, 'offering_id' => $this->latte->offering_id, 'business_id' => $this->cafe->id, 'user_id' => $this->tourist->id, 'rating' => 2, 'review' => 'Too sweet']);

        $res = $this->as($this->grillOwner)->getJson('/api/business-owner/reviews')->assertOk();
        $this->assertSame(2, $res->json('meta.total'));
        $this->assertEqualsCanonicalizing(['restaurant', 'food'], array_column($res->json('data'), 'kind'));
        $this->assertNotContains('Too sweet', array_column($res->json('data'), 'comment'), 'the cafe\'s review stays with the cafe');
        $this->assertSame(['average' => 4.5, 'count' => 2, 'distribution' => [5 => 1, 4 => 1, 3 => 0, 2 => 0, 1 => 0]], $res->json('meta.summary'));

        $food = $this->as($this->grillOwner)->getJson('/api/business-owner/reviews?rating=5')->assertOk();
        $food->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.item_name', 'Sisig')->assertJsonPath('data.0.customer_name', 'Maria Santos')->assertJsonPath('data.0.order_number', 'TT-10024');
        $this->assertSame(1, $this->as($this->grillOwner)->getJson('/api/business-owner/reviews?kind=restaurant')->json('meta.total'));
        $this->assertSame(0, $this->as($this->grillOwner)->getJson("/api/business-owner/reviews?business_id={$this->cafe->id}")->json('meta.total'));
    }

    // ── System maintenance notices ────────────────────────────────────────

    public function test_admin_sends_a_maintenance_notice_to_business_owners(): void
    {
        $admin = $this->user('admin@bansud.gov.ph', 'bansud_tourism_office');
        $payload = ['title' => 'Database upgrade', 'message' => 'Ordering will be unavailable.', 'audience' => 'business_owners', 'starts_at' => now()->addDay()->toISOString(), 'ends_at' => now()->addDay()->addHours(2)->toISOString()];

        $this->as($this->grillOwner)->postJson('/api/admin/system-notices', $payload)->assertForbidden();
        $this->as($admin)->postJson('/api/admin/system-notices', [...$payload, 'ends_at' => now()->toISOString()])->assertStatus(422);

        $res = $this->as($admin)->postJson('/api/admin/system-notices', $payload)->assertCreated();
        $res->assertJsonPath('data.recipients_count', 2)->assertJsonPath('data.status', 'scheduled');
        $noticeId = $res->json('data.id');

        $this->assertSame(1, Notification::where('user_id', $this->cafeOwner->id)->where('type', 'system_maintenance')->count());
        $this->assertSame(0, Notification::where('user_id', $this->tourist->id)->count(), 'tourists are not in this audience');

        // Banner for owners, not for tourists.
        $this->as($this->cafeOwner)->getJson('/api/system-notices/active')->assertOk()->assertJsonPath('data.0.title', 'Database upgrade');
        $this->assertSame([], $this->as($this->tourist)->getJson('/api/system-notices/active')->json('data'));

        $note = Notification::where('user_id', $this->cafeOwner->id)->where('type', 'system_maintenance')->firstOrFail();
        $this->as($this->cafeOwner)->getJson("/api/business-owner/notifications/{$note->id}")->assertOk()
            ->assertJsonPath('data.notification.category', 'system')
            ->assertJsonPath('data.subject.kind', 'system_notice')
            ->assertJsonPath('data.subject.title', 'Database upgrade');

        $this->as($admin)->postJson("/api/admin/system-notices/{$noticeId}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->as($admin)->postJson("/api/admin/system-notices/{$noticeId}/cancel")->assertStatus(422);
        $this->assertSame([], $this->as($this->cafeOwner)->getJson('/api/system-notices/active')->json('data'), 'a cancelled notice drops its banner');
        $this->assertSame('cancelled', SystemNotice::find($noticeId)->status());
        $this->as($admin)->getJson('/api/admin/system-notices')->assertOk()->assertJsonPath('data.0.id', $noticeId);
    }

    public function test_notice_times_without_an_offset_are_philippine_time(): void
    {
        $admin = $this->user('admin@bansud.gov.ph', 'bansud_tourism_office');
        $start = now('Asia/Manila')->addDay()->setTime(22, 0);

        $res = $this->as($admin)->postJson('/api/admin/system-notices', [
            'title' => 'Upgrade', 'message' => 'Brief downtime.', 'audience' => 'riders',
            'starts_at' => $start->format('Y-m-d\TH:i'), 'ends_at' => $start->copy()->addHours(2)->format('Y-m-d\TH:i'),
        ])->assertCreated();

        $this->assertSame($start->copy()->utc()->toISOString(), $res->json('data.starts_at'), '10 PM in Manila is 2 PM UTC');
        $this->assertSame(0, $res->json('data.recipients_count'), 'no riders in this test');

        // A window that already ended in Manila time is refused, even though it is "later" in UTC.
        $past = now('Asia/Manila')->subHours(2);
        $this->as($admin)->postJson('/api/admin/system-notices', [
            'title' => 'Late', 'message' => 'x', 'audience' => 'riders',
            'starts_at' => $past->copy()->subHour()->format('Y-m-d\TH:i'), 'ends_at' => $past->format('Y-m-d\TH:i'),
        ])->assertStatus(422)->assertJsonValidationErrors('ends_at');
    }

    public function test_reading_a_conversation_clears_its_message_notification(): void
    {
        $roomId = $this->as($this->tourist)->postJson("/api/tourist/orders/{$this->order->id}/chats", ['business_id' => $this->cafe->id])->json('data.room_id');
        $this->as($this->tourist)->postJson("/api/tourist/chats/{$roomId}/messages", ['message' => 'Hello'])->assertCreated();
        $this->assertSame(1, $this->as($this->cafeOwner)->getJson('/api/business-owner/notifications')->json('meta.unread_counts.messages'));

        $this->as($this->cafeOwner)->getJson("/api/business-owner/conversations/{$roomId}")->assertOk();
        $this->assertSame(0, $this->as($this->cafeOwner)->getJson('/api/business-owner/notifications')->json('meta.unread_counts.messages'));
    }
}
