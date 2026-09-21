import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

interface Props {
  title: string
  subtitle?: string
  viewAllTo?: string
  viewAllLabel?: string
}

export default function SectionHeader({ title, subtitle, viewAllTo, viewAllLabel = 'View all' }: Props) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div>
        <h2 className="text-lg font-bold text-[#17201B]">{title}</h2>
        {subtitle && <p className="text-xs text-[#68736D] mt-0.5">{subtitle}</p>}
      </div>
      {viewAllTo && (
        <Link to={viewAllTo} className="text-xs font-medium text-[#087F3F] hover:underline flex items-center gap-0.5 shrink-0">
          {viewAllLabel} <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      )}
    </div>
  )
}
