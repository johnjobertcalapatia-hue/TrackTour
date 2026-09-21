<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            MunicipalitySeeder::class,
            BarangaySeeder::class,
            BusinessCategorySeeder::class,
            BusinessModuleSeeder::class,
            StaffRoleSeeder::class,
            BusinessCategoryStaffRoleSeeder::class,
            RoleSeeder::class,
            TourismOfficeSeeder::class,
        ]);

        $user = User::factory()->create([
            'email' => 'test@example.com',
            'role' => User::ROLE_TOURIST,
        ]);

        $user->profile()->create([
            'first_name' => 'Test',
            'last_name' => 'User',
        ]);
    }
}
