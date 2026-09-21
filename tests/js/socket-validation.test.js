// Unit tests for socket-validation.js — run with: npm run test:js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIMITS,
  toFiniteNumber,
  isValidLatitude,
  isValidLongitude,
  isValidLatLng,
  isValidHeading,
  isValidSpeed,
  isFresh,
  isSatelliteLocation,
  isAllowedByInterval,
  haversineMeters,
  impliedSpeedKph,
  isPlausibleMovement,
  validateLocationUpdate,
  canRiderStreamForDelivery,
  isRadarEntryEligible,
} from '../../socket-validation.js';

const NOW = 1_700_000_000_000;

test('toFiniteNumber rejects blanks and non-numeric input', () => {
  assert.equal(toFiniteNumber('12.5'), 12.5);
  assert.equal(toFiniteNumber(0), 0);
  assert.equal(toFiniteNumber(''), null);
  assert.equal(toFiniteNumber(null), null);
  assert.equal(toFiniteNumber('abc'), null);
  assert.equal(toFiniteNumber(Infinity), null);
});

test('coordinate range validation', () => {
  assert.equal(isValidLatitude(0), true);
  assert.equal(isValidLatitude(-90), true);
  assert.equal(isValidLatitude(90), true);
  assert.equal(isValidLatitude(90.0001), false);
  assert.equal(isValidLongitude(180), true);
  assert.equal(isValidLongitude(-180), true);
  assert.equal(isValidLongitude(180.1), false);
  assert.equal(isValidLatLng(12.5, 121.3), true);
  assert.equal(isValidLatLng('12.5', '121.3'), true);
  assert.equal(isValidLatLng(12.5, null), false);
});

test('heading and speed are optional but bounded when present', () => {
  assert.equal(isValidHeading(undefined), true);
  assert.equal(isValidHeading(null), true);
  assert.equal(isValidHeading(0), true);
  assert.equal(isValidHeading(360), true);
  assert.equal(isValidHeading(360.5), false);
  assert.equal(isValidSpeed(undefined), true);
  assert.equal(isValidSpeed(0), true);
  assert.equal(isValidSpeed(LIMITS.maxSpeedMps), true);
  assert.equal(isValidSpeed(LIMITS.maxSpeedMps + 1), false);
});

test('isFresh handles stale, future and missing timestamps', () => {
  assert.equal(isFresh(NOW, NOW, 15000), true);
  assert.equal(isFresh(NOW - 14000, NOW, 15000), true);
  assert.equal(isFresh(NOW - 16000, NOW, 15000), false);
  assert.equal(isFresh(NOW + 2000, NOW, 15000), true);
  assert.equal(isFresh(NOW + 60000, NOW, 15000), false);
  assert.equal(isFresh(null, NOW, 15000), false);
});

test('impliedSpeedKph approximates travel speed', () => {
  // ~111 m north over 5s -> ~80 km/h
  const speed = impliedSpeedKph({ lat: 12.5, lng: 121.3, at: NOW }, { lat: 12.501, lng: 121.3, at: NOW + 5000 });
  assert.ok(speed > 70 && speed < 90, `expected ~80km/h, got ${speed}`);
});

test('isPlausibleMovement flags teleports but allows long gaps', () => {
  const here = { lat: 12.5, lng: 121.3, at: NOW };
  const near = { lat: 12.5005, lng: 121.3, at: NOW + 5000 };
  const far = { lat: 12.9, lng: 121.9, at: NOW + 5000 };

  assert.equal(isPlausibleMovement(here, near).ok, true);
  assert.equal(isPlausibleMovement(here, far).ok, false);
  assert.equal(isPlausibleMovement(here, far).reason, 'implausible_speed');

  const longGap = { lat: 12.9, lng: 121.9, at: NOW + 10 * 60 * 1000 };
  assert.equal(isPlausibleMovement(here, longGap).ok, true);

  const backwards = { lat: 12.9, lng: 121.9, at: NOW - 1000 };
  assert.equal(isPlausibleMovement(here, backwards).ok, false);
  assert.equal(isPlausibleMovement(here, backwards).reason, 'non_monotonic_timestamp');

  assert.equal(isPlausibleMovement(null, far).ok, true);
});

test('validateLocationUpdate accepts a well-formed payload', () => {
  const result = validateLocationUpdate(
    { riderId: 7, lat: 12.5, lng: 121.3, heading: 90, speed: 5, deliveryId: 42 },
    { socketRiderId: 7, now: NOW }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { riderId: 7, lat: 12.5, lng: 121.3, heading: 90, speed: 5, deliveryId: 42 });
});

