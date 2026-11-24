<?php

namespace Tests\Feature;

use App\Models\Municipality;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * GET /municipalities carries each municipal Tourism Office logo and cover for the
 * landing "Where to Next?" cards; Bansud falls back to the Bansud Tourism
 * Office profile logo.
 */
class MunicipalityOfficeLogoTest extends TestCase
{
    use RefreshDatabase;

    public function test_each_municipality_has_its_office_logo(): void
    {
        Municipality::create(['name' => 'Bansud', 'district' => '2', 'province' => 'Oriental Mindoro']);
        Municipality::create(['name' => 'Gloria', 'district' => '2', 'province' => 'Oriental Mindoro', 'logo' => 'municipalities/2/seal.png', 'cover_photo' => 'municipalities/2/plaza.jpg']);
        Municipality::create(['name' => 'Roxas', 'district' => '2', 'province' => 'Oriental Mindoro']);
        DB::table('tourism_settings')->insert([
            ['municipality_id' => null, 'key' => 'office_logo', 'value' => '/storage/office/logo/bansud.jpg', 'created_at' => now(), 'updated_at' => now()],
            ['municipality_id' => null, 'key' => 'office_cover', 'value' => '/storage/office/cover/plaza.jpg', 'created_at' => now(), 'updated_at' => now()],
        ]);

        $data = collect($this->getJson('/api/municipalities')->assertOk()->json('data'))->keyBy('name');

        $this->assertSame('/storage/office/logo/bansud.jpg', $data['Bansud']['logo_url']);
        $this->assertSame('municipalities/2/seal.png', $data['Gloria']['logo_url']);
        $this->assertNull($data['Roxas']['logo_url']);
        // Cover photos: the card background.
        $this->assertSame('/storage/office/cover/plaza.jpg', $data['Bansud']['cover_url']);
        $this->assertSame('municipalities/2/plaza.jpg', $data['Gloria']['cover_url']);
        $this->assertNull($data['Roxas']['cover_url']);
        $this->assertArrayNotHasKey('cover_photo', $data['Gloria']);
        $this->assertArrayNotHasKey('logo', $data['Gloria']);
        $this->assertArrayHasKey('barangays', $data['Gloria']);
    }
}
