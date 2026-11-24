/**
 * "Get Directions" inside TrackTour (2026-11-24): opens the TrackTour map with
 * the route to the place drawn, instead of sending the tourist to Google Maps.
 * The map (TouristExploreMap) reads ?directions=<business id> once it has
 * loaded its places. The map is public, so guests from the landing page can
 * use it too.
 */
export function trackTourDirectionsPath(businessId: number): string {
  return `/tourist/explore/map?directions=${businessId}`
}

/** Whether a place can be routed to on the map (it needs a pin). */
export function canRouteTo(place: { latitude?: number | string | null; longitude?: number | string | null }): boolean {
  return place.latitude != null && place.longitude != null && place.latitude !== '' && place.longitude !== ''
}
