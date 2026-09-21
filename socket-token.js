// socket-token.js
// HMAC-signed trip tokens that let the Zero-DB socket engine authorize room
// joins WITHOUT a database lookup. Laravel mints tokens via app/Services/
// TripTokenService using the same shared secret (SOCKET_BRIDGE_SECRET); the
// engine verifies them here and binds them to the live trip assignment.
//
// Token format: base64url(payloadJSON) "." base64url(HMAC_SHA256(payloadJSON, secret))
// Payload fields: { v, deliveryId, role, sub, exp }
//   - v      token schema version (1)
//   - role   'customer' | 'rider'
//   - sub    subject id (user id for customers, rider id for riders)
//   - exp    expiry (ms epoch)
import crypto from "node:crypto";

export const TRIP_TOKEN_VERSION = 1;

function sign(payloadB64, secret) {
  return crypto.createHmac("sha256", secret).update(payloadB64, "utf8").digest("base64url");
}

/**
 * Mint a signed trip token. Mirrors TripTokenService::issue() on the Laravel
 * side. `ttlSeconds` bounds how long a participant may rejoin on reconnects.
 */
export function issueTripToken({
  deliveryId,
  role = "customer",
  subjectId = null,
  secret,
  now = Date.now(),
  ttlSeconds = 7200,
}) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("issueTripToken requires a non-empty secret");
  }

  const payload = {
    v: TRIP_TOKEN_VERSION,
    deliveryId: String(deliveryId),
    role: role === "rider" ? "rider" : "customer",
    sub: subjectId === null || subjectId === undefined ? null : Number(subjectId),
    exp: now + ttlSeconds * 1000,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/**
 * Verify a trip token for a target delivery. Constant-time signature compare;
 * returns a reason on failure so callers can reject the join.
 */
export function verifyTripToken(token, { deliveryId, secret, now = Date.now() }) {
  if (typeof token !== "string" || typeof deliveryId !== "string" || deliveryId.length === 0) {
    return { ok: false, reason: "invalid_token", value: null };
  }
  if (typeof secret !== "string" || secret.length === 0) {
    return { ok: false, reason: "secret_missing", value: null };
  }

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: "invalid_token", value: null };
  }
  const [payloadB64, sig] = parts;

  const expected = sign(payloadB64, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid_signature", value: null };
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid_token", value: null };
  }

  if (!data || data.v !== TRIP_TOKEN_VERSION) {
    return { ok: false, reason: "invalid_token", value: null };
  }
  if (String(data.deliveryId) !== String(deliveryId)) {
    return { ok: false, reason: "token_mismatch", value: null };
  }
  const exp = Number(data.exp);
  if (!Number.isFinite(exp) || exp < now) {
    return { ok: false, reason: "token_expired", value: null };
  }

  return {
    ok: true,
    reason: null,
    value: {
      deliveryId: String(data.deliveryId),
      role: data.role === "rider" ? "rider" : "customer",
      subjectId: data.sub === null || data.sub === undefined ? null : Number(data.sub),
      exp,
    },
  };
}

/**
 * Authorize a `join_trip_room` request against the Zero-DB engine.
 * - Customers must present a valid HMAC trip token minted by Laravel.
 * - Riders must additionally match the token's subject AND hold the current
 *   assignment for that trip (activeTrips is written only by the authenticated
 *   /trip/assign bridge, never by client sockets).
 * Returns { ok, role, reason }.
 */
export function canJoinTripRoom({ deliveryId, socketRiderId = null, activeTrips, token, secret, now = Date.now() }) {
  if (deliveryId === null || deliveryId === undefined || String(deliveryId).length === 0) {
    return { ok: false, role: null, reason: "missing_delivery_id" };
  }

  const verified = verifyTripToken(token, { deliveryId: String(deliveryId), secret, now });
  if (!verified.ok) return { ok: false, role: null, reason: verified.reason };
  const { role, subjectId } = verified.value;

  if (role === "rider") {
    if (socketRiderId == null || String(subjectId) !== String(socketRiderId)) {
      return { ok: false, role, reason: "rider_identity_mismatch" };
    }
    const trip =
      activeTrips && typeof activeTrips.get === "function" ? activeTrips.get(String(deliveryId)) : null;
    if (!trip || trip.status === "completed" || String(trip.assignedRiderId) !== String(subjectId)) {
      return { ok: false, role, reason: "not_assigned_rider" };
    }
  }

  return { ok: true, role, reason: null };
}

/**
 * Mint a signed business room token for merchants.
 */
