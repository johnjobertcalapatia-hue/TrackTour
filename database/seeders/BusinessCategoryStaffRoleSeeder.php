<?php

namespace Database\Seeders;

use App\Models\BusinessCategory;
use App\Models\StaffRole;
use Illuminate\Database\Seeder;

class BusinessCategoryStaffRoleSeeder extends Seeder
{
    public function run(): void
    {
        $map = [
            'Restaurant' => [
                'Restaurant Manager',
            ],
            'Hotel' => [
                'Reservation & Front Desk Staff',
                'Room Management Staff',
                'Digital Promotion Staff',
                'Housekeeping Staff',
            ],
            'Resort' => [
                'Reservation Staff',
                'Facility Management Staff',
                'Digital Promotion Staff',
                'Maintenance Staff',
            ],
            'Café' => [
                'Order & Payment Staff',
                'Menu Management Staff',
                'Kitchen / Preparation Staff',
                'Digital Promotion Staff',
            ],
            'Food Hub / Food Park' => [
                'Order & Payment Staff',
                'Food Menu Staff',
                'Kitchen / Preparation Staff',
                'Digital Promotion Staff',
            ],
            'Tourist Attraction' => [
                'Visitor Management Staff',
                'Facility Management Staff',
                'Digital Promotion Staff',
            ],
            'Tour Guide' => [
                'Tour Booking Staff',
                'Tour Guide Staff',
                'Digital Promotion Staff',
            ],
            'Travel Agency' => [
                'Booking Staff',
                'Package Management Staff',
                'Digital Promotion Staff',
            ],
            'Souvenir Shop' => [
                'Sales Staff',
                'Product Management Staff',
                'Digital Promotion Staff',
            ],
            'Transport Service' => [
                'Booking Coordinator Staff',
                'Driver/Rider Staff',
                'Digital Promotion Staff',
            ],
            'Homestay' => [
                'Reservation Staff',
                'Housekeeping Staff',
                'Digital Promotion Staff',
            ],
            'Camping Site' => [
                'Reservation Staff',
                'Facility Management Staff',
                'Digital Promotion Staff',
            ],
            'Dive Shop' => [
                'Booking Staff',
                'Dive Instructor Staff',
                'Equipment Management Staff',
                'Digital Promotion Staff',
            ],
            'Event Venue' => [
                'Booking Staff',
                'Facility Management Staff',
                'Digital Promotion Staff',
            ],
            'Farm Tourism' => [
                'Visitor Management Staff',
                'Farm Activity Staff',
                'Product Management Staff',
                'Digital Promotion Staff',
            ],
        ];

        foreach ($map as $categoryName => $roleNames) {
            $category = BusinessCategory::where('name', $categoryName)->first();
            if (!$category) {
                $this->command->warn("Business category '{$categoryName}' not found. Skipping.");
                continue;
            }

            $roleIds = StaffRole::whereIn('name', $roleNames)->pluck('id')->toArray();
            $category->staffRoles()->sync($roleIds);
        }
    }
}
