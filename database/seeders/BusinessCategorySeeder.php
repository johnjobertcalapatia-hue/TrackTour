<?php

namespace Database\Seeders;

use App\Models\BusinessCategory;
use Illuminate\Database\Seeder;

class BusinessCategorySeeder extends Seeder
{
    public function run(): void
    {
        $categories = [
            ['name' => 'Hotel', 'description' => 'Hotel accommodation services'],
            ['name' => 'Resort', 'description' => 'Resort and leisure accommodation'],
            ['name' => 'Hotel & Restaurant Combination', 'description' => 'Combined hotel and restaurant services'],
            ['name' => 'Restaurant', 'description' => 'Food and beverage services'],
            ['name' => 'Café', 'description' => 'Coffee shop and light meals'],
            ['name' => 'Food Hub', 'description' => 'Multi-vendor food establishment'],
            ['name' => 'Tourist Attraction', 'description' => 'Tourist spots and destinations'],
            ['name' => 'Tour Guide', 'description' => 'Guided tour services'],
            ['name' => 'Travel Agency', 'description' => 'Travel and tour packages'],
            ['name' => 'Souvenir Shop', 'description' => 'Gifts, souvenirs, and local products'],
            ['name' => 'Transport Service', 'description' => 'Transportation and shuttle services'],
            ['name' => 'Homestay', 'description' => 'Home-based accommodation'],
            ['name' => 'Camping Site', 'description' => 'Camping grounds and outdoor accommodation'],
            ['name' => 'Dive Shop', 'description' => 'Diving equipment and tours'],
            ['name' => 'Event Venue', 'description' => 'Event and function venue rentals'],
            ['name' => 'Farm Tourism', 'description' => 'Agricultural tourism experiences'],
        ];

        foreach ($categories as $category) {
            BusinessCategory::firstOrCreate(
                ['name' => $category['name']],
                ['description' => $category['description']]
            );
        }
    }
}
