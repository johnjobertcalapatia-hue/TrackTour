/**
 * A GPS reading the app may use and send. A fix with an exact 0 latitude or
 * longitude is a reading missing an axis (an emulated / overridden location
 * with an empty field), never a real rider position: on 2026-11-10 one such fix
 * (12.96, 0) put a rider "12,949 km" from the drop-off. The server refuses it
 * too (422).
 */
export function isUsableGpsFix(latitude: unknown, longitude: unknown): boolean {
  const lat = Number(latitude)
  const lng = Number(longitude)
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat !== 0 && lng !== 0
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

export const INVALID_GPS_MESSAGE = 'Your device reported an invalid location. Check the location settings on your phone.'
