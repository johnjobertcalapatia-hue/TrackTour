<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Food drop-off location proof (owner decision 2026-11-12). A rider at the
 * tourist's door, 29 m away, could not confirm because the phone reported
 * worse than ±50 m and the server would not save the fix. Now the phone's own
 * fix sent with the action counts up to ±200 m (≤ 30 s old, within 50 m, no
 * teleport); coarser than ±50 m is flagged for the Tourism Office.
 */
class DropoffLocationProofTest extends TestCase
{
    use RefreshDatabase;

    private const LAT = 12.60;
    private const LNG = 121.40;

    private User $rider;
    private Business $restaurant;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $owner = User::create(['email' => 'owner@drop.test', 'password' => Hash::make('x'), 'role' => 'business_owner', 'account_status' => 'approved']);
        $this->restaurant = Business::create(['owner_id' => $owner->id, 'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => Municipality::create(['name' => 'Gloria', 'district' => '1st', 'province' => 'Oriental Mindoro'])->id,
            'business_name' => 'Drop Test Grill', 'status' => 'approved']);
        $this->rider = User::create(['email' => 'rider@drop.test', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved']);
        RiderDetail::create(['user_id' => $this->rider->id, 'rider_status' => 'busy', 'current_service' => 'food']);
    }

    private function delivery(string $status = 'arrived_destination'): Delivery
    {
        $tourist = User::create(['email' => uniqid().'@t.test', 'password' => Hash::make('x'), 'role' => 'tourist', 'account_status' => 'approved']);
        $order = Order::create(['order_number' => 'TT-'.random_int(10000, 99999), 'business_id' => $this->restaurant->id, 'user_id' => $tourist->id,
            'customer_name' => 'T', 'customer_email' => $tourist->email, 'order_type' => 'delivery', 'payment_method' => 'gcash', 'payment_status' => 'paid',
            'status' => 'ready', 'subtotal' => 300, 'system_fee' => 10, 'delivery_fee' => 40, 'rider_tip' => 0, 'total' => 350,
            'delivery_address' => 'Kawit, Gloria', 'delivery_latitude' => self::LAT, 'delivery_longitude' => self::LNG]);

        return Delivery::create(['order_id' => $order->id, 'rider_id' => $this->rider->id, 'status' => $status,
            'pickup_address' => 'Drop Test Grill', 'delivery_address' => 'Kawit, Gloria', 'pickup_latitude' => 12.51, 'pickup_longitude' => 121.31,
            'delivery_latitude' => self::LAT, 'delivery_longitude' => self::LNG]);
    }

    /** A saved fix $metresNorth of the drop-off, $ageSeconds old. */
    private function savedAt(float $metresNorth, int $ageSeconds = 5, ?float $accuracy = 20): void
    {
        RiderLocation::create(['rider_id' => $this->rider->id, 'latitude' => self::LAT + $metresNorth / 111_320, 'longitude' => self::LNG,
            'accuracy_m' => $accuracy, 'recorded_at' => now()->subSeconds($ageSeconds)]);
    }

    /** The phone's own fix, as the app sends it with the action. */
    private function phone(float $metresNorth, ?float $accuracy, int $ageSeconds = 3): array
    {
        return ['latitude' => self::LAT + $metresNorth / 111_320, 'longitude' => self::LNG,
            'accuracy' => $accuracy, 'fix_at' => now()->subSeconds($ageSeconds)->toIso8601String()];
    }

    private function complete(Delivery $delivery, array $phone = [])
    {
        return $this->actingAs($this->rider, 'sanctum')->post("/api/rider/deliveries/{$delivery->id}/complete",
            ['photo' => UploadedFile::fake()->image('delivered.jpg', 800, 600)] + $phone, ['Accept' => 'application/json']);
    }

    private function flags(): int
    {
        return ActivityLog::where('action', 'escalation.dropoff_low_precision_gps')->count();
    }

    public function test_the_29_m_doorway_case_now_confirms_and_is_flagged(): void
    {
        // The saved fix is stale (the server refused every coarse fix since).
        $this->savedAt(29, ageSeconds: 300);
        $delivery = $this->delivery();

        $this->complete($delivery, $this->phone(29, accuracy: 80))->assertOk();

        $this->assertNotNull($delivery->fresh()->delivered_at ?? $delivery->fresh()->delivery_confirmed_at);
        $this->assertSame(1, $this->flags(), 'coarser than ±50 m is flagged for review');
    }

    public function test_a_150_m_fix_like_the_devtools_default_confirms_and_is_flagged(): void
    {
        $delivery = $this->delivery();

        $this->complete($delivery, $this->phone(0, accuracy: 150))->assertOk();

        $this->assertSame(1, $this->flags());
    }

    public function test_a_precise_phone_fix_confirms_without_a_flag(): void
    {
        $delivery = $this->delivery();

        $this->complete($delivery, $this->phone(20, accuracy: 30))->assertOk();

        $this->assertSame(0, $this->flags());
    }

    public function test_a_fresh_saved_fix_still_decides_first(): void
    {
        $this->savedAt(10);
        $delivery = $this->delivery();

        // No phone fix sent at all: the saved fix proves it, as before.
        $this->complete($delivery)->assertOk();
        $this->assertSame(0, $this->flags());
    }

    public function test_coarser_than_200_m_is_refused_with_what_to_do(): void
    {
        $delivery = $this->delivery();

        $this->complete($delivery, $this->phone(29, accuracy: 250))
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'Your GPS is not precise enough (±250 m); it needs ±200 m or better. Turn on Precise location for TrackTour, or step outside away from the roof, then try again.']);
    }

    public function test_an_old_phone_fix_does_not_count(): void
    {
        $delivery = $this->delivery();

        $this->complete($delivery, $this->phone(29, accuracy: 40, ageSeconds: 90))
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'We need your current location. Keep the map open with location on, then try again.']);
    }

    public function test_a_phone_fix_outside_50_m_is_refused(): void
    {
        $delivery = $this->delivery();

        $this->complete($delivery, $this->phone(80, accuracy: 40))
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'You must be within 50 m of the delivery address to complete it (you are 80 m away).']);
    }

    public function test_a_teleporting_phone_fix_is_refused(): void
    {
        // Saved 5 km away 10 s ago; the phone now claims the doorway.
        $this->savedAt(5000, ageSeconds: 10);
        $delivery = $this->delivery();

        $this->complete($delivery, $this->phone(20, accuracy: 40))
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'Your phone\'s location jumped too far from your last saved position. If TrackTour is open in another tab or phone, close it, then try again.']);
    }

    public function test_ive_arrived_at_the_tourist_uses_the_same_rule(): void
    {
        $delivery = $this->delivery('in_transit');

        $this->actingAs($this->rider, 'sanctum')->patchJson("/api/rider/deliveries/{$delivery->id}/status", ['status' => 'arrived_destination'] + $this->phone(25, accuracy: 70))
            ->assertOk();

        $this->assertSame('arrived_destination', $delivery->fresh()->status->value);
        $this->assertSame(1, $this->flags());
    }

    public function test_ive_arrived_too_far_keeps_its_message(): void
    {
        $delivery = $this->delivery('in_transit');

        $this->actingAs($this->rider, 'sanctum')->patchJson("/api/rider/deliveries/{$delivery->id}/status", ['status' => 'arrived_destination'] + $this->phone(90, accuracy: 30))
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'Move closer to the delivery address to confirm arrival (within 50 m; you are 90 m away).']);
    }
}
