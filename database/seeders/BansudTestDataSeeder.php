<?php

namespace Database\Seeders;

use App\Models\Barangay;
use App\Models\Business;
use App\Models\BusinessCategory;
use App\Models\Municipality;
use App\Models\Offering;
use App\Models\OfferingCategory;
use App\Models\User;
use App\Models\UserProfile;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

/**
 * Test accounts + complete data for TrackTour's Bansud business/attraction
 * registry. Creates one approved business_owner account per entity so each
 * establishment/spot can be managed and tested through the owner UI.
 *
 * Restaurants          -> businesses (category 'Restaurant') + menu + details
 * Tourist spots/farms  -> businesses (category 'Tourist Attraction') + details
 */
class BansudTestDataSeeder extends Seeder
{
    private const MUNICIPALITY = 'Bansud';

    private const PASSWORD = 'password123';

    private \App\Models\Municipality $municipality;

    private \App\Models\BusinessCategory $restaurantCategory;

    private \App\Models\BusinessCategory $attractionCategory;

    /** @var array<string, \App\Models\Barangay> */
    private array $barangays = [];

    /**
     * Restaurant test data: owner account + business record + menu.
     */
    private array $restaurants = [
        [
            'owner' => [
                'name' => 'Carlo Eksklusibo',
                'email' => 'eksklusibo.grill@bansud.test',
                'first_name' => 'Carlo',
                'last_name' => 'Eksklusibo',
                'mobile_number' => '+63 917 555 0101',
            ],
            'business' => [
                'business_name' => 'Eksklusibo Grill & Restaurant',
                'business_description' => 'Bansud\'s destination for charcoal-grilled Filipino specialties and fresh seafood. Famous for our inihaw platters, sizzling sisig, and cold drinks in a laid-back family dining space.',
                'tagline' => 'Grill, sizzle, and enjoy',
                'contact_number' => '+63 917 555 0101',
                'address' => 'National Road, Poblacion, Bansud, Oriental Mindoro',
                'landmark' => 'Beside Bansud Municipal Plaza',
                'latitude' => 12.8650000,
                'longitude' => 121.4565000,
                'opening_time' => '10:00',
                'closing_time' => '22:00',
                'price_range' => 'mid_range',
                'legal_entity_type' => 'Sole Proprietorship',
                'tin' => '123-456-789-101',
                'year_established' => 2018,
                'number_of_employees' => 14,
                'initial_capital' => 700000,
                'gross_floor_area' => 180,
                'occupancy_status' => 'Rented',
                'business_size' => 'small',
                'postal_code' => '5210',
            ],
            'category' => 'Restaurant',
            'barangay' => 'Poblacion',
            'details' => [
                'seating_capacity' => '60',
                'service_type' => 'Casual Dining',
                'cuisine_type' => 'Filipino, Seafood, Grilled',
                'dining_facilities' => 'Indoor Dining, Outdoor Dining, Bar Area',
                'available_services' => 'Dine-in, Take-out, Delivery, Catering, Reservation',
            ],
            'menu' => [
                'Grilled Specialties' => [
                    'Pork BBQ (3 pcs)' => 65,
                    'Chicken Inasal' => 120,
                    'Grilled Liempo' => 95,
                    'Grilled Squid' => 180,
                    'Inihaw na Pusit Platter' => 250,
                ],
                'Sizzling & Rice Meals' => [
                    'Sizzling Sisig' => 130,
                    'Sizzling Bangus Sisig' => 140,
                    'Chicken Inasal Rice Meal' => 135,
                    'Pork BBQ Rice Meal' => 120,
                    'Seafood Rice Meal' => 165,
                ],
                'Drinks & Shakes' => [
                    'Buko Juice' => 40,
                    'Mango Shake' => 55,
                    'Calamansi Juice' => 35,
                    'Iced Tea' => 30,
                    'Softdrinks' => 25,
                ],
                'Desserts' => [
                    'Halo-Halo' => 60,
                    'Leche Flan' => 50,
                    'Turon (2 pcs)' => 30,
                ],
            ],
        ],
        [
            'owner' => [
                'name' => 'Angela Green Thumb',
                'email' => 'greenthumb.restobar@bansud.test',
                'first_name' => 'Angela',
                'last_name' => 'Green',
                'mobile_number' => '+63 917 555 0102',
            ],
            'business' => [
                'business_name' => 'Green Thumb Restobar',
                'business_description' => 'A lively restobar at the heart of Bansud pairing mouthwatering grilled and sizzling pulutan with cold beers, cocktails, and weekend live acoustic entertainment.',
                'tagline' => 'Good food, cold drinks, great vibes',
                'contact_number' => '+63 917 555 0102',
                'address' => 'Poblacion, Bansud, Oriental Mindoro',
                'landmark' => 'Near Bansud Public Market',
                'latitude' => 12.8663000,
                'longitude' => 121.4550000,
                'opening_time' => '16:00',
                'closing_time' => '02:00',
                'price_range' => 'mid_range',
                'legal_entity_type' => 'Sole Proprietorship',
                'tin' => '123-456-789-102',
                'year_established' => 2020,
                'number_of_employees' => 10,
                'initial_capital' => 500000,
                'gross_floor_area' => 140,
                'occupancy_status' => 'Rented',
                'business_size' => 'small',
                'postal_code' => '5210',
            ],
            'category' => 'Restaurant',
            'barangay' => 'Poblacion',
            'details' => [
                'seating_capacity' => '50',
                'service_type' => 'Casual Dining',
                'cuisine_type' => 'Filipino, Grill, Bar Food',
                'dining_facilities' => 'Indoor Dining, Bar Area, Function Area',
                'available_services' => 'Dine-in, Take-out, Reservation',
            ],
            'menu' => [
                'Restobar Classics' => [
                    'Sizzling Sisig' => 140,
                    'Crispy Pata' => 320,
                    'Chicken Wings (6 pcs)' => 180,
                    'Nachos with Cheese' => 95,
                    'French Fries' => 70,
                ],
                'Grill & Inihaw' => [
                    'Pork BBQ (3 pcs)' => 70,
                    'Chicken BBQ (2 pcs)' => 90,
                    'Isaw (3 pcs)' => 35,
                    'Bicol Express' => 95,
                ],
                'Rice & Combos' => [
                    'Pork BBQ Rice' => 120,
                    'Sisig Rice' => 145,
                    'Beef Tapa Rice' => 135,
                    'Garlic Rice' => 40,
                ],
                'Drinks & Beer' => [
                    'San Miguel Pale Pilsen' => 65,
                    'Red Horse Beer' => 75,
                    'Bar Cocktails' => 120,
                    'Buko Juice' => 45,
                    'Softdrinks (bottled)' => 30,
                ],
            ],
        ],
    ];

