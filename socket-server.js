// socket-server.js - TrackTour Zero-DB Real-Time Dispatch & Tracking Engine
// Architecture: WebSockets handle ephemeral rider registry + order pings (radar).
// Firebase RTDB is used ONLY for active-trip GPS tracking. MySQL is the source of
// truth for orders/deliveries/dispatch logs.
import { Server } from "socket.io";
import http from "node:http";
import crypto from "node:crypto";
import {
  toFiniteNumber,
  validateLocationUpdate,
  canRiderStreamForDelivery,
  isPlausibleMovement,
  isRadarEntryEligible,
  isSatelliteLocation,
  isAllowedByInterval,
} from "./socket-validation.js";
import { canJoinTripRoom, canJoinBusinessRoom, canJoinUserRoom } from "./socket-token.js";
import { routeStatusEvent, applyTripTerminal } from "./socket-events.js";

// Self-heal startup: load the project .env if the process wasn't launched with
// `--env-file` (plain `node socket-server.js`) — otherwise the bridge secret is
// empty and every /dispatch, /trip/* and /status call returns 401.
if (!process.env.SOCKET_BRIDGE_SECRET) {
  try {
    process.loadEnvFile();
  } catch {
    // No .env alongside the script — fall through to empty secret.
  }
}

const PORT = parseInt(process.env.SOCKET_PORT || "3001", 10);
const BRIDGE_PORT = parseInt(process.env.SOCKET_BRIDGE_PORT || "3002", 10);
const BRIDGE_SECRET = process.env.SOCKET_BRIDGE_SECRET || "";
const LOCATION_MIN_INTERVAL_MS = parseInt(process.env.SOCKET_LOCATION_MIN_INTERVAL_MS || "1000", 10);
const PENDING_TRIP_TTL_MS = parseInt(process.env.SOCKET_PENDING_TRIP_TTL_MS || "120000", 10);

if (!BRIDGE_SECRET) {
  console.warn(
    "[TrackTour Engine] WARNING: SOCKET_BRIDGE_SECRET is not set — all /dispatch, /trip/complete, /trip/assign and /status bridge calls will be rejected (401)."
  );
}

