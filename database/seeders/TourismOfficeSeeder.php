<?php

namespace Database\Seeders;

use App\Models\Municipality;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class TourismOfficeSeeder extends Seeder
{
    public function run(): void
    {
        $bansud = Municipality::where('name', 'Bansud')->first();

        $accounts = [
            [
                'name' => 'Bansud Tourism Office',
                'email' => 'tourism@bansud.gov.ph',
                'password' => 'password',
                'role' => User::ROLE_BANSUD_TOURISM_OFFICE,
                'account_status' => User::ACCOUNT_STATUS_APPROVED,
                'municipality_id' => $bansud?->id,
            ],
            [
                'name' => 'Tourism Office Staff',
                'email' => 'tourism.staff@bansud.gov.ph',
                'password' => 'password',
                'role' => User::ROLE_TOURISM_OFFICE,
                'account_status' => User::ACCOUNT_STATUS_APPROVED,
                'municipality_id' => $bansud?->id,
            ],
        ];

        foreach ($accounts as $data) {
            User::updateOrCreate(
                ['email' => $data['email']],
                [
                    'name' => $data['name'],
                    'password' => Hash::make($data['password']),
                    'role' => $data['role'],
                    'account_status' => $data['account_status'],
                    'municipality_id' => $data['municipality_id'],
                    'email_verified_at' => now(),
                ]
            );
        }

        $this->command->info('Tourism office accounts created successfully.');
    }
}
