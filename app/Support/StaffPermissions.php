<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * The staff permission catalogue (Staff Management Stage 1,
 * docs/staff-management-plan.md). Defined in code so staff can never edit it;
 * grants are stored per role in `staff_role_permissions`.
 *
 * Deliberately absent (never grantable to staff): managing staff, business
 * settings or ownership; marking a GCash/PayMongo payment paid; marking the
 * tourist's COD as collected. `payments.confirm_rider_cash` only covers cash the
 * business itself receives from the rider for the food
 * (CodPaymentConfirmationService).
 */
final class StaffPermissions
{
    public const ORDERS_VIEW = 'orders.view';

    public const ORDERS_UPDATE = 'orders.update';

    public const ORDERS_REJECT = 'orders.reject';

    public const PAYMENTS_CONFIRM_RIDER_CASH = 'payments.confirm_rider_cash';

    public const BOOKINGS_VIEW = 'bookings.view';

    public const BOOKINGS_UPDATE = 'bookings.update';

    public const MENU_VIEW = 'menu.view';

    public const MENU_MANAGE = 'menu.manage';

    // Restaurant roles (Stage 2/3 slice, docs/staff-management-plan.md section 5)
    public const HANDOVER_CONFIRM = 'handover.confirm';

    public const FINANCE_VIEW = 'finance.view';

    public const EXPENSES_MANAGE = 'expenses.manage';

    public const PROMOTIONS_MANAGE = 'promotions.manage';

    public const ORDER_PICKUP_ROLE = 'Order & Pickup Staff';

    public const FINANCE_ROLE = 'Finance Staff';

    public const MENU_PROMOTIONS_ROLE = 'Menu & Promotions Staff';

    /** The three restaurant roles, offered to these business categories only. */
    public const RESTAURANT_ROLES = [self::ORDER_PICKUP_ROLE, self::FINANCE_ROLE, self::MENU_PROMOTIONS_ROLE];

    public const RESTAURANT_CATEGORIES = ['Restaurant', 'Café', 'Food Hub'];

    /**
     * Never grantable to staff, whatever their roles or the owner's settings:
     * no permission key and no staff route exist for these.
     */
    public const NEVER_GRANTABLE = [
        'expenses.delete', 'payouts.manage', 'bank_details.manage', 'staff.manage',
        'business.settings', 'business.ownership', 'payments.mark_online_paid', 'payments.mark_cod_collected',
    ];

    /** key => [module, label] */
    public const CATALOGUE = [
        self::ORDERS_VIEW => ['Orders and reservations', 'View their restaurant\'s orders'],
        self::ORDERS_UPDATE => ['Orders and reservations', 'Accept orders, start preparation and mark items ready'],
        self::ORDERS_REJECT => ['Orders and reservations', 'Reject orders or dishes (only before a rider accepts)'],
        self::PAYMENTS_CONFIRM_RIDER_CASH => ['Payments and transactions', 'Confirm cash received from the rider for the food'],
        self::BOOKINGS_VIEW => ['Orders and reservations', 'View bookings and reservations'],
        self::BOOKINGS_UPDATE => ['Orders and reservations', 'Update booking status'],
        self::MENU_VIEW => ['Food menu and services', 'View the menu'],
        self::MENU_MANAGE => ['Food menu and services', 'Add, edit and remove menu items, photos and availability'],
        self::HANDOVER_CONFIRM => ['Delivery and rider handover', 'Confirm the food was handed to the rider'],
        self::FINANCE_VIEW => ['Reports and analytics', 'View sales, earnings, reports and COD settlements'],
        self::EXPENSES_MANAGE => ['Payments and transactions', 'Add and edit expenses'],
        self::PROMOTIONS_MANAGE => ['Food menu and services', 'Manage promotions and discounts'],
    ];

    private const FOOD_ORDER = [self::ORDERS_VIEW, self::ORDERS_UPDATE, self::MENU_VIEW];

    private const BOOKINGS = [self::BOOKINGS_VIEW, self::BOOKINGS_UPDATE];

