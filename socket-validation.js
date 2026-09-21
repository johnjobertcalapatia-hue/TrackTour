// socket-validation.js
// Pure, dependency-free validation helpers for the TrackTour real-time socket
// engine. Side-effect free so they can be unit-tested with `node --test`.
//
// Scope (P5.1 — GPS integrity):
//   - coordinate / heading / speed range validation
//   - sample freshness (timestamp validation)
//   - rider identity binding (socket <-> payload)
//   - rider <-> delivery ownership
//   - movement plausibility (teleport guard)

export const LIMITS = {
  maxLat: 90,
  maxLng: 180,
  maxSpeedMps: 60, // ~216 km/h hard ceiling for a single reported fix
  maxSampleAgeMs: 15000, // a reported fix older than this is stale
  radarStaleMs: 120000, // rider dropped from the dispatch radar after silence (2m: room for idle GPS on PC demos)
  maxImpliedSpeedKph: 150, // teleport guard ceiling
  clockSkewToleranceMs: 5000, // future-dated samples within this are tolerated
};

export function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isValidLatitude(value) {
  const n = toFiniteNumber(value);
  return n !== null && n >= -LIMITS.maxLat && n <= LIMITS.maxLat;
}

export function isValidLongitude(value) {
  const n = toFiniteNumber(value);
  return n !== null && n >= -LIMITS.maxLng && n <= LIMITS.maxLng;
}

export function isValidLatLng(lat, lng) {
  return isValidLatitude(lat) && isValidLongitude(lng);
}

/**
 * A "satellite grade" fix: valid ranges AND not the (0,0) Null Island sentinel.
 * Browsers and fallback code emit (0,0) when geolocation fails; those must never
 * enter the radar or the live tracking stream.
 */
export function isSatelliteLocation(lat, lng) {
  if (!isValidLatLng(lat, lng)) return false;
  const nLat = toFiniteNumber(lat);
  const nLng = toFiniteNumber(lng);
  return !(nLat === 0 && nLng === 0);
}

/**
 * Rate-limit helper: returns true when the elapsed time since `lastAt`
 * (ms epoch) reaches `minIntervalMs`. Missing state is always allowed.
 */
export function isAllowedByInterval(lastAt, now = Date.now(), minIntervalMs) {
  const interval = toFiniteNumber(minIntervalMs);
  if (interval === null || interval <= 0) return true;
  if (lastAt === null || lastAt === undefined || lastAt === '') return true;
  const last = toFiniteNumber(lastAt);
  if (last === null) return true;
  return now - last >= interval;
}

export function isValidHeading(value) {
  if (value === null || value === undefined || value === '') return true;
  const n = toFiniteNumber(value);
  return n !== null && n >= 0 && n <= 360;
}

export function isValidSpeed(value) {
  if (value === null || value === undefined || value === '') return true;
  const n = toFiniteNumber(value);
  return n !== null && n >= 0 && n <= LIMITS.maxSpeedMps;
}

/**
 * True when `updatedAt` (ms epoch) is recent relative to `now` (ms epoch).
 * Future-dated samples beyond the clock-skew tolerance are treated as invalid.
 */
export function isFresh(updatedAt, now = Date.now(), maxAgeMs = LIMITS.maxSampleAgeMs) {
  const t = toFiniteNumber(updatedAt);
  if (t === null) return false;
  const age = now - t;
  if (age < -LIMITS.clockSkewToleranceMs) return false;
  return age <= maxAgeMs;
}

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Speed implied by travelling between two fixes. Points are
 * `{ lat, lng, at }` with `at` in ms epoch. Returns null when uncomputable.
 */
export function impliedSpeedKph(prev, next) {
  if (!prev || !next) return null;
  const meters = haversineMeters(prev.lat, prev.lng, next.lat, next.lng);
  const elapsedMs = toFiniteNumber(next.at) - toFiniteNumber(prev.at);
  if (elapsedMs <= 0) return null;
  const hours = elapsedMs / 3600000;
  return meters / 1000 / hours;
}

/**
 * Teleport guard: rejects movement that implies an impossible speed. Large
 * sampling gaps are treated as unconstrained (we cannot judge a jump across a
 * long silence), so only gaps within `maxGapMs` are evaluated.
 */
