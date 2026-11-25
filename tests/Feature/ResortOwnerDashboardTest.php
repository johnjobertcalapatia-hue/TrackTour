<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\ResortBlockedDate;
use App\Models\ResortOffering;
use App\Models\User;
use App\Services\ResortAvailabilityService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Resort owner dashboard (redesign 2026-11-24): today's free units from the
 * availability engine, reservations, closures, offerings and the setup checklist.
 */
class ResortOwnerDashboardTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Business $resort;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(CarbonImmutable::parse('2026-12-01 09:00', 'Asia/Manila'));
        $this->owner = User::create(['email' => 'owner@example.com', 'name' => 'owner', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->resort = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Resort'])->id,
            'municipality_id' => Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro'])->id,
            'business_name' => 'RJM Beach Resort', 'status' => 'approved', 'latitude' => 12.86, 'longitude' => 121.48,
            'contact_number' => '09177711536',
        ]);
    }

    private function offering(string $name, int $qty, bool $published = true, float $price = 300): ResortOffering
    {
        return ResortOffering::create([
            'business_id' => $this->resort->id, 'category' => 'cottage', 'name' => $name, 'booking_mode' => 'day_use',
            'pricing_basis' => 'per_unit', 'price' => $price, 'inventory_mode' => 'units', 'inventory_quantity' => $qty, 'is_published' => $published,
        ]);
    }

    public function test_the_dashboard_shows_today_reservations_closures_and_setup(): void
    {
        $cottage = $this->offering('Cottage', 10);
        $hut = $this->offering('Hut', 2, price: 150);
        $this->offering('Draft villa', 1, published: false, price: 5000);
        $svc = app(ResortAvailabilityService::class);
        DB::transaction(fn () => $svc->reserve($this->resort, $svc->claimsFor($cottage, '2026-12-01', null, null, 3, 6)));
        ResortBlockedDate::create(['business_id' => $this->resort->id, 'resort_offering_id' => $hut->id, 'start_date' => '2026-12-01', 'end_date' => '2026-12-01', 'reason' => 'Repairs']);
        ResortBlockedDate::create(['business_id' => $this->resort->id, 'start_date' => '2026-12-20', 'end_date' => '2026-12-21', 'reason' => 'Private event']);
        Booking::create(['booking_number' => 'BK-1', 'business_id' => $this->resort->id, 'customer_name' => 'Ana Cruz', 'customer_email' => 'ana@example.com', 'booking_type' => 'accommodation', 'status' => 'pending', 'check_in_date' => '2026-12-05', 'guests' => 4]);

        $data = $this->actingAs($this->owner, 'sanctum')->getJson("/api/business-owner/dashboard/resort/{$this->resort->id}")->assertOk()->json('data');

        $today = collect($data['today']['offerings'])->keyBy('name');
        $this->assertSame(7, $today['Cottage']['available']);
        $this->assertTrue($today['Hut']['blocked']);
        $this->assertArrayNotHasKey('Draft villa', $today->all(), 'published offerings only');
        $this->assertSame(1, $data['reservations']['pending']);
        $this->assertSame('Ana Cruz', $data['reservations']['next'][0]['customer_name']);
        $this->assertSame(['published' => 2, 'total' => 3], ['published' => $data['offerings']['published'], 'total' => $data['offerings']['total']]);
        $this->assertEquals(150, $data['offerings']['from_price']);
        $this->assertSame(['2026-12-01', '2026-12-20'], array_column($data['closures'], 'start_date'));
        $checklist = collect($data['checklist'])->keyBy('key');
        $this->assertFalse($checklist['offerings']['done'], 'needs 3 published');
        $this->assertTrue($checklist['location']['done']);
        $this->assertTrue($checklist['contact']['done']);
        $this->assertCount(30, $data['views']['daily']);
    }

    public function test_only_the_owner_and_only_for_resorts(): void
    {
        $stranger = User::create(['email' => 's@example.com', 'name' => 's', 'password' => Hash::make('Password123!'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->actingAs($stranger, 'sanctum')->getJson("/api/business-owner/dashboard/resort/{$this->resort->id}")->assertForbidden();

        $grill = Business::create(['owner_id' => $this->owner->id, 'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id, 'municipality_id' => $this->resort->municipality_id, 'business_name' => 'Grill', 'status' => 'approved', 'latitude' => 1, 'longitude' => 1]);
        $this->actingAs($this->owner, 'sanctum')->getJson("/api/business-owner/dashboard/resort/{$grill->id}")->assertUnprocessable();
    }
}
