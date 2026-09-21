<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Offering;
use App\Models\OfferingCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class OfferingManagementTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
    }

    private function createBusinessOwner(): User
    {
        $user = User::factory()->create([
            'role' => User::ROLE_BUSINESS_OWNER,
            'account_status' => User::ACCOUNT_STATUS_APPROVED,
        ]);
        $user->profile()->create([
            'first_name' => 'Test',
            'last_name' => 'Owner',
            'nationality' => 'Filipino',
            'mobile_number' => '09171234567',
        ]);

        return $user;
    }

    private function createBusiness(User $owner, string $categoryName = 'Restaurant'): Business
    {
        $category = BusinessCategory::where('name', $categoryName)->first();

        return Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => $category->id,
            'business_name' => "Test {$categoryName}",
            'contact_number' => '09171234567',
            'email' => fake()->safeEmail(),
            'address' => 'Test Address',
            'status' => 'approved',
        ]);
    }

    public function test_offerings_index_returns_json(): void
    {
        $user = $this->createBusinessOwner();
        $business = $this->createBusiness($user);

        $response = $this->actingAs($user)
            ->getJson('/api/business-owner/offerings');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'success',
            'message',
        ]);
    }

    public function test_offering_can_be_created(): void
    {
        $user = $this->createBusinessOwner();
        $business = $this->createBusiness($user);

        $response = $this->actingAs($user)
            ->postJson('/api/business-owner/offerings', [
                'business_id' => $business->id,
                'name' => 'Test Burger',
                'description' => 'A delicious test burger',
                'price' => 150.00,
                'status' => 'available',
                'is_available' => '1',
            ]);

        $response->assertStatus(201);
        $response->assertJsonPath('success', true);

        $this->assertDatabaseHas('offerings', [
            'business_id' => $business->id,
            'name' => 'Test Burger',
            'price' => 150.00,
            'is_available' => true,
        ]);
    }

    public function test_offering_can_be_created_with_new_category(): void
    {
        $user = $this->createBusinessOwner();
        $business = $this->createBusiness($user);

        $response = $this->actingAs($user)
            ->postJson('/api/business-owner/offerings', [
                'business_id' => $business->id,
                'name' => 'Veggie Pizza',
                'price' => 250.00,
                'status' => 'available',
                'new_category' => 'Pizzas',
            ]);

        $response->assertStatus(201);

        $this->assertDatabaseHas('offering_categories', [
            'business_id' => $business->id,
            'name' => 'Pizzas',
        ]);

        $category = OfferingCategory::where('business_id', $business->id)
            ->where('name', 'Pizzas')->first();

        $this->assertDatabaseHas('offerings', [
            'business_id' => $business->id,
            'name' => 'Veggie Pizza',
            'offering_category_id' => $category->id,
        ]);
    }

    public function test_offering_can_be_updated(): void
    {
        $user = $this->createBusinessOwner();
        $business = $this->createBusiness($user);
        $offering = $business->offerings()->create([
            'name' => 'Old Name',
            'price' => 100.00,
            'status' => 'available',
            'is_available' => true,
        ]);

        $response = $this->actingAs($user)
            ->putJson("/api/business-owner/offerings/{$offering->id}", [
                'name' => 'Updated Name',
                'price' => 200.00,
                'status' => 'unavailable',
            ]);

        $response->assertStatus(200);
        $response->assertJsonPath('success', true);

        $this->assertDatabaseHas('offerings', [
            'id' => $offering->id,
            'name' => 'Updated Name',
            'price' => 200.00,
            'is_available' => false,
        ]);
    }

    public function test_offering_can_be_deleted(): void
    {
        $user = $this->createBusinessOwner();
        $business = $this->createBusiness($user);
        $offering = $business->offerings()->create([
            'name' => 'To Delete',
            'price' => 50.00,
        ]);

        $response = $this->actingAs($user)
            ->delete("/api/business-owner/offerings/{$offering->id}");

        $response->assertStatus(200);

        $this->assertDatabaseHas('offerings', [
            'id' => $offering->id,
            'status' => 'archived',
        ]);
    }

    public function test_categories_returns_json(): void
    {
        $user = $this->createBusinessOwner();
        $this->createBusiness($user);

        $response = $this->actingAs($user)
            ->getJson('/api/business-owner/offerings/categories');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'success',
            'data',
        ]);
    }

    public function test_category_can_be_created(): void
    {
        $user = $this->createBusinessOwner();
        $business = $this->createBusiness($user);

        $response = $this->actingAs($user)
            ->postJson('/api/business-owner/offerings/categories', [
                'business_id' => $business->id,
                'name' => 'Beverages',
            ]);

        $response->assertStatus(201);

        $this->assertDatabaseHas('offering_categories', [
            'business_id' => $business->id,
            'name' => 'Beverages',
        ]);
    }

    public function test_category_can_be_deleted(): void
    {
        $user = $this->createBusinessOwner();
        $business = $this->createBusiness($user);
        $category = $business->offeringCategories()->create([
            'name' => 'Snacks',
        ]);

        $response = $this->actingAs($user)
            ->delete("/api/business-owner/offerings/categories/{$category->id}");

        $response->assertStatus(200);

        $this->assertSoftDeleted($category);
    }

    public function test_owner_cannot_update_another_owners_offering(): void
    {
        $owner1 = $this->createBusinessOwner();
        $business1 = $this->createBusiness($owner1);

        $owner2 = $this->createBusinessOwner();
        $offering = $business1->offerings()->create([
            'name' => 'Secret Item',
            'price' => 500.00,
        ]);

        $response = $this->actingAs($owner2)
            ->putJson("/api/business-owner/offerings/{$offering->id}", [
                'name' => 'Hacked',
                'price' => 1.00,
                'status' => 'available',
            ]);

        $response->assertStatus(403);
    }

    public function test_offering_can_be_created_with_image(): void
    {
        if (! extension_loaded('gd')) {
            $this->markTestSkipped('GD extension is required to create fake images.');
        }

        Storage::fake('public');

        $user = $this->createBusinessOwner();
        $business = $this->createBusiness($user);

        $file = UploadedFile::fake()->image('burger.jpg');

        $response = $this->actingAs($user)
            ->postJson('/api/business-owner/offerings', [
                'business_id' => $business->id,
                'name' => 'Burger with Image',
                'price' => 180.00,
                'status' => 'available',
                'image' => $file,
            ]);

        $response->assertStatus(201);

        $offering = Offering::where('name', 'Burger with Image')->first();
        $this->assertNotNull($offering);
        $this->assertNotNull($offering->image);
        Storage::disk('public')->assertExists($offering->image);
    }

    public function test_hotel_room_can_be_created_as_offering(): void
    {
        $user = $this->createBusinessOwner();
        $business = $this->createBusiness($user, 'Hotel');

        $response = $this->actingAs($user)
            ->postJson('/api/business-owner/offerings', [
                'business_id' => $business->id,
                'name' => 'Deluxe Ocean View Room',
                'description' => 'A spacious room with ocean view',
                'price' => 3500.00,
                'status' => 'available',
                'is_available' => '1',
            ]);

        $response->assertStatus(201);

        $this->assertDatabaseHas('offerings', [
            'business_id' => $business->id,
            'name' => 'Deluxe Ocean View Room',
            'price' => 3500.00,
            'is_available' => true,
        ]);
    }

    public function test_offering_list_shows_on_index(): void
    {
        $user = $this->createBusinessOwner();
        $business = $this->createBusiness($user);

        $business->offerings()->createMany([
            ['name' => 'Pizza', 'price' => 200.00],
            ['name' => 'Pasta', 'price' => 180.00],
            ['name' => 'Salad', 'price' => 120.00],
        ]);

        $response = $this->actingAs($user)
            ->getJson('/api/business-owner/offerings');

        $response->assertStatus(200);
        $response->assertJsonFragment(['name' => 'Pizza']);
        $response->assertJsonFragment(['name' => 'Pasta']);
        $response->assertJsonFragment(['name' => 'Salad']);
    }
}