export function issueBusinessToken({
  businessId,
  role = "merchant",
  subjectId = null,
  secret,
  now = Date.now(),
  ttlSeconds = 7200,
}) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("issueBusinessToken requires a non-empty secret");
  }

  const payload = {
    v: TRIP_TOKEN_VERSION,
    businessId: String(businessId),
    role: "merchant",
    sub: subjectId === null || subjectId === undefined ? null : Number(subjectId),
    exp: now + ttlSeconds * 1000,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/**
 * Verify a business token for a target businessId.
 */
export function verifyBusinessToken(token, { businessId, secret, now = Date.now() }) {
  if (typeof token !== "string" || typeof businessId !== "string" || businessId.length === 0) {
    return { ok: false, reason: "invalid_token", value: null };
  }
  if (typeof secret !== "string" || secret.length === 0) {
    return { ok: false, reason: "secret_missing", value: null };
  }

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: "invalid_token", value: null };
  }
  const [payloadB64, sig] = parts;

  const expected = sign(payloadB64, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid_signature", value: null };
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid_token", value: null };
  }

  if (!data || data.v !== TRIP_TOKEN_VERSION) {
    return { ok: false, reason: "invalid_token", value: null };
  }
  if (String(data.businessId) !== String(businessId)) {
    return { ok: false, reason: "token_mismatch", value: null };
  }
  const exp = Number(data.exp);
  if (!Number.isFinite(exp) || exp < now) {
    return { ok: false, reason: "token_expired", value: null };
  }

  return {
    ok: true,
    reason: null,
    value: {
      businessId: String(data.businessId),
      role: "merchant",
      subjectId: data.sub === null || data.sub === undefined ? null : Number(data.sub),
      exp,
    },
  };
}

/**
 * Authorize a `join_business_room` request.
 */
export function canJoinBusinessRoom({ businessId, token, secret, now = Date.now() }) {
  if (businessId === null || businessId === undefined || String(businessId).length === 0) {
    return { ok: false, role: null, reason: "missing_business_id" };
  }

  const verified = verifyBusinessToken(token, { businessId: String(businessId), secret, now });
  if (!verified.ok) return { ok: false, role: null, reason: verified.reason };

  return { ok: true, role: "merchant", reason: null };
}

/**
 * Mint a signed user-room token for a tourist's `user:<userId>` room.
 * Mirrors TripTokenService::issueUserToken() on the Laravel side.
 */
export function issueUserToken({ userId, subjectId = null, secret, now = Date.now(), ttlSeconds = 7200 }) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("issueUserToken requires a non-empty secret");
  }

  const payload = {
    v: TRIP_TOKEN_VERSION,
    userId: String(userId),
    role: "user",
    sub: subjectId === null || subjectId === undefined ? null : Number(subjectId),
    exp: now + ttlSeconds * 1000,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/**
 * Verify a user-room token for a target userId.
 */
export function verifyUserToken(token, { userId, secret, now = Date.now() }) {
  if (typeof token !== "string" || typeof userId !== "string" || userId.length === 0) {
    return { ok: false, reason: "invalid_token", value: null };
  }
  if (typeof secret !== "string" || secret.length === 0) {
    return { ok: false, reason: "secret_missing", value: null };
  }

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: "invalid_token", value: null };
  }
  const [payloadB64, sig] = parts;

  const expected = sign(payloadB64, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid_signature", value: null };
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid_token", value: null };
  }

  if (!data || data.v !== TRIP_TOKEN_VERSION) {
    return { ok: false, reason: "invalid_token", value: null };
  }
  if (String(data.userId) !== String(userId)) {
    return { ok: false, reason: "token_mismatch", value: null };
  }
  const exp = Number(data.exp);
  if (!Number.isFinite(exp) || exp < now) {
    return { ok: false, reason: "token_expired", value: null };
  }

  return {
    ok: true,
    reason: null,
    value: {
      userId: String(data.userId),
      role: "user",
      subjectId: data.sub === null || data.sub === undefined ? null : Number(data.sub),
      exp,
    },
  };
}

/**
 * Authorize a `join_user_room` request for the tourist's status room.
 */
export function canJoinUserRoom({ userId, token, secret, now = Date.now() }) {
  if (userId === null || userId === undefined || String(userId).length === 0) {
    return { ok: false, role: null, reason: "missing_user_id" };
  }

  const verified = verifyUserToken(token, { userId: String(userId), secret, now });
  if (!verified.ok) return { ok: false, role: null, reason: verified.reason };

  return { ok: true, role: "user", reason: null };
}