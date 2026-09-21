// Unit tests for socket-token.js — the HMAC trip-token authorization module.
// Run with: npm run test:js
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  TRIP_TOKEN_VERSION,
  issueTripToken,
  verifyTripToken,
  canJoinTripRoom,
  issueUserToken,
  verifyUserToken,
  canJoinUserRoom,
} from '../../socket-token.js';

const SECRET = 'test-bridge-secret';
const NOW = 1_700_000_000_000;
const OTHER_SECRET = 'some-other-secret';

test('tokens must have a non-empty secret', () => {
  assert.throws(() =>
    issueTripToken({ deliveryId: '42', secret: '', now: NOW })
  );
});

test('a minted customer token verifies for the same delivery', () => {
  const token = issueTripToken({ deliveryId: '42', role: 'customer', subjectId: 9, secret: SECRET, now: NOW, ttlSeconds: 3600 });
  const result = verifyTripToken(token, { deliveryId: '42', secret: SECRET, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.value.role, 'customer');
  assert.equal(result.value.subjectId, 9);
  assert.equal(result.value.deliveryId, '42');
  assert.ok(result.value.exp > NOW);
});

test('expired tokens are rejected', () => {
  const token = issueTripToken({ deliveryId: '42', role: 'customer', subjectId: 9, secret: SECRET, now: NOW, ttlSeconds: 5 });
  assert.equal(verifyTripToken(token, { deliveryId: '42', secret: SECRET, now: NOW + 6001 }).reason, 'token_expired');
});

test('tampered and garbage tokens are rejected', () => {
  const token = issueTripToken({ deliveryId: '42', role: 'customer', subjectId: 9, secret: SECRET, now: NOW });
  const [payloadB64] = token.split('.');
  const forgedSignature = issueTripToken({ deliveryId: '42', role: 'customer', subjectId: 9, secret: OTHER_SECRET, now: NOW }).split('.')[1];
  const tamperedSubject = Buffer.from(JSON.stringify({ v: TRIP_TOKEN_VERSION, deliveryId: '42', role: 'customer', sub: 10, exp: NOW + 3600000 })).toString('base64url');

  assert.equal(verifyTripToken(`${payloadB64}.${forgedSignature}`, { deliveryId: '42', secret: SECRET, now: NOW }).reason, 'invalid_signature');
  assert.equal(verifyTripToken(`${tamperedSubject}.${sigOf(payloadB64, SECRET)}`, { deliveryId: '42', secret: SECRET, now: NOW }).reason, 'invalid_signature');
  assert.equal(verifyTripToken('not a token', { deliveryId: '42', secret: SECRET, now: NOW }).reason, 'invalid_token');
  assert.equal(verifyTripToken(payloadB64, { deliveryId: '42', secret: SECRET, now: NOW }).reason, 'invalid_token');
  assert.equal(verifyTripToken(null, { deliveryId: '42', secret: SECRET, now: NOW }).reason, 'invalid_token');
});

function sigOf(payloadB64, secret) {
  // Reference signature computed the same way the module does (node:crypto).
  return crypto.createHmac('sha256', secret).update(payloadB64, 'utf8').digest('base64url');
}

test('tokens are bound to their delivery and secret', () => {
  const token = issueTripToken({ deliveryId: '42', role: 'customer', subjectId: 9, secret: SECRET, now: NOW });
  assert.equal(verifyTripToken(token, { deliveryId: '99', secret: SECRET, now: NOW }).reason, 'token_mismatch');
  assert.equal(verifyTripToken(token, { deliveryId: '42', secret: OTHER_SECRET, now: NOW }).reason, 'invalid_signature');
});

test('canJoinTripRoom allows an authorized customer', () => {
  const token = issueTripToken({ deliveryId: '42', role: 'customer', subjectId: 9, secret: SECRET, now: NOW });
  const result = canJoinTripRoom({ deliveryId: '42', activeTrips: new Map(), token, secret: SECRET, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.role, 'customer');
});

test('canJoinTripRoom rejects joins without a token', () => {
  const result = canJoinTripRoom({ deliveryId: '42', activeTrips: new Map(), token: undefined, secret: SECRET, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_token');
});

test('canJoinTripRoom allows only the assigned rider with a matching socket identity', () => {
  const activeTrips = new Map([['42', { assignedRiderId: 7, status: 'assigned' }]]);
  const rideToken = issueTripToken({ deliveryId: '42', role: 'rider', subjectId: 7, secret: SECRET, now: NOW });

  assert.equal(canJoinTripRoom({ deliveryId: '42', socketRiderId: 7, activeTrips, token: rideToken, secret: SECRET, now: NOW }).ok, true);
  assert.equal(canJoinTripRoom({ deliveryId: '42', socketRiderId: 8, activeTrips, token: rideToken, secret: SECRET, now: NOW }).reason, 'rider_identity_mismatch');
  assert.equal(canJoinTripRoom({ deliveryId: '42', socketRiderId: null, activeTrips, token: rideToken, secret: SECRET, now: NOW }).reason, 'rider_identity_mismatch');
});

test('canJoinTripRoom blocks a rider who does not hold the current assignment', () => {
  const unassignedTrips = new Map();
  const rideToken = issueTripToken({ deliveryId: '42', role: 'rider', subjectId: 7, secret: SECRET, now: NOW });
  assert.equal(canJoinTripRoom({ deliveryId: '42', socketRiderId: 7, activeTrips: unassignedTrips, token: rideToken, secret: SECRET, now: NOW }).reason, 'not_assigned_rider');

  const completed = new Map([['42', { assignedRiderId: 7, status: 'completed' }]]);
  assert.equal(canJoinTripRoom({ deliveryId: '42', socketRiderId: 7, activeTrips: completed, token: rideToken, secret: SECRET, now: NOW }).reason, 'not_assigned_rider');
});

test('canJoinTripRoom rejects expired and mismatched joins', () => {
  const token = issueTripToken({ deliveryId: '42', role: 'customer', subjectId: 9, secret: SECRET, now: NOW, ttlSeconds: 1 });
  assert.equal(canJoinTripRoom({ deliveryId: '42', activeTrips: new Map(), token, secret: SECRET, now: NOW + 5000 }).reason, 'token_expired');
  assert.equal(canJoinTripRoom({ deliveryId: null, activeTrips: new Map(), token: undefined, secret: SECRET, now: NOW }).reason, 'missing_delivery_id');
});

// ===== P11.5 — user:{id} room tokens (tourist status room) =====

test('user tokens require a non-empty secret', () => {
  assert.throws(() => issueUserToken({ userId: '3', secret: '', now: NOW }));
});

test('a minted user token verifies for the same user room', () => {
  const token = issueUserToken({ userId: '3', subjectId: 9, secret: SECRET, now: NOW, ttlSeconds: 3600 });
  const result = verifyUserToken(token, { userId: '3', secret: SECRET, now: NOW });

  assert.equal(result.ok, true);
  assert.equal(result.value.role, 'user');
  assert.equal(result.value.subjectId, 9);
  assert.equal(result.value.userId, '3');
  assert.ok(result.value.exp > NOW);
});

test('user tokens are bound to their user, secret, expiry and payload', () => {
  const token = issueUserToken({ userId: '3', secret: SECRET, now: NOW, ttlSeconds: 5 });

  assert.equal(verifyUserToken(token, { userId: '4', secret: SECRET, now: NOW }).reason, 'token_mismatch');
  assert.equal(verifyUserToken(token, { userId: '3', secret: OTHER_SECRET, now: NOW }).reason, 'invalid_signature');
  assert.equal(verifyUserToken(token, { userId: '3', secret: SECRET, now: NOW + 6001 }).reason, 'token_expired');

  const tamperedUser = Buffer.from(JSON.stringify({ v: TRIP_TOKEN_VERSION, userId: '4', role: 'user', sub: null, exp: NOW + 3600000 })).toString('base64url');
  const originalSig = token.split('.')[1];
  assert.equal(
    verifyUserToken(`${tamperedUser}.${originalSig}`, { userId: '3', secret: SECRET, now: NOW }).reason,
    'invalid_signature'
  );
});

test('verifying a user token requires a target userId', () => {
  assert.equal(verifyUserToken(undefined, { userId: '3', secret: SECRET, now: NOW }).reason, 'invalid_token');
  assert.equal(verifyUserToken(issueUserToken({ userId: '3', secret: SECRET, now: NOW }), { userId: '', secret: SECRET, now: NOW }).reason, 'invalid_token');
});

test('canJoinUserRoom allows only the authorized tourist', () => {
  const token = issueUserToken({ userId: '3', subjectId: 9, secret: SECRET, now: NOW });
  assert.equal(canJoinUserRoom({ userId: '3', token, secret: SECRET, now: NOW }).ok, true);
  assert.equal(canJoinUserRoom({ userId: '3', token, secret: SECRET, now: NOW }).role, 'user');
  assert.equal(canJoinUserRoom({ userId: '4', token, secret: SECRET, now: NOW }).reason, 'token_mismatch');
});

test('canJoinUserRoom rejects joins without a userId or token', () => {
  assert.equal(canJoinUserRoom({ userId: '', token: undefined, secret: SECRET, now: NOW }).reason, 'missing_user_id');
  assert.equal(canJoinUserRoom({ userId: '3', token: undefined, secret: SECRET, now: NOW }).reason, 'invalid_token');
  assert.equal(canJoinUserRoom({ userId: '3', token: 'garbage', secret: SECRET, now: NOW }).reason, 'invalid_token');
});