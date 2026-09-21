import { Navigate } from 'react-router-dom'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import { Building2 } from 'lucide-react'

export default function BusinessOwnerGallery() {
  const businesses = useBusinessOwnerStore((s) => s.businesses)
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)

  if (selectedBusinessId) {
    return <Navigate to={`/business-owner/businesses/${selectedBusinessId}/gallery`} replace />
  }

  if (businesses.length > 0) {
    return <Navigate to={`/business-owner/businesses/${businesses[0].id}/gallery`} replace />
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 text-[#647067]">
      <Building2 className="w-16 h-16 mb-4 text-[#647067]" />
      <p className="text-lg font-medium">No business registered yet</p>
      <p className="text-sm mt-1">Register a business to start managing your gallery</p>
    </div>
  )
}
