import { Navigation2, Route } from 'lucide-react'
import type { RiderMapViewMode } from '@/features/rider/navigation-view'

/**
 * Overview / Navigation view buttons for the rider map (stacked above the
 * map-type button). Overview = flat bird's-eye view of the route; Navigation
 * = tilted, heading-up driving view following the rider.
 */
export function RiderMapViewToggle({
  value,
  onChange,
}: {
  value: RiderMapViewMode
  onChange: (mode: RiderMapViewMode) => void
}) {
  const button = (mode: RiderMapViewMode, label: string, Icon: typeof Route) => {
    const active = value === mode
    return (
      <button
        type="button"
        onClick={() => onChange(mode)}
        aria-label={label}
        aria-pressed={active}
        title={label}
        className={`w-11 h-11 rounded-full border flex items-center justify-center backdrop-blur transition ${
          active ? 'bg-[#16803C] border-[#16803C] text-white' : 'bg-white/95 border-[#E4E9E6] text-[#16803C] hover:bg-white'
        }`}
      >
        <Icon className="w-5 h-5" aria-hidden="true" />
      </button>
    )
  }

  return (
    <div role="group" aria-label="Map view" className="flex flex-col items-center gap-2">
      {button('overview', 'Overview', Route)}
      {button('navigation', 'Navigation view', Navigation2)}
    </div>
  )
}
