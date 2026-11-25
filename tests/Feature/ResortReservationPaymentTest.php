<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Notification;
use App\Models\Payment;
use App\Models\Refund;
use App\Models\ResortOffering;
use App\Models\ResortOfferingAllocation;
use App\Models\User;
use App\Services\ResortReservationService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Resort reservations Stage 8 (docs/resort-reservation-architecture.md §11):
 * GCash payment with a 30-minute hold, expiry, late payments, and refunds by
 * the snapshotted cancellation policy (product owner, 2026-11-24).
 */
class ResortReservationPaymentTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private User $tourist;

    private Business $resort;

    private ResortOffering $cottage;

    /** @var 'succeeded'|'pending'|'rejected' what the fake PayMongo answers to a refund */
    private string $refundAnswer = 'succeeded';

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(CarbonImmutable::parse('2026-12-01 09:00', 'Asia/Manila'));
        config(['services.paymongo.secret_key' => 'sk_test_resort', 'services.paymongo.webhook_secret' => '']);
        Http::fake(function (HttpRequest $request) {
            if (str_contains($request->url(), '/checkout_sessions')) {
                return Http::response(['data' => ['id' => 'cs_'.Str::random(8), 'attributes' => ['checkout_url' => 'https://checkout.paymongo.test/x']]], 200);
            }
            if (str_contains($request->url(), '/refunds')) {
                return $this->refundAnswer === 'rejected'
                    ? Http::response(['errors' => [['code' => 'resource_failed_state', 'detail' => 'Refused']]], 400)
                    : Http::response(['data' => ['id' => 'ref_'.Str::random(6), 'attributes' => ['status' => $this->refundAnswer]]], 200);
            }

            return Http::response([], 404);
        });

        $this->owner = $this->user('owner@example.com', 'business_owner');
        $this->tourist = $this->user('ana@example.com', 'tourist');
        $this->resort = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Resort'])->id,
            'municipality_id' => Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro'])->id,
            'business_name' => 'RJM Beach Resort', 'status' => 'approved', 'latitude' => 12.86, 'longitude' => 121.48,
        ]);
        $this->cottage = ResortOffering::create([
            'business_id' => $this->resort->id, 'category' => 'cottage', 'name' => 'Cottage', 'booking_mode' => 'day_use',
            'pricing_basis' => 'per_unit', 'price' => 1000, 'inventory_mode' => 'units', 'inventory_quantity' => 1,
            'max_guests' => 8, 'min_quantity' => 1, 'is_published' => true, 'bookable_independently' => true,
        ]);
    }

    private function user(string $email, string $role): User
    {
        return User::create(['email' => $email, 'name' => Str::before($email, '@'), 'password' => Hash::make('Password123!'), 'role' => $role, 'account_status' => 'approved']);
    }

    /** Reserve the cottage with GCash on $checkIn; returns the booking. */
    private function reserveGcash(string $checkIn = '2026-12-10'): Booking
    {
        $id = $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/resorts/{$this->resort->id}/reservations", [
            'check_in' => $checkIn, 'guests' => 2, 'lines' => [['offering_id' => $this->cottage->id, 'quantity' => 1, 'guests' => 2]],
            'customer_name' => 'Ana Cruz', 'customer_phone' => '09171234567', 'payment_option' => 'gcash',
        ])->assertCreated()->json('data.id');

        return Booking::findOrFail($id);
    }

    /** Start the GCash checkout, then PayMongo reports it completed (webhook). */
    private function pay(Booking $booking): Payment
    {
        $number = $this->actingAs($this->tourist, 'sanctum')->postJson('/api/payments/create-intent', [
            'payable_type' => 'booking', 'payable_id' => $booking->id, 'method' => 'gcash',
        ])->assertOk()->json('data.payment_number');
        $payment = Payment::where('payment_number', $number)->firstOrFail();
        $this->postJson('/api/payments/webhook', ['data' => ['id' => 'evt_'.Str::random(8), 'attributes' => [
            'type' => 'checkout_session.completed', 'data' => ['id' => $payment->provider_payment_id, 'status' => 'completed'],
        ]]])->assertOk();

        return $payment->fresh();
    }

    private function held(): int
    {
        return (int) ResortOfferingAllocation::where('resort_offering_id', $this->cottage->id)->where('date', '2026-12-10')->value('reserved_quantity');
    }

    private function owner()
    {
        return $this->actingAs($this->owner, 'sanctum');
    }

    public function test_a_gcash_reservation_holds_the_units_for_30_minutes_and_waits_for_payment(): void
    {
        $booking = $this->reserveGcash();
        $this->assertSame('awaiting_payment', $booking->payment_status);
        $this->assertSame('gcash', $booking->payment_option);
        $this->assertEquals(now()->addMinutes(30)->toDateTimeString(), $booking->payment_due_at->toDateTimeString());
        $this->assertSame(1, $this->held());

        // Not the owner's yet: no notice, not listed, cannot be confirmed.
        $this->assertFalse(Notification::where('user_id', $this->owner->id)->exists());
        $this->assertSame([], $this->owner()->getJson('/api/business-owner/bookings')->json('data'));
        $this->owner()->patchJson("/api/business-owner/bookings/{$booking->id}/status", ['status' => 'confirmed'])
            ->assertUnprocessable()->assertJsonPath('message', 'The guest has not paid with GCash yet.');
        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/reservations/{$booking->id}")
            ->assertJsonPath('data.awaiting_payment', true)->assertJsonPath('data.can_cancel', true);
    }

    public function test_paying_in_time_sends_it_to_the_owner(): void
    {
        $booking = $this->reserveGcash();
        $payment = $this->pay($booking);

        $this->assertSame('paid', $payment->status);
        $booking->refresh();
        $this->assertSame('paid', $booking->payment_status);
        $this->assertEquals(1000, $booking->paid_amount);
        $this->assertNull($booking->payment_due_at);
        $this->assertTrue(Notification::where('user_id', $this->owner->id)->where('title', 'New reservation (paid with GCash)')->exists());
        $this->assertCount(1, $this->owner()->getJson('/api/business-owner/bookings')->json('data'));
        $this->owner()->patchJson("/api/business-owner/bookings/{$booking->id}/status", ['status' => 'confirmed'])->assertOk();

        // Paying twice is refused.
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/payments/create-intent', ['payable_type' => 'booking', 'payable_id' => $booking->id, 'method' => 'gcash'])
            ->assertUnprocessable();
    }

    public function test_an_unpaid_hold_expires_and_a_late_payment_is_refunded_in_full(): void
    {
        $booking = $this->reserveGcash();
        $number = $this->actingAs($this->tourist, 'sanctum')->postJson('/api/payments/create-intent', ['payable_type' => 'booking', 'payable_id' => $booking->id, 'method' => 'gcash'])
            ->assertOk()->json('data.payment_number');

        $this->travel(31)->minutes();
        $this->artisan('resorts:process-payments')->assertSuccessful();
        $booking->refresh();
        $this->assertSame('expired', $booking->status);
        $this->assertSame(0, $this->held(), 'the units are free again');
        $this->assertTrue(Notification::where('user_id', $this->tourist->id)->where('title', 'Reservation expired')->exists());
        $this->assertSame(['pending', 'expired'], $booking->statusLogs->pluck('to_status')->all());
        $this->assertSame('system', $booking->statusLogs->last()->actor_type);

        // Paying a new checkout is refused…
        $this->actingAs($this->tourist, 'sanctum')->postJson('/api/payments/create-intent', ['payable_type' => 'booking', 'payable_id' => $booking->id, 'method' => 'gcash'])->assertUnprocessable();
        // …and money that arrives anyway goes back in full.
        $payment = Payment::where('payment_number', $number)->firstOrFail();
        $this->postJson('/api/payments/webhook', ['data' => ['id' => 'evt_late', 'attributes' => [
            'type' => 'checkout_session.completed', 'data' => ['id' => $payment->provider_payment_id, 'status' => 'completed'],
        ]]])->assertOk();

        $booking->refresh();
        $this->assertSame('expired', $booking->status);
        $this->assertEquals(1000, $booking->refund_due);
        $refund = Refund::where('payment_id', $payment->id)->sole();
        $this->assertEquals(1000, $refund->amount);
        $this->assertSame('succeeded', $refund->status);
        $this->assertSame('refunded', $booking->payment_status);
        $this->assertTrue(Notification::where('user_id', $this->tourist->id)->where('title', 'Payment refunded')->exists());
    }

    public function test_the_tourist_cancels_a_paid_reservation_and_gets_the_policy_refund(): void
    {
        // Inside the free period (3 days before): everything back.
        $booking = $this->reserveGcash('2026-12-10');
        $payment = $this->pay($booking);
        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/reservations/{$booking->id}")
            ->assertJsonPath('data.cancel_refund.percent', 100)->assertJsonPath('data.cancel_refund.amount', 1000);
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/reservations/{$booking->id}/cancel")->assertOk()
            ->assertJsonPath('data.refund.status', 'refunded')->assertJsonPath('data.refund.due', 1000);
        $this->assertEquals(1000, Refund::where('payment_id', $payment->id)->sum('amount'));

        // After the free period: the resort keeps 50%.
        $late = $this->reserveGcash('2026-12-03');
        $latePayment = $this->pay($late);
        $this->actingAs($this->tourist, 'sanctum')->getJson("/api/tourist/reservations/{$late->id}")->assertJsonPath('data.cancel_refund.percent', 50);
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/reservations/{$late->id}/cancel")->assertOk();
        $this->assertEquals(500, $late->fresh()->refund_due);
        $this->assertEquals(500, Refund::where('payment_id', $latePayment->id)->sole()->amount);
        $this->assertSame('paid', $latePayment->fresh()->status, 'half refunded: the payment stays paid');
    }

    public function test_the_owner_rejecting_or_cancelling_refunds_everything_and_a_no_show_nothing(): void
    {
        $rejected = $this->reserveGcash('2026-12-10');
        $p1 = $this->pay($rejected);
        $this->owner()->patchJson("/api/business-owner/bookings/{$rejected->id}/status", ['status' => 'rejected', 'reason' => 'Closed for repairs'])->assertOk()
            ->assertJsonPath('data.refund.status', 'refunded');
        $this->assertEquals(1000, Refund::where('payment_id', $p1->id)->sole()->amount);

        $noShow = $this->reserveGcash('2026-12-10');
        $p2 = $this->pay($noShow);
        $this->owner()->patchJson("/api/business-owner/bookings/{$noShow->id}/status", ['status' => 'confirmed'])->assertOk();
        $this->travelTo(CarbonImmutable::parse('2026-12-10 18:00', 'Asia/Manila'));
        $this->owner()->patchJson("/api/business-owner/bookings/{$noShow->id}/status", ['status' => 'no_show'])->assertOk()->assertJsonPath('data.refund.status', 'none');
        $this->assertSame(0, Refund::where('payment_id', $p2->id)->count());
    }

    public function test_a_refused_refund_is_retried_at_most_five_times(): void
    {
        $this->refundAnswer = 'rejected';
        $booking = $this->reserveGcash();
        $payment = $this->pay($booking);
        $this->owner()->patchJson("/api/business-owner/bookings/{$booking->id}/status", ['status' => 'cancelled', 'reason' => 'Typhoon warning'])->assertOk()
            ->assertJsonPath('data.refund.status', 'failed');

        for ($i = 0; $i < 7; $i++) {
            $this->artisan('resorts:process-payments')->assertSuccessful();
        }
        $this->assertSame(5, Refund::where('payment_id', $payment->id)->where('status', 'failed')->count(), '1 + 4 retries, then it stops');

        // Once PayMongo accepts, the next retry would go through — but it has stopped; reconciliation/admin takes over.
        $this->refundAnswer = 'succeeded';
        $this->artisan('resorts:process-payments')->assertSuccessful();
        $this->assertSame(0, Refund::where('payment_id', $payment->id)->where('status', 'succeeded')->count());
        $this->assertSame('failed', app(ResortReservationService::class)->refundInfo($booking->fresh())['status']);
        // The admins are told once that the money must be returned by hand.
        $this->assertSame(1, \App\Models\ActivityLog::where('action', 'escalation.resort_refund_failed')->where('model_id', $booking->id)->count());
    }

    public function test_cancelling_an_unpaid_hold_costs_nothing_and_frees_the_units(): void
    {
        $booking = $this->reserveGcash();
        $this->actingAs($this->tourist, 'sanctum')->postJson("/api/tourist/reservations/{$booking->id}/cancel")->assertOk()
            ->assertJsonPath('data.refund.status', 'none')->assertJsonPath('data.awaiting_payment', false);
        $this->assertSame(0, $this->held());
        $this->assertSame('unpaid', $booking->fresh()->payment_status);
        $this->assertSame(0, Refund::count());
    }
}
