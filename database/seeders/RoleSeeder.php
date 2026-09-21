<?php

namespace Database\Seeders;

use App\Models\Role;
use Illuminate\Database\Seeder;

class RoleSeeder extends Seeder
{
    public function run(): void
    {
        $roles = [
            ['name' => 'tourist', 'description' => 'Tourist or traveler'],
            ['name' => 'business_owner', 'description' => 'Business owner with registered businesses'],
            ['name' => 'rider', 'description' => 'Delivery rider'],
            ['name' => 'tourism_office', 'description' => 'Municipal Tourism Office staff'],
            ['name' => 'bansud_tourism_office', 'description' => 'Bansud Tourism Office — central authority with full platform access'],
        ];

        foreach ($roles as $role) {
            Role::updateOrCreate(
                ['name' => $role['name']],
                $role
            );
        }
    }
}
