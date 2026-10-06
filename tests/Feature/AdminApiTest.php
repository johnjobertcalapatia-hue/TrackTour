<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\User;
use App\Services\DeliveryFeeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AdminApiTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::create([
            'email' => 'admin@bansud.gov.ph',
            'password' => Hash::make('Password123!'),
            'role' => 'bansud_tourism_office',
            'account_status' => 'approved',
        ]);
    }

    public function test_admin_can_get_dashboard(): void
    {
        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/dashboard');

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ]);
    }

    public function test_admin_can_list_users(): void
    {
        User::create([
            'email' => 'user1@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/users');

        $response->assertOk()
            ->assertJsonStructure([
                'success',
                'message',
                'data',
                'meta' => [
                    'current_page',
                    'last_page',
                    'per_page',
                    'total',
                ],
            ]);
    }

    public function test_admin_can_list_users_with_search(): void
    {
        User::create([
            'email' => 'alice@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        User::create([
            'email' => 'bob@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
        ]);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/users?search=alice');

        $response->assertOk()
            ->assertJsonStructure([
                'success',
                'data',
                'meta',
            ]);
    }

    public function test_admin_can_list_users_by_role(): void
    {
        User::create([
            'email' => 'tourist1@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        User::create([
            'email' => 'rider1@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
        ]);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/users?role=tourist');

        $response->assertOk()
            ->assertJsonStructure([
                'success',
                'data',
                'meta',
            ]);
    }

    public function test_admin_can_list_businesses(): void
    {
        $owner = User::create([
            'email' => 'owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        Business::create([
            'owner_id' => $owner->id,
            'business_name' => 'Test Business',
            'status' => 'approved',
        ]);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/businesses');

        $response->assertOk()
            ->assertJsonStructure([
                'success',
                'data',
                'meta',
            ]);
    }

    public function test_admin_can_list_municipalities(): void
    {
        Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
        ]);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/municipalities');

        $response->assertOk()
            ->assertJsonStructure([
                'success',
                'data',
                'meta',
            ]);
    }

    public function test_admin_can_list_business_categories(): void
    {
        BusinessCategory::create(['name' => 'Restaurant']);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/business-categories');

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ])
            ->assertJsonStructure([
                'data',
            ]);
    }

    public function test_admin_can_add_document_to_category(): void
    {
        $category = BusinessCategory::create(['name' => 'Restaurant']);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/business-categories/{$category->id}/documents", [
                'document_name' => 'Business Permit',
                'document_code' => 'BP-001',
                'is_required' => true,
                'has_expiration' => true,
            ]);

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ]);

        $this->assertDatabaseHas('required_documents', [
            'business_category_id' => $category->id,
            'document_name' => 'Business Permit',
            'document_code' => 'BP-001',
            'is_required' => true,
        ]);
    }

    public function test_admin_can_list_riders(): void
    {
        $rider = User::create([
            'email' => 'rider1@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
        ]);

        $rider->profile()->create([
            'first_name' => 'Rider',
            'last_name' => 'One',
            'mobile_number' => '09171234567',
        ]);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/riders');

        $response->assertOk()
            ->assertJsonStructure([
                'success',
                'data',
                'meta',
            ]);

        $riderRow = collect($response->json('data'))->firstWhere('id', $rider->id);
        $this->assertSame('09171234567', $riderRow['phone'] ?? null);
    }

    public function test_non_admin_cannot_access_admin_routes(): void
    {
        $tourist = User::create([
            'email' => 'tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $response = $this->actingAs($tourist, 'sanctum')
            ->getJson('/api/admin/dashboard');

        $response->assertStatus(403);
    }

    public function test_non_admin_cannot_access_users_route(): void
    {
        $businessOwner = User::create([
            'email' => 'owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $response = $this->actingAs($businessOwner, 'sanctum')
            ->getJson('/api/admin/users');

        $response->assertStatus(403);
    }

    // ─────────────────────────────────────────────────────────────
    // Rider fare settings (standard fare + additional fees)
    // ─────────────────────────────────────────────────────────────

    private function farePayload(array $overrides = []): array
    {
        return array_merge([
            'base_fare' => 60.00,
            'included_kilometers' => 1.50,
            'per_kilometer' => 12.00,
            'minimum_fee' => 50.00,
            'service_adjustment' => 10.00,
            'surge_multiplier' => 1.25,
        ], $overrides);
    }

    public function test_admin_can_get_default_fare_settings(): void
    {
        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/riders/fares');

        $response->assertOk()
            ->assertJsonStructure([
                'success',
                'data' => [
                    'base_fare',
                    'included_kilometers',
                    'per_kilometer',
                    'minimum_fee',
                    'service_adjustment',
                    'surge_multiplier',
                ],
            ]);

        $this->assertEquals((float) config('delivery.base_fare'), $response->json('data.base_fare'));
        $this->assertEquals((float) config('delivery.per_kilometer'), $response->json('data.per_kilometer'));
    }

    public function test_admin_can_update_fare_settings(): void
    {
        $response = $this->actingAs($this->admin, 'sanctum')
            ->putJson('/api/admin/riders/fares', $this->farePayload());

        $response->assertOk();

        $this->assertEquals(60.0, $response->json('data.base_fare'));
        $this->assertEquals(1.5, $response->json('data.included_kilometers'));
        $this->assertEquals(12.0, $response->json('data.per_kilometer'));
        $this->assertEquals(50.0, $response->json('data.minimum_fee'));
        $this->assertEquals(10.0, $response->json('data.service_adjustment'));
        $this->assertEquals(1.25, $response->json('data.surge_multiplier'));

        $this->assertDatabaseHas('tourism_settings', [
            'key' => 'delivery_base_fare',
            'value' => '60',
        ]);

        $this->assertSame(60.0, app(\App\Services\DeliveryFareSettings::class)->baseFare());

        $second = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/riders/fares');

        $second->assertOk();

        $this->assertEquals(60.0, $second->json('data.base_fare'));
        $this->assertEquals(10.0, $second->json('data.service_adjustment'));
    }

    public function test_updated_fare_settings_drive_rider_delivery_fee_calculation(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->putJson('/api/admin/riders/fares', $this->farePayload())
            ->assertOk();

        Http::fake([
            'router.project-osrm.org/*' => Http::response([
                'code' => 'Ok',
                'routes' => [[
                    'distance' => 5000,
                    'duration' => 300,
                ]],
            ]),
        ]);

        $owner = User::create([
            'email' => 'kitchen@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
            'latitude' => 12.5,
            'longitude' => 121.3,
        ]);

        $business = Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Test Kitchen',
            'business_description' => 'Test kitchen',
            'status' => 'approved',
            'force_closed' => false,
            'latitude' => 12.5,
            'longitude' => 121.3,
        ]);

        $fee = app(DeliveryFeeService::class)->calculateOrderDeliveryFee($business, 12.6, 121.4);

        // distance 5.0 km, included 1.5 → 3.5 × 12 = 42 distance charge
        // (60 + 42 + 10) × 1.25 = 140.00
        $this->assertSame(5.0, $fee['distance_km']);
        $this->assertSame(60.0, $fee['base_fare']);
        $this->assertSame(12.0, $fee['distance_rate']);
        $this->assertSame(42.0, $fee['distance_charge']);
        $this->assertSame(10.0, $fee['service_adjustment']);
        $this->assertSame(1.25, $fee['surge_multiplier']);
        $this->assertSame(140.0, $fee['delivery_fee']);
    }

    public function test_fare_settings_persist_and_unknown_keys_are_ignored(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->putJson('/api/admin/riders/fares', $this->farePayload() + ['mystery' => 99])
            ->assertOk();

        $this->assertSame(60.0, app(\App\Services\DeliveryFareSettings::class)->baseFare());
        $this->assertSame(1.25, app(\App\Services\DeliveryFareSettings::class)->surgeMultiplier());
        $this->assertDatabaseMissing('tourism_settings', ['key' => 'delivery_mystery']);

        // Zero values are meaningful and must not be treated as "unset".
        $response = $this->actingAs($this->admin, 'sanctum')
            ->putJson('/api/admin/riders/fares', $this->farePayload(['service_adjustment' => 0]))
            ->assertOk();

        $this->assertEquals(0.0, $response->json('data.service_adjustment'));
    }

    public function test_fare_settings_reject_invalid_values(): void
    {
        $response = $this->actingAs($this->admin, 'sanctum')
            ->putJson('/api/admin/riders/fares', $this->farePayload(['base_fare' => -5]));

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['base_fare']);

        $this->assertDatabaseMissing('tourism_settings', ['key' => 'delivery_base_fare', 'value' => '-5.00']);
    }

    public function test_fare_settings_update_records_audit_log(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->putJson('/api/admin/riders/fares', $this->farePayload())
            ->assertOk();

        $this->assertDatabaseHas('activity_logs', [
            'user_id' => $this->admin->id,
            'action' => 'rider_fare_settings.updated',
        ]);
    }

    public function test_non_admin_cannot_access_fare_settings(): void
    {
        $tourist = User::create([
            'email' => 'tourist2@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->actingAs($tourist, 'sanctum')
            ->getJson('/api/admin/riders/fares')
            ->assertStatus(403);

        $this->actingAs($tourist, 'sanctum')
            ->putJson('/api/admin/riders/fares', $this->farePayload())
            ->assertStatus(403);

        $this->assertDatabaseMissing('tourism_settings', ['key' => 'delivery_base_fare']);
    }
}