    /**
     * Tourist spot/attraction test data: owner account + business record + details.
     */
    private array $attractions = [
        [
            'owner' => [
                'name' => 'Bansud Municipal Park',
                'email' => 'park.plaza@bansud.test',
                'first_name' => 'Bansud',
                'last_name' => 'Park & Plaza',
                'mobile_number' => '+63 917 555 0103',
            ],
            'business' => [
                'business_name' => 'Bansud Municipal Park and Plaza',
                'business_description' => 'The town\'s central open park and plaza fronting the Bansud Municipal Hall. A favorite spot for jogging, family picnics, nightly tambay, and town events celebrated around the bandstand and heritage lamp posts.',
                'tagline' => 'The heart of Bansud',
                'contact_number' => '+63 917 555 0103',
                'address' => 'Poblacion, Bansud, Oriental Mindoro',
                'landmark' => 'Fronting Bansud Municipal Hall',
                'latitude' => 12.8654000,
                'longitude' => 121.4570000,
                'opening_time' => '05:00',
                'closing_time' => '21:00',
                'price_range' => 'budget',
                'legal_entity_type' => 'Government Unit / LGU',
                'tin' => '000-000-000-000',
                'year_established' => 1990,
                'number_of_employees' => 4,
                'initial_capital' => 0,
                'gross_floor_area' => 15000,
                'occupancy_status' => 'Owned',
                'business_size' => 'small',
                'postal_code' => '5210',
            ],
            'category' => 'Tourist Attraction',
            'barangay' => 'Poblacion',
            'details' => [
                'attraction_type' => 'Park',
                'entrance_fee' => '0',
                'best_time_to_visit' => 'Every day, best in the late afternoon and evenings',
                'activities' => 'Jogging, Picnic, Sightseeing, Local Events',
            ],
        ],
        [
            'owner' => [
                'name' => 'Bansud Museum',
                'email' => 'bansud.museum@bansud.test',
                'first_name' => 'Bansud',
                'last_name' => 'Museum',
                'mobile_number' => '+63 917 555 0104',
            ],
            'business' => [
                'business_name' => 'Bansud Museum',
                'business_description' => 'A heritage showcase of Bansud\'s history, culture, and Mangyan heritage. Displays historical photographs, local artifacts, farming tools, and memorabilia that tell the story of the town from its founding to the present.',
                'tagline' => 'Treasuring Bansud\'s heritage',
                'contact_number' => '+63 917 555 0104',
                'address' => 'Poblacion, Bansud, Oriental Mindoro',
                'landmark' => 'Inside Bansud Municipal Compound',
                'latitude' => 12.8657000,
                'longitude' => 121.4578000,
                'opening_time' => '08:00',
                'closing_time' => '17:00',
                'price_range' => 'budget',
                'legal_entity_type' => 'Government Unit / LGU',
                'tin' => '000-000-000-000',
                'year_established' => 2015,
                'number_of_employees' => 3,
                'initial_capital' => 0,
                'gross_floor_area' => 300,
                'occupancy_status' => 'Owned',
                'business_size' => 'small',
                'postal_code' => '5210',
            ],
            'category' => 'Tourist Attraction',
            'barangay' => 'Poblacion',
            'details' => [
                'attraction_type' => 'Cultural Site',
                'entrance_fee' => '20',
                'best_time_to_visit' => 'Weekdays 8:00 AM - 5:00 PM',
                'activities' => 'Museum Tour, History & Culture Learning, Photo Ops',
            ],
        ],
        [
            'owner' => [
                'name' => 'Bato Viewing Hills',
                'email' => 'bato.viewinghills@bansud.test',
                'first_name' => 'Bato',
                'last_name' => 'Viewing Hills',
                'mobile_number' => '+63 917 555 0105',
            ],
            'business' => [
                'business_name' => 'Bato Viewing Hills',
                'business_description' => 'A scenic ridge in Barangay Bato offering a sweeping panorama of Bansud town, the coconut plains, and the Tablas Strait towards the horizon. A popular sunrise and sunset viewpoint with cool hill breezes.',
                'tagline' => 'A view above the coconut seas',
                'contact_number' => '+63 917 555 0105',
                'address' => 'Barangay Bato, Bansud, Oriental Mindoro',
                'landmark' => 'Sitio View Deck, Barangay Bato',
                'latitude' => 12.9025000,
                'longitude' => 121.4750000,
                'opening_time' => '05:00',
                'closing_time' => '18:00',
                'price_range' => 'budget',
                'legal_entity_type' => 'Government Unit / LGU',
                'tin' => '000-000-000-000',
                'year_established' => 2012,
                'number_of_employees' => 2,
                'initial_capital' => 0,
                'gross_floor_area' => 80000,
                'occupancy_status' => 'Owned',
                'business_size' => 'micro',
                'postal_code' => '5210',
            ],
            'category' => 'Tourist Attraction',
            'barangay' => 'Bato',
            'details' => [
                'attraction_type' => 'Viewpoint',
                'entrance_fee' => '20',
                'best_time_to_visit' => 'Early morning sunrise and late afternoon',
                'activities' => 'Hiking, Sightseeing, Photography, Sunrise Watching',
            ],
        ],
        [
            'owner' => [
                'name' => 'Batong Buwaya River',
                'email' => 'batong.buwaya@bansud.test',
                'first_name' => 'Batong Buwaya',
                'last_name' => 'River',
                'mobile_number' => '+63 917 555 0106',
            ],
            'business' => [
                'business_name' => 'Batong Buwaya River',
                'business_description' => 'A cool mountain-fed river named after a crocodile-shaped rock that rests along its banks. Clean, shallow pools make it a favorite family spot for swimming, river trekking, and picnics under the bamboo shade.',
                'tagline' => 'Where the crocodile rock sleeps',
                'contact_number' => '+63 917 555 0106',
                'address' => 'Barangay Bato, Bansud, Oriental Mindoro',
                'landmark' => 'Upper stream past Sitio Batong Buwaya',
                'latitude' => 12.8900000,
                'longitude' => 121.4680000,
                'opening_time' => '07:00',
                'closing_time' => '17:00',
                'price_range' => 'budget',
                'legal_entity_type' => 'Government Unit / LGU',
                'tin' => '000-000-000-000',
                'year_established' => 2010,
                'number_of_employees' => 2,
                'initial_capital' => 0,
                'gross_floor_area' => 50000,
                'occupancy_status' => 'Owned',
                'business_size' => 'micro',
                'postal_code' => '5210',
            ],
            'category' => 'Tourist Attraction',
            'barangay' => 'Bato',
            'details' => [
                'attraction_type' => 'Nature',
                'entrance_fee' => '0',
                'best_time_to_visit' => 'Morning to early afternoon, avoid after heavy rain',
                'activities' => 'Swimming, River Trekking, Picnic, Nature Watching',
            ],
        ],
        [
            'owner' => [
                'name' => 'Manihala Waterfalls',
                'email' => 'manihala.falls@bansud.test',
                'first_name' => 'Manihala',
                'last_name' => 'Waterfalls',
                'mobile_number' => '+63 917 555 0107',
            ],
            'business' => [
                'business_name' => 'Manihala Waterfalls',
                'business_description' => 'A multi-tier cascade tucked in the forests of Barangay Manihala. Crystal-clear water drops into natural catch basins perfect for a refreshing dip, surrounded by limestone cliffs and tropical greenery.',
                'tagline' => 'Nature\'s hidden cascade',
                'contact_number' => '+63 917 555 0107',
                'address' => 'Barangay Manihala, Bansud, Oriental Mindoro',
                'landmark' => 'Sitio Manihala Falls Trail',
                'latitude' => 12.8310000,
                'longitude' => 121.3920000,
                'opening_time' => '07:00',
                'closing_time' => '16:00',
                'price_range' => 'budget',
                'legal_entity_type' => 'Government Unit / LGU',
                'tin' => '000-000-000-000',
                'year_established' => 2008,
                'number_of_employees' => 2,
                'initial_capital' => 0,
                'gross_floor_area' => 30000,
                'occupancy_status' => 'Owned',
                'business_size' => 'micro',
                'postal_code' => '5210',
            ],
            'category' => 'Tourist Attraction',
            'barangay' => 'Manihala',
            'details' => [
                'attraction_type' => 'Waterfall',
                'entrance_fee' => '30',
                'best_time_to_visit' => 'Dry season, 7:00 AM - 4:00 PM',
                'activities' => 'Swimming, Hiking, Picnic, Photography',
            ],
        ],
        [
            'owner' => [
                'name' => 'Paypay Ama Waterfalls',
                'email' => 'paypayama.falls@bansud.test',
                'first_name' => 'Paypay Ama',
                'last_name' => 'Waterfalls',
                'mobile_number' => '+63 917 555 0108',
            ],
            'business' => [
                'business_name' => 'Paypay Ama Waterfalls',
                'business_description' => 'A tall, slender waterfall celebrated locally for its fan-like spray and deep refreshing basin. The short jungle trek to the falls is rewarded with a serene, almost-private swimming spot.',
                'tagline' => 'The fan-shaped falls of Bansud',
                'contact_number' => '+63 917 555 0108',
                'address' => 'Barangay Manihala, Bansud, Oriental Mindoro',
                'landmark' => 'Paypay Ama Buhay Falls Trail',
                'latitude' => 12.8450000,
                'longitude' => 121.4050000,
                'opening_time' => '07:00',
                'closing_time' => '16:00',
                'price_range' => 'budget',
                'legal_entity_type' => 'Government Unit / LGU',
                'tin' => '000-000-000-000',
                'year_established' => 2011,
                'number_of_employees' => 2,
                'initial_capital' => 0,
                'gross_floor_area' => 20000,
                'occupancy_status' => 'Owned',
                'business_size' => 'micro',
                'postal_code' => '5210',
            ],
            'category' => 'Tourist Attraction',
            'barangay' => 'Manihala',
            'details' => [
                'attraction_type' => 'Waterfall',
                'entrance_fee' => '30',
                'best_time_to_visit' => 'Dry season, 7:00 AM - 4:00 PM',
                'activities' => 'Swimming, Trekking, Picnic, Photography',
            ],
        ],
        [
            'owner' => [
                'name' => 'Rosacara Rolling Hills',
                'email' => 'rosacara.hills@bansud.test',
                'first_name' => 'Rosacara',
                'last_name' => 'Rolling Hills',
                'mobile_number' => '+63 917 555 0109',
            ],
            'business' => [
                'business_name' => 'Rosacara Rolling Hills',
                'business_description' => 'Wave after wave of green rolling hills that stretch to the coast. A breathtaking landscape famous for its undulating grasslands, grazing carabaos, and one of Bansud\'s most Instagram-worthy sunsets.',
                'tagline' => 'A sea of green hills',
                'contact_number' => '+63 917 555 0109',
                'address' => 'Barangay Rosacara, Bansud, Oriental Mindoro',
                'landmark' => 'Rosacara Hills Lookout',
                'latitude' => 12.8780000,
                'longitude' => 121.4120000,
                'opening_time' => '05:30',
                'closing_time' => '18:00',
                'price_range' => 'budget',
                'legal_entity_type' => 'Government Unit / LGU',
                'tin' => '000-000-000-000',
                'year_established' => 2013,
                'number_of_employees' => 2,
                'initial_capital' => 0,
                'gross_floor_area' => 100000,
                'occupancy_status' => 'Owned',
                'business_size' => 'micro',
                'postal_code' => '5210',
            ],
            'category' => 'Tourist Attraction',
            'barangay' => 'Rosacara',
            'details' => [
                'attraction_type' => 'Viewpoint',
                'entrance_fee' => '20',
                'best_time_to_visit' => 'Sunrise and golden-hour sunset',
                'activities' => 'Hiking, Sightseeing, Photography, Picnic',
            ],
        ],
        [
            'owner' => [
                'name' => 'Sunken Cemetery',
                'email' => 'sunken.cemetery@bansud.test',
                'first_name' => 'Sunken',
                'last_name' => 'Cemetery',
                'mobile_number' => '+63 917 555 0110',
            ],
            'business' => [
                'business_name' => 'Sunken Cemetery',
                'business_description' => 'An old coastal burial ground slowly reclaimed by the sea. The weathered stone markers standing in the shallow tidal flats tell a haunting story of Bansud\'s shoreline, best visited at low tide and at dusk.',
                'tagline' => 'Bansud\'s tide-swallowed landmark',
                'contact_number' => '+63 917 555 0110',
                'address' => 'Coastal Road, Poblacion, Bansud, Oriental Mindoro',
                'landmark' => 'Shoreline behind Poblacion seawall',
                'latitude' => 12.8600000,
                'longitude' => 121.4620000,
                'opening_time' => '06:00',
                'closing_time' => '18:00',
                'price_range' => 'budget',
                'legal_entity_type' => 'Government Unit / LGU',
                'tin' => '000-000-000-000',
                'year_established' => 1985,
                'number_of_employees' => 1,
                'initial_capital' => 0,
                'gross_floor_area' => 15000,
                'occupancy_status' => 'Owned',
                'business_size' => 'micro',
                'postal_code' => '5210',
            ],
            'category' => 'Tourist Attraction',
            'barangay' => 'Poblacion',
            'details' => [
                'attraction_type' => 'Historical Site',
                'entrance_fee' => '0',
                'best_time_to_visit' => 'Low tide, late afternoon',
                'activities' => 'Sightseeing, History Tour, Photography',
            ],
        ],
    ];

