# TrackTour — Production Deployment

Target stack:

```text
Vercel                         Railway (single project)
┌──────────────┐               ┌──────────────────────────────────────┐
│ React SPA    │  HTTPS /api    │ API (Laravel + Apache)  :80        │
│ (frontend/)  ├──────────────►│  scheduler  (schedule:work)         │
│              │  HTTPS /ws    │  queue worker (queue:work database) │
│              ├──────────────►│ Socket.IO service: 3001 → browsers  │
│              │               │             3002 → bridge (Laravel) │
└──────────────┘               │ MySQL (Railway data service)        │
                               └──────────────────────────────────────┘
```

Why Vercel: Vercel can only host the static React app. Laravel needs PHP+MySQL,
the scheduler needs a long-lived OS loop, and the Socket.IO engine needs
persistent WebSocket processes — all of which run on Railway here.

Three Railway services share this repo:

| Service      | Dockerfile       | Exposed ports |
|--------------|------------------|---------------|
| API          | `Dockerfile`     | 80 (public)   |
| Socket.IO    | `Dockerfile.socket` | 3001 (public, browsers), 3002 (internal, Laravel bridge) |
| MySQL        | Railway managed service | 3306 (internal) |

---

## 1. Deployment files in this repo

- `frontend/vercel.json` — SPA fallback + Vite build/output for Vercel.
- `frontend/.env.example` — Vercel vars the frontend build reads.
- `Dockerfile` (+ `docker/apache-vhost.conf`, `docker/supervisord.conf`,
  `docker/start-container.sh`, `docker/opcache.ini`) — Laravel API image.
  On boot it waits for MySQL, runs `php artisan migrate --force`, then starts
  Apache + `schedule:work` + `queue:work database` via supervisord.
- `Dockerfile.socket` — Socket.IO image (`node socket-server.js`).
- `.dockerignore` — keeps local dev files, uploads, tests, and docs out of the
  images.

---

## 2. Railway — MySQL data service

1. New project → **Provision MySQL** (Railway-managed database).
2. Note the generated `RAILWAY_DATABASE_NAME`, `MYSQLUSER`, `MYSQLPASSWORD`,
   `MYSQLPORT`, `internal port`, and public hostname. You will reuse these as
   the API service's `DB_*` variables.

## 3. Railway — Laravel API service

1. In the same Railway project, **New Service → Port with a Dockerfile**.
2. Point it at this repo. Settings: Dockerfile Path = `Dockerfile`,
   Root Directory = repo root, public port 80.
3. Add variables:

```text
APP_ENV=production
APP_DEBUG=false
APP_KEY=<generate once: php -r "echo Illuminate\Encryption\Encrypter::generateKey()" — or php artisan key:generate --show>
APP_URL=https://<your-api-service>.up.railway.app
FRONTEND_URL=https://<your-vercel-app>.vercel.app
SANCTUM_STATEFUL_DOMAINS=<your-vercel-app>.vercel.app,localhost:3000

DB_CONNECTION=mysql
DB_HOST=<mysql service name>.railway.internal
DB_PORT=3306
DB_DATABASE=<railway DB name>
DB_USERNAME=<railway MYSQLUSER>
DB_PASSWORD=<railway MYSQLPASSWORD>

SESSION_DRIVER=database
QUEUE_CONNECTION=database
CACHE_STORE=database
FILESYSTEM_DISK=local

PAYMONGO_SECRET_KEY=sk_...
PAYMONGO_PUBLIC_KEY=pk_...
PAYMONGO_WEBHOOK_SECRET=whsk_...
PAYMONGO_BASE_URL=https://api.paymongo.com/v1

SOCKET_SERVER_URL=https://<socket-service>.up.railway.app   # the 3002 bridge
SOCKET_BRIDGE_SECRET=<same secret as the Socket.IO service>
SOCKET_TRIP_TOKEN_TTL_SECONDS=7200
SOCKET_LOCATION_MIN_INTERVAL_MS=1000
SOCKET_PENDING_TRIP_TTL_MS=120000

MAIL_MAILER=smtp
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USERNAME=...
MAIL_PASSWORD=...
MAIL_ENCRYPTION=tls
MAIL_FROM_ADDRESS=...
MAIL_FROM_NAME="Track-Tour App"
```

