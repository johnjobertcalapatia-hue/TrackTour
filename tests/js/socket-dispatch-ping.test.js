// Integration test for the order → rider ping delivery path.
//
// The previous socket tests only exercised pure helpers; nothing proved that a
// connected rider's socket actually RECEIVES order_received_ping when the
// backend dispatches an order. This boots the real socket-server.js as a child
// process and speaks both sides of the bridge contract:
//
//   rider socket  --driver_go_online-->  socket engine (RAM radar)
//   Laravel bridge --POST /dispatch---->  socket engine --order_received_ping--> rider socket
//
// Run with: npm run test:js
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SECRET = 'test-bridge-secret';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Real socket engine on ephemeral ports, ready to accept bridge traffic. */
async function startEngine() {
  const socketPort = await getFreePort();
  const bridgePort = await getFreePort();

  const child = spawn(process.execPath, ['socket-server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      SOCKET_PORT: String(socketPort),
      SOCKET_BRIDGE_PORT: String(bridgePort),
      SOCKET_BRIDGE_SECRET: SECRET,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));

  const ready = async () => {
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) break;
      try {
        const res = await bridgeStatus(bridgePort);
        if (res.status === 200) return;
      } catch {
        // Bridge not listening yet — keep waiting.
      }
      await sleep(100);
    }
    throw new Error(`socket-server.js never came up:\n${logs.join('')}`);
  };
  await ready();

  return { child, socketPort, bridgePort, logs };
}

