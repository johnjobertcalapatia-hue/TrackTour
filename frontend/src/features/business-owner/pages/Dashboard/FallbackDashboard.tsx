import { Settings } from 'lucide-react'
import type { DashboardProps } from './types'

export function FallbackDashboard({ category }: DashboardProps & { category: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-tourism p-12 text-center">
      <div className="w-16 h-16 rounded-full bg-[#FFF7D6] flex items-center justify-center mx-auto mb-4">
        <Settings className="w-8 h-8 text-[#F4B400]" />
      </div>
      <h2 className="text-lg font-bold text-[#17201A] mb-2">{category} Dashboard</h2>
      <p className="text-sm text-[#647067] max-w-md mx-auto">
        Your dashboard for this business category is being prepared. You can still manage your business information and settings.
      </p>
    </div>
  )
}