    /**
     * Default grants for the existing role templates, by the role's purpose.
     * Roles not listed (promotion, housekeeping, maintenance, guides…) get no
     * order/booking/menu access until the owner's Stage 2 roles say otherwise.
     */
    public const ROLE_DEFAULTS = [
        self::ORDER_PICKUP_ROLE => [self::ORDERS_VIEW, self::ORDERS_UPDATE, self::PAYMENTS_CONFIRM_RIDER_CASH, self::HANDOVER_CONFIRM],
        self::FINANCE_ROLE => [self::FINANCE_VIEW, self::EXPENSES_MANAGE],
        self::MENU_PROMOTIONS_ROLE => [self::MENU_VIEW, self::MENU_MANAGE, self::PROMOTIONS_MANAGE],
        'Restaurant Manager' => [...self::FOOD_ORDER, self::ORDERS_REJECT, self::PAYMENTS_CONFIRM_RIDER_CASH, self::MENU_MANAGE],
        'Order & Payment Staff' => [...self::FOOD_ORDER, self::ORDERS_REJECT, self::PAYMENTS_CONFIRM_RIDER_CASH],
        'Kitchen / Preparation Staff' => self::FOOD_ORDER,
        'Menu Management Staff' => [self::MENU_VIEW, self::MENU_MANAGE],
        'Food Menu Staff' => [self::MENU_VIEW, self::MENU_MANAGE],
        'Inventory Staff' => [self::MENU_VIEW],
        'Reservation Staff' => self::BOOKINGS,
        'Reservation & Front Desk Staff' => self::BOOKINGS,
        'Front Desk Manager' => self::BOOKINGS,
        'Room Management Staff' => [self::BOOKINGS_VIEW],
        'Booking Staff' => self::BOOKINGS,
        'Tour Booking Staff' => self::BOOKINGS,
        'Booking Coordinator Staff' => self::BOOKINGS,
        'Visitor Management Staff' => self::BOOKINGS,
        'Guest Relations Officer' => [self::BOOKINGS_VIEW],
        'Concierge' => [self::BOOKINGS_VIEW],
    ];

    /**
     * Legacy `role_permissions` module codes → permission keys.
     * [module_code => [flag => permissions granted when that flag is set]]
     */
    private const LEGACY_MODULES = [
        'food_ordering' => ['can_view' => [self::ORDERS_VIEW], 'can_update' => [self::ORDERS_UPDATE], 'can_approve' => [self::PAYMENTS_CONFIRM_RIDER_CASH]],
        'order_status' => ['can_view' => [self::ORDERS_VIEW], 'can_update' => [self::ORDERS_UPDATE]],
        'kitchen_orders' => ['can_view' => [self::ORDERS_VIEW], 'can_update' => [self::ORDERS_UPDATE]],
        'pickup_orders' => ['can_view' => [self::ORDERS_VIEW], 'can_update' => [self::ORDERS_UPDATE]],
        'delivery_management' => ['can_view' => [self::ORDERS_VIEW]],
        'menu_management' => ['can_view' => [self::MENU_VIEW], 'can_create' => [self::MENU_MANAGE], 'can_update' => [self::MENU_MANAGE], 'can_delete' => [self::MENU_MANAGE]],
        'menu_availability' => ['can_view' => [self::MENU_VIEW]],
        'table_reservations' => ['can_view' => [self::BOOKINGS_VIEW], 'can_update' => [self::BOOKINGS_UPDATE]],
        'table_management' => ['can_view' => [self::BOOKINGS_VIEW]],
    ];

    /** @return list<string> */
    public static function all(): array
    {
        return array_keys(self::CATALOGUE);
    }

    public static function exists(string $permission): bool
    {
        return array_key_exists($permission, self::CATALOGUE);
    }

    /**
     * Only catalogue keys ever count: a stored grant that is not in the
     * catalogue (or is never grantable) is ignored.
     *
     * @param  iterable<string>  $granted
     * @return list<string>
     */
    public static function effective(iterable $granted): array
    {
        $keys = [];
        foreach ($granted as $permission) {
            if (self::exists($permission) && ! in_array($permission, self::NEVER_GRANTABLE, true)) {
                $keys[] = $permission;
            }
        }

        return array_values(array_unique($keys));
    }

    /**
     * What an existing role is granted: its legacy module grants converted,
     * plus the defaults for its purpose.
     *
     * @return list<string>
     */
    public static function mappedFor(string $roleName, iterable $legacyRows = []): array
    {
        $granted = self::ROLE_DEFAULTS[$roleName] ?? [];
        foreach ($legacyRows as $row) {
            $row = (array) $row;
            foreach (self::LEGACY_MODULES[$row['module_code'] ?? ''] ?? [] as $flag => $permissions) {
                if (! empty($row[$flag])) {
                    $granted = [...$granted, ...$permissions];
                }
            }
        }

        return array_values(array_unique(array_filter($granted, [self::class, 'exists'])));
    }

    /**
     * Give every role that has no Stage-1 grants yet its mapped permissions.
     * Idempotent; used by the migration and by StaffRoleSeeder (fresh installs).
     * Uses the query builder only, so it is safe inside a migration.
     */
    public static function seedRolesWithoutGrants(): int
    {
        $seeded = 0;
        $withGrants = DB::table('staff_role_permissions')->distinct()->pluck('staff_role_id')->all();
        $legacy = DB::getSchemaBuilder()->hasTable('role_permissions')
            ? DB::table('role_permissions')->get()->groupBy('staff_role_id')
            : collect();

        foreach (DB::table('staff_roles')->get(['id', 'name']) as $role) {
            if (in_array($role->id, $withGrants)) {
                continue;
            }
            $now = now();
            $rows = array_map(fn ($p) => ['staff_role_id' => $role->id, 'permission' => $p, 'created_at' => $now, 'updated_at' => $now],
                self::mappedFor($role->name, $legacy->get($role->id, collect())));
            if ($rows !== []) {
                DB::table('staff_role_permissions')->insertOrIgnore($rows);
                $seeded++;
            }
        }

        return $seeded;
    }
}