test('validateLocationUpdate binds payload rider to socket identity', () => {
  const result = validateLocationUpdate(
    { riderId: 8, lat: 12.5, lng: 121.3 },
    { socketRiderId: 7, now: NOW }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'rider_identity_mismatch');
});

test('validateLocationUpdate rejects bad coordinates and ids', () => {
  assert.equal(validateLocationUpdate({ riderId: 0, lat: 1, lng: 1 }, { now: NOW }).reason, 'invalid_rider_id');
  assert.equal(validateLocationUpdate({ riderId: 7, lat: 200, lng: 1 }, { now: NOW }).reason, 'invalid_coordinates');
  assert.equal(validateLocationUpdate({ riderId: 7, lat: 'abc', lng: 1 }, { now: NOW }).reason, 'invalid_coordinates');
  assert.equal(validateLocationUpdate(null, { now: NOW }).reason, 'malformed_payload');
});

test('validateLocationUpdate rejects stale client timestamps', () => {
  const stale = validateLocationUpdate(
    { riderId: 7, lat: 12.5, lng: 121.3, timestamp: NOW - 60000 },
    { socketRiderId: 7, now: NOW }
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale_sample');

  const noTimestamp = validateLocationUpdate({ riderId: 7, lat: 12.5, lng: 121.3 }, { socketRiderId: 7, now: NOW });
  assert.equal(noTimestamp.ok, true);
});

test('canRiderStreamForDelivery enforces rider <-> delivery ownership', () => {
  const activeTrips = new Map([['42', { assignedRiderId: 7, status: 'assigned' }]]);

  assert.equal(canRiderStreamForDelivery({ riderId: 7, deliveryId: null, activeTrips }).ok, true);
  assert.equal(canRiderStreamForDelivery({ riderId: 7, deliveryId: '42', activeTrips }).ok, true);
  assert.equal(canRiderStreamForDelivery({ riderId: 8, deliveryId: '42', activeTrips }).reason, 'not_assigned_rider');
  assert.equal(canRiderStreamForDelivery({ riderId: 7, deliveryId: '99', activeTrips }).reason, 'trip_not_assigned');

  const completed = new Map([['42', { assignedRiderId: 7, status: 'completed' }]]);
  assert.equal(canRiderStreamForDelivery({ riderId: 7, deliveryId: '42', activeTrips: completed }).reason, 'trip_completed');
});

test('isRadarEntryEligible excludes stale, busy and coordinate-less riders', () => {
  const base = { status: 'available', lat: 12.5, lng: 121.3, updatedAt: NOW };
  assert.equal(isRadarEntryEligible(base, { now: NOW }), true);
  assert.equal(isRadarEntryEligible({ ...base, updatedAt: NOW - 60000 }, { now: NOW }), true);
  assert.equal(isRadarEntryEligible({ ...base, updatedAt: NOW - 180000 }, { now: NOW }), false);
  assert.equal(isRadarEntryEligible({ ...base, status: 'busy' }, { now: NOW }), false);
  assert.equal(isRadarEntryEligible({ ...base, lat: null }, { now: NOW }), false);
  assert.equal(isRadarEntryEligible(null, { now: NOW }), false);
});

test('isSatelliteLocation rejects the (0,0) Null Island sentinel', () => {
  assert.equal(isSatelliteLocation(12.5, 121.3), true);
  assert.equal(isSatelliteLocation(90, 180), true);
  assert.equal(isSatelliteLocation(0, 0), false);
  assert.equal(isSatelliteLocation('0', '0'), false);
  assert.equal(isSatelliteLocation(0, 121.3), true);
  assert.equal(isSatelliteLocation(12.5, null), false);
});

test('validateLocationUpdate rejects (0,0) Null Island fixes', () => {
  assert.equal(validateLocationUpdate({ riderId: 7, lat: 0, lng: 0 }, { now: NOW }).reason, 'null_island');
  assert.equal(validateLocationUpdate({ riderId: 7, lat: 90, lng: 0 }, { now: NOW }).ok, true);
});

test('isAllowedByInterval implements the location rate limit', () => {
  const min = 1000;
  assert.equal(isAllowedByInterval(undefined, NOW, min), true);
  assert.equal(isAllowedByInterval(null, NOW, min), true);
  assert.equal(isAllowedByInterval(NOW, NOW, min), false);
  assert.equal(isAllowedByInterval(NOW - 999, NOW, min), false);
  assert.equal(isAllowedByInterval(NOW - 1000, NOW, min), true);
  assert.equal(isAllowedByInterval(NOW - 5000, NOW, min), true);
});
