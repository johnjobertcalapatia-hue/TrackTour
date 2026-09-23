<?php

namespace Tests\Feature;

use App\Models\BookingDispatchLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Delivery;
use App\Models\Municipality;
use App\Models\Order;
use App\Models\RiderDetail;
use App\Models\RiderLocation;
use App\Models\User;
use App\Services\NearestRiderService;
use App\Services\SmartDispatchService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Re-offer after an OFFER TIMEOUT (missed-ping recovery).
 *
 * The verified field failure: a rider never saw a COD ping because
 * `alreadyDispatchedRiderIds` contained EVERY prior offer row regardless of
 * `response`. One TIMED-OUT offer therefore excluded that rider from the
 * delivery forever — and UNIQUE(delivery_id, rider_id) forbids a second row,
 * so there was no path back. In a town with one eligible rider the delivery
 * dead-ended silently while diagnostics reported `already_offered`.
 *
 * Contract under test:
 *
 *   - timeout  → RE-OFFERABLE (rider never answered; reopen the same row)
 *   - declined → blocked        (a decline is an answer)
 *   - pending  → blocked        (an active offer is in flight, never duplicated)
 *
 * The reopen is an UPDATE of the single existing row (never a second insert),
 * so the UNIQUE backstop and the offer state machine are untouched. Reopening
 * removes ONLY the already-offered blocker: every other COD gate (approved,
 * available, food service, fresh GPS, pickup distance, active-order limit)
 * must still apply.
 */
class DispatchTimedOutReofferTest extends TestCase
{
    use RefreshDatabase;

    private Business $business;
    private User $rider;
    private NearestRiderService $service;

    protected function setUp(): void
    {
        parent::setUp();

        // The bridge is best-effort; keep it deterministic and offline.
        Http::fake([
            '*' => Http::response(['success' => true, 'onlineRiders' => []], 200),
        ]);

        $category = BusinessCategory::firstOrCreate(['name' => 'Restaurant']);
        $municipality = Municipality::firstOrCreate(
            ['name' => 'Bansud'],
            [
                'district' => '1st',
                'province' => 'Oriental Mindoro',
                'latitude' => 12.5,
                'longitude' => 121.3,
            ]
        );

        $owner = User::firstOrCreate(
            ['email' => 'owner-reoffer@example.com'],
            [
                'password' => Hash::make('Password123!'),
                'role' => 'business_owner',
                'account_status' => 'approved',
            ]
        );

        $this->business = Business::create([
            'owner_id' => $owner->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'business_name' => 'Reoffer Restaurant',
            'status' => 'approved',
            'force_closed' => false,
            'latitude' => 12.51,
            'longitude' => 121.31,
        ]);

        // Located AT the pickup point with a fresh fix, so the primary MySQL
        // COD query finds this rider — no radar fallback needed for these cases.
        $this->rider = User::create([
            'email' => 'rider-reoffer@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'rider',
            'account_status' => 'approved',
            'rider_status' => 'available',
            'current_service' => 'food',
            'municipality_id' => null,
        ]);

        RiderDetail::create([
            'user_id' => $this->rider->id,
            'rider_status' => 'available',
            'current_service' => 'food',
        ]);

        RiderLocation::create([
            'rider_id' => $this->rider->id,
            'latitude' => $this->business->latitude,
            'longitude' => $this->business->longitude,
            'recorded_at' => now(),
        ]);

        $this->service = $this->app->make(NearestRiderService::class);
    }

    /** Create the delivery and produce the rider's first pending offer. */
    private function dispatchWithInitialOffer(): Delivery
    {
        $order = Order::create([
            'order_number' => 'ORD-' . Str::upper(Str::random(8)),
            'business_id' => $this->business->id,
            'customer_name' => 'Customer',
            'customer_email' => 'cust-reoffer@example.com',
            'customer_phone' => '09171234567',
            'order_type' => 'delivery',
            'payment_method' => 'cash',
            'payment_status' => 'pending',
            'status' => 'waiting_restaurant',
            'subtotal' => 300,
            'delivery_fee' => 40,
            'rider_tip' => 0,
            'system_fee' => 0,
            'rider_financed_amount' => 300,
            'total' => 340,
            'delivery_latitude' => 12.52,
            'delivery_longitude' => 121.32,
            'delivery_address' => '123 Test St',
        ]);

        app(SmartDispatchService::class)->scheduleDispatch($order->fresh());

        $delivery = $order->fresh()->delivery;
        $this->assertNotNull($delivery, 'scheduleDispatch created the delivery.');

        $offer = $this->offerFor($delivery);
        $this->assertNotNull($offer, 'Initial wave created the pending offer.');
        $this->assertSame('pending', $offer->response);

        return $delivery;
    }

