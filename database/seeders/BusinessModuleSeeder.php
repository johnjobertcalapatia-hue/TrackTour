<?php

namespace Database\Seeders;

use App\Models\BusinessCategory;
use App\Models\BusinessModule;
use Illuminate\Database\Seeder;

class BusinessModuleSeeder extends Seeder
{
    public function run(): void
    {
        $modules = [
            ['code' => 'business_profile', 'name' => 'Business Profile', 'icon' => 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4', 'route_prefix' => 'business-owner.businesses.manage.edit'],
            ['code' => 'staff_management', 'name' => 'Staff Management', 'icon' => 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z', 'route_prefix' => 'business-owner.staff.index'],
            ['code' => 'promotions', 'name' => 'Promotions', 'icon' => 'M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z', 'route_prefix' => 'business-owner.promotions.index'],
            ['code' => 'customer_reviews', 'name' => 'Customer Reviews', 'icon' => 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z', 'route_prefix' => '#'],
            ['code' => 'reports', 'name' => 'Reports', 'icon' => 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', 'route_prefix' => 'business-owner.reports.sales'],
            ['code' => 'expenses', 'name' => 'Vendor & Expenses', 'icon' => 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', 'route_prefix' => 'business-owner.expenses'],

            // Restaurant / Café modules
            ['code' => 'menu_management', 'name' => 'Menu Management', 'icon' => 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', 'route_prefix' => 'business-owner.menu'],
            ['code' => 'food_categories', 'name' => 'Food Categories', 'icon' => 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10', 'route_prefix' => 'business-owner.offerings.categories'],
            ['code' => 'inventory', 'name' => 'Inventory', 'icon' => 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', 'route_prefix' => 'business-owner.offerings.index'],
            ['code' => 'food_ordering', 'name' => 'Food Ordering', 'icon' => 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01', 'route_prefix' => 'business-owner.orders'],
            ['code' => 'delivery_management', 'name' => 'Delivery Management', 'icon' => 'M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0', 'route_prefix' => 'business-owner.orders.delivery'],
            ['code' => 'pickup_orders', 'name' => 'Pickup Orders', 'icon' => 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z', 'route_prefix' => 'business-owner.orders'],
            ['code' => 'table_reservations', 'name' => 'Table Reservations', 'icon' => 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', 'route_prefix' => 'business-owner.bookings.calendar'],
            ['code' => 'pos_sales', 'name' => 'POS & Sales', 'icon' => 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 7l2 2 4-4', 'route_prefix' => 'business-owner.pos'],
            ['code' => 'table_management', 'name' => 'Table Management', 'icon' => 'M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z', 'route_prefix' => 'business-owner.tables'],
            ['code' => 'attendance', 'name' => 'Attendance', 'icon' => 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', 'route_prefix' => 'business-owner.attendance'],
            ['code' => 'payroll', 'name' => 'Payroll', 'icon' => 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z', 'route_prefix' => 'business-owner.payroll'],
            ['code' => 'customer_management', 'name' => 'Customer Management', 'icon' => 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', 'route_prefix' => 'business-owner.customers'],
            ['code' => 'user_role_management', 'name' => 'User & Role Management', 'icon' => 'M12 4.354a4 4 0 110 7.292 4 4 0 010-7.292zM15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z', 'route_prefix' => 'business-owner.roles'],
            ['code' => 'business_settings', 'name' => 'Business Settings', 'icon' => 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z', 'route_prefix' => 'business-owner.settings'],
            ['code' => 'pos_monitoring', 'name' => 'POS Monitoring', 'icon' => 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', 'route_prefix' => 'business-owner.pos-monitoring'],
            ['code' => 'employee_scheduling', 'name' => 'Employee Scheduling', 'icon' => 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', 'route_prefix' => 'business-owner.scheduling'],
            ['code' => 'operational_reports', 'name' => 'Operational Reports', 'icon' => 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', 'route_prefix' => 'business-owner.operational-reports'],
            ['code' => 'payments', 'name' => 'Payments', 'icon' => 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z', 'route_prefix' => 'business-owner.payments'],
            ['code' => 'receipts', 'name' => 'Receipts', 'icon' => 'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z', 'route_prefix' => 'business-owner.receipts'],
            ['code' => 'kitchen_orders', 'name' => 'Kitchen Orders', 'icon' => 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10', 'route_prefix' => 'business-owner.kitchen'],
            ['code' => 'order_status', 'name' => 'Order Status', 'icon' => 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4', 'route_prefix' => 'business-owner.order-status'],
            ['code' => 'menu_availability', 'name' => 'Menu Availability', 'icon' => 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z', 'route_prefix' => 'business-owner.menu-availability'],

            // Hotel / Accommodation modules
            ['code' => 'room_management', 'name' => 'Room Management', 'icon' => 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4', 'route_prefix' => 'business-owner.offerings.index'],
            ['code' => 'room_availability', 'name' => 'Room Availability', 'icon' => 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', 'route_prefix' => 'business-owner.bookings.calendar'],
            ['code' => 'reservation_management', 'name' => 'Reservation Management', 'icon' => 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01', 'route_prefix' => 'business-owner.bookings.index'],
            ['code' => 'check_in_out', 'name' => 'Check-in / Check-out', 'icon' => 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', 'route_prefix' => 'business-owner.bookings.index'],

            // Resort modules
            ['code' => 'cottage_management', 'name' => 'Cottage Management', 'icon' => 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', 'route_prefix' => 'business-owner.offerings.index'],
            ['code' => 'facility_management', 'name' => 'Facility Management', 'icon' => 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10', 'route_prefix' => 'business-owner.offerings.index'],
            ['code' => 'event_venue_booking', 'name' => 'Event Venue Booking', 'icon' => 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z', 'route_prefix' => 'business-owner.bookings.index'],
            ['code' => 'gallery', 'name' => 'Gallery', 'icon' => 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z', 'route_prefix' => 'business-owner.businesses.manage.gallery'],

            // Tour Guide modules
            ['code' => 'tour_package_management', 'name' => 'Tour Package Management', 'icon' => 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', 'route_prefix' => 'business-owner.offerings.index'],
            ['code' => 'schedule_management', 'name' => 'Schedule Management', 'icon' => 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', 'route_prefix' => 'business-owner.bookings.calendar'],
            ['code' => 'booking_requests', 'name' => 'Booking Requests', 'icon' => 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01', 'route_prefix' => 'business-owner.bookings.index'],
            ['code' => 'earnings_reports', 'name' => 'Earnings Reports', 'icon' => 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', 'route_prefix' => 'business-owner.reports.sales'],

            // Transport modules
            ['code' => 'vehicle_management', 'name' => 'Vehicle Management', 'icon' => 'M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0', 'route_prefix' => 'business-owner.offerings.index'],
            ['code' => 'driver_management', 'name' => 'Driver Management', 'icon' => 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z', 'route_prefix' => 'business-owner.staff.index'],
            ['code' => 'gps_tracking', 'name' => 'GPS Tracking', 'icon' => 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z', 'route_prefix' => 'business-owner.orders.delivery'],
            ['code' => 'fare_management', 'name' => 'Fare Management', 'icon' => 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', 'route_prefix' => 'business-owner.offerings.index'],

            // Souvenir Shop modules
            ['code' => 'product_management', 'name' => 'Product Management', 'icon' => 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', 'route_prefix' => 'business-owner.offerings.index'],
            ['code' => 'orders', 'name' => 'Orders', 'icon' => 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01', 'route_prefix' => 'business-owner.orders.index'],

            // Equipment Rental modules
            ['code' => 'equipment_inventory', 'name' => 'Equipment Inventory', 'icon' => 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', 'route_prefix' => 'business-owner.offerings.index'],
            ['code' => 'rental_pricing', 'name' => 'Rental Pricing', 'icon' => 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', 'route_prefix' => 'business-owner.offerings.index'],
            ['code' => 'rental_returns', 'name' => 'Rental Returns', 'icon' => 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15', 'route_prefix' => 'business-owner.orders.index'],
            ['code' => 'damage_reports', 'name' => 'Damage Reports', 'icon' => 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z', 'route_prefix' => '#'],
        ];

        $moduleMap = [];
        foreach ($modules as $mod) {
            $moduleMap[$mod['code']] = BusinessModule::firstOrCreate(
                ['code' => $mod['code']],
                $mod
            );
        }

        $mappings = [
            'Restaurant' => [
                'business_profile', 'menu_management', 'food_categories',
                'food_ordering', 'delivery_management', 'pickup_orders', 'table_reservations',
                'staff_management', 'promotions', 'customer_reviews', 'reports', 'gallery',
                'pos_sales', 'table_management', 'customer_management',
                'user_role_management', 'business_settings', 'pos_monitoring',
                'operational_reports', 'payments', 'receipts', 'kitchen_orders', 'order_status', 'menu_availability',
                'expenses',
            ],
            'Café' => [
                'business_profile', 'menu_management', 'food_categories',
                'food_ordering', 'pickup_orders', 'staff_management',
                'promotions', 'customer_reviews', 'reports', 'gallery',
                'pos_sales', 'table_management', 'customer_management',
                'user_role_management', 'business_settings', 'pos_monitoring',
                'operational_reports', 'payments', 'receipts', 'kitchen_orders', 'order_status', 'menu_availability',
                'expenses',
            ],
            'Food Hub / Food Park' => [
                'business_profile', 'menu_management', 'food_categories',
                'food_ordering', 'pickup_orders', 'staff_management',
                'promotions', 'customer_reviews', 'reports',
                'expenses',
            ],
            'Hotel' => [
                'business_profile', 'room_management', 'room_availability',
                'reservation_management', 'check_in_out',
                'staff_management', 'promotions', 'reports', 'customer_reviews',
                'expenses',
            ],
            'Resort' => [
                'business_profile', 'cottage_management', 'room_management',
                'facility_management', 'reservation_management',
                'event_venue_booking', 'gallery',
                'staff_management', 'reports', 'customer_reviews',
                'expenses',
            ],
            'Homestay' => [
                'business_profile', 'room_management', 'room_availability',
                'reservation_management', 'check_in_out',
                'staff_management', 'customer_reviews',
                'expenses',
            ],
            'Camping Site' => [
                'business_profile', 'facility_management',
                'reservation_management', 'gallery',
                'staff_management', 'customer_reviews',
                'expenses',
            ],
            'Tour Guide' => [
                'business_profile', 'tour_package_management',
                'schedule_management', 'booking_requests',
                'customer_reviews', 'earnings_reports',
                'expenses',
            ],
            'Transport Service' => [
                'business_profile', 'vehicle_management', 'driver_management',
                'booking_requests', 'gps_tracking', 'fare_management',
                'earnings_reports', 'customer_reviews',
                'expenses',
            ],
            'Travel Agency' => [
                'business_profile', 'tour_package_management',
                'booking_requests', 'promotions',
                'earnings_reports', 'customer_reviews',
                'expenses',
            ],
            'Souvenir Shop' => [
                'business_profile', 'product_management', 'inventory',
                'orders', 'delivery_management', 'pickup_orders',
                'promotions', 'reports',
                'expenses',
            ],
            'Tourist Attraction' => [
                'business_profile', 'facility_management',
                'booking_requests', 'gallery',
                'staff_management', 'customer_reviews',
                'expenses',
            ],
            'Dive Shop' => [
                'business_profile', 'equipment_inventory', 'rental_pricing',
                'booking_requests', 'rental_returns', 'damage_reports',
                'customer_reviews',
                'expenses',
            ],
            'Event Venue' => [
                'business_profile', 'facility_management',
                'reservation_management', 'event_venue_booking', 'gallery',
                'staff_management', 'promotions', 'customer_reviews',
                'expenses',
            ],
            'Food Hub' => [
                'business_profile', 'menu_management', 'food_categories',
                'food_ordering', 'pickup_orders', 'staff_management',
                'promotions', 'customer_reviews', 'reports',
                'expenses',
            ],
            'Hotel & Restaurant Combination' => [
                'business_profile', 'menu_management', 'food_categories',
                'food_ordering', 'delivery_management', 'pickup_orders', 'table_reservations',
                'staff_management', 'promotions', 'customer_reviews', 'reports', 'gallery',
                'pos_sales', 'table_management', 'customer_management',
                'user_role_management', 'business_settings', 'pos_monitoring',
                'operational_reports', 'payments', 'receipts', 'kitchen_orders', 'order_status', 'menu_availability',
                'room_management', 'room_availability',
                'reservation_management', 'check_in_out',
                'expenses',
            ],
            'Farm Tourism' => [
                'business_profile', 'facility_management',
                'tour_package_management', 'booking_requests', 'gallery',
                'staff_management', 'customer_reviews',
                'expenses',
            ],
        ];

        foreach ($mappings as $categoryName => $moduleCodes) {
            $category = BusinessCategory::where('name', $categoryName)->first();
            if (! $category) {
                continue;
            }

            $moduleIds = collect($moduleCodes)
                ->filter(fn ($code) => isset($moduleMap[$code]))
                ->map(fn ($code) => $moduleMap[$code]->id)
                ->values()
                ->toArray();

            $category->modules()->sync($moduleIds);
        }
    }
}
