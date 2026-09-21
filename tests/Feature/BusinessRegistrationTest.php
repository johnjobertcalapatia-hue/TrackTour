<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class BusinessRegistrationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
    }

    private function createOwner(): User
    {
        $user = User::factory()->create([
            'role' => User::ROLE_BUSINESS_OWNER,
            'account_status' => 'approved',
        ]);
        $user->profile()->create([
            'first_name' => 'Test',
            'last_name' => 'Owner',
        ]);

        return $user;
    }

    public function test_registration_screen_can_be_rendered(): void
    {
        $response = $this->actingAs($this->createOwner())
            ->get(route('business-owner.businesses.create'));

        $response->assertStatus(200);
    }

    public function test_sync_modules_works_directly(): void
    {
        $category = BusinessCategory::where('name', 'Restaurant')->first();
        $this->assertNotNull($category);

        $business = Business::create([
            'owner_id' => $this->createOwner()->id,
            'business_category_id' => $category->id,
            'business_name' => 'Test Direct Sync',
            'status' => 'under_review',
        ]);

        $business->syncModulesFromCategory();

        $this->assertGreaterThan(0, $business->activeModules()->count());
        $this->assertTrue($business->hasModule('menu_management'));
        $this->assertTrue($business->hasModule('food_ordering'));
        $this->assertFalse($business->hasModule('room_management'));
    }

    public function test_controller_flow_reproduced(): void
    {
        $user = $this->createOwner();
        $category = BusinessCategory::where('name', 'Restaurant')->first();
        $municipalityId = Municipality::first()->id;
        $barangayId = Barangay::first()->id;

        try {
            DB::beginTransaction();

            $business = $user->businesses()->create([
                'business_category_id' => $category->id,
                'business_name' => 'Debug Restaurant',
                'municipality_id' => $municipalityId,
                'barangay_id' => $barangayId,
                'status' => 'under_review',
            ]);

            $business->statusLogs()->create([
                'status' => 'under_review',
                'remarks' => 'Business registration created',
            ]);

            $business->syncModulesFromCategory();

            DB::commit();

            $this->assertNotNull($business->id);
            $this->assertGreaterThan(0, $business->activeModules()->count());
        } catch (\Exception $e) {
            DB::rollBack();
            $this->fail('Controller flow failed: '.$e->getMessage()."\n".$e->getTraceAsString());
        }
    }

    private function registrationPayload(array $overrides = []): array
    {
        $category = BusinessCategory::where('name', 'Restaurant')->first();
        $municipalityId = Municipality::first()->id;
        $barangayId = Barangay::first()->id;

        return array_merge([
            'business_name' => 'Test Business',
            'business_description' => 'A test business description.',
            'business_category_id' => $category->id,
            'municipality_id' => $municipalityId,
            'barangay_id' => $barangayId,
            'address' => '123 Test Street',
            'contact_number' => '09171234567',
            'email' => 'test@example.com',
            'opening_time' => '08:00',
            'closing_time' => '22:00',
            'business_days' => ['Monday', 'Tuesday'],
            'latitude' => 12.5,
            'longitude' => 121.2,
            'legal_entity_type' => 'Sole Proprietorship',
            'tin' => '123-456-789-000',
            'year_established' => '2020',
        ], $overrides);
    }

    public function test_business_can_be_registered_with_modules_synced(): void
    {
        $category = BusinessCategory::where('name', 'Restaurant')->first();
        $this->assertNotNull($category);

        $response = $this->actingAs($this->createOwner())
            ->postJson(route('business-owner.businesses.store'), $this->registrationPayload([
                'business_name' => 'Test Restaurant',
            ]));

        $response->assertStatus(201);

        $business = Business::where('business_name', 'Test Restaurant')->first();
        $this->assertNotNull($business);
        $this->assertEquals('under_review', $business->status);
        $this->assertEquals($category->id, $business->business_category_id);

        $expectedModules = $category->modules()->pluck('code')->sort()->values();
        $actualModules = $business->activeModules()->pluck('code')->sort()->values();
        $this->assertEquals($expectedModules->toArray(), $actualModules->toArray());
    }

    public function test_business_registration_requires_category_and_location(): void
    {
        $response = $this->actingAs($this->createOwner())
            ->postJson(route('business-owner.businesses.store'), [
                'business_name' => 'Incomplete Business',
            ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors([
            'business_category_id', 'municipality_id', 'barangay_id', 'address',
        ]);
    }

    public function test_different_categories_get_different_modules(): void
    {
        $user = $this->createOwner();

        $hotelCat = BusinessCategory::where('name', 'Hotel')->first();
        $diveCat = BusinessCategory::where('name', 'Dive Shop')->first();

        $resp1 = $this->actingAs($user)->postJson(route('business-owner.businesses.store'), $this->registrationPayload([
            'business_category_id' => $hotelCat->id,
            'business_name' => 'Test Hotel',
            'opening_time' => '00:00',
            'closing_time' => '23:59',
        ]));
        $resp1->assertStatus(201);

        $resp2 = $this->actingAs($user)->postJson(route('business-owner.businesses.store'), $this->registrationPayload([
            'business_category_id' => $diveCat->id,
            'business_name' => 'Test Dive Shop',
        ]));
        $resp2->assertStatus(201);

        $hotel = Business::where('business_name', 'Test Hotel')->first();
        $dive = Business::where('business_name', 'Test Dive Shop')->first();
        $this->assertNotNull($hotel);
        $this->assertNotNull($dive);

        $hotelCodes = $hotel->activeModules()->pluck('code')->toArray();
        $diveCodes = $dive->activeModules()->pluck('code')->toArray();

        $this->assertContains('room_management', $hotelCodes);
        $this->assertNotContains('room_management', $diveCodes);
        $this->assertContains('equipment_inventory', $diveCodes);
        $this->assertNotContains('equipment_inventory', $hotelCodes);
    }

    public function test_middleware_sets_active_business_and_modules(): void
    {
        $user = $this->createOwner();
        $category = BusinessCategory::where('name', 'Resort')->first();

        $resp = $this->actingAs($user)->postJson(route('business-owner.businesses.store'), $this->registrationPayload([
            'business_category_id' => $category->id,
            'business_name' => 'Test Resort',
        ]));
        $resp->assertStatus(201);

        $business = Business::where('business_name', 'Test Resort')->first();
        $this->assertNotNull($business);

        $this->assertGreaterThan(0, $business->activeModules()->count());

        $moduleCodes = $business->activeModules()->pluck('code')->toArray();
        $this->assertContains('cottage_management', $moduleCodes);
        $this->assertContains('gallery', $moduleCodes);
    }
}
