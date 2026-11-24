<?php

use App\Support\StaffPermissions;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Staff Management, restaurant roles (docs/staff-management-plan.md §5):
 * Order & Pickup Staff, Finance Staff and Menu & Promotions Staff, with their
 * permissions, offered to the Restaurant, Café and Food Hub categories ONLY.
 *
 * Those three categories now offer exactly these roles. Staff already holding
 * an older role keep it (and its permissions); other categories are untouched.
 */
return new class extends Migration
{
    public function up(): void
    {
        $now = now();
        $roleIds = [];
        $descriptions = [
            StaffPermissions::ORDER_PICKUP_ROLE => 'Receives orders, marks food ready, confirms the rider\'s cash payment and hands the food to the rider',
            StaffPermissions::FINANCE_ROLE => 'Views sales, earnings, reports and COD settlements; adds and edits expenses',
            StaffPermissions::MENU_PROMOTIONS_ROLE => 'Creates the menu, sets items available or unavailable, and manages promotions and discounts',
        ];

        foreach (StaffPermissions::RESTAURANT_ROLES as $name) {
            $id = DB::table('staff_roles')->where('name', $name)->value('id')
                ?? DB::table('staff_roles')->insertGetId(['name' => $name, 'description' => $descriptions[$name], 'created_at' => $now, 'updated_at' => $now]);
            $roleIds[] = $id;
            DB::table('staff_role_permissions')->insertOrIgnore(array_map(
                fn ($permission) => ['staff_role_id' => $id, 'permission' => $permission, 'created_at' => $now, 'updated_at' => $now],
                StaffPermissions::ROLE_DEFAULTS[$name]
            ));
        }

        $categoryIds = DB::table('business_categories')->whereIn('name', StaffPermissions::RESTAURANT_CATEGORIES)->pluck('id');
        foreach ($categoryIds as $categoryId) {
            DB::table('business_category_staff_role')->where('business_category_id', $categoryId)->delete();
            DB::table('business_category_staff_role')->insert(array_map(
                fn ($roleId) => ['business_category_id' => $categoryId, 'staff_role_id' => $roleId, 'created_at' => $now, 'updated_at' => $now],
                $roleIds
            ));
        }
    }

    public function down(): void
    {
        $roleIds = DB::table('staff_roles')->whereIn('name', StaffPermissions::RESTAURANT_ROLES)->pluck('id');
        DB::table('business_category_staff_role')->whereIn('staff_role_id', $roleIds)->delete();
        // Roles still held by staff are kept so nobody loses access on rollback.
        $held = DB::table('staff_role_assignments')->whereIn('staff_role_id', $roleIds)->pluck('staff_role_id')
            ->merge(DB::table('staff')->whereIn('staff_role_id', $roleIds)->pluck('staff_role_id'))->unique();
        DB::table('staff_roles')->whereIn('id', $roleIds->diff($held))->delete();
    }
};
