import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import type { QuickAction } from './types'

export function QuickActionCard({ action }: { action: QuickAction }) {
  const navigate = useNavigate()
  const Icon = action.icon

  return (
    <button
      onClick={() => navigate(action.path)}
      className="group relative overflow-hidden rounded-[14px] px-6 py-[22px] text-left text-white bg-gradient-to-br from-[#126B32] to-[#16803C] shadow-tourism-lg transition-all duration-200 hover:shadow-[0_14px_28px_rgba(22,101,52,0.25)] hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-white/15 flex items-center justify-center shrink-0">
          <Icon className="w-7 h-7 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white text-base">{action.label}</h3>
          <p className="text-sm text-white/75">{action.count}</p>
        </div>
        <ArrowRight className="w-5 h-5 text-white/80 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
  )
}
