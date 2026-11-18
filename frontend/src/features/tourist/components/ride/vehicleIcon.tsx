import type { ComponentType, SVGProps } from 'react'
import { Car, Motorbike, Van } from 'lucide-react'

export type VehicleIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>

/**
 * Tricycle (motorcycle with a covered sidecar), drawn in Lucide's style
 * (24×24, 2px round strokes) — Lucide has no tricycle icon.
 */
export function TricycleIcon({ className, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      data-vehicle-icon="tricycle"
      {...rest}
    >
      {/* Covered cab: roof, back, sloped windscreen, nose */}
      <path d="M3 15V6a1 1 0 0 1 1-1h8l4 5h3a2 2 0 0 1 2 2v3" />
      {/* Cab window line */}
      <path d="M8 5v5h8" />
      {/* Chassis between the wheels */}
      <path d="M8.5 17h7" />
      <circle cx="6" cy="17" r="2.5" />
      <circle cx="18" cy="17" r="2.5" />
    </svg>
  )
}

const ICONS: Record<string, VehicleIcon> = {
  motorcycle: Motorbike,
  tricycle: TricycleIcon,
  car: Car,
  van: Van,
}

/** The icon for a ride vehicle type the tourist booked (motorcycle, tricycle, car, van). */
export function rideVehicleIcon(type: string | null | undefined): VehicleIcon {
  return ICONS[String(type ?? '')] ?? Car
}
