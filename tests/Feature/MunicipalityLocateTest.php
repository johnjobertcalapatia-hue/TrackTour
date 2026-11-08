<?php

namespace Tests\Feature;

use App\Models\Municipality;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * GET /api/municipalities/locate — powers the dynamic "Discover <municipality>" card.
 */
class MunicipalityLocateTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Municipality::create(['name' => 'Bansud', 'district' => 'District 2', 'province' => 'Oriental Mindoro', 'latitude' => 12.8667, 'longitude' => 121.4500, 'cover_photo' => 'municipalities/bansud.jpg']);
        Municipality::create(['name' => 'Bongabong', 'district' => 'District 2', 'province' => 'Oriental Mindoro', 'latitude' => 12.7469, 'longitude' => 121.4889]);
        Municipality::create(['name' => 'No Coords Town', 'district' => 'District 2', 'province' => 'Oriental Mindoro']);
    }

    public function test_resolves_the_nearest_municipality(): void
    {
        $this->getJson('/api/municipalities/locate?lat=12.86&lng=121.45')
            ->assertOk()
            ->assertJsonPath('data.name', 'Bansud')
            ->assertJsonPath('data.province', 'Oriental Mindoro')
            ->assertJsonPath('data.cover_photo', 'municipalities/bansud.jpg');

        $this->getJson('/api/municipalities/locate?lat=12.75&lng=121.49')
            ->assertOk()
            ->assertJsonPath('data.name', 'Bongabong');
    }

    public function test_returns_null_outside_covered_municipalities(): void
    {
        // Manila: hundreds of km away.
        $this->getJson('/api/municipalities/locate?lat=14.5995&lng=120.9842')
            ->assertOk()
            ->assertJsonPath('data', null);
    }

    public function test_is_public_and_validates_coordinates(): void
    {
        $this->getJson('/api/municipalities/locate')->assertUnprocessable();
        $this->getJson('/api/municipalities/locate?lat=95&lng=121')->assertUnprocessable();
        $this->getJson('/api/municipalities/locate?lat=abc&lng=121')->assertUnprocessable();
    }
}
