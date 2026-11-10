import { Navigation2, Route } from 'lucide-react'
import type { RiderMapViewMode } from '@/features/rider/navigation-view'

/**
 * One button that switches the rider map between its two views (above the
 * map-type button). It always offers the OTHER view:
 *  - in the Overview (flat bird's-eye view of the route) it is the
 *    "Navigation view" button (arrow);
 *  - in the Navigation view (tilted, heading-up, following the rider) it is
 *    the "Overview" button (route).
 */
export function RiderMapViewToggle({
  value,
  onChange,
}: {
  value: RiderMapViewMode
  onChange: (mode: RiderMapViewMode) => void
}) {
  const next: RiderMapViewMode = value === 'navigation' ? 'overview' : 'navigation'
  const label = next === 'navigation' ? 'Navigation view' : 'Overview'
  const Icon = next === 'navigation' ? Navigation2 : Route

  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      aria-label={label}
      title={label}
      data-current-view={value}
      className="w-11 h-11 rounded-full border flex items-center justify-center backdrop-blur transition bg-white/95 border-[#E4E9E6] text-[#16803C] hover:bg-white"
    >
      <Icon className="w-5 h-5" aria-hidden="true" />
    </button>
  )
}
