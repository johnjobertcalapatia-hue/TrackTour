import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EtaBanner, SearchingScreen } from '@/features/tourist/components/ride/RidePhases'
import { rideVehicleIcon, TricycleIcon } from '@/features/tourist/components/ride/vehicleIcon'
import { Car, Motorbike, Van } from 'lucide-react'

/** The ride screens show the vehicle the tourist booked, not always a car. */
const vehicleSvg = (root: HTMLElement) => root.querySelector('svg[data-vehicle-icon], svg.lucide-motorbike, svg.lucide-car, svg.lucide-van')

describe('ride vehicle icon', () => {
  it('maps each bookable vehicle type to its own icon', () => {
    expect(rideVehicleIcon('motorcycle')).toBe(Motorbike)
    expect(rideVehicleIcon('tricycle')).toBe(TricycleIcon)
    expect(rideVehicleIcon('car')).toBe(Car)
    expect(rideVehicleIcon('van')).toBe(Van)
    expect(rideVehicleIcon(null)).toBe(Car)
  })

  it.each([
    ['motorcycle', 'lucide-motorbike'],
    ['car', 'lucide-car'],
    ['van', 'lucide-van'],
  ])('finding your driver shows the %s icon', (type, cls) => {
    render(<SearchingScreen since={null} vehicleType={type} onCancel={() => {}} cancelling={false} onBack={() => {}} />)
    const screenEl = screen.getByRole('region', { name: 'Finding your driver' })
    expect(vehicleSvg(screenEl)).toHaveClass(cls)
    expect(screenEl).toHaveTextContent(`Looking for a nearby ${type} driver`)
  })

  it('finding your driver shows the tricycle icon for a tricycle ride', () => {
    render(<SearchingScreen since={null} vehicleType="tricycle" onCancel={() => {}} cancelling={false} onBack={() => {}} />)
    expect(vehicleSvg(screen.getByRole('region', { name: 'Finding your driver' }))).toHaveAttribute('data-vehicle-icon', 'tricycle')
  })

  it('the arrival banner shows the booked vehicle too', () => {
    const { rerender } = render(<EtaBanner status="arriving" minutes={4} vehicleType="motorcycle" />)
    expect(vehicleSvg(screen.getByTestId('ride-eta-banner'))).toHaveClass('lucide-motorbike')
    rerender(<EtaBanner status="arriving" minutes={4} vehicleType="tricycle" />)
    expect(vehicleSvg(screen.getByTestId('ride-eta-banner'))).toHaveAttribute('data-vehicle-icon', 'tricycle')
  })
})
