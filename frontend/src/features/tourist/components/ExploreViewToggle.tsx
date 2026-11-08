import { Link } from 'react-router-dom'
import { LayoutGrid, Map as MapIcon } from 'lucide-react'
import { cn } from '@/shared/utils'

interface Props {
  /** The view the tourist is on now; the button switches to the other one. */
  current: 'list' | 'map'
  /** Where the other view lives (keeps the current tab / category). */
  to: string
  className?: string
}

/**
 * One Explore view switch, shared by the list and the map: the same button in
 * the same place that reads "Map view" on the list and "List view" on the map,
 * so clicking it simply flips the view.
 */
export default function ExploreViewToggle({ current, to, className }: Props) {
  const toMap = current === 'list'
  const Icon = toMap ? MapIcon : LayoutGrid
  return (
    <Link
      to={to}
      data-testid="explore-view-toggle"
      data-view={current}
      className={cn(
        'explore-view-toggle shrink-0 inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[#087F3F] text-white text-sm font-semibold hover:bg-[#056B35] transition',
        className,
      )}
    >
      <Icon className="w-4 h-4" aria-hidden="true" />
      <span>{toMap ? 'Map view' : 'List view'}</span>
    </Link>
  )
}
