import { createContext, useContext, type ReactNode } from 'react'
import { useBusinessOwnerStore } from './business-owner-store'

/**
 * Which portal an owner page is rendered in (Staff Management §5,
 * docs/staff-management-plan.md). The menu, promotion, expense and report
 * pages are shared by the business owner and the /staff portal:
 *
 *  - prefix: API and link prefix — '/business-owner' or '/staff' (the staff
 *    API and pages use the same paths under /staff);
 *  - businessId / businesses: the owner's selected business, or the staff
 *    member's one restaurant;
 *  - isStaff: hide what staff may never do (e.g. delete an expense) — the
 *    server refuses it anyway.
 *
 * Without a provider this is exactly the owner's existing behaviour.
 */
export interface PortalBusiness {
  id: number
  name: string
  category?: string
  status?: string
  logo?: string | null
  module_codes?: string[]
}

export interface BusinessPortal {
  prefix: string
  isStaff: boolean
  businessId: number | null
  businesses: PortalBusiness[]
  /**
   * Staff: what their roles allow (GET /staff/me), to hide buttons they may
   * not use. Owners: everything. The server checks every request anyway.
   */
  can?: (permission: string) => boolean
}

const ALLOW_ALL = () => true

const PortalContext = createContext<BusinessPortal | null>(null)

export function BusinessPortalProvider({ value, children }: { value: BusinessPortal; children: ReactNode }) {
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>
}

export function useBusinessPortal(): BusinessPortal & { can: (permission: string) => boolean } {
  const portal = useContext(PortalContext)
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)
  const businesses = useBusinessOwnerStore((s) => s.businesses)

  if (portal) return { ...portal, can: portal.can ?? ALLOW_ALL }
  return { prefix: '/business-owner', isStaff: false, businessId: selectedBusinessId, businesses, can: ALLOW_ALL }
}
