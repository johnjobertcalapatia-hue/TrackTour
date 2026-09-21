<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\Tourist;

class TouristSeeder extends Seeder
{
    public function run(): void
    {
        $samples = [
            [
                'first_name' => 'Alice',
                'last_name' => 'Wong',
                'dob' => '1990-05-12',
                'nationality' => 'Philippines',
                'bio' => 'Loves beaches and local cuisine.',
                'preferences' => ['interests' => ['beaches', 'food']],
            ],
            [
                'first_name' => 'Bob',
                'last_name' => 'Garcia',
                'dob' => '1985-11-03',
                'nationality' => 'Philippines',
                'bio' => 'History buff and hiker.',
                'preferences' => ['interests' => ['museums', 'hiking']],
            ],
            [
                'first_name' => 'Carlos',
                'last_name' => 'Reyes',
                'dob' => '1995-07-21',
                'nationality' => 'Philippines',
                'bio' => 'Foodie and photographer.',
                'preferences' => ['interests' => ['food', 'photography']],
            ],
        ];

        foreach ($samples as $s) {
            Tourist::create($s);
        }
    }
}
