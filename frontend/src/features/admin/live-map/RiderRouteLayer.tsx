import { Marker, Polyline, Tooltip } from 'react-leaflet'
import { useOsrmRoute } from '@/features/rider/hooks/useOsrmRoute'
import { stopIcon } from './icons'
import { hasPoint, routeWaypoints, type LiveRider } from './types'

const ROUTE_COLOR = { food: '#EA580C', ride: '#2563EB' } as const

/**
 * Live route of one rider on a trip: a road route (OSRM) from the rider
 * through the remaining pickups to the drop-off, falling back to a dashed
 * straight line while the road route loads or when routing is unavailable.
 * The selected rider's route is drawn bold with its stop markers; the others
 * are thin so many riders stay readable.
 */
export default function RiderRouteLayer({ rider, selected }: { rider: LiveRider; selected: boolean }) {
  const trip = rider.trip
  const waypoints = routeWaypoints(rider)
  const { points } = useOsrmRoute(waypoints.length >= 2 ? waypoints : null, waypoints.length >= 2)
  if (!trip || waypoints.length < 2) return null

  const color = ROUTE_COLOR[trip.type]
  const road = points.length >= 2

  return (
    <>
      <Polyline
        positions={road ? points : waypoints}
        pathOptions={{
          color,
          weight: selected ? 6 : 3,
          opacity: selected ? 0.9 : 0.55,
          dashArray: road ? undefined : '8 8',
          lineCap: 'round',
        }}
      />
      {selected && trip.pickups.map((stop, i) =>
        hasPoint(stop) ? (
          <Marker key={`p-${i}`} position={[stop.lat, stop.lng]} icon={stopIcon('pickup', String(i + 1), stop.collected)}>
            <Tooltip direction="top" offset={[0, -24]}>
              {trip.type === 'ride' ? 'Passenger pickup' : `Pickup: ${stop.name ?? 'Restaurant'}`}{stop.collected ? ' (done)' : ''}
            </Tooltip>
          </Marker>
        ) : null,
      )}
      {selected && hasPoint(trip.dropoff) && (
        <Marker position={[trip.dropoff.lat, trip.dropoff.lng]} icon={stopIcon('dropoff', '')}>
          <Tooltip direction="top" offset={[0, -24]}>
            {trip.type === 'ride' ? 'Destination' : 'Drop-off'}{trip.dropoff.address ? `: ${trip.dropoff.address}` : ''}
          </Tooltip>
        </Marker>
      )}
    </>
  )
}
