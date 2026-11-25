<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Notification;
use App\Models\ResortOffering;
use App\Models\ResortOfferingAllocation;
use App\Models\User;
use App\Support\ResortCancellationPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Resort reservations Stage 7 (docs/resort-reservation-architecture.md §11):
 * quote, reserve (pay at the resort), owner confirm / reject / cancel /
 * complete / no-show, tourist cancel before check-in, cancellation policy.
 */
class ResortReservationTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private User $tourist;

    private Business $resort;

    private ResortOffering $entrance;   // required, per person, capacity 300

    private ResortOffering $cottage;    // day use, per unit, 2 units, 8 guests each

    private ResortOffering $room;       // overnight, per night, 1 unit, 2 guests

    private ResortOffering $kayak;      // time slot, per hour, 2 per slot

    private ResortOffering $videoke;    // add-on, only with the cottage

    protected function setUp(): void
    {
        parent::setUp();
        // Tuesday 1 Dec 2026, 9 AM Philippine time.
        $this->travelTo(CarbonImmutable::parse('2026-12-01 09:00', 'Asia/Manila'));
        $this->owner = $this->user('owner@example.com', 'business_owner');
        $this->tourist = $this->user('ana@example.com', 'tourist');
        $this->resort = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Resort'])->id,
            'municipality_id' => Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro'])->id,
            'business_name' => 'RJM Beach Resort', 'status' => 'approved', 'latitude' => 12.86, 'longitude' => 121.48,
            // Closed on Mondays.
            'business_hours' => collect(['tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])->mapWithKeys(fn ($d) => [$d => [['open' => '08:00', 'close' => '17:00']]])->all(),
        ]);
        $this->entrance = $this->offering('Entrance', 'other', 'day_use', 'per_person', 20, 'capacity', 300, ['is_required' => true]);
        $this->cottage = $this->offering('Cottage', 'cottage', 'day_use', 'per_unit', 300, 'units', 2, ['max_guests' => 8]);
        $this->room = $this->offering('Family room', 'room', 'overnight', 'per_night', 1300, 'units', 1, ['max_guests' => 2]);
        $this->kayak = $this->offering('Kayak', 'activity', 'time_slot', 'per_hour', 100, 'slots', 2, ['duration_minutes' => 60]);
        $this->videoke = $this->offering('Videoke', 'equipment', 'day_use', 'per_unit', 200, 'units', 3, ['bookable_independently' => false, 'requires_offering_id' => $this->cottage->id]);
    }

    private function user(string $email, string $role): User
    {
        return User::create(['email' => $email, 'name' => Str::before($email, '@'), 'password' => Hash::make('Password123!'), 'role' => $role, 'account_status' => 'approved']);
    }

    private function offering(string $name, string $category, string $mode, string $basis, float $price, string $inventory, int $qty, array $extra = []): ResortOffering
    {
        return ResortOffering::create($extra + [
            'business_id' => $this->resort->id, 'category' => $category, 'name' => $name, 'booking_mode' => $mode,
            'pricing_basis' => $basis, 'price' => $price, 'inventory_mode' => $inventory, 'inventory_quantity' => $qty,
            'min_quantity' => 1, 'is_published' => true, 'bookable_independently' => true,
        ]);
    }

    private function stay(array $lines, array $extra = []): array
    {
        return $extra + ['check_in' => '2026-12-05', 'guests' => 4, 'lines' => $lines];
    }

    private function entrance(int $people = 4): array
    {
        return ['offering_id' => $this->entrance->id, 'quantity' => $people];
    }

    private function reserve(array $payload)
    {
        return $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/resorts/{$this->resort->id}/reservations",
            $payload + ['customer_name' => 'Ana Cruz', 'customer_phone' => '09171234567']);
    }

    private function reserved(ResortOffering $o, string $date, string $slot = ''): int
    {
        return (int) ResortOfferingAllocation::where('resort_offering_id', $o->id)->where('date', $date)->where('slot', $slot)->value('reserved_quantity');
    }

    private function owner()
    {
        return $this->actingAs($this->owner, 'sanctum');
    }

    // ------------------------------------------------------------------ quote

    public function test_the_quote_prices_every_basis(): void
    {
        $quote = $this->postJson("/api/tourist/resorts/{$this->resort->id}/quote", $this->stay([
            $this->entrance(4),
            ['offering_id' => $this->cottage->id, 'quantity' => 1, 'guests' => 4],
            ['offering_id' => $this->videoke->id, 'quantity' => 1],
            ['offering_id' => $this->kayak->id, 'quantity' => 2, 'slot' => '09:00'],
            ['offering_id' => $this->room->id, 'quantity' => 1, 'guests' => 2],
        ], ['check_out' => '2026-12-07']))->assertOk()->json('data');

        $amounts = collect($quote['lines'])->pluck('amount', 'name')->map(fn ($a) => (float) $a);
        $this->assertEquals(80, $amounts['Entrance'], '₱20 × 4 people');
        $this->assertEquals(300, $amounts['Cottage'], '₱300 × 1 unit');
        $this->assertEquals(200, $amounts['Videoke']);
        $this->assertEquals(200, $amounts['Kayak'], '₱100 × 1 hour × 2 people');
        $this->assertEquals(2600, $amounts['Family room'], '₱1,300 × 2 nights');
        $this->assertEquals(3380, $quote['total']);
        $this->assertSame(2, $quote['nights']);
        $this->assertSame(['free_days' => 3, 'penalty_percent' => 50], array_intersect_key($quote['policy'], ['free_days' => 0, 'penalty_percent' => 0]));
        $this->assertSame(0, ResortOfferingAllocation::count(), 'a quote reserves nothing');
    }

    public function test_the_rules_are_checked(): void
    {
        $quote = fn (array $payload) => $this->postJson("/api/tourist/resorts/{$this->resort->id}/quote", $payload);

        $quote($this->stay([['offering_id' => $this->cottage->id, 'quantity' => 1, 'guests' => 4]]))
            ->assertUnprocessable()->assertJsonValidationErrors('lines'); // entrance is required
        $quote($this->stay([$this->entrance(), ['offering_id' => $this->videoke->id, 'quantity' => 1]]))
            ->assertUnprocessable()->assertJsonValidationErrors('lines.1'); // videoke only with the cottage
        $quote($this->stay([$this->entrance(), ['offering_id' => $this->cottage->id, 'quantity' => 3, 'guests' => 4]]))
            ->assertUnprocessable()->assertJsonValidationErrors('lines.1'); // only 2 cottages
        $quote($this->stay([$this->entrance(), ['offering_id' => $this->cottage->id, 'quantity' => 1, 'guests' => 9]]))
            ->assertUnprocessable()->assertJsonValidationErrors('lines.1'); // 8 guests per cottage
        $quote($this->stay([$this->entrance(), ['offering_id' => $this->room->id, 'quantity' => 1, 'guests' => 2]]))
            ->assertUnprocessable()->assertJsonValidationErrors('check_out');
        $quote($this->stay([$this->entrance(), ['offering_id' => $this->room->id, 'quantity' => 1, 'guests' => 2]], ['check_in' => '2026-12-07', 'check_out' => '2026-12-08']))
            ->assertUnprocessable()->assertJsonValidationErrors('check_in'); // Monday: closed, no check-in
        $quote($this->stay([$this->entrance(), ['offering_id' => $this->kayak->id, 'quantity' => 1]]))
            ->assertUnprocessable()->assertJsonValidationErrors('lines.1'); // needs a time
        $quote($this->stay([$this->entrance()], ['check_in' => '2026-11-30']))
            ->assertUnprocessable()->assertJsonValidationErrors('check_in');
        $this->cottage->update(['is_published' => false]);
        $quote($this->stay([$this->entrance(), ['offering_id' => $this->cottage->id, 'quantity' => 1]]))
            ->assertUnprocessable()->assertJsonValidationErrors('lines.1');
    }

    // ----------------------------------------------------------------- reserve

    public function test_a_tourist_reserves_and_the_units_are_held(): void
    {
        $res = $this->reserve($this->stay([$this->entrance(4), ['offering_id' => $this->cottage->id, 'quantity' => 2, 'guests' => 4]], ['notes' => 'Arriving at 9 AM']))
            ->assertCreated();

        $booking = Booking::findOrFail($res->json('data.id'));
        $this->assertSame('pending', $booking->status);
        $this->assertSame('resort', $booking->booking_type);
        $this->assertSame('pay_at_resort', $booking->payment_option);
        $this->assertEquals(680, $booking->total_amount);
        $this->assertSame($this->tourist->id, $booking->user_id);
        $this->assertSame(3, $booking->cancellation_policy['free_days']);
        $this->assertSame(2, $this->reserved($this->cottage, '2026-12-05'));
        $this->assertSame(4, $this->reserved($this->entrance, '2026-12-05'));
        $this->assertSame(['pending'], $booking->statusLogs->pluck('to_status')->all());
        $this->assertTrue($res->json('data.can_cancel'));
        $this->assertSame('Cottage', collect($res->json('data.items'))->firstWhere('name', 'Cottage')['name']);
        $this->assertTrue(Notification::where('user_id', $this->owner->id)->where('type', 'booking_created')->exists());

        // The cottages are now taken for that day.
        $this->reserve($this->stay([$this->entrance(2), ['offering_id' => $this->cottage->id, 'quantity' => 1, 'guests' => 2]], ['guests' => 2]))
            ->assertUnprocessable()->assertJsonPath('problems.0.reason', 'sold_out');

        // The price is a snapshot: a later price change does not touch it.
        $this->cottage->update(['price' => 999]);
        $this->assertEquals(300, $booking->items()->where('description', 'Cottage')->value('price'));
    }

    public function test_a_double_submit_books_once(): void
    {
        $payload = $this->stay([$this->entrance(4), ['offering_id' => $this->cottage->id, 'quantity' => 1, 'guests' => 4]], ['client_reference' => 'form-123']);
        $first = $this->reserve($payload)->assertCreated()->json('data.id');
        $second = $this->reserve($payload)->assertCreated()->json('data.id');

        $this->assertSame($first, $second);
        $this->assertSame(1, Booking::count());
        $this->assertSame(1, $this->reserved($this->cottage, '2026-12-05'));
    }

    public function test_only_logged_in_tourists_reserve(): void
    {
        $payload = $this->stay([$this->entrance()]) + ['customer_name' => 'Ana', 'customer_phone' => '0917'];
        $this->postJson("/api/tourist/resorts/{$this->resort->id}/reservations", $payload)->assertUnauthorized();
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/tourist/resorts/{$this->resort->id}/reservations", $payload)->assertForbidden();
        $this->assertSame(0, Booking::count());
    }

    // ----------------------------------------------------------------- owner

    public function test_the_owner_confirms_and_the_tourist_is_told(): void
    {
        $id = $this->reserve($this->stay([$this->entrance()]))->json('data.id');

        $this->owner()->getJson("/api/business-owner/bookings/{$id}")->assertOk()->assertJsonPath('data.actions', ['confirm', 'reject', 'cancel']);
        $this->owner()->patchJson("/api/business-owner/bookings/{$id}/status", ['status' => 'confirmed'])->assertOk()
            ->assertJsonPath('data.status', 'confirmed')->assertJsonPath('data.actions', ['cancel']);

        $this->assertNotNull(Booking::find($id)->confirmed_at);
        $this->assertTrue(Notification::where('user_id', $this->tourist->id)->where('type', 'booking_status_changed')->where('title', 'Reservation confirmed')->exists());
        // Confirming twice is refused.
        $this->owner()->patchJson("/api/business-owner/bookings/{$id}/status", ['status' => 'confirmed'])->assertUnprocessable();
    }

    public function test_rejecting_needs_a_reason_and_frees_the_units(): void
    {
        $id = $this->reserve($this->stay([$this->entrance(), ['offering_id' => $this->cottage->id, 'quantity' => 2, 'guests' => 4]]))->json('data.id');
        $this->owner()->patchJson("/api/business-owner/bookings/{$id}/status", ['status' => 'rejected'])->assertUnprocessable()->assertJsonValidationErrors('reason');

        $this->owner()->patchJson("/api/business-owner/bookings/{$id}/status", ['status' => 'rejected', 'reason' => 'Fully booked for a private event'])->assertOk();
        $this->assertSame(0, $this->reserved($this->cottage, '2026-12-05'));
        $booking = Booking::find($id);
        $this->assertSame('Fully booked for a private event', $booking->cancellation_reason);
        $this->assertSame(['pending', 'rejected'], $booking->statusLogs->pluck('to_status')->all());
        $this->assertSame('Fully booked for a private event', $booking->statusLogs->last()->reason);
    }

    public function test_complete_and_no_show_only_from_the_check_in_date(): void
    {
        $id = $this->reserve($this->stay([$this->entrance(), ['offering_id' => $this->cottage->id, 'quantity' => 1, 'guests' => 4]]))->json('data.id');
        $this->owner()->patchJson("/api/business-owner/bookings/{$id}/status", ['status' => 'confirmed'])->assertOk();
        $this->owner()->patchJson("/api/business-owner/bookings/{$id}/status", ['status' => 'completed'])->assertUnprocessable();

        $this->travelTo(CarbonImmutable::parse('2026-12-05 10:00', 'Asia/Manila'));
        $this->owner()->getJson("/api/business-owner/bookings/{$id}")->assertJsonPath('data.actions', ['complete', 'no_show', 'cancel']);
        $this->owner()->patchJson("/api/business-owner/bookings/{$id}/status", ['status' => 'no_show'])->assertOk()->assertJsonPath('data.status', 'no_show');
        $this->assertSame(0, $this->reserved($this->cottage, '2026-12-05'), 'a no-show frees the units');
    }

    public function test_another_owner_cannot_touch_the_reservation_and_old_bookings_still_work(): void
    {
        $id = $this->reserve($this->stay([$this->entrance()]))->json('data.id');
        $stranger = $this->user('other@example.com', 'business_owner');
        $this->actingAs($stranger, 'sanctum')->patchJson("/api/business-owner/bookings/{$id}/status", ['status' => 'confirmed'])->assertNotFound();

        $legacy = Booking::create(['booking_number' => 'BK-OLD', 'business_id' => $this->resort->id, 'customer_name' => 'Old', 'booking_type' => 'accommodation', 'status' => 'pending', 'check_in_date' => '2026-12-10', 'guests' => 1]);
        $this->owner()->patchJson("/api/business-owner/bookings/{$legacy->id}/status", ['status' => 'confirmed'])->assertOk();
        $this->assertSame('confirmed', $legacy->fresh()->status);
    }

    // ----------------------------------------------------------------- tourist

    public function test_the_tourist_cancels_before_check_in_only(): void
    {
        $id = $this->reserve($this->stay([$this->entrance(), ['offering_id' => $this->cottage->id, 'quantity' => 1, 'guests' => 4]]))->json('data.id');
        $other = $this->user('ben@example.com', 'tourist');
        $this->actingAs($other, 'sanctum')->postJson("/api/tourist/reservations/{$id}/cancel")->assertNotFound();
        $this->actingAs($other, 'sanctum')->getJson("/api/tourist/reservations/{$id}")->assertNotFound();

        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/reservations/{$id}/cancel", ['reason' => 'Change of plans'])->assertOk()
            ->assertJsonPath('data.status', 'cancelled')->assertJsonPath('data.can_cancel', false);
        $this->assertSame(0, $this->reserved($this->cottage, '2026-12-05'));
        $this->assertTrue(Notification::where('user_id', $this->owner->id)->where('title', 'Reservation cancelled')->exists());
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/reservations/{$id}/cancel")->assertUnprocessable();

        // On the check-in date it is too late for the tourist.
        $id2 = $this->reserve($this->stay([$this->entrance()], ['check_in' => '2026-12-02']))->json('data.id');
        $this->travelTo(CarbonImmutable::parse('2026-12-02 08:00', 'Asia/Manila'));
        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/reservations/{$id2}")->assertOk()->assertJsonPath('data.can_cancel', false);
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/reservations/{$id2}/cancel")->assertUnprocessable();
    }

    // ------------------------------------------------------------------ policy

    public function test_the_owner_sets_a_cancellation_policy_inside_the_limits(): void
    {
        $base = "/api/business-owner/businesses/{$this->resort->id}/resort-policy";
        $this->owner()->getJson($base)->assertOk()->assertJsonPath('data.free_days', 3)->assertJsonPath('data.penalty_percent', 50);
        $this->owner()->putJson($base, ['free_days' => 15, 'penalty_percent' => 50])->assertUnprocessable()->assertJsonValidationErrors('free_days');
        $this->owner()->putJson($base, ['free_days' => 7, 'penalty_percent' => 30])->assertOk()
            ->assertJsonPath('data.summary', 'Free cancellation until 7 days before check-in; after that, 30% of what you paid online is kept by the resort.');
        $this->actingAs($this->user('x@example.com', 'business_owner'), 'sanctum')->putJson($base, ['free_days' => 1, 'penalty_percent' => 1])->assertForbidden();

        // New reservations keep the policy in force when they were made.
        $id = $this->reserve($this->stay([$this->entrance()]))->json('data.id');
        $this->owner()->putJson($base, ['free_days' => 1, 'penalty_percent' => 100])->assertOk();
        $this->assertSame(['free_days' => 7, 'penalty_percent' => 30], array_intersect_key(Booking::find($id)->cancellation_policy, ['free_days' => 0, 'penalty_percent' => 0]));

        // The tourist page shows the policy before booking.
        $this->getJson("/api/tourist/explore/{$this->resort->id}")->assertOk()->assertJsonPath('data.resort.cancellation_policy.free_days', 1);
    }

    public function test_refund_percentages_follow_the_policy(): void
    {
        $policy = ['free_days' => 3, 'penalty_percent' => 50];
        $this->assertSame(100, ResortCancellationPolicy::refundPercent($policy, '2026-12-10', '2026-12-07'));
        $this->assertSame(50, ResortCancellationPolicy::refundPercent($policy, '2026-12-10', '2026-12-08'));
        $this->assertSame(100, ResortCancellationPolicy::refundPercent(['free_days' => 0, 'penalty_percent' => 50], '2026-12-10', '2026-12-09'));
    }
}
