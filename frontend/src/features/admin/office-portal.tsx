import { createContext, useContext, type ReactNode } from 'react'

/**
 * Which Tourism Office portal a shared page is rendered in (Municipal Office
 * plan Stage 2). Live Map, Deliveries and Rider Cash are the Bansud pages; the
 * municipal portal renders the same pages against /municipal/*, where the
 * server limits every answer to the officer's municipality.
 */
export interface OfficePortal {
  /** API prefix: '/admin' or '/municipal'. */
  api: string
  /** Page route prefix: '/admin' or '/municipal'. */
  route: string
  /** True for the Bansud Tourism Office (district-wide tools such as SOS and trip diagnostics). */
  district: boolean
}

export const BANSUD_PORTAL: OfficePortal = { api: '/admin', route: '/admin', district: true }
export const MUNICIPAL_PORTAL: OfficePortal = { api: '/municipal', route: '/municipal', district: false }

const OfficePortalContext = createContext<OfficePortal>(BANSUD_PORTAL)

export function OfficePortalProvider({ value, children }: { value: OfficePortal; children: ReactNode }) {
  return <OfficePortalContext.Provider value={value}>{children}</OfficePortalContext.Provider>
}

export function useOfficePortal(): OfficePortal {
  return useContext(OfficePortalContext)
}
