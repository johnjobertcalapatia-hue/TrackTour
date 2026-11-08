<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\OfferingVariation;
use App\Models\Review;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * GET /api/tourist/food/{offering} — the individual food item detail payload
 * consumed by the tourist food detail modal.
 *
 * These tests assert that the endpoint reports only real menu/restaurant data:
 * no fabricated ratings, no invented reviews, and no visibility regressions
 * versus the food listing (index()).
 */
class TouristFoodDetailTest extends TestCase
{
    use RefreshDatabase;

    private function makeUser(string $role, string $email): User
    {
        return User::create([
            'name' => 'Test User',
            'email' => $email,
            'password' => Hash::make('Password123!'),
            'role' => $role,
            'account_status' => 'approved',
        ]);
    }

    private function makeBusiness(User $owner, array $overrides = []): Business
    {
        return Business::create(array_merge([
            'owner_id' => $owner->id,
            'business_name' => 'Test Restaurant',
            'business_description' => 'A test restaurant',
            'status' => 'approved',
        ], $overrides));
    }

    private function makeOffering(Business $business, array $overrides = []): Offering
    {
        return Offering::create(array_merge([
            'business_id' => $business->id,
            'name' => 'Adobo Rice',
            'description' => 'Tender chicken adobo over steamed rice.',
            'price' => 120.00,
            'is_available' => true,
            'status' => 'available',
            'offering_type' => 'menu',
        ], $overrides));
    }

    public function test_food_detail_returns_gallery_variations_and_restaurant_context(): void
    {
        $owner = $this->makeUser('tourist', 'owner@example.com');
        $business = $this->makeBusiness($owner, [
            'address' => 'Poblacion, Bansud, Oriental Mindoro',
            'logo' => 'logos/restaurant.png',
        ]);

        $offering = $this->makeOffering($business, [
            'image' => 'foods/adobo.jpg',
            'images' => ['foods/adobo-2.jpg', 'foods/adobo-3.jpg'],
            'compare_price' => 150.00,
            'preparation_time' => 20,
            'has_variations' => true,
        ]);

        OfferingVariation::create(['offering_id' => $offering->id, 'name' => 'Regular', 'price' => 120, 'is_available' => true, 'sort_order' => 0]);
        OfferingVariation::create(['offering_id' => $offering->id, 'name' => 'Large', 'price' => 150, 'is_available' => true, 'sort_order' => 1]);
        OfferingVariation::create(['offering_id' => $offering->id, 'name' => 'Family', 'price' => 250, 'is_available' => false, 'sort_order' => 2]);

        $response = $this->getJson('/api/tourist/food/'.$offering->id);

        $response->assertOk()
            ->assertJsonPath('data.id', $offering->id)
            ->assertJsonPath('data.name', 'Adobo Rice')
            ->assertJsonPath('data.description', 'Tender chicken adobo over steamed rice.')
            ->assertJsonPath('data.category', 'General')
            ->assertJsonPath('data.image', 'foods/adobo.jpg')
            ->assertJsonPath('data.is_available', true)
            ->assertJsonPath('data.has_variations', true)
            ->assertJsonPath('data.preparation_time', 20)
            ->assertJsonPath('data.business_id', $business->id)
            ->assertJsonPath('data.business_name', 'Test Restaurant')
            ->assertJsonPath('data.business_logo', 'logos/restaurant.png')
            ->assertJsonPath('data.business_address', 'Poblacion, Bansud, Oriental Mindoro')
            ->assertJsonPath('data.is_accepting_orders', false);

        // Gallery: primary image first, then the stored image gallery.
        $this->assertSame(
            ['foods/adobo.jpg', 'foods/adobo-2.jpg', 'foods/adobo-3.jpg'],
            $response->json('data.images')
        );

        $this->assertEquals(150.0, $response->json('data.compare_price'));

        $variations = $response->json('data.variations');
        $this->assertCount(3, $variations);
        $this->assertSame('Regular', $variations[0]['name']);
        $this->assertEquals(120.0, $variations[0]['price']);
        $this->assertTrue($variations[0]['is_available']);
        $this->assertSame('Large', $variations[1]['name']);
        $this->assertFalse($variations[2]['is_available']);
    }

    public function test_food_detail_returns_only_approved_restaurant_reviews(): void
    {
        $owner = $this->makeUser('tourist', 'owner@example.com');
        $business = $this->makeBusiness($owner);
        $offering = $this->makeOffering($business);
        $reviewer = $this->makeUser('tourist', 'reviewer@example.com');

        Review::create(['business_id' => $business->id, 'user_id' => $reviewer->id, 'rating' => 5, 'review' => 'Great food!', 'status' => 'approved']);
        Review::create(['business_id' => $business->id, 'user_id' => $reviewer->id, 'rating' => 4, 'review' => 'Nice place.', 'status' => 'approved']);
        Review::create(['business_id' => $business->id, 'user_id' => $reviewer->id, 'rating' => 1, 'review' => 'Hidden pending review.', 'status' => 'pending']);

        $response = $this->getJson('/api/tourist/food/'.$offering->id);

        $response->assertOk();

        $reviews = $response->json('data.business_reviews');
        $comments = array_column($reviews, 'review');

        $this->assertCount(2, $reviews);
        $this->assertContains('Great food!', $comments);
        $this->assertContains('Nice place.', $comments);
        $this->assertNotContains('Hidden pending review.', $comments);
        $this->assertSame('Test User', $reviews[0]['user_name'] ?? null);

        // The stored counter is the business-level metric maintained by ReviewObserver.
        $this->assertEquals($business->fresh()->review_count, $response->json('data.business_review_count'));
    }

