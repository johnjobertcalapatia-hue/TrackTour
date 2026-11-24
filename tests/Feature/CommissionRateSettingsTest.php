<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\CommissionRateSnapshot;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\TransactionEvent;
use App\Models\User;
use App\Services\CommissionRateSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Earnings Stage 1 (2026-11-24, docs/secure-transaction-audit.md §R2):
 * commission rate settings — Bansud district defaults, each town's own
 * rates, who may see and change what, and the rates kept with each order.
 */
class CommissionRateSettingsTest extends TestCase
{
    use RefreshDatabase;

    private Municipality $bansud;

    private Municipality $gloria;

    private Municipality $roxas;

    private User $superAdmin;

    private User $gloriaOfficer;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake();

        $this->bansud = Municipality::create(['name' => 'Bansud', 'district' => '1st', 'province' => 'Oriental Mindoro', 'latitude' => 12.86, 'longitude' => 121.45]);
        $this->gloria = Municipality::create(['name' => 'Gloria', 'district' => '1st', 'province' => 'Oriental Mindoro']);
        $this->roxas = Municipality::create(['name' => 'Roxas', 'district' => '2nd', 'province' => 'Oriental Mindoro']);
        $this->superAdmin = $this->user(User::ROLE_BANSUD_TOURISM_OFFICE, $this->bansud);
        $this->gloriaOfficer = $this->user(User::ROLE_TOURISM_OFFICE, $this->gloria);
    }

    private function user(string $role, ?Municipality $municipality): User
    {
        return User::create([
            'name' => ucfirst($role).' '.Str::random(4),
            'email' => Str::lower($role.'.'.Str::random(10)).'@example.com',
            'password' => 'Password123!',
            'role' => $role,
            'account_status' => User::ACCOUNT_STATUS_APPROVED,
            'municipality_id' => $municipality?->id,
        ]);
    }

    private function districtPayload(array $overrides = []): array
    {
        return array_merge([
            'ride_driver_percent' => 40,
            'ride_driver_minimum' => 20,
            'food_system_fee_percent' => 10,
            'food_office_percent' => 20,
            'fast_platform_percent' => 10,
            'fast_rider_percent' => 30,
            'fast_office_percent' => 60,
            'cashout_fee_percent' => 2,
            'platform_net_percent' => 10,
            'fast_amount_minimum' => 20,
            'fast_amount_maximum' => 100,
            'fast_amount_options' => [25, 50, 100],
        ], $overrides);
    }

    private function townPayload(array $overrides = []): array
    {
        return array_merge(array_fill_keys(CommissionRateSettings::TOWN_FIELDS, null), $overrides);
    }

    public function test_built_in_defaults_are_todays_rules(): void
    {
        $rates = app(CommissionRateSettings::class)->effective($this->gloria->id)['rates'];

        $this->assertSame(40.0, $rates['ride_driver_percent']);
        $this->assertSame(20.0, $rates['ride_driver_minimum']);
        $this->assertSame(10.0, $rates['food_system_fee_percent']);
        $this->assertSame(20.0, $rates['food_office_percent']);
        $this->assertSame([10.0, 30.0, 60.0], [$rates['fast_platform_percent'], $rates['fast_rider_percent'], $rates['fast_office_percent']]);
        $this->assertSame(2.0, $rates['cashout_fee_percent']);
        $this->assertSame(10.0, $rates['platform_net_percent']);
    }

    public function test_super_admin_sets_district_defaults_and_every_town_without_its_own_value_uses_them(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson('/api/admin/commission-rates', $this->districtPayload(['ride_driver_percent' => 45, 'cashout_fee_percent' => 1.5]))
            ->assertOk()
            ->assertJsonPath('data.rates.ride_driver_percent', 45);

        $roxas = app(CommissionRateSettings::class)->effective($this->roxas->id);
        $this->assertSame(45.0, $roxas['rates']['ride_driver_percent']);
        $this->assertSame(1.5, $roxas['rates']['cashout_fee_percent']);
        $this->assertSame('district', $roxas['sources']['ride_driver_percent']);
        $this->assertTrue(ActivityLog::where('action', 'commission_rates.district_updated')->where('description', 'like', '%ride_driver_percent: 40% → 45%%')->exists());
    }

    public function test_a_municipal_office_sets_its_own_rates_and_a_blank_field_uses_the_district_default(): void
    {
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->putJson('/api/municipal/commission-rates', $this->townPayload(['ride_driver_percent' => 50, 'ride_driver_minimum' => 25]))
            ->assertOk()
            ->assertJsonPath('data.effective.rates.ride_driver_percent', 50)
            ->assertJsonPath('data.effective.sources.ride_driver_percent', 'town')
            ->assertJsonPath('data.effective.sources.food_office_percent', 'default');

        $settings = app(CommissionRateSettings::class);
        $this->assertSame(50.0, $settings->effective($this->gloria->id)['rates']['ride_driver_percent']);
        $this->assertSame(40.0, $settings->effective($this->roxas->id)['rates']['ride_driver_percent'], 'another town is not affected');

        // Clearing the field returns Gloria to the district default.
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->putJson('/api/municipal/commission-rates', $this->townPayload())
            ->assertOk()
            ->assertJsonPath('data.effective.rates.ride_driver_percent', 40)
            ->assertJsonPath('data.effective.sources.ride_driver_percent', 'default');
    }

    public function test_a_municipal_office_sees_only_its_own_rates_and_cannot_reach_the_district_settings(): void
    {
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson('/api/municipal/commission-rates')
            ->assertOk()
            ->assertJsonPath('data.municipality.id', $this->gloria->id)
            ->assertJsonMissingPath('data.municipalities');

        $this->actingAs($this->gloriaOfficer, 'sanctum')->getJson('/api/admin/commission-rates')->assertForbidden();
        $this->actingAs($this->gloriaOfficer, 'sanctum')->putJson('/api/admin/commission-rates', $this->districtPayload())->assertForbidden();
    }

    public function test_a_municipal_office_cannot_change_district_only_rates(): void
    {
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->putJson('/api/municipal/commission-rates', $this->townPayload(['platform_net_percent' => 0]))
            ->assertOk();

        $this->assertSame(10.0, app(CommissionRateSettings::class)->effective($this->gloria->id)['rates']['platform_net_percent']);
    }

    public function test_super_admin_views_every_town_and_edits_only_bansuds_own_rates(): void
    {
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->putJson('/api/municipal/commission-rates', $this->townPayload(['cashout_fee_percent' => 3]))
            ->assertOk();

        $towns = collect($this->actingAs($this->superAdmin, 'sanctum')->getJson('/api/admin/commission-rates')->assertOk()->json('data.municipalities'));
        $gloria = $towns->firstWhere('id', $this->gloria->id);
        $this->assertEquals(3, $gloria['effective']['rates']['cashout_fee_percent']);
        $this->assertTrue($gloria['has_own_rates']);
        $this->assertFalse($gloria['can_edit']);
        $this->assertTrue($towns->firstWhere('id', $this->bansud->id)['can_edit']);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson("/api/admin/commission-rates/municipalities/{$this->gloria->id}", $this->townPayload(['cashout_fee_percent' => 9]))
            ->assertForbidden();
        $this->assertSame(3.0, app(CommissionRateSettings::class)->effective($this->gloria->id)['rates']['cashout_fee_percent']);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson("/api/admin/commission-rates/municipalities/{$this->bansud->id}", $this->townPayload(['food_office_percent' => 18]))
            ->assertOk()
            ->assertJsonPath('data.effective.rates.food_office_percent', 18);
    }

    public function test_the_fast_delivery_split_must_add_up_to_100_percent(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson('/api/admin/commission-rates', $this->districtPayload(['fast_rider_percent' => 35]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('fast_office_percent');

        // A town overriding one part of the split must keep the total at 100%.
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->putJson('/api/municipal/commission-rates', $this->townPayload(['fast_rider_percent' => 40]))
            ->assertStatus(422);
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->putJson('/api/municipal/commission-rates', $this->townPayload(['fast_rider_percent' => 40, 'fast_office_percent' => 50]))
            ->assertOk();

        // New district defaults may not break a town's own split.
        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson('/api/admin/commission-rates', $this->districtPayload(['fast_platform_percent' => 5, 'fast_office_percent' => 65]))
            ->assertStatus(422);
    }

    public function test_fast_delivery_amounts_must_sit_inside_the_allowed_range(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson('/api/admin/commission-rates', $this->districtPayload(['fast_amount_options' => [25, 150]]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('fast_amount_options');

        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson('/api/admin/commission-rates', $this->districtPayload(['fast_amount_options' => [80, 30]]))
            ->assertOk()
            ->assertJsonPath('data.fast_amount_options', [30, 80]);
    }

    public function test_percentages_are_bounded(): void
    {
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->putJson('/api/municipal/commission-rates', $this->townPayload(['cashout_fee_percent' => 120]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('cashout_fee_percent');
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->putJson('/api/municipal/commission-rates', $this->townPayload(['ride_driver_minimum' => -1]))
            ->assertStatus(422);
    }

    /** Every town field's limit, starting from the built-in limits. */
    private function limitsPayload(array $overrides = []): array
    {
        return array_merge(app(CommissionRateSettings::class)->builtInLimits(), $overrides);
    }

    public function test_the_starting_limits_are_the_product_owners_ranges(): void
    {
        $limits = app(CommissionRateSettings::class)->limits();
        $this->assertSame(['min' => 30.0, 'max' => 70.0], $limits['ride_driver_percent']);
        $this->assertSame(['min' => 10.0, 'max' => 50.0], $limits['ride_driver_minimum']);
        $this->assertSame(['min' => 0.0, 'max' => 20.0], $limits['food_system_fee_percent']);
        $this->assertSame(['min' => 0.0, 'max' => 5.0], $limits['cashout_fee_percent']);
        $this->assertSame(['min' => 0.0, 'max' => 100.0], $limits['fast_rider_percent'], 'a rate with no listed limit keeps its full range');

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->getJson('/api/municipal/commission-rates')
            ->assertOk()
            ->assertJsonPath('data.limits.cashout_fee_percent.max', 5);
    }

    public function test_a_towns_own_rate_must_stay_within_bansuds_limits(): void
    {
        foreach ([
            'ride_driver_percent' => [75, 29],
            'ride_driver_minimum' => [55, 5],
            'food_system_fee_percent' => [21],
            'cashout_fee_percent' => [6],
        ] as $field => $values) {
            foreach ($values as $value) {
                $this->actingAs($this->gloriaOfficer, 'sanctum')
                    ->putJson('/api/municipal/commission-rates', $this->townPayload([$field => $value]))
                    ->assertStatus(422)
                    ->assertJsonValidationErrors($field);
            }
        }
        $this->assertSame([], array_filter(app(CommissionRateSettings::class)->overrides($this->gloria->id)), 'nothing was saved');

        $response = $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->putJson('/api/municipal/commission-rates', $this->townPayload(['ride_driver_percent' => 80]))
            ->assertStatus(422);
        $this->assertStringContainsString('30%–70%', $response->json('errors.ride_driver_percent.0'));

        // The edges are allowed; Bansud's own rates follow the same limits.
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->putJson('/api/municipal/commission-rates', $this->townPayload(['ride_driver_percent' => 70, 'ride_driver_minimum' => 10, 'cashout_fee_percent' => 5]))
            ->assertOk();
        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson("/api/admin/commission-rates/municipalities/{$this->bansud->id}", $this->townPayload(['cashout_fee_percent' => 5.5]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('cashout_fee_percent');
    }

    public function test_bansud_changes_the_limits_and_the_change_is_audited(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson('/api/admin/commission-rates', $this->districtPayload([
                'limits' => $this->limitsPayload(['cashout_fee_percent' => ['min' => 0, 'max' => 8]]),
            ]))
            ->assertOk()
            ->assertJsonPath('data.limits.cashout_fee_percent.max', 8);

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->putJson('/api/municipal/commission-rates', $this->townPayload(['cashout_fee_percent' => 7]))
            ->assertOk();
        $this->assertTrue(ActivityLog::where('action', 'commission_rates.district_updated')
            ->where('description', 'like', '%cashout_fee_percent limit: 0%–5% → 0%–8%%')->exists());

        // Leaving the limits out of a save keeps the ones in force.
        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson('/api/admin/commission-rates', $this->districtPayload(['ride_driver_percent' => 45]))
            ->assertOk()
            ->assertJsonPath('data.limits.cashout_fee_percent.max', 8);
    }

    public function test_the_district_defaults_must_sit_inside_the_limits(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson('/api/admin/commission-rates', $this->districtPayload(['ride_driver_percent' => 25]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('ride_driver_percent');

        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson('/api/admin/commission-rates', $this->districtPayload([
                'limits' => $this->limitsPayload(['cashout_fee_percent' => ['min' => 3, 'max' => 5]]),
            ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('cashout_fee_percent');

        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson('/api/admin/commission-rates', $this->districtPayload([
                'limits' => $this->limitsPayload(['ride_driver_percent' => ['min' => 60, 'max' => 50]]),
            ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('limits.ride_driver_percent.min');

        // The Fast Delivery shares can be limited too.
        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson('/api/admin/commission-rates', $this->districtPayload([
                'limits' => $this->limitsPayload(['fast_rider_percent' => ['min' => 35, 'max' => 50]]),
            ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('fast_rider_percent');
    }

    public function test_new_limits_cannot_leave_a_towns_own_rate_outside_them(): void
    {
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->putJson('/api/municipal/commission-rates', $this->townPayload(['cashout_fee_percent' => 4]))
            ->assertOk();

        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson('/api/admin/commission-rates', $this->districtPayload([
                'limits' => $this->limitsPayload(['cashout_fee_percent' => ['min' => 0, 'max' => 3]]),
            ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('limits');
        $this->assertStringContainsString('Gloria', $response->json('errors.limits.0'));
        $this->assertSame(5.0, app(CommissionRateSettings::class)->limits()['cashout_fee_percent']['max'], 'the limits were not changed');
        $this->assertSame(4.0, app(CommissionRateSettings::class)->effective($this->gloria->id)['rates']['cashout_fee_percent']);
    }

    public function test_the_ride_driver_share_never_exceeds_the_fare(): void
    {
        $rule = fn (float $fare) => \App\Services\RideDestinationChangeService::commission($fare);
        $this->assertSame(80.0, $rule(200), '40% of the fare');
        $this->assertSame(20.0, $rule(40), 'the ₱20 minimum');
        $this->assertSame(15.0, $rule(15), 'never more than the fare: the office share is ₱0, not negative');
        $this->assertSame(0.0, $rule(0));
    }

    public function test_a_food_order_keeps_the_restaurant_towns_rates_and_a_later_change_never_rewrites_them(): void
    {
        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->putJson('/api/municipal/commission-rates', $this->townPayload(['food_office_percent' => 15]))
            ->assertOk();

        $tourist = $this->user(User::ROLE_TOURIST, null);
        $offering = $this->menuItem($this->gloria);
        $orderId = $this->actingAs($tourist)->postJson('/api/tourist/food/order', [
            'business_id' => $offering->business_id,
            'items' => [['offering_id' => $offering->id, 'quantity' => 1, 'notes' => null]],
            'order_type' => 'delivery',
            'delivery_speed' => 'standard',
            'delivery_address' => '123 Test St',
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'customer_phone' => '09171234567',
            'payment_method' => 'gcash',
        ])->assertCreated()->json('data.order.id');

        $snapshot = CommissionRateSnapshot::where('order_id', $orderId)->sole();
        $this->assertSame(CommissionRateSnapshot::CONTEXT_FOOD_CHECKOUT, $snapshot->context);
        $this->assertSame($this->gloria->id, $snapshot->municipality_id);
        $this->assertEquals(15, $snapshot->rates['food_office_percent']);
        $this->assertTrue(TransactionEvent::where('event_type', 'commission_rates_captured')->exists(), 'the rates are in the tamper-evident ledger');

        $this->actingAs($this->gloriaOfficer, 'sanctum')
            ->putJson('/api/municipal/commission-rates', $this->townPayload(['food_office_percent' => 25]))
            ->assertOk();
        $this->assertEquals(15, $snapshot->fresh()->rates['food_office_percent'], 'a booked order keeps its rates');

        try {
            $snapshot->delete();
            $this->fail('a snapshot must never be deleted');
        } catch (\LogicException) {
        }
        $this->assertTrue(CommissionRateSnapshot::whereKey($snapshot->id)->exists());

        // The database also refuses a hard delete of the order the rates belong to.
        try {
            \App\Models\Order::withTrashed()->findOrFail($orderId)->forceDelete();
            $this->fail('the order must not be hard-deleted while it has rate snapshots');
        } catch (\Illuminate\Database\QueryException) {
        }
        $this->assertTrue(CommissionRateSnapshot::whereKey($snapshot->id)->exists());

        $this->expectException(\LogicException::class);
        $snapshot->update(['fingerprint' => str_repeat('0', 64)]);
    }

    public function test_a_group_order_keeps_one_snapshot_per_restaurant_town(): void
    {
        $tourist = $this->user(User::ROLE_TOURIST, null);
        $a = $this->menuItem($this->gloria);
        $b = $this->menuItem($this->roxas, 12.52, 121.32);

        $this->actingAs($tourist)->postJson('/api/tourist/food/group-order', [
            'restaurants' => [
                ['business_id' => $a->business_id, 'items' => [['offering_id' => $a->id, 'quantity' => 1, 'notes' => null]]],
                ['business_id' => $b->business_id, 'items' => [['offering_id' => $b->id, 'quantity' => 1, 'notes' => null]]],
            ],
            'order_type' => 'delivery',
            'delivery_speed' => 'standard',
            'delivery_address' => '123 Test St',
            'delivery_latitude' => 12.6,
            'delivery_longitude' => 121.4,
            'customer_phone' => '09171234567',
            'payment_method' => 'gcash',
        ])->assertSuccessful();

        $this->assertEqualsCanonicalizing(
            [$this->gloria->id, $this->roxas->id],
            CommissionRateSnapshot::pluck('municipality_id')->all()
        );
    }

    private function menuItem(Municipality $town, float $lat = 12.51, float $lng = 121.31): Offering
    {
        $allDays = array_fill_keys(
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
            [['open' => '00:00', 'close' => '23:59'], ['open' => '23:59', 'close' => '00:00']]
        );
        $business = Business::create([
            'owner_id' => $this->user(User::ROLE_BUSINESS_OWNER, $town)->id,
            'business_category_id' => BusinessCategory::firstOrCreate(['name' => 'Restaurant'])->id,
            'municipality_id' => $town->id,
            'business_name' => 'Eatery '.Str::random(5),
            'status' => 'approved',
            'force_closed' => false,
            'business_hours' => $allDays,
            'latitude' => $lat,
            'longitude' => $lng,
        ]);

        return Offering::create([
            'business_id' => $business->id,
            'name' => 'Adobo',
            'description' => 'Test menu item',
            'price' => 250,
            'is_available' => true,
            'status' => 'available',
        ]);
    }
}
