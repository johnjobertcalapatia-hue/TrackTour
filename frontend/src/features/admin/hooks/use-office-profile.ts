import { useQuery } from '@tanstack/react-query'
import { API_ENDPOINTS } from '@/shared/constants'
import { get } from '@/shared/services/api'

/**
 * Bansud Tourism Office identity (logo, cover photo, contact details).
 *
 * Municipal-wide branding stored in `tourism_settings`, so it is shared by the
 * profile page (/admin/profile) and the Admin sidebar, which shows the
 * uploaded logo instead of the TrackTour mark once the office sets one.
 */
export interface OfficeProfile {
  name: string
  about: string
  email: string
  phone: string
  address: string
  logo_url: string | null
  cover_url: string | null
  updated_at: string | null
}

export const OFFICE_PROFILE_QUERY_KEY = ['admin-office-profile'] as const

export function useOfficeProfile(enabled = true) {
  return useQuery({
    queryKey: OFFICE_PROFILE_QUERY_KEY,
    queryFn: () => get<OfficeProfile>(API_ENDPOINTS.ADMIN.PROFILE),
    enabled,
    // Branding changes rarely and every admin page renders the sidebar.
    staleTime: 5 * 60 * 1000,
  })
}
