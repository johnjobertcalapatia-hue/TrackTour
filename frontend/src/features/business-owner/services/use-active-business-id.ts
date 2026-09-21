import { useEffect } from 'react'
import { useBusinessOwnerStore } from './business-owner-store'

export function useActiveBusinessId(urlId?: string): number | null {
  const businesses = useBusinessOwnerStore((s) => s.businesses)
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)
  const setSelectedBusinessId = useBusinessOwnerStore((s) => s.setSelectedBusinessId)

  const parsedUrlId = urlId !== undefined && urlId !== '' ? Number(urlId) : null
  const urlValid = parsedUrlId !== null && businesses.some((b) => b.id === parsedUrlId)
  const selectionValid =
    selectedBusinessId !== null && businesses.some((b) => b.id === selectedBusinessId)

  let effective: number | null
  if (selectionValid) {
    effective = selectedBusinessId
  } else if (urlValid) {
    effective = parsedUrlId
  } else {
    effective = businesses[0]?.id ?? null
  }

  useEffect(() => {
    if (businesses.length === 0) return
    if (effective !== null && effective !== selectedBusinessId) {
      setSelectedBusinessId(effective)
    }
  }, [businesses.length, effective, selectedBusinessId, setSelectedBusinessId])

  return effective
}