    private function offerFor(Delivery $delivery): ?BookingDispatchLog
    {
        return BookingDispatchLog::where('delivery_id', $delivery->id)
            ->where('rider_id', $this->rider->id)
            ->first();
    }

    /** Simulate what processTimeouts() writes when an offer expires unanswered. */
    private function expireOffer(Delivery $delivery, string $response): void
    {
        $this->offerFor($delivery)->update([
            'response' => $response,
            'responded_at' => now(),
        ]);
    }

    /** The scheduler/timeout path calling the authoritative dispatch layer again. */
    private function redispatch(Delivery $delivery): ?User
    {
        return $this->service->dispatchToNearest(
            $delivery->fresh(),
            'food',
            $this->business->municipality_id
        );
    }

    public function test_a_timed_out_offer_is_reopened_for_the_same_rider(): void
    {
        $delivery = $this->dispatchWithInitialOffer();
        $firstOffer = $this->offerFor($delivery);

        $this->expireOffer($delivery, 'timeout');

        $rider = $this->redispatch($delivery);

        $this->assertNotNull($rider, 'A rider whose offer only timed out is offered again.');
        $this->assertSame($this->rider->id, $rider->id);

        $reopen = $this->offerFor($delivery);
        $this->assertSame('pending', $reopen->response, 'Timed-out offer reopened as live.');
        $this->assertNull($reopen->responded_at, 'Reopening clears the timeout answer.');
        $this->assertTrue(
            $reopen->dispatched_at->greaterThanOrEqualTo($firstOffer->dispatched_at),
            'dispatched_at refreshed so the offer window restarts.'
        );

        $delivery->refresh();
        $this->assertSame('notified', $delivery->dispatch_status);
        $this->assertNotNull($delivery->dispatch_expires_at, 'Offer window re-armed.');
    }

    public function test_reopening_reuses_the_single_row_so_the_unique_backstop_holds(): void
    {
        $delivery = $this->dispatchWithInitialOffer();
        $offerId = $this->offerFor($delivery)->id;

        $this->expireOffer($delivery, 'timeout');
        $this->redispatch($delivery);

        $this->assertSame(
            1,
            BookingDispatchLog::where('delivery_id', $delivery->id)
                ->where('rider_id', $this->rider->id)
                ->count(),
            'Re-offer must UPDATE the timed-out row, never insert a second one.'
        );
        $this->assertSame(
            $offerId,
            $this->offerFor($delivery)->id,
            'Same logical offer survives the reopen (UNIQUE delivery/rider intact).'
        );
    }

    public function test_a_declined_rider_is_not_re_offered(): void
    {
        $delivery = $this->dispatchWithInitialOffer();

        $this->expireOffer($delivery, 'declined');

        $this->redispatch($delivery);

        $offer = $this->offerFor($delivery);
        $this->assertSame('declined', $offer->response, 'A decline is an answer and stays final.');
        $this->assertSame(
            1,
            BookingDispatchLog::where('delivery_id', $delivery->id)->count()
        );
    }

    public function test_a_live_pending_offer_is_never_duplicated(): void
    {
        $delivery = $this->dispatchWithInitialOffer();
        $firstOffer = $this->offerFor($delivery);

        $this->redispatch($delivery);

        $offer = $this->offerFor($delivery);
        $this->assertSame('pending', $offer->response);
        $this->assertTrue(
            $offer->dispatched_at->equalTo($firstOffer->dispatched_at),
            'An in-flight offer keeps its original window — no silent re-arm.'
        );
        $this->assertSame(
            1,
            BookingDispatchLog::where('delivery_id', $delivery->id)->count()
        );
    }

    public function test_reopening_does_not_bypass_the_other_cod_gates(): void
    {
        $delivery = $this->dispatchWithInitialOffer();
        $this->expireOffer($delivery, 'timeout');

        // Rider went offline after timing out: re-offerable, but ineligible.
        $this->rider->riderDetail()->update(['rider_status' => 'offline']);

        $this->assertNull($this->redispatch($delivery), 'No offer to an ineligible rider.');

        $this->assertSame('timeout', $this->offerFor($delivery)->response, 'Timed-out offer stays untouched.');
    }
}
