/**
 * "Get Directions" inside TrackTour (2026-11-24): opens the TrackTour map with
 * the route to the place drawn, instead of sending the tourist to Google Maps.
 * The protected map reads ?directions=<business id> once it has loaded its
 * places. Guests sign in first and return to this map destination afterward.
 */
export function trackTourDirectionsPath(businessId: number): string {
  return `/tourist/explore/map?directions=${businessId}`
}

/** Public map route used by guests viewing place details on the landing site. */
export function landingTrackTourDirectionsPath(businessId: number): string {
  return `/explore/map?directions=${businessId}`
}

/** Whether a place can be routed to on the map (it needs a pin). */
export function canRouteTo(place: { latitude?: number | string | null; longitude?: number | string | null }): boolean {
  return place.latitude != null && place.longitude != null && place.latitude !== '' && place.longitude !== ''
}
