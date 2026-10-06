<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Favorite;
use App\Models\Municipality;
use App\Models\Notification;
use App\Models\Offering;
use App\Models\Review;
use App\Models\TourismEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class TouristApiTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;
    private Business $business;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tourist = User::create([
            'email' => 'tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
        ]);

        $this->business = Business::create([
            'owner_id' => $this->tourist->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Test Restaurant',
            'business_description' => 'A test restaurant',
            'status' => 'approved',
            'latitude' => 12.3456789,
            'longitude' => 122.3456789,
        ]);
    }

    public function test_tourist_can_get_dashboard(): void
    {
        if (config('database.default') === 'sqlite') {
            $this->markTestSkipped('TouristController dashboard uses HAVING on non-aggregate queries which SQLite does not support.');
        }

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/dashboard');

        $response->assertOk();
    }

    public function test_tourist_can_explore_businesses(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/explore');

        $response->assertOk();
    }

    public function test_tourist_can_search(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/explore/search?q=restaurant');

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ])
            ->assertJsonStructure([
                'data' => [
                    'businesses',
                    'municipalities',
                    'events',
                ],
            ]);
    }

    public function test_tourist_can_list_food_businesses(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/food');

        $response->assertOk();
    }

    public function test_tourist_can_toggle_favorite(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/tourist/favorites/toggle', [
                'favoritable_type' => Business::class,
                'favoritable_id' => $this->business->id,
            ]);

        $response->assertOk()
            ->assertJson([
                'success' => true,
                'data' => [
                    'favorited' => true,
                ],
            ]);

        $this->assertDatabaseHas('favorites', [
            'user_id' => $this->tourist->id,
            'favoritable_id' => $this->business->id,
            'favoritable_type' => Business::class,
        ]);

        $response2 = $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/tourist/favorites/toggle', [
                'favoritable_type' => Business::class,
                'favoritable_id' => $this->business->id,
            ]);

        $response2->assertOk()
            ->assertJson([
                'success' => true,
                'data' => [
                    'favorited' => false,
                ],
            ]);

        $this->assertSoftDeleted('favorites', [
            'user_id' => $this->tourist->id,
            'favoritable_id' => $this->business->id,
            'favoritable_type' => Business::class,
        ]);
    }

    public function test_tourist_can_list_favorites(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/favorites');

        $response->assertOk();
    }

    public function test_tourist_can_list_reviews(): void
    {
        Review::create([
            'business_id' => $this->business->id,
            'user_id' => $this->tourist->id,
            'rating' => 5,
            'review' => 'Great restaurant!',
            'status' => 'approved',
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/reviews');

        $response->assertOk();
    }

    public function test_tourist_can_list_notifications(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/notifications');

        $response->assertOk();
    }

    public function test_tourist_can_list_history(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/history');

        $response->assertOk();
    }

    public function test_tourist_can_get_profile(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/profile');

        $response->assertOk();
    }

    public function test_non_tourist_can_access_public_explore(): void
    {
        $rider = User::create([
            'email' => 'rider@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
        ]);

        $response = $this->actingAs($rider, 'sanctum')
            ->getJson('/api/tourist/explore/search?q=test');

        $response->assertOk();
    }

    public function test_tourist_explore_index_handles_upcoming_events(): void
    {
        $municipality = Municipality::create([
            'name' => 'Gloria',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
        ]);
        TourismEvent::create([
            'municipality_id' => $municipality->id,
            'name' => 'Weekend Market',
            'description' => 'A market day',
            'location' => 'Town Plaza',
            'start_date' => now()->addDays(2),
            'end_date' => now()->addDays(4),
            'image' => null,
            'status' => 'published',
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/explore');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => ['upcomingEvents', 'food', 'counts'],
            ]);
    }

    public function test_tourist_can_view_event_detail(): void
    {
        $municipality = Municipality::create([
            'name' => 'Gloria',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
        ]);
        $event = TourismEvent::create([
            'municipality_id' => $municipality->id,
            'name' => 'Weekend Market',
            'description' => 'A market day',
            'location' => 'Town Plaza',
            'start_date' => now()->addDays(2),
            'end_date' => now()->addDays(4),
            'image' => null,
            'status' => 'published',
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson("/api/tourist/events/{$event->id}");

        $response->assertOk()
            ->assertJson([
                'success' => true,
                'data' => ['id' => $event->id, 'name' => 'Weekend Market'],
            ]);
    }

    public function test_tourist_food_lists_only_canonical_available_offerings(): void
    {
        Offering::create([
            'business_id' => $this->business->id,
            'name' => 'Available Dish',
            'price' => 120.00,
            'is_available' => true,
            'status' => 'available',
            'sort_order' => 1,
        ]);
        Offering::create([
            'business_id' => $this->business->id,
            'name' => 'Legacy Active Dish',
            'price' => 80.00,
            'is_available' => true,
            'status' => 'active',
            'sort_order' => 2,
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/food');

        $response->assertOk()
            ->assertJsonPath('data.data.0.name', 'Available Dish')
            ->assertJsonMissing(['data.data.1' => ['name' => 'Legacy Active Dish']]);
    }

    public function test_tourist_favorites_return_favoritable_payload(): void
    {
        Favorite::create([
            'user_id' => $this->tourist->id,
            'favoritable_type' => Business::class,
            'favoritable_id' => $this->business->id,
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/favorites');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [
                    'favorites' => [
                        [
                            'id',
                            'favoritable' => ['id', 'name', 'category', 'municipality'],
                        ],
                    ],
                ],
            ])
            ->assertJsonPath('data.favorites.0.favoritable.id', $this->business->id);
    }

    public function test_tourist_notifications_return_notifications_envelope(): void
    {
        Notification::create([
            'user_id' => $this->tourist->id,
            'title' => 'Welcome',
            'message' => 'Welcome to TrackTour!',
            'type' => 'general',
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/notifications');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => ['notifications' => []],
            ]);
    }

    public function test_tourist_stays_lists_accommodations_and_rentals(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/booking');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => ['accommodations', 'rentals'],
            ]);
    }

    public function test_tourist_bookings_come_from_history_bookings_envelope(): void
    {
        Booking::create([
            'booking_number' => 'BK-1001',
            'business_id' => $this->business->id,
            'customer_name' => 'Tourist',
            'customer_email' => $this->tourist->email,
            'booking_type' => 'accommodation',
            'status' => 'confirmed',
            'check_in_date' => now()->addDays(1),
            'check_out_date' => now()->addDays(3),
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/history?tab=bookings');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => ['bookings' => ['data' => []]],
            ])
            ->assertJsonPath('data.bookings.data.0.booking_number', 'BK-1001');
    }

    public function test_tourist_can_view_own_booking_detail(): void
    {
        $booking = Booking::create([
            'booking_number' => 'BK-1002',
            'business_id' => $this->business->id,
            'customer_name' => 'Tourist',
            'customer_email' => $this->tourist->email,
            'booking_type' => 'accommodation',
            'status' => 'confirmed',
            'check_in_date' => now()->addDays(1),
            'check_out_date' => now()->addDays(3),
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson("/api/tourist/booking/{$booking->id}/detail");

        $response->assertOk()
            ->assertJsonPath('data.booking.id', $booking->id)
            ->assertJsonPath('data.booking.business.business_name', 'Test Restaurant');
    }

    public function test_tourist_cannot_view_another_users_booking_detail(): void
    {
        $other = User::create([
            'email' => 'other@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);
        $booking = Booking::create([
            'booking_number' => 'BK-1003',
            'business_id' => $this->business->id,
            'customer_name' => 'Other',
            'customer_email' => $other->email,
            'booking_type' => 'accommodation',
            'status' => 'confirmed',
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson("/api/tourist/booking/{$booking->id}/detail");

        $response->assertNotFound();
    }

    public function test_landing_map_reports_accepting_orders_for_approved_businesses(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/map/businesses');

        $response->assertOk()
            ->assertJsonPath('data.0.name', 'Test Restaurant')
            ->assertJsonStructure([
                'data' => [
                    [
                        'id',
                        'name',
                        'latitude',
                        'longitude',
                        'is_open',
                        'is_accepting_orders',
                        'menu_items',
                    ],
                ],
            ]);
    }
}
