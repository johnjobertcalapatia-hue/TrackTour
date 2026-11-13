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

    public function test_explore_show_rating_summary_covers_all_approved_reviews(): void
    {
        // 12 approved reviews (more than the 10 returned in `reviews`) plus
        // pending ones that must be excluded from every aggregate.
        $ratings = [5, 5, 5, 5, 5, 5, 4, 4, 4, 3, 2, 1];
        foreach ($ratings as $rating) {
            Review::create([
                'business_id' => $this->business->id,
                'user_id' => $this->tourist->id,
                'rating' => $rating,
                'review' => 'Review',
                'status' => 'approved',
            ]);
        }
        Review::create([
            'business_id' => $this->business->id,
            'user_id' => $this->tourist->id,
            'rating' => 1,
            'review' => 'Pending',
            'status' => 'pending',
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson("/api/tourist/explore/{$this->business->id}");

        $response->assertOk()
            ->assertJsonPath('data.reviewsCount', 12)
            ->assertJsonPath('data.ratingBreakdown.5', 6)
            ->assertJsonPath('data.ratingBreakdown.4', 3)
            ->assertJsonPath('data.ratingBreakdown.3', 1)
            ->assertJsonPath('data.ratingBreakdown.2', 1)
            ->assertJsonPath('data.ratingBreakdown.1', 1)
            ->assertJsonCount(10, 'data.reviews');

        // (6*5 + 3*4 + 3 + 2 + 1) / 12 = 48 / 12 = 4.0 over all approved reviews.
        $this->assertEquals(4.0, $response->json('data.avgRating'));
    }

    public function test_explore_show_rating_summary_is_zero_without_reviews(): void
    {
        $this->actingAs($this->tourist, 'sanctum')
            ->getJson("/api/tourist/explore/{$this->business->id}")
            ->assertOk()
            ->assertJsonPath('data.reviewsCount', 0)
            ->assertJsonPath('data.avgRating', 0)
            ->assertJsonPath('data.ratingBreakdown.5', 0)
            ->assertJsonPath('data.ratingBreakdown.1', 0);
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

    public function test_tourist_food_list_honours_sort_and_real_category_names(): void
    {
        $category = \App\Models\OfferingCategory::create(['business_id' => $this->business->id, 'name' => 'Grilled Specialties']);
        $mk = fn (string $name, float $price, bool $bestseller, ?int $categoryId = null) => Offering::create([
            'business_id' => $this->business->id,
            'offering_category_id' => $categoryId,
            'name' => $name,
            'price' => $price,
            'is_available' => true,
            'status' => 'available',
            'bestseller' => $bestseller,
        ]);
        $mk('Mid', 150, false, $category->id);
        $mk('Cheap', 70, false);
        $mk('Pricey', 220, true, $category->id);

        $names = fn (string $query) => collect(
            $this->actingAs($this->tourist, 'sanctum')->getJson('/api/tourist/food'.$query)->assertOk()->json('data.data')
        )->pluck('name')->all();

        $this->assertSame(['Cheap', 'Mid', 'Pricey'], $names('?sort=price_low'));
        $this->assertSame(['Pricey', 'Mid', 'Cheap'], $names('?sort=price_high'));
        $this->assertSame('Pricey', $names('')[0], 'popular (default) lists bestsellers first');
        // Category chips send the real category name returned in `categories`.
        $this->assertEqualsCanonicalizing(['Mid', 'Pricey'], $names('?category=Grilled%20Specialties'));
        $this->assertContains(
            'Grilled Specialties',
            $this->actingAs($this->tourist, 'sanctum')->getJson('/api/tourist/food')->json('data.categories')
        );
    }

    public function test_tourist_explore_map_includes_only_available_business_menu_items(): void
    {
        $availableDish = Offering::create([
            'business_id' => $this->business->id,
            'name' => 'Chicken BBQ',
            'description' => 'Grilled chicken served with rice.',
            'price' => 180.00,
            'image' => 'offerings/chicken-bbq.jpg',
            'is_available' => true,
            'status' => 'available',
            'bestseller' => true,
            'sort_order' => 1,
        ]);
        Offering::create([
            'business_id' => $this->business->id,
            'name' => 'Unavailable Dish',
            'price' => 100.00,
            'is_available' => false,
            'status' => 'unavailable',
            'sort_order' => 2,
        ]);
        Offering::create([
            'business_id' => $this->business->id,
            'name' => 'Legacy Active Dish',
            'price' => 80.00,
            'is_available' => true,
            'status' => 'active',
            'sort_order' => 3,
        ]);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/explore/map');

        $response->assertOk()
            ->assertJsonPath('businesses.0.menu_items.0.id', $availableDish->id)
            ->assertJsonPath('businesses.0.menu_items.0.name', 'Chicken BBQ')
            ->assertJsonPath('businesses.0.menu_items.0.image', 'offerings/chicken-bbq.jpg')
            ->assertJsonCount(1, 'businesses.0.menu_items');
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
        $this->business->update(['logo' => 'businesses/logos/test-logo.png']);

        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/map/businesses');

        $response->assertOk()
            ->assertJsonPath('data.0.name', 'Test Restaurant')
            ->assertJsonPath('data.0.logo', '/storage/businesses/logos/test-logo.png')
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

    public function test_landing_map_preserves_absolute_logo_urls(): void
    {
        $logoUrl = rtrim(config('filesystems.disks.public.url'), '/').'/businesses/logos/test-logo.png';
        $this->business->update(['logo' => $logoUrl]);

        $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/map/businesses')
            ->assertOk()
            ->assertJsonPath('data.0.logo', $logoUrl);
    }
}
