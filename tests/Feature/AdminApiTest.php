<?php

namespace Tests\Feature;

use App\Models\Barangay;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
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

    public function test_admin_can_list_riders(): void
    {
        User::create([
            'email' => 'rider1@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
        ]);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/riders');

        $response->assertOk()
            ->assertJsonStructure([
                'success',
                'data',
                'meta',
            ]);
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
}