// Shared-secret authentication for the Laravel <-> socket HTTP bridge. Uses a
// length check + constant-time compare so secrets cannot be guessed by timing.
function bridgeAuthorized(req) {
  if (!BRIDGE_SECRET) return false;
  const provided = req.headers["x-socket-secret"];
  if (typeof provided !== "string" || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(BRIDGE_SECRET);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const io = new Server(PORT, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Volatile RAM Registry (0 DB Writes) — online rider locations for dispatch only.
// This is ephemeral: it lives in server memory and disappears on disconnect.
const onlineRiders = new Map(); // riderId -> { socketId, lat, lng, vehicleType, status }
const activeTrips = new Map();   // deliveryId -> { assignedRiderId, status, expiresAt? }
const locationRate = new Map();  // socketId -> last accepted location fix (ms)

// One rider = one active delivery: a rider assigned to a live trip must never
// appear "available" on the dispatch radar.
function findAssignedTripForRider(riderId, trips) {
  for (const [deliveryId, trip] of trips.entries()) {
    if (trip.status === "assigned" && trip.assignedRiderId != null && String(trip.assignedRiderId) === String(riderId)) {
      return deliveryId;
    }
  }
  return null;
}

// Haversine Distance Calculation (in kilometers)
function calculateHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Proximity "radar" scan: all online available riders sorted by distance to pickup.
function scanEligibleRiders(restaurantLat, restaurantLng) {
  const eligible = [];
  const now = Date.now();
  for (const [rId, rData] of onlineRiders.entries()) {
    if (!isRadarEntryEligible(rData, { now })) continue;
    const distKm = calculateHaversineKm(restaurantLat, restaurantLng, rData.lat, rData.lng);
    eligible.push({ riderId: rId, distanceKm: distKm, socketId: rData.socketId });
  }
  eligible.sort((a, b) => a.distanceKm - b.distanceKm);
  return eligible;
}

console.log(`[TrackTour Engine] Zero-DB WebSocket Server running on port ${PORT}...`);

io.on("connection", (socket) => {
  console.log(`[Socket Connected] ID: ${socket.id}`);

  // ENDPOINT 1: Driver State Setup (driver_go_online) — rider registers ephemeral
  // location in server RAM. Used ONLY for dispatch radar, never persisted.
  socket.on("driver_go_online", ({ riderId, currentLat, currentLng, vehicleType } = {}) => {
    const id = toFiniteNumber(riderId);
    if (id === null || !Number.isInteger(id) || id <= 0 || !isSatelliteLocation(currentLat, currentLng)) {
      socket.emit("driver_registration_rejected", { reason: "invalid_registration" });
      return;
    }

    // A rider currently assigned to a live trip registers as busy so they are
    // excluded from the radar until the trip completes and releases them.
    const busyWith = findAssignedTripForRider(id, activeTrips);

    onlineRiders.set(id, {
      socketId: socket.id,
      lat: Number(currentLat),
      lng: Number(currentLng),
      vehicleType: vehicleType || "motorcycle",
      status: busyWith ? "busy" : "available",
      updatedAt: Date.now()
    });
    socket.riderId = id;
    console.log(`[Phase A] Rider #${id} ${busyWith ? `registered BUSY (assigned to trip ${busyWith})` : `added to RAM radar matrix at (${currentLat}, ${currentLng})`}`);
  });

  // Room Join Protocol (P6): joins are authorized. Customers present an HMAC
  // trip token minted by Laravel; riders must match the token subject AND hold
  // the current assignment for that trip. Unauthorized joins are rejected.
  socket.on("join_trip_room", ({ deliveryId, token } = {}) => {
    const auth = canJoinTripRoom({
      deliveryId,
      socketRiderId: socket.riderId ?? null,
      activeTrips,
      token,
      secret: BRIDGE_SECRET
    });

    if (!auth.ok) {
      socket.emit("join_trip_room_rejected", { deliveryId: deliveryId ?? null, reason: auth.reason });
      console.log(`[Room Join DENIED] Socket ${socket.id} -> trip:${deliveryId} (${auth.reason})`);
      return;
    }

    const room = `trip:${String(deliveryId)}`;
    socket.join(room);
    socket.tripRoles = socket.tripRoles || new Map();
    socket.tripRoles.set(String(deliveryId), auth.role);
    console.log(`[Room Join] Socket ${socket.id} joined room ${room} as ${auth.role}`);
  });

  // Business Room Join Protocol: merchants join their business room.
  socket.on("join_business_room", ({ businessId, token } = {}) => {
    const auth = canJoinBusinessRoom({
      businessId,
      token,
      secret: BRIDGE_SECRET
    });

    if (!auth.ok) {
      socket.emit("join_business_room_rejected", { businessId: businessId ?? null, reason: auth.reason });
      console.log(`[Business Room Join DENIED] Socket ${socket.id} -> business:${businessId} (${auth.reason})`);
      return;
    }

    const room = `business:${String(businessId)}`;
    socket.join(room);
    console.log(`[Business Room Join] Socket ${socket.id} joined room ${room}`);
  });

  // User Room Join Protocol (P11.5): a tourist joins their own user:{id} room
  // with an HMAC token minted by Laravel so they receive order-status events.
  socket.on("join_user_room", ({ userId, token } = {}) => {
    const auth = canJoinUserRoom({
      userId,
      token,
      secret: BRIDGE_SECRET
    });

    if (!auth.ok) {
      socket.emit("join_user_room_rejected", { userId: userId ?? null, reason: auth.reason });
      console.log(`[User Room Join DENIED] Socket ${socket.id} -> user:${userId} (${auth.reason})`);
      return;
    }

    const room = `user:${String(userId)}`;
    socket.join(room);
    console.log(`[User Room Join] Socket ${socket.id} joined room ${room}`);
  });

  // Driver Accept Lock (driver_accept_order)
  socket.on("driver_accept_order", ({ deliveryId, riderId } = {}) => {
    // The accepting socket must be the rider it claims to be.
    if (socket.riderId == null || String(socket.riderId) !== String(riderId)) {
      socket.emit("order_ping_result", { success: false, message: "Rider identity mismatch." });
      return;
    }

    // P6: assignments are authoritative from the Laravel bridge (/trip/assign).
    // A client event must never write assignment state into RAM — accepting a
    // dispatch is a backend decision. Legacy clients are told to finalize via
    // the API so Laravel can persist and confirm through the bridge.
    socket.emit("order_ping_result", {
      success: false,
      reason: "accept_via_api",
      deliveryId: deliveryId ?? null,
      message: "Confirm the delivery in the app to finalize your acceptance."
    });
    console.log(`[Rider Accept IGNORED] Rider #${socket.riderId} -> delivery #${deliveryId} (accept must go through the API)`);
  });

  // Driver Decline or Timeout — Shift to Next Nearest Rider in RAM Line
  socket.on("driver_decline_order", ({ deliveryId, riderId } = {}) => {
    if (socket.riderId == null || String(socket.riderId) !== String(riderId)) {
      socket.emit("order_ping_result", { success: false, message: "Rider identity mismatch." });
      return;
    }

    const trip = activeTrips.get(String(deliveryId));
    if (!trip || trip.status === "assigned") return;

    trip.currentCandidateIndex += 1;
    if (trip.currentCandidateIndex < trip.eligibleRiders.length) {
      const nextRider = trip.eligibleRiders[trip.currentCandidateIndex];
      console.log(`[Fallback Dispatch] Order #${deliveryId} passed to next nearest Rider #${nextRider.riderId} (${nextRider.distanceKm.toFixed(2)}km away)`);

      io.to(nextRider.socketId).emit("order_received_ping", {
        deliveryId,
        restaurantName: trip.restaurantName,
        timeoutSeconds: 45,
        distanceKm: nextRider.distanceKm,
        timestamp: Date.now()
      });
    } else {
      console.log(`[Dispatch Finished] All eligible riders declined or timed out for Delivery #${deliveryId}`);
      io.to(`trip:${deliveryId}`).emit("dispatch_status_update", { deliveryId, status: "no_rider_available" });
    }
  });

  // ENDPOINT 4: Telemetry Pipeline (rider_location_update - Zero DB Writes)
  socket.on("rider_location_update", (payload = {}) => {
    const now = Date.now();

    // 1) Validate shape, coordinates, ranges, optional timestamp, identity.
    const check = validateLocationUpdate(payload, { socketRiderId: socket.riderId, now });
    if (!check.ok) {
      socket.emit("rider_location_rejected", { reason: check.reason });
      return;
    }

    const { riderId, lat, lng, heading, speed, deliveryId } = check.value;

    // 2) Rider <-> delivery ownership: only the assigned rider may stream.
    const ownership = canRiderStreamForDelivery({ riderId, deliveryId, activeTrips });
    if (!ownership.ok) {
      socket.emit("rider_location_rejected", { reason: ownership.reason, deliveryId: deliveryId ?? null });
      return;
    }

    // 2.5) Rate limit: block location flooding from a single socket.
    const lastFix = locationRate.get(socket.id);
    if (!isAllowedByInterval(lastFix, now, LOCATION_MIN_INTERVAL_MS)) {
      socket.emit("rider_location_rejected", { reason: "rate_limited" });
      return;
    }
    locationRate.set(socket.id, now);

    // 3) Movement plausibility (teleport guard) against the last known fix.
    const prev = onlineRiders.get(riderId);
    if (prev && prev.lat != null && prev.lng != null) {
      const plausibility = isPlausibleMovement(
        { lat: prev.lat, lng: prev.lng, at: prev.updatedAt },
        { lat, lng, at: now }
      );
      if (!plausibility.ok) {
        socket.emit("rider_location_rejected", { reason: plausibility.reason });
        return;
      }
    }

    if (prev) {
      prev.lat = lat;
      prev.lng = lng;
      prev.updatedAt = now;
    }

    if (deliveryId) {
      socket.to(`trip:${deliveryId}`).emit("rider_location_stream", {
        riderId,
        lat,
        lng,
        heading,
        speed,
        timestamp: now
      });
    }
  });

  socket.on("disconnect", () => {
    if (socket.riderId && onlineRiders.has(socket.riderId)) {
      onlineRiders.delete(socket.riderId);
      console.log(`[Phase A] Rider #${socket.riderId} disconnected — wiped from RAM matrix.`);
    }
    locationRate.delete(socket.id);
  });
});

// Initiate the dispatch challenge flow: ping the preferred (backend-selected) rider
// if they are online and available, otherwise fall back to the nearest available
// rider in the ephemeral radar registry.
function startDispatchChallenge({ deliveryId, restaurantName, restaurantLat, restaurantLng, timeoutSeconds = 45, preferredRiderId = null }) {
  console.log(`[Dispatch Received] ${JSON.stringify({ deliveryId, restaurantName, restaurantLat, restaurantLng, preferredRiderId })}`);
  let targetRider = null;
  // Declared at FUNCTION scope on purpose: the trip record stored below lives
  // outside the `if (!targetRider)` block and must always be able to reference
  // it. When this was block-scoped inside that if, any dispatch that honored a
  // preferred rider (block skipped) or found a non-empty radar reached
  // activeTrips.set() with no binding in scope, threw
  // "ReferenceError: eligibleRiders is not defined", and the bridge answered
  // 500 BEFORE ever emitting order_received_ping — silently killing the
  // realtime ping whenever a rider was actually online.
  let eligibleRiders = [];

  // The Laravel bridge is authoritative: when it names a preferred rider it has
  // already vetted status, service type, credit and distance at dispatch time.
  // Honor that pick whenever the rider's socket is still connected and not busy,
  // even if their last GPS fix has aged past the radar staleness window (idle
  // browser / PC demos routinely trip a 30s-silence edge).
  if (preferredRiderId != null) {
    let prefEntry = null;
    for (const [rId, rData] of onlineRiders.entries()) {
      if (String(rId) === String(preferredRiderId)) {
        prefEntry = rData;
        break;
      }
    }
    if (prefEntry && prefEntry.socketId && prefEntry.status !== "busy") {
      targetRider = {
        riderId: preferredRiderId,
        socketId: prefEntry.socketId,
        distanceKm: calculateHaversineKm(restaurantLat, restaurantLng, prefEntry.lat, prefEntry.lng)
      };
      console.log(`[Dispatch] preferred rider #${preferredRiderId} honored (online, ${prefEntry.status}) at ${targetRider.distanceKm.toFixed(2)}km`);
    } else {
      console.log(`[Dispatch] preferred rider #${preferredRiderId} ${prefEntry ? `not pingable (${prefEntry.status})` : "NOT connected on socket radar"}`);
    }
  }

  if (!targetRider) {
    eligibleRiders = scanEligibleRiders(restaurantLat, restaurantLng);
    console.log(`[Dispatch] eligible socket riders for ${deliveryId}: ${eligibleRiders.map((r) => `${r.riderId}@${r.distanceKm.toFixed(2)}km`).join(', ') || 'NONE'}`);

    if (eligibleRiders.length === 0) {
      console.log(`[Dispatch Failed] No online available riders for ${deliveryId}.`);
      io.to(`trip:${deliveryId}`).emit("dispatch_failed", {
        deliveryId,
        message: "No online available riders found."
      });
      return;
    }

    if (preferredRiderId != null) {
      const preferred = eligibleRiders.find((r) => String(r.riderId) === String(preferredRiderId));
      if (preferred) targetRider = preferred;
    }
    if (!targetRider) {
      targetRider = eligibleRiders[0];
    }
  }

  console.log(`[Phase C Match] Rider #${targetRider.riderId} (socket ${targetRider.socketId}) matched at ${targetRider.distanceKm.toFixed(2)}km away.`);

  // Store pending challenge in RAM
  activeTrips.set(String(deliveryId), {
    restaurantName,
    restaurantLat,
    restaurantLng,
    eligibleRiders,
    currentCandidateIndex: Math.max(0, eligibleRiders.indexOf(targetRider)),
    status: "pending_accept",
    expiresAt: Date.now() + PENDING_TRIP_TTL_MS
  });

  // ENDPOINT 3: Challenge target driver (order_received_ping)
  console.log(`[Dispatch] emitting "order_received_ping" to socket ${targetRider.socketId}`);
  io.to(targetRider.socketId).emit("order_received_ping", {
    deliveryId,
    restaurantName,
    timeoutSeconds,
    distanceKm: targetRider.distanceKm,
    timestamp: Date.now()
  });
}

// Pending challenge sweep: trips stuck in pending_accept (no rider accepted)
// are dropped so abandoned dispatches never accumulate in RAM.
setInterval(() => {
  const now = Date.now();
  for (const [deliveryId, trip] of activeTrips.entries()) {
    if (trip.status === "pending_accept" && trip.expiresAt != null && trip.expiresAt < now) {
      activeTrips.delete(deliveryId);
      io.to(`trip:${deliveryId}`).emit("dispatch_status_update", { deliveryId, status: "expired" });
      console.log(`[Dispatch Expired] Delivery #${deliveryId} removed from RAM (no rider accepted).`);
    }
  }
}, 30000).unref();

// HTTP bridge so the Laravel backend (authoritative source of truth) can trigger a
// real-time dispatch ping over the websocket. Laravel POSTs when a delivery is
// dispatched; the socket engine pings the target/nearest rider's live connection.
const httpServer = http.createServer(async (req, res) => {
  const setCors = () => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  };

  if (req.method === "OPTIONS") {
    setCors();
    res.writeHead(204);
    res.end();
    return;
  }

  // Every bridge route requires the shared secret. CORS preflight (OPTIONS)
  // above is intentionally exempt so browsers can negotiate headers.
  if (!bridgeAuthorized(req)) {
    setCors();
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, message: "Unauthorized bridge request." }));
    return;
  }

  if (req.method === "POST" && req.url === "/dispatch") {
    let body = "";
    for await (const chunk of req) body += chunk;
    setCors();

    try {
      const payload = JSON.parse(body || "{}");
      const {
        deliveryId,
        restaurantName = "Restaurant",
        restaurantLat,
        restaurantLng,
        riderId = null,
        timeoutSeconds = 45
      } = payload;

      if (!deliveryId || restaurantLat == null || restaurantLng == null) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, message: "deliveryId, restaurantLat, restaurantLng are required." }));
        return;
      }

      startDispatchChallenge({
        deliveryId,
        restaurantName,
        restaurantLat,
        restaurantLng,
        timeoutSeconds,
        preferredRiderId: riderId
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, message: "Dispatch ping sent." }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, message: e.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/trip/assign") {
    let body = "";
    for await (const chunk of req) body += chunk;
    setCors();

    try {
      const { deliveryId, riderId } = JSON.parse(body || "{}");
      if (!deliveryId || riderId == null) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, message: "deliveryId and riderId are required." }));
        return;
      }

      // Authoritative assignment from Laravel. Overrides any client-claimed
      // acceptance so location streaming ownership is trustworthy.
      const existing = activeTrips.get(String(deliveryId)) || {};
      activeTrips.set(String(deliveryId), {
        ...existing,
        status: "assigned",
        assignedRiderId: riderId
      });

      if (onlineRiders.has(riderId)) {
        onlineRiders.get(riderId).status = "busy";
      }

      io.to(`trip:${deliveryId}`).emit("rider_assigned", { deliveryId, riderId, timestamp: Date.now() });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, message: "Trip assignment recorded." }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, message: e.message }));
    }
    return;
  }

  if (req.method === "POST" && (req.url === "/trip/complete" || req.url === "/trip/cancel")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    setCors();

    try {
      const { deliveryId, riderId } = JSON.parse(body || "{}");
      if (!deliveryId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, message: "deliveryId is required." }));
        return;
      }

      const terminal = req.url === "/trip/cancel" ? "cancelled" : "completed";
      const now = Date.now();

      // Shared terminal logic: mark trip, release the rider, build the events,
      // evict the RAM trip. Duplicate terminal calls are harmless no-ops.
      const result = applyTripTerminal(activeTrips, onlineRiders, {
        deliveryId,
        riderId,
        terminal,
        now
      });

      for (const ev of result.events) {
        io.to(ev.room).emit(ev.eventName, ev.data);
      }

      // Stop tracking: tell anyone still in the room (e.g. the tourist's live
      // map) to stop, then eject them. Late location fixes are already refused
      // by canRiderStreamForDelivery ('trip_completed'/'trip_cancelled').
      io.in(result.room).socketsLeave(result.room);

      console.log(`[Trip ${terminal.toUpperCase()}] Delivery #${result.room} ended — activeTrips removed? ${result.removed}`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        message: `Trip ${terminal} / room notified.`,
        removed: result.removed,
        events: result.events.length
      }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, message: e.message }));
    }
    return;
  }

  // P11.5 — Status-event bridge: Laravel routes canonical status events to the
  // audience rooms it computed. Only the supported room shapes are accepted;
  // unauthorized/unknown rooms are rejected before any emit happens.
  if (req.method === "POST" && req.url === "/event") {
    let body = "";
    for await (const chunk of req) body += chunk;
    setCors();

    try {
      const payload = JSON.parse(body || "{}");
      const routed = routeStatusEvent(payload);

      if (!routed.ok) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, message: `Invalid event payload: ${routed.reason}` }));
        return;
      }

      for (const { room, eventName, data } of routed.emits) {
        io.to(room).emit(eventName, data);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, emits: routed.emits.length }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, message: e.message }));
    }
    return;
  }

  if (req.method === "GET" && req.url === "/status") {
    setCors();
    const radar = [];
    for (const [riderId, rData] of onlineRiders.entries()) {
      radar.push({
        riderId,
        status: rData.status,
        vehicleType: rData.vehicleType,
        lat: rData.lat,
        lng: rData.lng,
        updatedAt: rData.updatedAt || null,
        socketId: rData.socketId
      });
    }
    const trips = [];
    for (const [deliveryId, tData] of activeTrips.entries()) {
      trips.push({
        deliveryId,
        status: tData.status,
        assignedRiderId: tData.assignedRiderId || null,
        currentCandidateIndex: tData.currentCandidateIndex ?? null,
        eligibleCount: Array.isArray(tData.eligibleRiders) ? tData.eligibleRiders.length : null
      });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ onlineRiderCount: radar.length, activeTripCount: trips.length, onlineRiders: radar, activeTrips: trips }));
    return;
  }

  setCors();
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: false, message: "Not found." }));
});

httpServer.listen(BRIDGE_PORT, () => {
  console.log(`[TrackTour Engine] HTTP dispatch bridge listening on port ${BRIDGE_PORT} (POST /dispatch)`);
});
