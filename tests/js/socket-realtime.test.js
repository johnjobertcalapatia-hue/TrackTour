// Unit tests for socket-events.js — the audience-room routing + trip-terminal
// helpers used by the Zero-DB socket engine's HTTP bridge.
// Run with: npm run test:js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateAudienceRooms,
  routeStatusEvent,
  applyTripTerminal,
} from '../../socket-events.js';

test('validateAudienceRooms accepts supported audience rooms and collapses duplicates', () => {
  const result = validateAudienceRooms(['business:1', 'user:7', 'trip:3', 'rider:4', 'business:1']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rooms, ['business:1', 'user:7', 'trip:3', 'rider:4']);
});

test('validateAudienceRooms rejects empty or non-array room lists', () => {
  assert.equal(validateAudienceRooms([]).reason, 'empty_rooms');
  assert.equal(validateAudienceRooms(undefined).reason, 'empty_rooms');
  assert.equal(validateAudienceRooms(null).reason, 'empty_rooms');
  assert.equal(validateAudienceRooms('business:1').reason, 'empty_rooms');
});

test('validateAudienceRooms rejects unsupported or malformed room shapes', () => {
  assert.equal(validateAudienceRooms(['whatever']).reason, 'invalid_room');
  assert.equal(validateAudienceRooms(['business:abc']).reason, 'invalid_room');
  assert.equal(validateAudienceRooms(['trip:-1']).reason, 'invalid_room');
  assert.equal(validateAudienceRooms(['business:1', 42]).reason, 'invalid_room');
});

test('routeStatusEvent accepts a canonical status event and fans it out per room', () => {
  const data = { order_id: 12, new_status: 'preparing' };
  const result = routeStatusEvent({
    eventName: 'order.status.changed',
    rooms: ['business:1', 'user:7', 'trip:3'],
    data,
  });

  assert.equal(result.ok, true);
  assert.equal(result.emits.length, 3);
  assert.deepEqual(result.emits[0], { room: 'business:1', eventName: 'order.status.changed', data });
  assert.deepEqual(result.emits[1], { room: 'user:7', eventName: 'order.status.changed', data });
  assert.deepEqual(result.emits[2], { room: 'trip:3', eventName: 'order.status.changed', data });
});

test('routeStatusEvent rejects events without a name or with invalid rooms', () => {
  assert.equal(routeStatusEvent({ eventName: '', rooms: ['business:1'], data: {} }).reason, 'missing_event_name');
  assert.equal(routeStatusEvent({ rooms: ['business:1'], data: {} }).reason, 'missing_event_name');
  assert.equal(routeStatusEvent({ eventName: 'order.status.changed', rooms: ['nope'], data: {} }).reason, 'invalid_room');
  assert.equal(routeStatusEvent({ eventName: 'order.status.changed', rooms: [], data: {} }).reason, 'empty_rooms');
});

test('routeStatusEvent never emits an unauthorized room list', () => {
  const result = routeStatusEvent({ eventName: 'order.status.changed', rooms: ['business:1', 'evil:2'], data: {} });
  assert.equal(result.ok, false);
  assert.equal(result.emits.length, 0);
});

test('routeStatusEvent forces non-object data to an empty object payload', () => {
  const result = routeStatusEvent({ eventName: 'delivery.status.changed', rooms: ['trip:3'], data: null });
  assert.equal(result.ok, true);
  assert.deepEqual(result.emits[0].data, {});
});

test('applyTripTerminal marks the trip, releases the rider, and evicts RAM state on completion', () => {
  const activeTrips = new Map([['1', { assignedRiderId: 9, status: 'assigned' }]]);
  const onlineRiders = new Map([['9', { status: 'busy', socketId: 's1', updatedAt: 0 }]]);
  const now = 1_700_100_000;

  const result = applyTripTerminal(activeTrips, onlineRiders, { deliveryId: 1, riderId: 9, terminal: 'completed', now });

  assert.equal(result.removed, true);
  assert.equal(result.freedRiderId, 9);
  assert.equal(result.room, 'trip:1');
  assert.equal(activeTrips.has('1'), false, 'RAM trip evicted on completion.');
  assert.equal(onlineRiders.get('9').status, 'available', 'Assigned rider released back to the radar.');
  assert.equal(onlineRiders.get('9').updatedAt, now);

  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].eventName, 'trip_completed');
  assert.equal(result.events[0].data.deliveryId, '1');
  assert.equal(result.events[1].eventName, 'dispatch_status_update');
  assert.equal(result.events[1].data.status, 'completed');
});

test('applyTripTerminal uses the trip_cancelled event on cancellation', () => {
  const activeTrips = new Map([['7', { assignedRiderId: 3, status: 'assigned' }]]);
  const result = applyTripTerminal(activeTrips, new Map(), { deliveryId: 7, terminal: 'cancelled' });

  assert.equal(result.removed, true);
  assert.equal(result.events[0].eventName, 'trip_cancelled');
  assert.equal(result.events[1].eventName, 'dispatch_status_update');
  assert.equal(result.events[1].data.status, 'cancelled');
});

test('applyTripTerminal releases the rider recorded on the trip when riderId is omitted', () => {
  const activeTrips = new Map([['5', { assignedRiderId: 2, status: 'assigned' }]]);
  const onlineRiders = new Map([['2', { status: 'busy', updatedAt: 0 }]]);

  const result = applyTripTerminal(activeTrips, onlineRiders, { deliveryId: 5, terminal: 'completed' });

  assert.equal(result.freedRiderId, 2);
  assert.equal(onlineRiders.get('2').status, 'available');
});

test('applyTripTerminal is a harmless no-op on duplicate terminal calls', () => {
  const activeTrips = new Map();
  const onlineRiders = new Map();

  const first = applyTripTerminal(activeTrips, onlineRiders, { deliveryId: 3, riderId: 8, terminal: 'completed' });
  const second = applyTripTerminal(activeTrips, onlineRiders, { deliveryId: 3, riderId: 8, terminal: 'cancelled' });

  assert.equal(first.removed, false);
  assert.equal(second.removed, false, 'Duplicate terminal calls do not remove anything.');
  assert.equal(second.freedRiderId, 8, 'Provided rider is still resolved for the room notification.');
});

test('applyTripTerminal does not invent a rider not present on the radar', () => {
  const activeTrips = new Map();
  const result = applyTripTerminal(activeTrips, new Map(), { deliveryId: 11, terminal: 'cancelled' });
  assert.equal(result.removed, false);
  assert.equal(result.freedRiderId, null);
});