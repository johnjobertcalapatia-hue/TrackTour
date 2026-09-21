import { formatCurrency } from '@/shared/utils'
import type { StatCardConfig } from './types'

export function StatCard({ config, value }: { config: StatCardConfig; value: number | string }) {
  const Icon = config.icon
  return (
    <div className="bg-white border border-[#E2E8E3] rounded-2xl p-[26px] shadow-tourism transition-all duration-200 hover:shadow-[0_10px_24px_rgba(22,101,52,0.12)] hover:-translate-y-0.5">
      <div className="flex items-start justify-between">
        <div>
          <p className={`text-[13px] font-bold uppercase tracking-[0.03em] ${config.labelClass}`}>{config.label}</p>
          <p className="mt-2 text-2xl lg:text-[32px] font-bold text-[#17201A] leading-tight">
            {config.isCurrency ? formatCurrency(Number(value)) : value}
          </p>
        </div>
        <div className={`w-12 h-12 ${config.iconBg} rounded-xl flex items-center justify-center shrink-0`}>
          <Icon className={`w-6 h-6 ${config.iconText}`} />
        </div>
      </div>
    </div>
  )
}