    public function run(): void
    {
        $this->municipality = Municipality::where('name', self::MUNICIPALITY)->firstOrFail();

        $this->restaurantCategory = BusinessCategory::where('name', 'Restaurant')->firstOrFail();
        $this->attractionCategory = BusinessCategory::where('name', 'Tourist Attraction')->firstOrFail();

        $barangayNames = array_unique(array_merge(
            array_column($this->restaurants, 'barangay'),
            array_column($this->attractions, 'barangay')
        ));

        foreach ($barangayNames as $name) {
            $barangay = Barangay::where('municipality_id', $this->municipality->id)
                ->where('name', $name)
                ->first();

            if ($barangay) {
                $this->barangays[$name] = $barangay;
            }
        }

        foreach ($this->restaurants as $data) {
            $this->createRestaurant($data);
        }

        foreach ($this->attractions as $data) {
            $this->createAttraction($data);
        }

        $this->command?->info('Bansud test data seeded successfully.');
    }

    private function createRestaurant(array $data): void
    {
        $business = $this->createBusiness($data, $this->restaurantCategory);

        $this->ensureDetails($business, $data['details']);

        if ($business->offerings()->exists()) {
            $this->command?->info("Restaurant '$business->business_name' menu already present.");

            return;
        }

        $sortOrder = 0;
        foreach ($data['menu'] as $categoryName => $items) {
            $category = OfferingCategory::create([
                'business_id' => $business->id,
                'name' => $categoryName,
                'sort_order' => $sortOrder++,
                'is_available' => true,
            ]);

            foreach ($items as $itemName => $price) {
                Offering::create([
                    'business_id' => $business->id,
                    'offering_category_id' => $category->id,
                    'name' => $itemName,
                    'description' => "Freshly prepared {$itemName}",
                    'price' => $price,
                    'is_available' => true,
                    'status' => 'available',
                    'bestseller' => false,
                    'sort_order' => 0,
                    'type' => 'food',
                    'offering_type' => 'food',
                ]);
            }
        }

        $this->command?->info("Created restaurant: {$business->business_name} ({$data['owner']['email']})");
    }

