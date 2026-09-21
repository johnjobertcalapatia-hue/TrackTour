import { TourismBackdrop } from './TourismBackdrop'

export function DashboardHeader({ businessName, categoryLabel, isAllBusinesses, businessCount }: {
  businessName: string
  categoryLabel: string
  isAllBusinesses: boolean
  businessCount: number
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism mb-6">
      <div className="pointer-events-none absolute inset-0 opacity-[0.08]" aria-hidden>
        <TourismBackdrop />
      </div>
      <div className="relative px-6 py-5 lg:px-8 lg:py-6">
        <h1 className="text-2xl lg:text-[32px] font-bold text-[#126B32] leading-tight">
          {isAllBusinesses ? 'All Businesses' : businessName}
        </h1>
        <p className="mt-1 text-sm text-[#647067]">
          {isAllBusinesses ? `${businessCount} businesses` : categoryLabel} &bull; Owner Dashboard
        </p>
      </div>
    </div>
  )
}
