<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Booking;
use App\Models\Barangay;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\User;
use App\Repositories\Eloquent\BusinessRepository;
use App\Repositories\Eloquent\BookingRepository;
use App\Repositories\Eloquent\OrderRepository;
use App\Repositories\Eloquent\UserRepository;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class RepositoryTest extends TestCase
{
    use RefreshDatabase;

    private Municipality $municipality;

    protected function setUp(): void
    {
        parent::setUp();

        $this->municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
            'latitude' => 12.3500000,
            'longitude' => 122.3500000,
        ]);
    }

    public function test_user_repository_find_by_id(): void
    {
        $repo = app(UserRepository::class);

        $user = User::create([
            'email' => 'repo-test@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $found = $repo->findById($user->id);

        $this->assertNotNull($found);
        $this->assertEquals($user->id, $found->id);
        $this->assertEquals('repo-test@example.com', $found->email);
    }

    public function test_user_repository_create(): void
    {
        $repo = app(UserRepository::class);

        $user = $repo->create([
            'email' => 'created@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->assertNotNull($user);
        $this->assertEquals('created@example.com', $user->email);

        $this->assertDatabaseHas('users', [
            'email' => 'created@example.com',
            'role' => 'tourist',
        ]);
    }

    public function test_user_repository_get_paginated(): void
    {
        $repo = app(UserRepository::class);

        for ($i = 0; $i < 5; $i++) {
            User::create([
                "email" => "user{$i}@example.com",
                'password' => Hash::make('Password123!'),
                'role' => 'tourist',
                'account_status' => 'approved',
            ]);
        }

        $result = $repo->getPaginated([], 3);

        $this->assertEquals(3, $result->perPage());
        $this->assertEquals(5, $result->total());
        $this->assertCount(3, $result->items());
    }

    public function test_business_repository_get_nearby(): void
    {
        if (config('database.default') === 'sqlite') {
            $this->markTestSkipped('Haversine SQL functions (acos, sin, cos) are not supported in SQLite.');
        }

        $repo = app(BusinessRepository::class);

        $category = BusinessCategory::create(['name' => 'Restaurant']);
        $owner = User::create([
            'email' => 'owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        Business::create([
            'owner_id' => $owner->id,
            'municipality_id' => $this->municipality->id,
            'business_category_id' => $category->id,
            'business_name' => 'Nearby Restaurant',
            'latitude' => 12.3510000,
            'longitude' => 122.3510000,
            'status' => 'approved',
        ]);

        Business::create([
            'owner_id' => $owner->id,
            'municipality_id' => $this->municipality->id,
            'business_category_id' => $category->id,
            'business_name' => 'Far Restaurant',
            'latitude' => 13.5000000,
            'longitude' => 123.5000000,
            'status' => 'approved',
        ]);

        $nearby = $repo->getNearby(12.3500000, 122.3500000, 20);

        $this->assertGreaterThanOrEqual(1, $nearby->count());
        $this->assertEquals('Nearby Restaurant', $nearby->first()->business_name);
    }

    public function test_business_repository_search(): void
    {
        $repo = app(BusinessRepository::class);

        $owner = User::create([
            'email' => 'owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        Business::create([
            'owner_id' => $owner->id,
            'business_name' => 'Adobo House',
            'business_description' => 'Filipino restaurant',
            'status' => 'approved',
        ]);

        Business::create([
            'owner_id' => $owner->id,
            'business_name' => 'Beach Resort',
            'business_description' => 'Beautiful beach',
            'status' => 'approved',
        ]);

        $results = $repo->search('Adobo');

        $this->assertCount(1, $results);
        $this->assertEquals('Adobo House', $results->first()->business_name);
    }

    public function test_order_repository_get_today_summary(): void
    {
        $repo = app(OrderRepository::class);

        $owner = User::create([
            'email' => 'owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $business = Business::create([
            'owner_id' => $owner->id,
            'business_name' => 'Test Restaurant',
            'status' => 'approved',
        ]);

        Order::create([
            'order_number' => 'ORD-SUM001',
            'business_id' => $business->id,
            'customer_name' => 'Customer 1',
            'order_type' => 'pickup',
            'status' => 'waiting_restaurant',
            'subtotal' => 100.00,
            'total' => 100.00,
        ]);

        Order::create([
            'order_number' => 'ORD-SUM002',
            'business_id' => $business->id,
            'customer_name' => 'Customer 2',
            'order_type' => 'pickup',
            'status' => 'completed',
            'subtotal' => 200.00,
            'total' => 200.00,
            'completed_at' => now(),
        ]);

        $summary = $repo->getTodaySummary($business->id);

        $this->assertIsArray($summary);
        $this->assertEquals(1, $summary['pending']);
        $this->assertEquals(1, $summary['completed_today']);
        $this->assertEqualsWithDelta(200.0, $summary['revenue_today'], 0.01);
    }

    public function test_booking_repository_get_today_summary(): void
    {
        $repo = app(BookingRepository::class);

        $owner = User::create([
            'email' => 'owner@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $business = Business::create([
            'owner_id' => $owner->id,
            'business_name' => 'Test Resort',
            'status' => 'approved',
        ]);

        Booking::create([
            'booking_number' => 'BK-SUM001',
            'business_id' => $business->id,
            'customer_name' => 'Customer 1',
            'customer_email' => 'c1@example.com',
            'customer_phone' => '09171234567',
            'booking_type' => 'accommodation',
            'status' => 'pending',
            'check_in_date' => now()->addDays(5)->toDateString(),
            'check_out_date' => now()->addDays(7)->toDateString(),
            'guests' => 2,
            'total_amount' => 5000.00,
        ]);

        Booking::create([
            'booking_number' => 'BK-SUM002',
            'business_id' => $business->id,
            'customer_name' => 'Customer 2',
            'customer_email' => 'c2@example.com',
            'customer_phone' => '09179876543',
            'booking_type' => 'accommodation',
            'status' => 'completed',
            'check_in_date' => now()->subDays(2)->toDateString(),
            'check_out_date' => now()->subDays(1)->toDateString(),
            'guests' => 3,
            'total_amount' => 7500.00,
            'completed_at' => now(),
        ]);

        $summary = $repo->getTodaySummary($business->id);

        $this->assertIsArray($summary);
        $this->assertEquals(1, $summary['pending']);
        $this->assertEquals(1, $summary['completed_today']);
        $this->assertEqualsWithDelta(7500.0, $summary['revenue_today'], 0.01);
    }
}
