<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Favorite;
use App\Models\Municipality;
use App\Models\Review;
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
}
