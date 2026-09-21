<?php

namespace Database\Seeders;

use App\Models\Municipality;
use Illuminate\Database\Seeder;

class MunicipalitySeeder extends Seeder
{
    public function run(): void
    {
        $municipalities = [
            ['name' => 'Bansud', 'district' => 'District 2', 'province' => 'Oriental Mindoro', 'latitude' => 12.8667, 'longitude' => 121.4500],
            ['name' => 'Bongabong', 'district' => 'District 2', 'province' => 'Oriental Mindoro', 'latitude' => 12.7469, 'longitude' => 121.4889],
            ['name' => 'Bulalacao', 'district' => 'District 2', 'province' => 'Oriental Mindoro', 'latitude' => 12.3253, 'longitude' => 121.3436],
            ['name' => 'Gloria', 'district' => 'District 2', 'province' => 'Oriental Mindoro', 'latitude' => 12.9750, 'longitude' => 121.4667],
            ['name' => 'Mansalay', 'district' => 'District 2', 'province' => 'Oriental Mindoro', 'latitude' => 12.5204, 'longitude' => 121.4386],
            ['name' => 'Pinamalayan', 'district' => 'District 2', 'province' => 'Oriental Mindoro', 'latitude' => 12.9833, 'longitude' => 121.4667],
            ['name' => 'Roxas', 'district' => 'District 2', 'province' => 'Oriental Mindoro', 'latitude' => 12.5833, 'longitude' => 121.5167],
        ];

        foreach ($municipalities as $municipality) {
            Municipality::firstOrCreate(
                ['name' => $municipality['name']],
                $municipality
            );
        }
    }
}
