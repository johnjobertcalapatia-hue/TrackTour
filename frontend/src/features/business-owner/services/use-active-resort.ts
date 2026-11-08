import { useActiveBusinessId } from './use-active-business-id'
import { useBusinessOwnerStore } from './business-owner-store'

/** The owner's active business and whether it uses the resort setup (Resort category only). */
export function useActiveResort() {
  const businessId = useActiveBusinessId()
  const businesses = useBusinessOwnerStore((s) => s.businesses)
  const business = businesses.find((b) => b.id === businessId) ?? null
  const isResort = (business?.category ?? '').toLowerCase() === 'resort'
  return { businessId, business, isResort }
}