    private function createAttraction(array $data): void
    {
        $business = $this->createBusiness($data, $this->attractionCategory);

        $this->ensureDetails($business, $data['details']);

        $this->command?->info("Created attraction: {$business->business_name} ({$data['owner']['email']})");
    }

    private function createBusiness(array $data, BusinessCategory $category): Business
    {
        $ownerData = $data['owner'];
        $businessData = $data['business'];

        $user = User::firstOrCreate(
            ['email' => $ownerData['email']],
            [
                'name' => $ownerData['name'],
                'password' => Hash::make(self::PASSWORD),
                'role' => 'business_owner',
                'account_status' => 'approved',
                'municipality_id' => $this->municipality->id,
                'email_verified_at' => now(),
            ]
        );

        if ($user->role !== 'business_owner') {
            $user->update(['role' => 'business_owner']);
        }

        UserProfile::updateOrCreate(
            ['user_id' => $user->id],
            [
                'first_name' => $ownerData['first_name'] ?? $ownerData['name'],
                'last_name' => $ownerData['last_name'] ?? $ownerData['name'],
                'mobile_number' => $ownerData['mobile_number'] ?? null,
                'municipality_id' => $this->municipality->id,
            ]
        );

        $existing = Business::withTrashed()
            ->where('owner_id', $user->id)
            ->where('business_name', $businessData['business_name'])
            ->first();

        if ($existing) {
            $this->command?->info("Business '{$businessData['business_name']}' already exists (ID: {$existing->id}).");

            return $existing;
        }

        $barangay = $this->barangays[$data['barangay']] ?? null;

        $business = Business::create(array_merge(
            [
                'owner_id' => $user->id,
                'business_category_id' => $category->id,
                'municipality_id' => $this->municipality->id,
                'barangay_id' => $barangay?->id,
                'email' => $user->email,
                'business_days' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
                'business_hours' => $this->businessHours($businessData['opening_time'], $businessData['closing_time']),
                'accepts_reservation' => true,
                'reservation_required' => false,
                'force_closed' => false,
                'status' => 'approved',
                'facilities' => ['Parking', 'Bathroom', 'Wi-Fi'],
                'services' => ['Accept Cash', 'Accept GCash'],
                'payment_methods' => ['cash', 'gcash'],
                'signature_dishes' => [],
                'popularity_score' => 0,
                'booking_count' => 0,
                'favorite_count' => 0,
                'review_count' => 0,
                'average_rating' => 0,
            ],
            $businessData
        ));

        $business->syncModulesFromCategory();

        return $business;
    }

    private function ensureDetails(Business $business, array $details): void
    {
        $existingKeys = $business->details()->pluck('field_name')->all();

        $missing = collect($details)
            ->reject(fn ($value, $key) => in_array($key, $existingKeys, true))
            ->map(fn ($value, $key) => [
                'field_name' => $key,
                'field_value' => (string) $value,
            ])
            ->values()
            ->all();

        if (! empty($missing)) {
            $business->details()->createMany($missing);
        }
    }

    private function businessHours(string $open, string $close): array
    {
        $days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

        $hours = [];
        foreach ($days as $day) {
            $hours[$day] = [['open' => $open, 'close' => $close]];
        }

        return $hours;
    }
}