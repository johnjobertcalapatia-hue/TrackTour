<?php

namespace Database\Seeders;

use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Barangay;
use App\Models\Municipality;
use App\Models\OfferingCategory;
use App\Models\Offering;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class RestaurantTestSeeder extends Seeder
{
    private array $restaurants = [
        [
            'owner' => [
                'name' => 'Maria Santos',
                'email' => 'maria.santos@example.com',
            ],
            'business' => [
                'business_name' => "Maria's Kitchen",
                'business_description' => 'Authentic Filipino home-cooked meals with a modern twist. Famous for our sinigang and kare-kare.',
                'tagline' => 'Home-style cooking at its finest',
                'contact_number' => '+63 917 123 4567',
                'address' => 'Poblacion, Bansud, Oriental Mindoro',
                'latitude' => 12.8333,
                'longitude' => 121.4500,
                'opening_time' => '06:00',
                'closing_time' => '21:00',
                'price_range' => 'budget',
                'number_of_employees' => 5,
                'initial_capital' => 200000,
                'gross_floor_area' => 80,
                'occupancy_status' => 'Owned',
            ],
            'municipality' => 'Bansud',
            'barangay' => 'Poblacion',
            'categories' => [
                'Rice Meals' => ['Sinigang na Baboy', 'Kare-Kare', 'Bicol Express', 'Adobong Manok', 'Pinakbet'],
                'Ulams' => ['Fried Tilapia', 'Grilled Bangus', 'Paksiw na Isda', 'Giniling na Baboy'],
                'Drinks' => ['Buko Juice', 'Iced Tea', 'Softdrinks', 'Kape Barako'],
                'Desserts' => ['Halo-Halo', 'Leche Flan', 'Bibingka', 'Puto'],
            ],
        ],
        [
            'owner' => [
                'name' => 'Juan Dela Cruz',
                'email' => 'juan.delacruz@example.com',
            ],
            'business' => [
                'business_name' => 'Seaside Grill',
                'business_description' => 'Fresh seafood straight from the ocean. Grilled, fried, or cooked to your liking with a beautiful sea view.',
                'tagline' => 'Ocean to table, fresh every day',
                'contact_number' => '+63 918 234 5678',
                'address' => 'Maligaya, Bongabong, Oriental Mindoro',
                'latitude' => 12.7833,
                'longitude' => 121.4833,
                'opening_time' => '10:00',
                'closing_time' => '23:00',
                'price_range' => 'mid_range',
                'number_of_employees' => 12,
                'initial_capital' => 800000,
                'gross_floor_area' => 150,
                'occupancy_status' => 'Rented',
            ],
            'municipality' => 'Bongabong',
            'barangay' => 'Maligaya',
            'categories' => [
                'Grilled Seafood' => ['Grilled Squid', 'Grilled Shrimp', 'Grilled Tilapia', 'Grilled Boneless Bangus', 'Seafood Platter'],
                'Fried' => ['Fried Chicken', 'Fish and Chips', 'Crispy Pata', 'Lechon Kawali'],
                'Noodles' => ['Pancit Canton', 'Pancit Bihon', 'Sotanghon Soup'],
                'Drinks' => ['Fresh Coconut', 'Mango Shake', 'Calamansi Juice', 'Beer'],
            ],
        ],
        [
            'owner' => [
                'name' => 'Ana Reyes',
                'email' => 'ana.reyes@example.com',
            ],
            'business' => [
                'business_name' => 'Lola’s Carinderia',
                'business_description' => 'Traditional Bulalacao recipes passed down through generations. Affordable, filling, and absolutely delicious.',
                'tagline' => 'Lola\'s secret recipes, now yours',
                'contact_number' => '+63 919 345 6789',
                'address' => 'Centro, Bulalacao, Oriental Mindoro',
                'latitude' => 12.3167,
                'longitude' => 121.3500,
                'opening_time' => '05:30',
                'closing_time' => '20:00',
                'price_range' => 'budget',
                'number_of_employees' => 4,
                'initial_capital' => 150000,
                'gross_floor_area' => 60,
                'occupancy_status' => 'Owned',
            ],
            'municipality' => 'Bulalacao',
            'barangay' => 'Centro',
            'categories' => [
                'Breakfast' => ['Tapsilog', 'Longsilog', 'Bangsilog', 'Cornsilog', 'Chosilog'],
                'Lunch Specials' => ['Kare-Kare', 'Mechado', 'Afritada', 'Menudo', 'Tinola'],
                'Merienda' => ['Turon', 'Banana Cue', 'Kamote Cue', 'Empanada', 'Lumpia Shanghai'],
                'Drinks' => ['Salabat', 'Tsokolate', 'Kape', 'Softdrinks'],
            ],
        ],
        [
            'owner' => [
                'name' => 'Roberto Garcia',
                'email' => 'roberto.garcia@example.com',
            ],
            'business' => [
                'business_name' => 'Garcia\'s BBQ House',
                'business_description' => 'The best grilled meats in Gloria! Inihaw, sisig, and more with our secret marinade.',
                'tagline' => 'Grilled to perfection',
                'contact_number' => '+63 920 456 7890',
                'address' => 'San Ignacio, Gloria, Oriental Mindoro',
                'latitude' => 12.5667,
                'longitude' => 121.4167,
                'opening_time' => '11:00',
                'closing_time' => '22:00',
                'price_range' => 'affordable',
                'number_of_employees' => 8,
                'initial_capital' => 350000,
                'gross_floor_area' => 100,
                'occupancy_status' => 'Rented',
            ],
            'municipality' => 'Gloria',
            'barangay' => 'San Ignacio',
            'categories' => [
                'Inihaw' => ['Pork BBQ', 'Chicken BBQ', 'Isaw', 'Betamax', 'Adidas', 'Hotdog'],
                'Sizzling' => ['Sisig', 'Sizzling Squid', 'Sizzling Tofu', 'Bulalog Sisig'],
                'Pulutan' => ['Kinilaw', 'Longganisa', 'Chicharon', 'Ensaladang Talong'],
                'Drinks' => ['Beer', 'Softdrinks', 'Buko Juice', 'Calamansi Juice'],
            ],
        ],
        [
            'owner' => [
                'name' => 'Elena Mendoza',
                'email' => 'elena.mendoza@example.com',
            ],
            'business' => [
                'business_name' => 'Mindoro Flavors',
                'business_description' => 'A fusion restaurant blending traditional Mangyan flavors with contemporary cuisine. Experience the taste of Mindoro.',
                'tagline' => 'Where tradition meets innovation',
                'contact_number' => '+63 921 567 8901',
                'address' => 'Poblacion, Mansalay, Oriental Mindoro',
                'latitude' => 12.5167,
                'longitude' => 121.4333,
                'opening_time' => '07:00',
                'closing_time' => '22:00',
                'price_range' => 'mid_range',
                'number_of_employees' => 15,
                'initial_capital' => 1000000,
                'gross_floor_area' => 200,
                'occupancy_status' => 'Owned',
            ],
            'municipality' => 'Mansalay',
            'barangay' => 'Poblacion',
            'categories' => [
                'Signature Dishes' => ['Mangyan Rice Bowl', 'Mindoro Seafood Paella', 'Forest Herb Chicken', 'Wild Vine Salad'],
                'Classics' => ['Sinigang na Hipon', 'Laing', 'Ginataang Kalabasa', 'Nilagang Baka'],
                'Rice & Noodles' => ['Garlic Rice', 'Pancit Malabon', 'Arroz Caldo', 'Champorado'],
                'Beverages' => ['Tablea Tsokolate', 'Tuba', 'Lambanog', 'Fresh Juices'],
                'Desserts' => ['Biko', 'Cassava Cake', 'Maja Blanca', 'Espasol'],
            ],
        ],
    ];

    public function run(): void
    {
        $restaurantCategory = BusinessCategory::where('name', 'Restaurant')->first();
        if (! $restaurantCategory) {
            $this->command?->error('Restaurant category not found. Run BusinessCategorySeeder first.');
            return;
        }

        foreach ($this->restaurants as $data) {
            $municipality = Municipality::where('name', $data['municipality'])->first();
            if (! $municipality) {
                $this->command?->warn("Municipality '{$data['municipality']}' not found, skipping.");
                continue;
            }

            $barangay = Barangay::where('municipality_id', $municipality->id)
                ->where('name', $data['barangay'])
                ->first();

            $user = User::firstOrCreate(
                ['email' => $data['owner']['email']],
                [
                    'name' => $data['owner']['name'],
                    'password' => Hash::make('password123'),
                    'role' => 'business_owner',
                    'account_status' => 'approved',
                    'municipality_id' => $municipality->id,
                    'email_verified_at' => now(),
                ]
            );

            if ($user->role !== 'business_owner') {
                $user->update(['role' => 'business_owner']);
            }

            $existing = Business::where('owner_id', $user->id)
                ->where('business_name', $data['business']['business_name'])
                ->first();

            if ($existing) {
                $this->command?->info("Business '{$data['business']['business_name']}' already exists (ID: {$existing->id}).");
                continue;
            }

            $business = Business::create([
                'owner_id' => $user->id,
                'business_category_id' => $restaurantCategory->id,
                'municipality_id' => $municipality->id,
                'barangay_id' => $barangay?->id,
                'business_name' => $data['business']['business_name'],
                'business_description' => $data['business']['business_description'],
                'tagline' => $data['business']['tagline'],
                'contact_number' => $data['business']['contact_number'],
                'email' => $data['owner']['email'],
                'address' => $data['business']['address'],
                'latitude' => $data['business']['latitude'],
                'longitude' => $data['business']['longitude'],
                'opening_time' => $data['business']['opening_time'],
                'closing_time' => $data['business']['closing_time'],
                'business_days' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
                'legal_entity_type' => 'Sole Proprietorship',
                'tin' => '123-456-789-000',
                'year_established' => rand(2018, 2025),
                'number_of_employees' => $data['business']['number_of_employees'],
                'initial_capital' => $data['business']['initial_capital'],
                'gross_floor_area' => $data['business']['gross_floor_area'],
                'occupancy_status' => $data['business']['occupancy_status'],
                'price_range' => $data['business']['price_range'],
                'accepts_reservation' => true,
                'status' => 'approved',
            ]);

            $business->syncModulesFromCategory();

            $sortOrder = 0;
            foreach ($data['categories'] as $catName => $items) {
                $offeringCategory = OfferingCategory::create([
                    'business_id' => $business->id,
                    'name' => $catName,
                    'sort_order' => $sortOrder++,
                    'is_available' => true,
                ]);

                foreach ($items as $i => $itemName) {
                    $price = $this->getPrice($catName, $data['business']['price_range']);
                    $hasVariations = in_array($itemName, ['Seafood Platter', 'Pork BBQ', 'Chicken BBQ']);

                    $offering = Offering::create([
                        'business_id' => $business->id,
                        'offering_category_id' => $offeringCategory->id,
                        'name' => $itemName,
                        'description' => "Freshly prepared {$itemName}",
                        'price' => $price,
                        'is_available' => true,
                        'status' => 'active',
                        'bestseller' => $i < 2,
                        'has_variations' => $hasVariations,
                        'sort_order' => $i,
                        'type' => 'food',
                        'offering_type' => 'food',
                    ]);

                    if ($hasVariations) {
                        $this->createVariations($offering, $price);
                    }
                }
            }

            $this->command?->info("Created: {$business->business_name} ({$data['owner']['email']})");
        }

        $this->command?->info('All restaurant test data seeded successfully!');
    }

    private function getPrice(string $category, string $priceRange): float
    {
        $basePrices = [
            'Rice Meals' => [65, 85, 120],
            'Ulams' => [55, 75, 95],
            'Drinks' => [15, 25, 40],
            'Desserts' => [25, 35, 50],
            'Grilled Seafood' => [80, 120, 180],
            'Fried' => [70, 100, 150],
            'Noodles' => [50, 70, 90],
            'Breakfast' => [45, 65, 85],
            'Lunch Specials' => [55, 75, 100],
            'Merienda' => [15, 25, 40],
            'Inihaw' => [15, 25, 40],
            'Sizzling' => [80, 120, 160],
            'Pulutan' => [50, 80, 120],
            'Signature Dishes' => [120, 180, 250],
            'Classics' => [65, 95, 130],
            'Rice & Noodles' => [30, 50, 70],
            'Beverages' => [20, 35, 60],
        ];

        $prices = $basePrices[$category] ?? [50, 80, 120];
        $index = match ($priceRange) {
            'budget' => 0,
            'affordable' => 0,
            'mid_range' => 1,
            'premium' => 2,
            'luxury' => 2,
            default => 1,
        };

        return (float) $prices[$index] + rand(-10, 15);
    }

    private function createVariations(Offering $offering, float $basePrice): void
    {
        $variations = match (true) {
            str_contains($offering->name, 'Platter') => [
                ['name' => 'Regular (2-3 pax)', 'price' => $basePrice],
                ['name' => 'Family (4-6 pax)', 'price' => $basePrice * 1.8],
                ['name' => 'Barkada (7-10 pax)', 'price' => $basePrice * 2.5],
            ],
            str_contains($offering->name, 'BBQ') => [
                ['name' => 'Regular (3 pcs)', 'price' => $basePrice],
                ['name' => 'Extra (5 pcs)', 'price' => $basePrice * 1.6],
                ['name' => 'Bilao (10 pcs)', 'price' => $basePrice * 3],
            ],
            default => [
                ['name' => 'Solo', 'price' => $basePrice],
                ['name' => 'Sharing (2-3 pax)', 'price' => $basePrice * 2],
            ],
        };

        foreach ($variations as $i => $v) {
            $offering->variations()->create([
                'name' => $v['name'],
                'price' => $v['price'],
                'is_available' => true,
                'sort_order' => $i,
            ]);
        }
    }
}