export function isPlausibleMovement(prev, next, options = {}) {
  const maxSpeedKph = options.maxSpeedKph ?? LIMITS.maxImpliedSpeedKph;
  const maxGapMs = options.maxGapMs ?? LIMITS.maxSampleAgeMs;

  if (!prev || !next) return { ok: true, reason: null, speedKph: null };
  if (!isValidLatLng(prev.lat, prev.lng) || !isValidLatLng(next.lat, next.lng)) {
    return { ok: false, reason: 'invalid_coordinates', speedKph: null };
  }

  const elapsedMs = toFiniteNumber(next.at) - toFiniteNumber(prev.at);
  const movedMeters = haversineMeters(prev.lat, prev.lng, next.lat, next.lng);

  if (elapsedMs <= 0) {
    return movedMeters > 5
      ? { ok: false, reason: 'non_monotonic_timestamp', speedKph: null }
      : { ok: true, reason: null, speedKph: 0 };
  }

  if (elapsedMs > maxGapMs) {
    return { ok: true, reason: null, speedKph: null };
  }

  const speedKph = (movedMeters / 1000) / (elapsedMs / 3600000);

  return speedKph > maxSpeedKph
    ? { ok: false, reason: 'implausible_speed', speedKph }
    : { ok: true, reason: null, speedKph };
}

/**
 * Validate a `rider_location_update` payload. `socketRiderId` is the identity
 * the socket registered through `driver_go_online`; when present the payload
 * rider must match it (identity binding).
 */
export function validateLocationUpdate(payload, options = {}) {
  const socketRiderId = options.socketRiderId ?? null;
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? LIMITS.maxSampleAgeMs;

  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'malformed_payload', value: null };
  }

  const riderId = toFiniteNumber(payload.riderId);
  if (riderId === null || !Number.isInteger(riderId) || riderId <= 0) {
    return { ok: false, reason: 'invalid_rider_id', value: null };
  }

  if (socketRiderId !== null && String(socketRiderId) !== String(riderId)) {
    return { ok: false, reason: 'rider_identity_mismatch', value: null };
  }

  const lat = toFiniteNumber(payload.lat);
  const lng = toFiniteNumber(payload.lng);
  if (!isValidLatLng(lat, lng)) {
    return { ok: false, reason: 'invalid_coordinates', value: null };
  }
  if (!isSatelliteLocation(lat, lng)) {
    return { ok: false, reason: 'null_island', value: null };
  }

  if (!isValidHeading(payload.heading)) {
    return { ok: false, reason: 'invalid_heading', value: null };
  }

  if (!isValidSpeed(payload.speed)) {
    return { ok: false, reason: 'invalid_speed', value: null };
  }

  if (payload.timestamp !== null && payload.timestamp !== undefined && !isFresh(payload.timestamp, now, maxAgeMs)) {
    return { ok: false, reason: 'stale_sample', value: null };
  }

  return {
    ok: true,
    reason: null,
    value: {
      riderId,
      lat,
      lng,
      heading: toFiniteNumber(payload.heading) ?? 0,
      speed: toFiniteNumber(payload.speed) ?? 0,
      deliveryId: payload.deliveryId ?? null,
    },
  };
}

/**
 * Rider <-> delivery ownership: a rider may stream location into a trip room
 * only when that trip is assigned to them.
 */
export function canRiderStreamForDelivery({ riderId, deliveryId, activeTrips }) {
  if (!deliveryId) return { ok: true, reason: null };

  const trip = activeTrips && typeof activeTrips.get === 'function' ? activeTrips.get(String(deliveryId)) : null;
  if (!trip || trip.assignedRiderId === null || trip.assignedRiderId === undefined) {
    return { ok: false, reason: 'trip_not_assigned' };
  }
  if (String(trip.assignedRiderId) !== String(riderId)) {
    return { ok: false, reason: 'not_assigned_rider' };
  }
  if (trip.status === 'completed') {
    return { ok: false, reason: 'trip_completed' };
  }

  return { ok: true, reason: null };
}

/**
 * An entry in the ephemeral dispatch radar is eligible only when the rider is
 * available, holds valid coordinates, and has reported recently.
 */
export function isRadarEntryEligible(entry, options = {}) {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? LIMITS.radarStaleMs;

  if (!entry) return false;
  if (entry.status !== 'available') return false;
  if (!isSatelliteLocation(entry.lat, entry.lng)) return false;
  return isFresh(entry.updatedAt, now, maxAgeMs);
}
