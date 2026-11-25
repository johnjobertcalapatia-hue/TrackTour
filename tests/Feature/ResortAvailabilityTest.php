<?php

namespace Tests\Feature;

use App\Exceptions\ResortUnavailableException;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\ResortBlockedDate;
use App\Models\ResortOffering;
use App\Models\ResortOfferingAllocation;
use App\Models\User;
use App\Services\ResortAvailabilityService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Resort reservations Stage 6 (docs/resort-reservation-architecture.md §11):
 * which dates an offering uses, closures, time slots, capacity under lock,
 * the tourist calendar and the owner's blocked dates.
 */
class ResortAvailabilityTest extends TestCase
{
    use RefreshDatabase;

    private ResortAvailabilityService $svc;

    private User $owner;

    private Business $resort;

    private ResortOffering $cottage;   // day use, 2 units

    private ResortOffering $room;      // overnight, 1 unit

    private ResortOffering $pool;      // day use, capacity 10 guests

    private ResortOffering $kayak;     // time slot, 60 min, 2 per slot

    protected function setUp(): void
    {
        parent::setUp();
        // Tuesday 1 Dec 2026, 9 AM in the Philippines.
        $this->travelTo(CarbonImmutable::parse('2026-12-01 09:00', 'Asia/Manila'));
        $this->svc = app(ResortAvailabilityService::class);

        $town = Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        $this->owner = $this->user('owner@example.com', 'business_owner');
        $this->resort = Business::create([
            'owner_id' => $this->owner->id,
            'business_category_id' => BusinessCategory::create(['name' => 'Resort'])->id,
            'municipality_id' => $town->id,
            'business_name' => 'RJM Beach Resort', 'status' => 'approved', 'latitude' => 12.86, 'longitude' => 121.48,
            // Open every day except Monday, 8 AM – 5 PM.
            'business_hours' => collect(['tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
                ->mapWithKeys(fn ($d) => [$d => [['open' => '08:00', 'close' => '17:00']]])->all(),
        ]);
        $this->cottage = $this->offering('Cottage', 'cottage', 'day_use', 'units', 2);
        $this->room = $this->offering('Family room', 'room', 'overnight', 'units', 1, ['pricing_basis' => 'per_night']);
        $this->pool = $this->offering('Pool pass', 'pool_access', 'day_use', 'capacity', 10, ['pricing_basis' => 'per_person']);
        $this->kayak = $this->offering('Kayak', 'activity', 'time_slot', 'slots', 2, ['duration_minutes' => 60, 'pricing_basis' => 'per_hour']);
    }

    private function user(string $email, string $role): User
    {
        return User::create(['email' => $email, 'name' => Str::before($email, '@'), 'password' => Hash::make('Password123!'), 'role' => $role, 'account_status' => 'approved']);
    }

    private function offering(string $name, string $category, string $mode, string $inventory, int $qty, array $extra = []): ResortOffering
    {
        return ResortOffering::create($extra + [
            'business_id' => $this->resort->id, 'category' => $category, 'name' => $name, 'booking_mode' => $mode,
            'pricing_basis' => 'per_unit', 'price' => 300, 'inventory_mode' => $inventory, 'inventory_quantity' => $qty,
            'min_quantity' => 1, 'is_published' => true, 'bookable_independently' => true,
        ]);
    }

    private function reserve(array $claims): void
    {
        DB::transaction(fn () => $this->svc->reserve($this->resort, $claims));
    }

    private function reserved(ResortOffering $o, string $date, string $slot = ''): int
    {
        return (int) ResortOfferingAllocation::where('resort_offering_id', $o->id)->where('date', $date)->where('slot', $slot)->value('reserved_quantity');
    }

    // --------------------------------------------------------------- engine

    public function test_an_overnight_stay_uses_each_night_and_day_use_one_date(): void
    {
        $this->assertSame(['2026-12-04', '2026-12-05'], $this->svc->datesFor($this->room, '2026-12-04', '2026-12-06'));
        $this->assertSame(['2026-12-04'], $this->svc->datesFor($this->cottage, '2026-12-04', '2026-12-06'));
        $this->assertSame(3, $this->svc->usage($this->cottage, 3, 8), 'units: the quantity');
        $this->assertSame(8, $this->svc->usage($this->pool, 1, 8), 'capacity: the guests');
    }

    public function test_capacity_is_enforced_and_a_failed_reservation_keeps_nothing(): void
    {
        $this->reserve($this->svc->claimsFor($this->cottage, '2026-12-04', null, null, 2, 4));
        $this->assertSame(2, $this->reserved($this->cottage, '2026-12-04'));

        try {
            // The room is free, the cottage is sold out: the whole reservation fails.
            $this->reserve([...$this->svc->claimsFor($this->room, '2026-12-04', '2026-12-05', null, 1, 2), ...$this->svc->claimsFor($this->cottage, '2026-12-04', null, null, 1, 2)]);
            $this->fail('Expected sold out');
        } catch (ResortUnavailableException $e) {
            $this->assertSame('sold_out', $e->problems[0]['reason']);
            $this->assertSame(0, $e->problems[0]['available']);
        }
        $this->assertSame(0, $this->reserved($this->room, '2026-12-04'), 'rolled back');
        $this->assertSame(2, $this->reserved($this->cottage, '2026-12-04'));
    }

    public function test_one_overnight_night_sold_out_refuses_the_whole_stay(): void
    {
        $this->reserve($this->svc->claimsFor($this->room, '2026-12-05', '2026-12-06', null, 1, 2));
        $this->expectException(ResortUnavailableException::class);
        $this->reserve($this->svc->claimsFor($this->room, '2026-12-04', '2026-12-07', null, 1, 2));
    }

    public function test_two_lines_on_the_same_offering_and_date_are_added_together(): void
    {
        $this->expectException(ResortUnavailableException::class);
        $this->reserve([...$this->svc->claimsFor($this->cottage, '2026-12-04', null, null, 1, 2), ...$this->svc->claimsFor($this->cottage, '2026-12-04', null, null, 2, 2)]);
    }

    public function test_capacity_offerings_count_guests(): void
    {
        $this->reserve($this->svc->claimsFor($this->pool, '2026-12-04', null, null, 1, 7));
        $this->expectException(ResortUnavailableException::class);
        $this->reserve($this->svc->claimsFor($this->pool, '2026-12-04', null, null, 1, 4));
    }

    public function test_release_gives_units_back_and_never_goes_below_zero(): void
    {
        $claims = $this->svc->claimsFor($this->cottage, '2026-12-04', null, null, 2, 4);
        $this->reserve($claims);
        DB::transaction(fn () => $this->svc->release($claims));
        DB::transaction(fn () => $this->svc->release($claims));
        $this->assertSame(0, $this->reserved($this->cottage, '2026-12-04'));
    }

    public function test_blocked_closed_past_and_far_dates_are_refused(): void
    {
        ResortBlockedDate::create(['business_id' => $this->resort->id, 'start_date' => '2026-12-10', 'end_date' => '2026-12-11', 'reason' => 'Repairs']);
        ResortBlockedDate::create(['business_id' => $this->resort->id, 'resort_offering_id' => $this->cottage->id, 'start_date' => '2026-12-12', 'end_date' => '2026-12-12']);

        $reason = function (ResortOffering $o, string $in, ?string $out = null) {
            try {
                $this->svc->assertAvailable($this->resort, $this->svc->claimsFor($o, $in, $out, null, 1, 1));

                return 'ok';
            } catch (ResortUnavailableException $e) {
                return $e->problems[0]['reason'];
            }
        };
        $this->assertSame('blocked', $reason($this->cottage, '2026-12-10'));
        $this->assertSame('blocked', $reason($this->room, '2026-12-09', '2026-12-12'), 'a blocked night inside the stay');
        $this->assertSame('blocked', $reason($this->cottage, '2026-12-12'), 'blocked for this offering');
        $this->assertSame('ok', $reason($this->pool, '2026-12-12'), 'other offerings still open');
        $this->assertSame('closed', $reason($this->cottage, '2026-12-07'), 'Monday');
        $this->assertSame('ok', $reason($this->room, '2026-12-06', '2026-12-08'), 'nights may fall on a closed day');
        $this->assertSame('out_of_window', $reason($this->cottage, '2026-11-30'));
        $this->assertSame('out_of_window', $reason($this->cottage, '2028-01-05'));
    }

    public function test_time_slots_follow_the_opening_hours(): void
    {
        $slots = $this->svc->slotsFor($this->kayak, $this->resort, '2026-12-04');
        $this->assertSame('08:00', $slots[0]);
        $this->assertSame('16:00', end($slots));
        $this->assertCount(9, $slots);
        $this->assertSame([], $this->svc->slotsFor($this->kayak, $this->resort, '2026-12-07'), 'closed Monday');

        $this->reserve($this->svc->claimsFor($this->kayak, '2026-12-04', null, '09:00', 1, 2));
        $this->assertSame(2, $this->reserved($this->kayak, '2026-12-04', '09:00'));
        $this->reserve($this->svc->claimsFor($this->kayak, '2026-12-04', null, '10:00', 1, 2)); // another slot is free

        try {
            $this->reserve($this->svc->claimsFor($this->kayak, '2026-12-04', null, '09:30', 1, 1));
            $this->fail('Expected an unknown slot');
        } catch (ResortUnavailableException $e) {
            $this->assertSame('slot', $e->problems[0]['reason']);
        }
    }

    // ----------------------------------------------------------------- API

    public function test_tourists_see_the_calendar_of_published_offerings(): void
    {
        $this->offering('Hidden hut', 'cottage', 'day_use', 'units', 5, ['is_published' => false]);
        $this->reserve($this->svc->claimsFor($this->cottage, '2026-12-04', null, null, 1, 2));
        ResortBlockedDate::create(['business_id' => $this->resort->id, 'start_date' => '2026-12-05', 'end_date' => '2026-12-05']);

        $data = $this->getJson("/api/tourist/resorts/{$this->resort->id}/availability?from=2026-12-04&to=2026-12-07")->assertOk()->json('data');

        $names = array_column($data['offerings'], 'name');
        $this->assertNotContains('Hidden hut', $names);
        $cottage = collect($data['offerings'])->firstWhere('name', 'Cottage');
        $days = collect($cottage['dates'])->keyBy('date');
        $this->assertSame(1, $days['2026-12-04']['available']);
        $this->assertSame(0, $days['2026-12-05']['available']);
        $this->assertTrue($days['2026-12-05']['blocked']);
        $this->assertTrue($days['2026-12-07']['closed']);
        $this->assertSame(['2026-12-07'], $data['closed_dates']);
        $kayakDay = collect(collect($data['offerings'])->firstWhere('name', 'Kayak')['dates'])->firstWhere('date', '2026-12-04');
        $this->assertSame('08:00', $kayakDay['slots'][0]['slot']);

        // Past dates are moved to today; ranges are limited; only approved resorts.
        $this->assertSame('2026-12-01', $this->getJson("/api/tourist/resorts/{$this->resort->id}/availability?from=2026-11-01&to=2026-12-02")->json('data.from'));
        $this->getJson("/api/tourist/resorts/{$this->resort->id}/availability?from=2026-12-01&to=2027-03-01")->assertUnprocessable();
        $this->resort->update(['status' => 'pending']);
        $this->getJson("/api/tourist/resorts/{$this->resort->id}/availability")->assertNotFound();
    }

    public function test_the_owner_blocks_and_reopens_dates(): void
    {
        $this->reserve($this->svc->claimsFor($this->cottage, '2026-12-20', null, null, 2, 4));
        $owner = $this->actingAs($this->owner, 'sanctum');
        $base = "/api/business-owner/businesses/{$this->resort->id}/resort-blocked-dates";

        $res = $owner->postJson($base, ['start_date' => '2026-12-20', 'end_date' => '2026-12-22', 'reason' => 'Private event'])->assertCreated();
        $this->assertSame(2, $res->json('data.already_reserved'));
        $this->assertStringContainsString('stay booked', $res->json('message'));

        $owner->postJson($base, ['start_date' => '2026-12-24', 'end_date' => '2026-12-24', 'resort_offering_id' => $this->room->id])->assertCreated()
            ->assertJsonPath('data.offering_name', 'Family room');
        $owner->postJson($base, ['start_date' => '2026-11-20', 'end_date' => '2026-11-21'])->assertUnprocessable()->assertJsonValidationErrors('start_date');
        $owner->postJson($base, ['start_date' => '2026-12-22', 'end_date' => '2026-12-21'])->assertUnprocessable()->assertJsonValidationErrors('end_date');

        $other = Business::create(['owner_id' => $this->owner->id, 'business_category_id' => $this->resort->business_category_id, 'municipality_id' => $this->resort->municipality_id, 'business_name' => 'Other resort', 'status' => 'approved', 'latitude' => 1, 'longitude' => 1]);
        $theirs = ResortOffering::create(['business_id' => $other->id, 'category' => 'cottage', 'name' => 'Theirs', 'booking_mode' => 'day_use', 'pricing_basis' => 'per_unit', 'price' => 1, 'inventory_mode' => 'units', 'inventory_quantity' => 1]);
        $owner->postJson($base, ['start_date' => '2026-12-25', 'end_date' => '2026-12-25', 'resort_offering_id' => $theirs->id])->assertUnprocessable()->assertJsonValidationErrors('resort_offering_id');

        $list = $owner->getJson($base)->assertOk()->json('data');
        $this->assertCount(2, $list);
        $owner->deleteJson("{$base}/{$list[0]['id']}")->assertOk();
        $this->assertSame(1, ResortBlockedDate::count());

        // The owner calendar also shows unpublished offerings.
        $this->offering('Draft villa', 'room', 'overnight', 'units', 1, ['is_published' => false, 'pricing_basis' => 'per_night']);
        $names = array_column($owner->getJson("/api/business-owner/businesses/{$this->resort->id}/resort-availability?from=2026-12-01&to=2026-12-03")->assertOk()->json('data.offerings'), 'name');
        $this->assertContains('Draft villa', $names);
    }

    public function test_other_owners_and_non_resorts_are_refused(): void
    {
        $stranger = $this->user('stranger@example.com', 'business_owner');
        $this->actingAs($stranger, 'sanctum')->getJson("/api/business-owner/businesses/{$this->resort->id}/resort-blocked-dates")->assertForbidden();
        $this->actingAs($stranger, 'sanctum')->postJson("/api/business-owner/businesses/{$this->resort->id}/resort-blocked-dates", ['start_date' => '2026-12-20', 'end_date' => '2026-12-20'])->assertForbidden();

        $grill = Business::create(['owner_id' => $this->owner->id, 'business_category_id' => BusinessCategory::create(['name' => 'Restaurant'])->id, 'municipality_id' => $this->resort->municipality_id, 'business_name' => 'Grill', 'status' => 'approved', 'latitude' => 1, 'longitude' => 1]);
        $this->actingAs($this->owner, 'sanctum')->getJson("/api/business-owner/businesses/{$grill->id}/resort-blocked-dates")->assertUnprocessable();
        $this->getJson("/api/tourist/resorts/{$grill->id}/availability")->assertNotFound();
    }
}
