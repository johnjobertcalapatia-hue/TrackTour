import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'

/** Staff Management Stage 1 permission keys (App\Support\StaffPermissions). */
export type StaffPermission =
  | 'orders.view'
  | 'orders.update'
  | 'orders.reject'
  | 'payments.confirm_rider_cash'
  | 'bookings.view'
  | 'bookings.update'
  | 'menu.view'
  | 'menu.manage'
  | 'handover.confirm'
  | 'finance.view'
  | 'expenses.manage'
  | 'promotions.manage'

export interface StaffMe {
  staff: { id: number; full_name: string; employee_id: string; role: string; profile_picture?: string | null }
  business: { id: number; name: string; category?: string | null; logo?: string | null }
  permissions: StaffPermission[]
}

/**
 * The signed-in staff member and their permissions (GET /staff/me). Used to
 * hide what their role does not allow; the backend enforces every action.
 */
export function useStaffPermissions() {
  const query = useQuery({
    queryKey: ['staff-me'],
    queryFn: () => get<StaffMe>('/staff/me'),
    staleTime: 60_000,
  })
  const permissions = query.data?.permissions ?? []

  return {
    ...query,
    permissions,
    can: (permission: StaffPermission) => permissions.includes(permission),
  }
}
