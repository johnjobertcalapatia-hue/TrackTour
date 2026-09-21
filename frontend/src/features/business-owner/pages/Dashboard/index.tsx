import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { useBusinessOwnerStore } from '../../services/business-owner-store'
import { DashboardHeader } from './DashboardHeader'
import { getDashboardForCategory, categoryLabels } from './registry'
import type { DashboardData } from './types'

export default function BusinessOwnerDashboard() {
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)
  const getSelectedBusiness = useBusinessOwnerStore((s) => s.getSelectedBusiness)

  const { data, isLoading } = useQuery({
    queryKey: ['bo-dashboard', selectedBusinessId],
    queryFn: () => {
      const params = selectedBusinessId ? `?business_id=${selectedBusinessId}` : ''
      return get<DashboardData>(`/business-owner/dashboard${params}`)
    },
  })

  if (isLoading) return <DashboardSkeleton />
  if (!data) return <div className="text-center py-20 text-[#647067]">Unable to load dashboard data.</div>

  const selectedBiz = getSelectedBusiness()
  const category = selectedBiz?.category || data.business?.category || 'Restaurant'
  const dashboardLabel = categoryLabels[category] || category
  const businessName = data.business?.name || dashboardLabel
  const isAllBusinesses = !selectedBusinessId

  const { Component: DashboardComponent, isFallback } = getDashboardForCategory(category)

  return (
    <div>
      <DashboardHeader
        businessName={businessName}
        categoryLabel={dashboardLabel}
        isAllBusinesses={isAllBusinesses}
        businessCount={data.businesses?.length || 0}
      />

      {isFallback ? (
        <DashboardComponent category={category} data={data} businessName={businessName} />
      ) : (
        <DashboardComponent data={data} businessName={businessName} />
      )}
    </div>
  )
}