function bridgeStatus(bridgePort) {
  return fetch(`http://127.0.0.1:${bridgePort}/status`, {
    headers: { 'x-socket-secret': SECRET },
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

function postBridge(bridgePort, route, body, secret = SECRET) {
  return fetch(`http://127.0.0.1:${bridgePort}${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'x-socket-secret': secret } : {}),
    },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) }));
}

/** A rider socket, connected but not yet on the radar. */
function connectRiderSocket(socketPort) {
  return new Promise((resolve, reject) => {
    const socket = io(`http://127.0.0.1:${socketPort}`, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    const timer = setTimeout(() => reject(new Error('rider socket failed to connect')), 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Emit driver_go_online and wait until the engine's radar actually lists the rider. */
async function goOnline(socket, bridgePort, riderId, lat = 12.51, lng = 121.31, vehicleType = 'food') {
  socket.emit('driver_go_online', {
    riderId,
    currentLat: lat,
    currentLng: lng,
    vehicleType,
  });

  for (let i = 0; i < 50; i++) {
    const { body } = await bridgeStatus(bridgePort);
    const listed = (body.onlineRiders ?? []).find((r) => String(r.riderId) === String(riderId));
    if (listed) return listed;
    await sleep(50);
  }
  throw new Error(`rider ${riderId} never appeared on the radar`);
}

async function waitForBusy(bridgePort, riderId) {
  for (let i = 0; i < 50; i++) {
    const { body } = await bridgeStatus(bridgePort);
    const listed = (body.onlineRiders ?? []).find((r) => String(r.riderId) === String(riderId));
    if (listed && listed.status === 'busy') return listed;
    await sleep(50);
  }
  throw new Error(`rider ${riderId} never became busy`);
}

/** Resolve with the first matching order_received_ping, or reject on timeout. */
function awaitPing(socket, { timeoutMs = 3000, deliveryId } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('order_received_ping', handler);
      reject(
        new Error(
          `no order_received_ping within ${timeoutMs}ms${deliveryId !== undefined ? ` for delivery ${deliveryId}` : ''}`
        )
      );
    }, timeoutMs);

    const handler = (payload) => {
      if (deliveryId !== undefined && String(payload?.deliveryId) !== String(deliveryId)) return;
      clearTimeout(timer);
      socket.off('order_received_ping', handler);
      resolve(payload);
    };

    socket.on('order_received_ping', handler);
  });
}

/** Resolve with the ping if it arrives before the window closes, else null. */
async function awaitNoPing(socket, deliveryId, windowMs = 700) {
  try {
    return await awaitPing(socket, { timeoutMs: windowMs, deliveryId });
  } catch {
    return null;
  }
}

/**
 * Wait until the engine's radar lists EXACTLY the given rider ids. Riders
 * disconnected by a previous test are removed asynchronously; gating on the
 * exact set makes a radar-scan dispatch deterministic instead of depending on
 * how quickly the engine processed the previous test's disconnects.
 */
async function waitForRadarOnly(bridgePort, expectedIds, logs = []) {
  const expected = expectedIds.map(String).sort();
  for (let i = 0; i < 100; i++) {
    const { body } = await bridgeStatus(bridgePort);
    const actual = (body.onlineRiders ?? []).map((r) => String(r.riderId)).sort();
    if (actual.length === expected.length && expected.every((id, idx) => actual[idx] === id)) return;
    await sleep(50);
  }
  throw new Error(`radar never settled to [${expected.join(', ')}] — engine.logs:\n${logs.join('')}`);
}

describe('socket engine delivers the order ping to an online rider', () => {
  let engine;
  const sockets = [];
  let nextRiderId = 7100;
  let nextDeliveryId = 9100;

  const newRiderId = () => nextRiderId++;
  const newDeliveryId = () => nextDeliveryId++;

  before(async () => {
    engine = await startEngine();
  });

  afterEach(() => {
    // Disconnecting a rider's socket also wipes their entry from the engine's
    // RAM radar (socket-server.js `disconnect` handler), so a rider from one
    // test can never intercept the radar ping of a later test.
    for (const socket of sockets) socket.disconnect();
    sockets.length = 0;
  });

  after(() => {
    for (const socket of sockets) socket.disconnect();
    engine?.child?.kill();
  });

  const registerRider = async () => {
    const riderId = newRiderId();
    const socket = await connectRiderSocket(engine.socketPort);
    sockets.push(socket);
    await goOnline(socket, engine.bridgePort, riderId);
    return { socket, riderId };
  };

  it('pings the preferred rider named by the backend for a dispatched order', async () => {
    const { socket, riderId } = await registerRider();
    const deliveryId = newDeliveryId();

    const ping = awaitPing(socket, { deliveryId });
    const res = await postBridge(engine.bridgePort, '/dispatch', {
      deliveryId,
      restaurantName: 'Lucky Garden',
      restaurantLat: 12.51,
      restaurantLng: 121.31,
      riderId,
      timeoutSeconds: 45,
    });

    assert.equal(res.status, 200, 'the bridge accepted the dispatch');
    assert.equal(res.body.success, true, res.body.message ?? '');

    const payload = await ping;
    assert.equal(String(payload.deliveryId), String(deliveryId));
    assert.equal(payload.restaurantName, 'Lucky Garden');
    assert.equal(payload.timeoutSeconds, 45);
    assert.ok(payload.distanceKm >= 0, 'the ping carries a distance to the pickup');
  });

  it('pings the nearest online rider when the backend names no preferred rider', async () => {
    const { socket, riderId } = await registerRider();
    await waitForRadarOnly(engine.bridgePort, [riderId], engine.logs);
    const deliveryId = newDeliveryId();

    const ping = awaitPing(socket, { deliveryId });
    const res = await postBridge(engine.bridgePort, '/dispatch', {
      deliveryId,
      restaurantName: 'Radar Fallback',
      restaurantLat: 12.51,
      restaurantLng: 121.31,
      riderId: null,
      timeoutSeconds: 45,
    });

    assert.equal(res.status, 200, 'the bridge accepted the blind dispatch');
    const payload = await ping;
    assert.equal(String(payload.deliveryId), String(deliveryId));
    assert.ok(riderId > 0);
  });

  it('does not ping a rider whose socket never registered on the radar', async () => {
    const deliveryId = newDeliveryId();
    const unridered = await connectRiderSocket(engine.socketPort);
    sockets.push(unridered);

    const ping = await awaitNoPing(unridered, deliveryId);

    assert.equal(ping, null, 'an unregistered socket must not be handed a dispatch');
  });

  it('skips the busy preferred rider and pings the other online rider', async () => {
    const busy = await registerRider();
    const free = await registerRider();

    // The busy rider accepted a trip earlier: authoritative assignment marks
    // them busy on the radar, so they can never be handed a second order.
    const assigned = await postBridge(engine.bridgePort, '/trip/assign', {
      deliveryId: newDeliveryId(),
      riderId: busy.riderId,
    });
    assert.equal(assigned.status, 200);
    await waitForBusy(engine.bridgePort, busy.riderId);
    await waitForRadarOnly(engine.bridgePort, [busy.riderId, free.riderId], engine.logs);

    const deliveryId = newDeliveryId();
    const missedByBusy = await awaitNoPing(busy.socket, deliveryId);
    assert.equal(missedByBusy, null, 'a busy rider must never receive a second offer');

    const ping = awaitPing(free.socket, { deliveryId });
    const res = await postBridge(engine.bridgePort, '/dispatch', {
      deliveryId,
      restaurantName: 'Busy Skip',
      restaurantLat: 12.51,
      restaurantLng: 121.31,
      riderId: busy.riderId,
      timeoutSeconds: 45,
    });

    assert.equal(res.status, 200, 'the bridge still accepted the dispatch');
    const payload = await ping;
    assert.equal(String(payload.deliveryId), String(deliveryId), 'the free rider was pinged instead');
  });

  it('rejects a dispatch without the shared secret so a missing secret is loud, not silent', async () => {
    const { socket } = await registerRider();
    const deliveryId = newDeliveryId();

    const ping = await awaitNoPing(socket, deliveryId);
    const res = await postBridge(engine.bridgePort, '/dispatch', {
      deliveryId,
      restaurantName: 'No Secret',
      restaurantLat: 12.51,
      restaurantLng: 121.31,
      riderId: null,
      timeoutSeconds: 45,
    }, '');

    assert.equal(res.status, 401, 'an unauthenticated bridge call never reaches the riders');
    assert.equal(ping, null, 'no rider received a ping from a rejected dispatch');
  });

  it('rejects an incomplete dispatch payload instead of emitting a malformed ping', async () => {
    const { socket } = await registerRider();
    const deliveryId = newDeliveryId();

    const ping = await awaitNoPing(socket, deliveryId);
    const res = await postBridge(engine.bridgePort, '/dispatch', {
      deliveryId,
      restaurantLat: null,
      restaurantLng: null,
      riderId: null,
    });

    assert.equal(res.status, 400, 'missing pickup coordinates are rejected');
    assert.equal(ping, null, 'no rider received a ping from an invalid dispatch');
  });
});
