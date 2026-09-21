<?php

namespace Database\Seeders;

use App\Models\StaffRole;
use Illuminate\Database\Seeder;

class StaffRoleSeeder extends Seeder
{
    public function run(): void
    {
        $roles = [
            // Food & Beverage
            ['name' => 'Restaurant Manager', 'description' => 'Manages orders, receives incoming orders, updates order status when rider picks up for delivery'],

            // General
            ['name' => 'Reservation Staff', 'description' => 'Accepts, rejects, and reschedules reservations; assigns tables'],

            // Accommodation (Hotel, Resort, Homestay)
            ['name' => 'Front Desk Manager', 'description' => 'Oversees front desk operations, check-ins, check-outs, and guest services'],
            ['name' => 'Concierge', 'description' => 'Assists guests with reservations, recommendations, and special requests'],
            ['name' => 'Housekeeping Staff', 'description' => 'Cleans and maintains guest rooms and common areas'],
            ['name' => 'Maintenance Staff', 'description' => 'Handles repairs, upkeep, and facility maintenance'],
            ['name' => 'Guest Relations Officer', 'description' => 'Handles guest inquiries, complaints, and ensures satisfaction'],

            // Tour & Travel
            ['name' => 'Travel Consultant', 'description' => 'Assists clients in planning travel itineraries and booking arrangements'],

            // Transport
            ['name' => 'Dispatcher', 'description' => 'Coordinates vehicle assignments and schedules'],

            // Events & Attractions
            ['name' => 'Event Coordinator', 'description' => 'Plans and coordinates events, bookings, and schedules'],
            ['name' => 'Ground Staff', 'description' => 'Assists with on-site operations, guest assistance, and maintenance'],
            ['name' => 'Activities Instructor', 'description' => 'Leads and instructs guests in recreational activities'],

            // Retail (Souvenir Shop)
            ['name' => 'Sales Staff', 'description' => 'Assists customers, processes sales, and manages inventory'],
            ['name' => 'Inventory Staff', 'description' => 'Manages stock levels, ordering, and inventory tracking'],

            // Dive Shop
            ['name' => 'Dive Master', 'description' => 'Assists with dive operations and ensures safety protocols'],

            // TrackTour — Digital Promotion (shared across all categories)
            ['name' => 'Digital Promotion Staff', 'description' => 'Manages online presence, promotional content, images, and advertisements for TrackTour'],

            // TrackTour — Hotel
            ['name' => 'Reservation & Front Desk Staff', 'description' => 'Manages guest reservations, check-in/check-out, room availability, and customer inquiries'],
            ['name' => 'Room Management Staff', 'description' => 'Manages hotel room details, room status, amenities, and room images'],

            // TrackTour — General Facilities
            ['name' => 'Facility Management Staff', 'description' => 'Manages facilities, amenities, schedules, availability status, and maintenance'],

            // TrackTour — Café & Food Hub
            ['name' => 'Order & Payment Staff', 'description' => 'Processes customer orders, confirms payments, generates receipts, and updates order status'],
            ['name' => 'Menu Management Staff', 'description' => 'Maintains menu items, updates prices, manages ingredients, and controls menu availability'],
            ['name' => 'Kitchen / Preparation Staff', 'description' => 'Prepares food and beverage orders, updates preparation status, and marks orders ready'],
            ['name' => 'Food Menu Staff', 'description' => 'Creates food items, manages recipes, ingredients, pricing, availability, and menu information'],

            // TrackTour — Tourist Attraction & Farm
            ['name' => 'Visitor Management Staff', 'description' => 'Manages visitor bookings, schedules, confirmation, and activity reservations'],

            // TrackTour — Tour Guide
            ['name' => 'Tour Booking Staff', 'description' => 'Receives tour requests, confirms schedules, manages tour packages, and communicates with tourists'],
            ['name' => 'Tour Guide Staff', 'description' => 'Conducts tours, manages availability, updates tour status, and provides tour services'],

            // TrackTour — Travel Agency
            ['name' => 'Booking Staff', 'description' => 'Processes bookings, manages schedules, confirms customer requests, and handles payments'],
            ['name' => 'Package Management Staff', 'description' => 'Creates and updates packages, manages pricing, and controls availability'],

            // TrackTour — Souvenir Shop
            ['name' => 'Product Management Staff', 'description' => 'Adds products, updates prices, manages stock availability, and maintains product information'],

            // TrackTour — Transport
            ['name' => 'Booking Coordinator Staff', 'description' => 'Receives transportation bookings, assigns drivers, confirms schedules, and monitors trips'],
            ['name' => 'Driver/Rider Staff', 'description' => 'Accepts assigned trips, updates availability, shares location, and updates trip status'],

            // TrackTour — Dive Shop
            ['name' => 'Dive Instructor Staff', 'description' => 'Conducts diving activities, manages availability, and updates activity status'],
            ['name' => 'Equipment Management Staff', 'description' => 'Tracks equipment availability, updates equipment status, and manages rental information'],

            // TrackTour — Farm Tourism
            ['name' => 'Farm Activity Staff', 'description' => 'Updates activities, availability, schedules, and visitor participation status'],
        ];

        foreach ($roles as $role) {
            StaffRole::updateOrCreate(
                ['name' => $role['name']],
                ['description' => $role['description']]
            );
        }
    }
}
