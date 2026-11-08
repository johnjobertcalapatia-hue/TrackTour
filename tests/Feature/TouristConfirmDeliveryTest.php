<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\Payment;
use App\Models\RiderDetail;
use App\Models\RiderEarning;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use App\Models\RiderLocation;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Food delivery completion — reconciled 2026-11-08 (AGENTS.md §12; product
 * decision: the rider's proof photo replaces the P14 tourist confirmation).
 *
 * A food delivery is completed by the RIDER at the drop-off:
 *   - within tracking.dropoff_radius_meters (50 m) of the delivery address,
 *     judged from the rider's own fresh saved GPS fix
 *   - with a photo of the delivered food (POST /rider/deliveries/{d}/complete)
 * Confirming means the tourist has paid: COD is settled for exactly the cash
 * due through the canonical settleCodDelivery() (no separate settle step).
 *   COD     -> completed, order paid, cash Payment + settlement booked
 *   Prepaid -> completed, rider released
 * The rider still can't PATCH a food delivery to 'delivered' without proof,
 * and the old tourist confirm endpoint is retired (422, no state change).
 * Standalone transport rides stay rider-driven.
 */
class TouristConfirmDeliveryTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $rider;
    private User $customer;
    private User $otherCustomer;
    private Business $restaurant;
    private Municipality $municipality;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'email' => 'owner-confirm@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'business_owner',
            'account_status' => 'approved',
        ]);

        $this->customer = User::create([
            'email' => 'customer-confirm@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->otherCustomer = User::create([
            'email' => 'other-confirm@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);

        $this->municipality = Municipality::create([
            'name' => 'Bansud',
            'district' => '1st',
            'province' => 'Oriental Mindoro',
            'latitude' => 12.5,
            'longitude' => 121.3,
        ]);

        $this->restaurant = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id,
            'municipality_id' => $this->municipality->id,
            'business_name' => 'Confirm Test Restaurant',
            'status' => 'approved',
        ]);

        $this->rider = User::create([
            'email' => 'rider-confirm@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
        ]);

        RiderDetail::create([
            'user_id' => $this->rider->id,
            'rider_status' => 'available',
            'current_service' => 'food',
        ]);
    }

    private function makeOrder(string $paymentMethod, string $orderNumber, string $orderType = 'delivery'): Order
    {
        return Order::create([
            'order_number' => $orderNumber,
            'business_id' => $this->restaurant->id,
            'user_id' => $this->customer->id,
            'customer_name' => 'P14 Confirmation Tourist',
            'customer_email' => $this->customer->email,
            'order_type' => $orderType,
            'payment_method' => $paymentMethod,
            'payment_status' => $paymentMethod === 'cash' ? 'unpaid' : 'paid',
            'status' => 'ready',
            'subtotal' => 900.00,
            'system_fee' => 25.00,
            'delivery_fee' => 150.00,
            'rider_tip' => 0,
            'rider_financed_amount' => 900.00,
            'total' => 1075.00,
            'delivery_address' => '123 Confirmation St, Bansud',
            'delivery_latitude' => 12.60,
            'delivery_longitude' => 121.40,
        ]);
    }

    private function makeDelivery(Order $order, string $status = 'arrived_destination'): Delivery
    {
        return Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $this->rider->id,
            'status' => $status,
            'pickup_address' => $this->restaurant->business_name,
            'delivery_address' => $order->delivery_address,
            'pickup_latitude' => 12.51,
            'pickup_longitude' => 121.31,
            'delivery_latitude' => 12.60,
            'delivery_longitude' => 121.40,
        ]);
    }

    private function riderToken(): string
    {
        return $this->rider->createToken('test')->plainTextToken;
    }

    private function customerToken(): string
    {
        return $this->customer->createToken('test')->plainTextToken;
    }

    /** Saved GPS fix for the rider, $metresNorth from the drop-off, $ageSeconds old. */
    private function riderAt(float $metresNorth, int $ageSeconds = 5): void
    {
        RiderLocation::create([
            'rider_id' => $this->rider->id,
            'latitude' => 12.60 + $metresNorth / 111_320,
            'longitude' => 121.40,
            'recorded_at' => now()->subSeconds($ageSeconds),
        ]);
    }

    private function completeWithPhoto(Delivery $delivery, ?User $as = null, bool $withPhoto = true)
    {
        $token = ($as ?? $this->rider)->createToken('test')->plainTextToken;
        $payload = $withPhoto ? ['photo' => UploadedFile::fake()->image('delivered.jpg', 800, 600)] : [];

        return $this->withHeader('Authorization', 'Bearer '.$token)
            ->post('/api/rider/deliveries/'.$delivery->id.'/complete', $payload, ['Accept' => 'application/json']);
    }

    public function test_rider_cannot_mark_a_food_delivery_delivered_without_proof(): void
    {
        $order = $this->makeOrder('gcash', 'TT-CONFIRM-GATE');
        $delivery = $this->makeDelivery($order);

        $this->withHeader('Authorization', 'Bearer '.$this->riderToken())
            ->patchJson('/api/rider/deliveries/'.$delivery->id.'/status', ['status' => 'delivered'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Take a photo of the delivered food at the drop-off to complete this delivery.');

        $this->assertSame('arrived_destination', $delivery->fresh()->status->value ?? $delivery->fresh()->status);
        $this->assertNull($delivery->fresh()->delivered_at);
    }

    public function test_rider_completes_a_prepaid_delivery_with_a_photo_within_50_m(): void
    {
        Storage::fake('public');
        $order = $this->makeOrder('gcash', 'TT-CONFIRM-PREPAID');
        $delivery = $this->makeDelivery($order);
        $this->riderAt(30);

        $this->completeWithPhoto($delivery)
            ->assertOk()
            ->assertJsonPath('data.new_status', 'completed')
            ->assertJsonPath('data.cod_settled', false)
            ->assertJsonPath('message', 'Delivery completed. Thank you!');

        $delivery->refresh();
        $this->assertSame('completed', $delivery->status->value ?? $delivery->status);
        $this->assertNotNull($delivery->delivered_at);
        $this->assertSame($this->rider->id, (int) $delivery->delivery_confirmed_by, 'Confirmed by the rider.');
        $this->assertNotNull($delivery->delivery_proof_path);
        $this->assertNotNull($delivery->delivery_proof_at);
        $this->assertEqualsWithDelta(30, (float) $delivery->delivery_proof_distance_m, 1.0);
        Storage::disk('public')->assertExists($delivery->delivery_proof_path);

        $this->assertSame('completed', $order->fresh()->status);
        $this->assertNotNull($order->fresh()->completed_at);
        $this->assertSame(1, RiderEarning::where('rider_id', $this->rider->id)->where('order_id', $order->id)->count());
        $this->assertSame('available', $this->rider->fresh()->riderDetail->rider_status, 'Rider is released.');
    }

    public function test_confirming_a_cod_delivery_means_the_tourist_paid_and_settles_it_in_one_step(): void
    {
        Storage::fake('public');
        $order = $this->makeOrder('cash', 'TT-CONFIRM-COD');
        $delivery = $this->makeDelivery($order);
        $this->riderAt(10);

        $this->completeWithPhoto($delivery)
            ->assertOk()
            ->assertJsonPath('data.cod_settled', true)
            ->assertJsonPath('data.new_status', 'completed');

        $delivery->refresh();
        $this->assertSame('completed', $delivery->status->value ?? $delivery->status);
        $this->assertSame((float) $order->total, (float) $delivery->cash_due, 'Cash due snapshot frozen.');
        $this->assertSame((float) $order->total, (float) $delivery->cash_received, 'Exactly the cash due was received.');
        $this->assertEquals(0, (float) $delivery->change_given);
        $this->assertNotNull($delivery->cash_settled_at);

        $this->assertSame('completed', $order->fresh()->status);
        $this->assertSame('paid', $order->fresh()->payment_status);
        $this->assertSame(1, Payment::where('payable_type', Order::class)
            ->where('payable_id', $order->id)
            ->where('method', 'cash')
            ->where('status', 'paid')
            ->count());
        $this->assertSame('available', $this->rider->fresh()->riderDetail->rider_status);

        // No separate settle step is left (and it can't run twice).
        $this->withHeader('Authorization', 'Bearer '.$this->riderToken())
            ->postJson('/api/rider/deliveries/'.$delivery->id.'/settle-cod', ['cash_received' => (float) $order->total])
            ->assertStatus(422);
        $this->assertSame(1, Payment::where('payable_type', Order::class)->where('payable_id', $order->id)->where('method', 'cash')->count());
    }

    public function test_completion_requires_being_within_50_m_of_the_delivery_address(): void
    {
        Storage::fake('public');
        $order = $this->makeOrder('cash', 'TT-CONFIRM-FAR');
        $delivery = $this->makeDelivery($order);
        $this->riderAt(80);

        $this->completeWithPhoto($delivery)
            ->assertStatus(422)
            ->assertJsonPath('message', 'You must be within 50 m of the delivery address to complete it (you are 80 m away).');

        $this->assertSame('arrived_destination', $delivery->fresh()->status->value ?? $delivery->fresh()->status);
        $this->assertNull($delivery->fresh()->delivery_proof_path);
        $this->assertSame([], Storage::disk('public')->allFiles('delivery-proofs'), 'No photo is kept for a refused completion.');
        $this->assertNull($delivery->fresh()->cash_received);
    }

    public function test_completion_needs_a_fresh_location_and_a_photo_and_picked_up_food(): void
    {
        Storage::fake('public');

        $stale = $this->makeDelivery($this->makeOrder('gcash', 'TT-CONFIRM-STALE'));
        $this->riderAt(5, 600);
        $this->completeWithPhoto($stale)->assertStatus(422)
            ->assertJsonPath('message', 'We need your current location. Keep the map open with location on, then try again.');

        $this->riderAt(5);
        $this->completeWithPhoto($stale, withPhoto: false)->assertStatus(422)->assertJsonValidationErrors('photo');

        $notPickedUp = $this->makeDelivery($this->makeOrder('gcash', 'TT-CONFIRM-EARLY'), 'arrived_pickup');
        $this->completeWithPhoto($notPickedUp)->assertStatus(422)
            ->assertJsonPath('message', 'Pick up the food before completing the delivery.');
        $this->assertSame([], Storage::disk('public')->allFiles('delivery-proofs'));
    }

    public function test_only_the_assigned_rider_completes_and_only_once(): void
    {
        Storage::fake('public');
        $order = $this->makeOrder('gcash', 'TT-CONFIRM-403');
        $delivery = $this->makeDelivery($order);
        $this->riderAt(5);

        $otherRider = User::create(['email' => 'other-rider@example.com', 'password' => Hash::make('x'), 'role' => 'rider', 'account_status' => 'approved']);
        $this->completeWithPhoto($delivery, $otherRider)->assertStatus(403);
        $this->completeWithPhoto($delivery, $this->customer)->assertStatus(403);

        $this->completeWithPhoto($delivery)->assertOk();
        $this->completeWithPhoto($delivery)->assertStatus(422)->assertJsonPath('message', 'This delivery is already completed.');
        $this->assertSame(1, RiderEarning::where('order_id', $order->id)->count(), 'Completion happens once.');
    }

    public function test_the_old_tourist_confirm_endpoint_is_retired_and_changes_nothing(): void
    {
        $order = $this->makeOrder('cash', 'TT-CONFIRM-RETIRED');
        $delivery = $this->makeDelivery($order);

        $this->withHeader('Authorization', 'Bearer '.$this->customerToken())
            ->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')
            ->assertStatus(422)
            ->assertJsonPath('message', 'Your rider completes the delivery with a photo when your food arrives. No action is needed from you.');

        $this->assertSame('arrived_destination', $delivery->fresh()->status->value ?? $delivery->fresh()->status);
        $this->assertNull($delivery->fresh()->delivery_confirmed_at);

        // Still guarded: another tourist / unauthenticated.
        $this->withHeader('Authorization', 'Bearer '.$this->otherCustomer->createToken('t')->plainTextToken)
            ->postJson('/api/tourist/food/order/'.$order->id.'/confirm-delivery')->assertStatus(403);
    }

    public function test_unauthenticated_completion_is_rejected(): void
    {
        $delivery = $this->makeDelivery($this->makeOrder('gcash', 'TT-CONFIRM-UNAUTH'));
        $this->post('/api/rider/deliveries/'.$delivery->id.'/complete', [], ['Accept' => 'application/json'])->assertStatus(401);
    }

    public function test_transport_rides_stay_rider_driven_and_are_not_gated(): void
    {
        $order = $this->makeOrder('gcash', 'TT-TRANSPORT', 'transport');
        $delivery = $this->makeDelivery($order);

        $this->withHeader('Authorization', 'Bearer '.$this->riderToken())
            ->patchJson('/api/rider/deliveries/'.$delivery->id.'/status', ['status' => 'delivered'])
            ->assertOk()
            ->assertJson(['success' => true]);

        $this->assertSame('completed', $delivery->fresh()->status->value ?? $delivery->fresh()->status,
            'A transport ride completes on the riders own delivered action.');
    }
}