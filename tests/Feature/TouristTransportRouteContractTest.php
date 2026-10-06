<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Tourist transport Phase 3 contract: fare breakdown line items + route preview.
 *
 *   - estimate() must expose explicit line items per vehicle
 *     {base_fare, distance_fare, total_fare} and a top-level service_fee
 *     (config-driven, default 0, NOT added to orders.total in MVP) while
 *     keeping the Phase 1 legacy keys (fare / fare_text) intact.
 *   - POST /tourist/transport/route must return a renderable polyline:
 *     decoded OSRM GeoJSON when the router responds, otherwise a straight-line
 *     fallback with source 'straight_line'. distance_km/duration_min always
 *     present; invalid/missing coordinates → 422; unauthenticated → 401.
 */
class TouristTransportRouteContractTest extends TestCase
{
    use RefreshDatabase;

    private User $tourist;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tourist = User::create([
            'name' => 'Route Tourist',
            'email' => 'route-tourist@example.com',
            'password' => Hash::make('Password123!'),
            'role' => 'tourist',
            'account_status' => 'approved',
        ]);
    }

    // ---------- helpers ----------

    private function coords(): array
    {
        return [
            'pickup_lat' => 12.5,
            'pickup_lng' => 121.3,
            'destination_lat' => 12.6,
            'destination_lng' => 121.4,
        ];
    }

    private function authHeaders(): array
    {
        return [
            'Authorization' => 'Bearer '.$this->tourist->createToken('test')->plainTextToken,
        ];
    }

    // ---------- estimate line items ----------

    public function test_estimate_exposes_explicit_fare_line_items(): void
    {
        $response = $this->postJson('/api/tourist/transport/estimate', $this->coords(), $this->authHeaders());

        $response->assertOk();

        $data = $response->json('data');
        $this->assertSame(0.0, (float) $data['service_fee'], 'service_fee must default to 0 in MVP');

        $motorcycle = $data['fares']['motorcycle'];
        $distanceKm = (float) $data['distance_km'];

        $this->assertSame(50.00, (float) $motorcycle['base_fare']);
        // total_fare is exactly base + distance line (both 2-dp values).
        $this->assertSame(
            round(50.00 + (float) $motorcycle['distance_fare'], 2),
            (float) $motorcycle['total_fare']
        );
        // distance_fare tracks the displayed distance within 2-dp rounding
        // (server computes it from the unrounded haversine distance).
        $this->assertEqualsWithDelta(round($distanceKm * 15, 2), (float) $motorcycle['distance_fare'], 0.1);
        $this->assertSame((float) $motorcycle['fare'], (float) $motorcycle['total_fare']);
        $this->assertSame((float) $distanceKm, (float) $motorcycle['distance_km']);
        $this->assertSame((int) $data['duration_min'], (int) $motorcycle['duration_min']);
    }

    public function test_estimate_keeps_legacy_fare_keys_for_phase1_consumers(): void
    {
        $response = $this->postJson('/api/tourist/transport/estimate', $this->coords(), $this->authHeaders());

        $response->assertOk();
        $data = $response->json('data');

        foreach (['motorcycle', 'tricycle', 'car', 'van'] as $vehicle) {
            $this->assertArrayHasKey('fare', $data['fares'][$vehicle]);
            $this->assertArrayHasKey('fare_text', $data['fares'][$vehicle]);
            $this->assertArrayHasKey('base_fare', $data['fares'][$vehicle]);
            $this->assertArrayNotHasKey('custom_advisory', $data['fares'][$vehicle], 'no inventable keys in the contract');
        }
    }

    // ---------- route preview ----------

    public function test_route_decodes_osrm_geojson_polyline(): void
    {
        Http::fake([
            'router.project-osrm.org/*' => Http::response([
                'code' => 'Ok',
                'routes' => [[
                    'distance' => 2500,
                    'duration' => 600,
                    'geometry' => [
                        'type' => 'LineString',
                        'coordinates' => [[121.30, 12.50], [121.32, 12.52], [121.34, 12.54]],
                    ],
                ]],
            ]),
        ]);

        $response = $this->postJson('/api/tourist/transport/route', $this->coords(), $this->authHeaders());

        $response->assertOk();

        $data = $response->json('data');
        $this->assertSame('osrm', $data['source']);
        $this->assertSame(2.5, (float) $data['distance_km']);
        $this->assertSame(10, (int) $data['duration_min']);
        $this->assertSame([[12.5, 121.3], [12.52, 121.32], [12.54, 121.34]], $data['polyline']);
    }

    public function test_route_falls_back_to_straight_line_when_osrm_fails(): void
    {
        Http::fake([
            'router.project-osrm.org/*' => Http::response(['code' => 'NoRoute'], 500),
        ]);

        $response = $this->postJson('/api/tourist/transport/route', $this->coords(), $this->authHeaders());

        $response->assertOk();

        $data = $response->json('data');
        $this->assertSame('straight_line', $data['source']);
        $this->assertCount(2, $data['polyline']);
        $this->assertSame([[12.5, 121.3], [12.6, 121.4]], $data['polyline']);
        $this->assertGreaterThan(0.0, (float) $data['distance_km']);
        $this->assertGreaterThanOrEqual(5, (int) $data['duration_min']);
    }

    public function test_route_requires_authentication(): void
    {
        Http::fake();

        $this->postJson('/api/tourist/transport/route', $this->coords())->assertStatus(401);
    }

    public function test_route_validates_missing_coordinates(): void
    {
        $this->postJson('/api/tourist/transport/route', ['pickup_lat' => 12.5], $this->authHeaders())
            ->assertStatus(422)
            ->assertJsonValidationErrors(['pickup_lng', 'destination_lat', 'destination_lng']);
    }
}