import { STATUS_COLORS, STATUS_LABELS } from '@/shared/constants'
import { capitalize } from '@/shared/utils'

interface StatusBadgeProps {
  status: string
  size?: 'sm' | 'md'
}

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const c = (STATUS_COLORS[status] || STATUS_COLORS.pending)!

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium border backdrop-blur-sm ${c.bg} ${c.text} ${c.border} ${
        size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-sm'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${c.dot}`} />
      {STATUS_LABELS[status] ?? capitalize(status)}
    </span>
  )
}