    public function test_food_detail_reports_the_stored_restaurant_rating_without_fabricating_one(): void
    {
        $owner = $this->makeUser('tourist', 'owner@example.com');
        $business = $this->makeBusiness($owner);
        $offering = $this->makeOffering($business);

        // Unrated business: the stored average is 0, which must not surface as a rating.
        $this->getJson('/api/tourist/food/'.$offering->id)
            ->assertOk()
            ->assertJsonPath('data.rating', null);

        $reviewer = $this->makeUser('tourist', 'reviewer2@example.com');
        Review::create(['business_id' => $business->id, 'user_id' => $reviewer->id, 'rating' => 5, 'review' => 'Excellent.', 'status' => 'approved']);
        Review::create(['business_id' => $business->id, 'user_id' => $reviewer->id, 'rating' => 3, 'review' => 'Average.', 'status' => 'approved']);

        $business->refresh();

        $response = $this->getJson('/api/tourist/food/'.$offering->id);

        $response->assertOk();
        $this->assertEquals($business->average_rating, $response->json('data.rating'));
        $this->assertEquals(4.0, $response->json('data.rating'));
    }

    public function test_food_detail_returns_restaurant_strip_fields_and_full_rating_summary(): void
    {
        $owner = $this->makeUser('tourist', 'owner3@example.com');
        $municipality = Municipality::create(['name' => 'Bansud', 'district' => '1st', 'province' => 'Oriental Mindoro']);
        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $business = $this->makeBusiness($owner, [
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'contact_number' => '+63 912 345 6789',
            'opening_time' => '10:00:00',
            'closing_time' => '22:00:00',
        ]);
        $offering = $this->makeOffering($business, ['unit' => 'pc']);

        $reviewer = $this->makeUser('tourist', 'reviewer3@example.com');
        // 5 approved reviews (more than the 3 returned in business_reviews) + 1 pending.
        foreach ([5, 5, 4, 3, 1] as $rating) {
            Review::create(['business_id' => $business->id, 'user_id' => $reviewer->id, 'rating' => $rating, 'review' => 'r', 'status' => 'approved']);
        }
        Review::create(['business_id' => $business->id, 'user_id' => $reviewer->id, 'rating' => 1, 'review' => 'p', 'status' => 'pending']);

        $response = $this->getJson('/api/tourist/food/'.$offering->id);

        $response->assertOk()
            ->assertJsonPath('data.unit', 'pc')
            ->assertJsonPath('data.business_category', 'Restaurant')
            ->assertJsonPath('data.business_municipality', 'Bansud')
            ->assertJsonPath('data.business_contact_number', '+63 912 345 6789')
            ->assertJsonPath('data.business_rating_summary.count', 5)
            ->assertJsonPath('data.business_rating_summary.breakdown.5', 2)
            ->assertJsonPath('data.business_rating_summary.breakdown.4', 1)
            ->assertJsonPath('data.business_rating_summary.breakdown.3', 1)
            ->assertJsonPath('data.business_rating_summary.breakdown.2', 0)
            ->assertJsonPath('data.business_rating_summary.breakdown.1', 1)
            ->assertJsonCount(3, 'data.business_reviews');

        // (5+5+4+3+1)/5 = 3.6 over every approved review, pending excluded.
        $this->assertEquals(3.6, $response->json('data.business_rating_summary.average'));
        $this->assertStringStartsWith('10:00', (string) $response->json('data.business_opening_time'));
    }

    public function test_food_detail_returns_404_for_unavailable_offering(): void
    {
        $owner = $this->makeUser('tourist', 'owner@example.com');
        $business = $this->makeBusiness($owner);
        $offering = $this->makeOffering($business, ['is_available' => false, 'status' => 'unavailable']);

        $this->getJson('/api/tourist/food/'.$offering->id)->assertNotFound();
    }

    public function test_food_detail_returns_404_when_offering_status_is_not_canonical_available(): void
    {
        $owner = $this->makeUser('tourist', 'owner@example.com');
        $business = $this->makeBusiness($owner);
        $offering = $this->makeOffering($business, ['is_available' => true, 'status' => 'hidden']);

        $this->getJson('/api/tourist/food/'.$offering->id)->assertNotFound();
    }

    public function test_food_detail_returns_404_for_unapproved_business(): void
    {
        $owner = $this->makeUser('tourist', 'owner@example.com');
        $business = $this->makeBusiness($owner, ['status' => 'pending']);
        $offering = $this->makeOffering($business);

        $this->getJson('/api/tourist/food/'.$offering->id)->assertNotFound();
    }
}
