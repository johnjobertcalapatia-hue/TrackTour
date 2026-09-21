<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class TourismOfficeApiTest extends TestCase
{
    use RefreshDatabase;

    private User $tourismOfficer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tourismOfficer = User::create([
            'email' => 'tourism@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourism_office',
            'account_status' => 'approved',
        ]);
    }

    public function test_tourism_office_can_get_dashboard(): void
    {
        $response = $this->actingAs($this->tourismOfficer, 'sanctum')
            ->getJson('/api/tourism-office/dashboard');

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ])
            ->assertJsonStructure([
                'data' => [
                    'stats',
                    'tourism',
                    'recent_businesses',
                    'top_municipalities',
                ],
            ]);
    }

    public function test_tourism_office_can_list_business_owners(): void
    {
        User::create([
            'email' => 'owner1@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'pending_review',
        ]);

        $response = $this->actingAs($this->tourismOfficer, 'sanctum')
            ->getJson('/api/tourism-office/business-owners');

        $response->assertOk()
            ->assertJson([
                'success' => true,
            ]);
    }

    public function test_non_tourism_office_cannot_access(): void
    {
        $tourist = User::create([
            'email' => 'tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $response = $this->actingAs($tourist, 'sanctum')
            ->getJson('/api/tourism-office/dashboard');

        $response->assertStatus(403);
    }
}
