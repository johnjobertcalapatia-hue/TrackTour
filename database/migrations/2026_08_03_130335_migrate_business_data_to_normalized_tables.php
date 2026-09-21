<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 1. Migrate business_profiles data from businesses JSON columns
        $businesses = DB::table('businesses')
            ->whereNotNull('welcome_message')
            ->orWhereNotNull('special_offers')
            ->orWhereNotNull('featured_banner')
            ->orWhereNotNull('featured_video')
            ->orWhereNotNull('restaurant_profile')
            ->get();

        foreach ($businesses as $business) {
            DB::table('business_profiles')->insert([
                'business_id' => $business->id,
                'welcome_message' => $business->welcome_message,
                'about_us' => $business->special_offers,
                'featured_banner' => $business->featured_banner,
                'featured_video' => $business->featured_video,
                'theme_settings' => $business->restaurant_profile,
                'created_at' => $business->created_at,
                'updated_at' => $business->updated_at,
            ]);
        }

        // 2. Migrate restaurant_profiles data
        $restaurantBusinesses = DB::table('businesses')
            ->whereNotNull('signature_dishes')
            ->orWhereNotNull('featured_menu_items')
            ->get();

        foreach ($restaurantBusinesses as $business) {
            DB::table('restaurant_profiles')->insert([
                'business_id' => $business->id,
                'dining_style' => $business->dining_style,
                'average_wait_time' => $business->average_wait_time,
                'created_at' => $business->created_at,
                'updated_at' => $business->updated_at,
            ]);
        }

        // 3. Create menus and menu_items from offerings for each restaurant business
        // This creates a mapping from old offering IDs to new menu_item IDs
        $offeringToMenuItemMap = [];

        $restaurantBusinessIds = DB::table('restaurant_profiles')->pluck('business_id')->toArray();

        foreach ($restaurantBusinessIds as $businessId) {
            $offerings = DB::table('offerings')
                ->where('business_id', $businessId)
                ->whereNull('deleted_at')
                ->get();

            if ($offerings->isEmpty()) {
                continue;
            }

            // Create a default menu for this business
            $menuId = DB::table('menus')->insertGetId([
                'business_id' => $businessId,
                'name' => 'Main Menu',
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            foreach ($offerings as $offering) {
                $menuItemId = DB::table('menu_items')->insertGetId([
                    'menu_id' => $menuId,
                    'business_id' => $businessId,
                    'name' => $offering->name,
                    'description' => $offering->description,
                    'price' => $offering->price,
                    'compare_price' => $offering->compare_price,
                    'image' => $offering->image,
                    'is_available' => $offering->status === 'active',
                    'bestseller' => $offering->bestseller ?? false,
                    'sort_order' => $offering->sort_order ?? 0,
                    'created_at' => $offering->created_at,
                    'updated_at' => $offering->updated_at,
                ]);

                $offeringToMenuItemMap[$offering->id] = $menuItemId;
            }
        }

        // 4. Migrate signature_dishes (JSON array of offering IDs -> pivot table with new menu_item IDs)
        $businessesWithSignature = DB::table('businesses')
            ->whereNotNull('signature_dishes')
            ->get();

        foreach ($businessesWithSignature as $business) {
            $offeringIds = is_string($business->signature_dishes)
                ? json_decode($business->signature_dishes, true)
                : $business->signature_dishes;

            if (is_array($offeringIds)) {
                foreach ($offeringIds as $index => $offeringId) {
                    $menuItemId = $offeringToMenuItemMap[$offeringId] ?? null;
                    if ($menuItemId) {
                        DB::table('signature_dishes')->insert([
                            'business_id' => $business->id,
                            'menu_item_id' => $menuItemId,
                            'display_order' => $index,
                            'created_at' => $business->created_at,
                            'updated_at' => $business->updated_at,
                        ]);
                    }
                }
            }
        }

        // 5. Migrate featured_menu_items (JSON array of offering IDs -> pivot table with new menu_item IDs)
        $businessesWithFeatured = DB::table('businesses')
            ->whereNotNull('featured_menu_items')
            ->get();

        foreach ($businessesWithFeatured as $business) {
            $offeringIds = is_string($business->featured_menu_items)
                ? json_decode($business->featured_menu_items, true)
                : $business->featured_menu_items;

            if (is_array($offeringIds)) {
                foreach ($offeringIds as $index => $offeringId) {
                    $menuItemId = $offeringToMenuItemMap[$offeringId] ?? null;
                    if ($menuItemId) {
                        DB::table('featured_menu_items')->insert([
                            'business_id' => $business->id,
                            'menu_item_id' => $menuItemId,
                            'display_order' => $index,
                            'created_at' => $business->created_at,
                            'updated_at' => $business->updated_at,
                        ]);
                    }
                }
            }
        }
    }

    public function down(): void
    {
        // Reverse migration - copy data back to businesses table
        $profiles = DB::table('business_profiles')->get();
        foreach ($profiles as $profile) {
            DB::table('businesses')
                ->where('id', $profile->business_id)
                ->update([
                    'welcome_message' => $profile->welcome_message,
                    'special_offers' => $profile->about_us,
                    'featured_banner' => $profile->featured_banner,
                    'featured_video' => $profile->featured_video,
                    'restaurant_profile' => $profile->theme_settings,
                ]);
        }

        // Clear normalized tables
        DB::table('signature_dishes')->truncate();
        DB::table('featured_menu_items')->truncate();
        DB::table('menu_items')->truncate();
        DB::table('menus')->truncate();
        DB::table('restaurant_profiles')->truncate();
        DB::table('business_profiles')->truncate();
    }
};
