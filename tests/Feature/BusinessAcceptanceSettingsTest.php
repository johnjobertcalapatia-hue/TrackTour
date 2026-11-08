<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class BusinessAcceptanceSettingsTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private User $otherOwner;

    private User $tourist;

    private Business $business;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = $this->makeUser('owner@example.com', 'business_owner');
        $this->otherOwner = $this->makeUser('other-owner@example.com', 'business_owner');
        $this->tourist = $this->makeUser('tourist@example.com', 'tourist');

        $category = BusinessCategory::create(['name' => 'Hotel']);
        $municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
        ]);

        $this->business = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Test Hotel',
            'business_description' => 'A hotel for acceptance settings tests',
            'status' => 'approved',
            'accepts_reservation' => true,
        ]);
    }

    public function test_owner_can_save_acceptance_preferences_and_they_are_returned(): void
    {
        $this->actingAs($this->owner, 'sanctum')
            ->putJson('/api/business-owner/businesses/'.$this->business->id.'/accept-settings', [
                'accepts_reservation' => false,
                'accepts_orders' => false,
                'accepts_walk_ins' => false,
            ])
            ->assertOk()
            ->assertJsonPath('data.accepts_reservation', false)
            ->assertJsonPath('data.accepts_orders', false)
            ->assertJsonPath('data.accepts_walk_ins', false)
            ->assertJsonPath('data.is_accepting_orders', false);

        $this->assertDatabaseHas('businesses', [
            'id' => $this->business->id,
            'accepts_reservation' => false,
            'accepts_orders' => false,
            'accepts_walk_ins' => false,
        ]);
    }

    public function test_acceptance_settings_require_boolean_values(): void
    {
        $this->actingAs($this->owner, 'sanctum')
            ->putJson('/api/business-owner/businesses/'.$this->business->id.'/accept-settings', [
                'accepts_reservation' => 'sometimes',
                'accepts_orders' => true,
                'accepts_walk_ins' => true,
            ])
            ->assertUnprocessable();

        $this->assertTrue($this->business->fresh()->accepts_reservation);
        $this->assertTrue($this->business->fresh()->accepts_orders);
    }

    public function test_only_business_owner_can_change_acceptance_settings(): void
    {
        $payload = [
            'accepts_reservation' => false,
            'accepts_orders' => false,
            'accepts_walk_ins' => false,
        ];

        $this->actingAs($this->otherOwner, 'sanctum')
            ->putJson('/api/business-owner/businesses/'.$this->business->id.'/accept-settings', $payload)
            ->assertForbidden();

        $this->actingAs($this->tourist, 'sanctum')
            ->putJson('/api/business-owner/businesses/'.$this->business->id.'/accept-settings', $payload)
            ->assertForbidden();
    }

    public function test_order_acceptance_defaults_to_enabled_for_existing_business_behavior(): void
    {
        $this->assertTrue($this->business->fresh()->accepts_orders);
    }

    public function test_disabling_order_acceptance_blocks_the_canonical_order_check(): void
    {
        $allDays = array_fill_keys(
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
            [['open' => '00:00', 'close' => '23:59'], ['open' => '23:59', 'close' => '00:00']]
        );
        $this->business->update([
            'accepts_orders' => false,
            'force_closed' => false,
            'business_hours' => $allDays,
        ]);

        $this->assertFalse($this->business->fresh()->isAcceptingOrders());
    }

    public function test_booking_list_and_submission_respect_accept_bookings_setting(): void
    {
        $this->business->update(['accepts_reservation' => false]);

        $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/booking')
            ->assertOk()
            ->assertJsonMissing(['id' => $this->business->id]);

        $this->actingAs($this->tourist, 'sanctum')
            ->postJson('/api/tourist/booking/'.$this->business->id, [
                'check_in_date' => now()->addDays(1)->toDateString(),
                'check_out_date' => now()->addDays(2)->toDateString(),
                'customer_name' => 'Test Tourist',
                'customer_phone' => '09170000000',
                'guests' => 2,
                'booking_type' => 'accommodation',
            ])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'This business is not currently accepting bookings.');

        $this->assertDatabaseCount('bookings', 0);
    }

    public function test_booking_list_includes_businesses_that_accept_bookings(): void
    {
        $response = $this->actingAs($this->tourist, 'sanctum')
            ->getJson('/api/tourist/booking');

        $response->assertOk()
            ->assertJsonFragment([
                'id' => $this->business->id,
                'business_name' => 'Test Hotel',
            ]);
    }

    private function makeUser(string $email, string $role): User
    {
        return User::create([
            'email' => $email,
            'password' => Hash::make('Password123!'),
            'role' => $role,
            'account_status' => 'approved',
        ]);
    }
}
