import { DashboardSkeleton } from '@/shared/components/Skeleton'

export function LoadingDashboard({ businessName }: { businessName?: string }) {
  return (
    <div>
      {businessName && (
        <div className="mb-6 bg-[#EAF6ED] border border-[#D7E8DB] rounded-2xl px-6 py-4 flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-[#16803C] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-[#126B32]">Loading {businessName} dashboard...</p>
        </div>
      )}
      <DashboardSkeleton />
    </div>
  )
}
