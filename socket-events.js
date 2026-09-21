// socket-events.js
// Pure, testable routing helpers for the Zero-DB socket engine's HTTP bridge.
// Kept free of Socket.IO so audit/routing/terminal rules can be unit-tested
// with node:test without launching a server.

/**
 * Validate an audience room list like ["business:1", "user:7", "trip:3"].
 * Only the supported audience rooms may be addressed; duplicates collapse.
 */
export function validateAudienceRooms(rooms) {
  if (!Array.isArray(rooms) || rooms.length === 0) {
    return { ok: false, reason: "empty_rooms" };
  }

  const seen = new Set();
  for (const room of rooms) {
    if (typeof room !== "string" || !/^(business|rider|user|trip):\d+$/.test(room)) {
      return { ok: false, reason: "invalid_room" };
    }
    seen.add(room);
  }

  return { ok: true, reason: null, rooms: [...seen] };
}

/**
 * Resolve `/event` bridge payloads into per-room emits.
 *
 *   routeStatusEvent({ eventName: "order.status.changed", rooms, data })
 *   -> { ok, reason, emits: [{ room, eventName, data }] }
 *
 * Invalid payloads resolve to empty emits so the bridge can reject with 400.
 */
export function routeStatusEvent({ eventName, rooms, data } = {}) {
  if (typeof eventName !== "string" || eventName.length === 0) {
    return { ok: false, reason: "missing_event_name", emits: [] };
  }

  const audience = validateAudienceRooms(rooms);
  if (!audience.ok) {
    return { ok: false, reason: audience.reason, emits: [] };
  }

  const payload = data && typeof data === "object" && !Array.isArray(data) ? data : {};

  return {
    ok: true,
    reason: null,
    emits: audience.rooms.map((room) => ({ room, eventName, data: payload })),
  };
}

/**
 * Terminate a live trip (completed or cancelled) against the RAM registry.
 *
 * - marks the stored trip terminal (if present)
 * - releases the assigned rider back to the radar
 * - derives the client events to emit to the trip room
 * - removes the RAM trip
 *
 * Returns { removed, freedRiderId, room, events }. Duplicate terminal calls
 * are no-ops on the RAM side (`removed === false`) and only re-emit into an
 * (already evicted) room — harmless by design.
 */
export function applyTripTerminal(
  activeTrips,
  onlineRiders,
  { deliveryId, riderId = null, terminal = "completed", now = Date.now() } = {}
) {
  const key = String(deliveryId);
  const room = `trip:${key}`;

  const existing = activeTrips.get(key);
  if (existing) existing.status = terminal;

  const freedRiderId = riderId ?? existing?.assignedRiderId ?? null;
  if (freedRiderId != null && onlineRiders && onlineRiders.has(String(freedRiderId))) {
    onlineRiders.get(String(freedRiderId)).status = "available";
    onlineRiders.get(String(freedRiderId)).updatedAt = now;
  }

  const events = [
    {
      room,
      eventName: terminal === "cancelled" ? "trip_cancelled" : "trip_completed",
      data: { deliveryId: key, timestamp: now },
    },
    {
      room,
      eventName: "dispatch_status_update",
      data: { deliveryId: key, status: terminal },
    },
  ];

  const removed = activeTrips.delete(key);

  return { removed, freedRiderId, room, events };
}