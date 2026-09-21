<?php

namespace Database\Seeders;

use App\Models\RolePermission;
use App\Models\StaffRole;
use Illuminate\Database\Seeder;

class RolePermissionSeeder extends Seeder
{
    public function run(): void
    {
        $permissions = [
            // ─── Restaurant Manager ──────────────────────────────────
            'Restaurant Manager' => [
                'business_profile' => ['can_view' => 1, 'can_create' => 0, 'can_update' => 0, 'can_delete' => 0, 'can_export' => 0, 'can_approve' => 0],
                'menu_management' => ['can_view' => 1, 'can_create' => 1, 'can_update' => 1, 'can_delete' => 1, 'can_export' => 0, 'can_approve' => 0],
                'food_ordering' => ['can_view' => 1, 'can_create' => 0, 'can_update' => 1, 'can_delete' => 0, 'can_export' => 0, 'can_approve' => 0],
                'kitchen_orders' => ['can_view' => 1, 'can_create' => 0, 'can_update' => 1, 'can_delete' => 0, 'can_export' => 0, 'can_approve' => 0],
                'order_status' => ['can_view' => 1, 'can_create' => 0, 'can_update' => 1, 'can_delete' => 0, 'can_export' => 0, 'can_approve' => 0],
                'delivery_management' => ['can_view' => 1, 'can_create' => 0, 'can_update' => 1, 'can_delete' => 0, 'can_export' => 0, 'can_approve' => 0],
                'pickup_orders' => ['can_view' => 1, 'can_create' => 0, 'can_update' => 1, 'can_delete' => 0, 'can_export' => 0, 'can_approve' => 0],
                'menu_availability' => ['can_view' => 1, 'can_create' => 0, 'can_update' => 1, 'can_delete' => 0, 'can_export' => 0, 'can_approve' => 0],
                'attendance' => ['can_view' => 1, 'can_create' => 0, 'can_update' => 0, 'can_delete' => 0, 'can_export' => 0, 'can_approve' => 0],
            ],

            // ─── Reservation Staff ─────────────────────────────────────────────
            'Reservation Staff' => [
                'business_profile' => ['can_view' => 1, 'can_create' => 0, 'can_update' => 0, 'can_delete' => 0, 'can_export' => 0, 'can_approve' => 0],
                'table_management' => ['can_view' => 1, 'can_create' => 0, 'can_update' => 1, 'can_delete' => 0, 'can_export' => 0, 'can_approve' => 0],
                'table_reservations' => ['can_view' => 1, 'can_create' => 1, 'can_update' => 1, 'can_delete' => 0, 'can_export' => 0, 'can_approve' => 0],
                'customer_management' => ['can_view' => 1, 'can_create' => 1, 'can_update' => 0, 'can_delete' => 0, 'can_export' => 0, 'can_approve' => 0],
                'menu_management' => ['can_view' => 1, 'can_create' => 0, 'can_update' => 0, 'can_delete' => 0, 'can_export' => 0, 'can_approve' => 0],
                'attendance' => ['can_view' => 1, 'can_create' => 0, 'can_update' => 0, 'can_delete' => 0, 'can_export' => 0, 'can_approve' => 0],
            ],
        ];

        foreach ($permissions as $roleName => $modules) {
            $role = StaffRole::where('name', $roleName)->first();
            if (! $role) {
                continue;
            }

            foreach ($modules as $moduleCode => $perms) {
                RolePermission::updateOrCreate(
                    ['staff_role_id' => $role->id, 'module_code' => $moduleCode],
                    $perms
                );
            }
        }
    }
}
