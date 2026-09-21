<?php

namespace Database\Seeders;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Barangay;
use App\Models\Municipality;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class RestaurantBusinessSeeder extends Seeder
{
    public function run(): void
    {
        $email = 'johnjobertcalapatia@gmail.com';

        // Find or create the business owner user
        $user = User::firstOrCreate(
            ['email' => $email],
            [
                'name' => 'John Jobert Calapatia',
                'password' => Hash::make('password123'),
                'role' => 'business_owner',
                'account_status' => 'approved',
                'email_verified_at' => now(),
            ]
        );

        // Ensure user has business_owner role
        if ($user->role !== 'business_owner') {
            $user->update(['role' => 'business_owner']);
        }

        // Get municipality (Bansud)
        $municipality = Municipality::where('name', 'Bansud')->first();
        if (! $municipality) {
            $this->command?->error('Bansud municipality not found. Run MunicipalitySeeder first.');
            return;
        }

        // Get barangay (Poblacion in Bansud)
        $barangay = Barangay::where('municipality_id', $municipality->id)
            ->where('name', 'Poblacion')
            ->first();

        if (! $barangay) {
            $this->command?->error('Poblacion barangay not found in Bansud. Run BarangaySeeder first.');
            return;
        }

        // Get Restaurant category
        $category = BusinessCategory::where('name', 'Restaurant')->first();
        if (! $category) {
            $this->command?->error('Restaurant category not found. Run BusinessCategorySeeder first.');
            return;
        }

        // Check if business already exists
        $existing = Business::where('owner_id', $user->id)
            ->where('business_name', "John Jobert's Restaurant")
            ->first();

        if ($existing) {
            $this->command?->info("Business already exists with ID: {$existing->id}");
            return;
        }

        // Create the restaurant business
        $business = Business::create([
            'owner_id' => $user->id,
            'business_category_id' => $category->id,
            'municipality_id' => $municipality->id,
            'barangay_id' => $barangay->id,
            'business_name' => "John Jobert's Restaurant",
            'business_description' => 'A cozy restaurant serving delicious Filipino and local Oriental Mindoro cuisine. Fresh seafood, traditional dishes, and warm hospitality await you.',
            'tagline' => 'Taste the flavors of Oriental Mindoro',
            'contact_number' => '+63 912 345 6789',
            'email' => $email,
            'address' => 'Poblacion, Bansud, Oriental Mindoro',
            'latitude' => $municipality->latitude,
            'longitude' => $municipality->longitude,
            'opening_time' => '08:00',
            'closing_time' => '22:00',
            'business_days' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
            'legal_entity_type' => 'Sole Proprietorship',
            'tin' => '123-456-789-000',
            'year_established' => 2024,
            'number_of_employees' => 10,
            'initial_capital' => 500000,
            'gross_floor_area' => 120,
            'occupancy_status' => 'Rented',
            'price_range' => 'moderate',
            'accepts_reservation' => true,
            'status' => 'approved',
        ]);

        // Sync modules from category (menu_management, food_ordering, etc.)
        $business->syncModulesFromCategory();

        $this->command?->info("Restaurant business created successfully!");
        $this->command?->info("Business ID: {$business->id}");
        $this->command?->info("Owner: {$user->email}");
        $this->command?->info("Login credentials: {$user->email} / password123");
    }
}