4. First deploy runs migrations automatically (`start-container.sh`). Verify in
   the `migrations` table. If the initial DB is empty, optionally seed a base
   set once: Railway shell → `php artisan db:seed --force`.
5. (Recommended) bind a **volume** at `/var/www/html/storage/app/public` so
   uploaded documents/media survive redeploys, and file expiry runs via
   `CleanupRiderLocations`.
6. Point PayMongo webhooks at `https://<your-api-service>.up.railway.app/api/payments/webhook`
   and the payment return URL at the API's `/api/payments/return`.

## 4. Railway — Socket.IO service

1. **New Service → Port with a Dockerfile**, same repo. Settings:
   Dockerfile Path = `Dockerfile.socket`, Root Directory = repo root.
2. Variables (must match the API service for the shared secret):

```text
NODE_ENV=production
SOCKET_PORT=3001
SOCKET_BRIDGE_PORT=3002
SOCKET_BRIDGE_SECRET=<same value as API service>
```

3. Exposure: make **3001 public** (browsers connect here — this becomes
   `VITE_SOCKET_URL`), keep **3002 internal** (only Laravel reaches it via
   `SOCKET_SERVER_URL`).

## 5. Vercel — frontend (only this repo's `frontend/`)

1. **New Project → import this repo**, then:
   - **Root Directory:** `frontend`
   - Vercel auto-detects Vite (build `npm run build`, output `dist`).
2. **Environment variables** (build-time, must be `VITE_`-prefixed):

```text
VITE_API_URL=https://<your-api-service>.up.railway.app
VITE_SOCKET_URL=https://<your-socket-service>.up.railway.app   # 3001 public
VITE_PAYMONGO_PUBLIC_KEY=pk_...
# optional: override asset origin (defaults to VITE_API_URL)
# VITE_API_ORIGIN=https://<your-api-service>.up.railway.app
```

3. Deploy. Confirm the SPA loads and that `/api/...` calls in the network tab
   go to `VITE_API_URL`.

---

## 6. Cross-service guarantees to double-check

- The **SOCKET_BRIDGE_SECRET** is the same on the API and Socket.IO services —
  otherwise every `/dispatch`, `/trip/*`, `/event` bridge call returns 401.
- `SOCKET_SERVER_URL` on the API points at the socket service's **3002** port.
- `FRONTEND_URL` on the API equals the Vercel origin (CORS: `config/cors.php`
  serves `FRONTEND_URL` verbatim).
- API is HTTPS behind Railway; Laravel trust-proxy defaults honour
  `X-Forwarded-Proto` so generated/redirect URLs keep `https`.
- Classic routes still served by Laravel (`/login`, etc.) are not part of the
  Vercel SPA; Vercel serves the React app for all routes except `/api` rewrites.

## 7. Verification checklist

1. `curl https://<api>.up.railway.app/api/health` (or any public endpoint) → JSON.
2. Socket engine: `curl https://<socket>.up.railway.app/status` → radar/trip JSON.
3. `npm run build` locally in `frontend/` → clean.
4. Full Laravel suite passes locally: `php artisan test`.
5. Socket JS suite: `npm run test:js` → 45/45.
6. Log in from the Vercel URL; place an order; watch the dispatch ping reach an
   online rider and the status flow render in realtime.

## 8. Known production notes

- The scheduler (`schedule:work`) runs inside the API container. Promoted
  commands: dispatch retries, preparation advancement, auto-cancel/refund after
  60 min, document expiry, pending-refund reconciliation, GPS cleanup.
- OCR (`tesseract` with `eng+fil`) is installed in the API image. The `fil`
  language pack install is best-effort (`|| true`); if it is unavailable on the
  base OS, OCR falls back to `eng` only — check log noise after deploy.
- Uploaded media must live on the Railway volume, not the container layer.
- No Redis: sessions/queue/cache all use MySQL (`database` drivers).