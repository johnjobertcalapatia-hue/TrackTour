<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Offering;
use App\Models\Promotion;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class RouteModelBindingTest extends TestCase
{
    use RefreshDatabase;

    private function makeUser(string $role, string $email): User
    {
        return User::create([
            'email' => $email,
            'password' => Hash::make('Password123!'),
            'role' => $role,
            'account_status' => 'approved',
        ]);
    }

    private function makeBusiness(User $owner): Business
    {
        return Business::create([
            'owner_id' => $owner->id,
            'business_name' => 'Test Restaurant',
            'business_description' => 'A test restaurant',
            'status' => 'approved',
        ]);
    }

    public function test_tourist_food_offering_detail_resolves_the_offering(): void
    {
        $owner = $this->makeUser('tourist', 'owner@example.com');
        $business = $this->makeBusiness($owner);

        $offering = Offering::create([
            'business_id' => $business->id,
            'name' => 'Adobo Rice',
            'price' => 120.00,
            'is_available' => true,
            'status' => 'available',
            'offering_type' => 'menu',
        ]);

        $response = $this->getJson('/api/tourist/food/'.$offering->id);

        $response->assertOk()
            ->assertJson([
                'success' => true,
                'data' => [
                    'id' => $offering->id,
                    'business_id' => $business->id,
                ],
            ]);
    }

    public function test_tourist_booking_business_detail_resolves_the_business(): void
    {
        $tourist = $this->makeUser('tourist', 'tourist@example.com');
        $business = $this->makeBusiness($tourist);

        $response = $this->be($tourist)
            ->getJson('/api/tourist/booking/'.$business->id);

        $response->assertOk()
            ->assertJson([
                'success' => true,
                'data' => [
                    'business' => [
                        'id' => $business->id,
                    ],
                ],
            ]);
    }

    public function test_business_owner_can_update_and_archive_a_promotion(): void
    {
        $owner = $this->makeUser('business_owner', 'owner@example.com');
        $business = $this->makeBusiness($owner);

        $promotion = Promotion::create([
            'business_id' => $business->id,
            'name' => 'Old Deal',
            'description' => 'Before',
            'type' => 'percentage',
            'value' => 10,
            'is_active' => true,
        ]);

        $this->be($owner);

        $update = $this->putJson('/api/business-owner/promotions/'.$promotion->id, [
            'title' => 'Summer Deal',
            'description' => 'After',
            'discount_percentage' => 25,
            'valid_from' => '2026-09-01',
            'valid_until' => '2026-10-01',
        ]);

        $update->assertOk()
            ->assertJson([
                'success' => true,
                'message' => 'Promotion updated successfully.',
            ]);

        $promotion->refresh();
        $this->assertSame('Summer Deal', $promotion->name);
        $this->assertSame('After', $promotion->description);
        $this->assertEqualsWithDelta(25.0, (float) $promotion->value, 0.01);

        $destroy = $this->deleteJson('/api/business-owner/promotions/'.$promotion->id);

        $destroy->assertOk()
            ->assertJson([
                'success' => true,
            ]);

        $this->assertSoftDeleted('promotions', ['id' => $promotion->id]);
    }

    public function test_admin_can_view_and_approve_a_rider(): void
    {
        $admin = $this->makeUser('bansud_tourism_office', 'admin@example.com');
        $rider = $this->makeUser('rider', 'rider@example.com');

        $this->be($admin);

        $this->getJson('/api/admin/riders/'.$rider->id)
            ->assertOk()
            ->assertJson([
                'success' => true,
                'data' => [
                    'email' => 'rider@example.com',
                ],
            ]);

        $this->postJson('/api/admin/riders/'.$rider->id.'/approve')
            ->assertOk()
            ->assertJson([
                'success' => true,
                'message' => 'Rider application has been approved successfully.',
            ]);

        $this->assertSame('approved', $rider->fresh()->account_status);
    }
}