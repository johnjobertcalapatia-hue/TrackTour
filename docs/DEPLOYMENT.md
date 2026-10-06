# TrackTour — Production Deployment

The repository includes a self-managed VPS option in §9. The managed
Vercel/Railway setup below remains available as an alternative.

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
- `compose.vps.yaml`, `Caddyfile`, `frontend/Dockerfile`, and
  `frontend/nginx.vps.conf` — self-managed Ubuntu VPS stack with automatic
  HTTPS, private MySQL/socket bridge, and static SPA hosting.
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
4. Run the Laravel suite and resolve failures before production rollout.
5. Socket JS suite: `npm run test:js` → 51/51.
6. Log in from the frontend URL; place an order; watch the dispatch ping reach an
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

## 9. Ubuntu VPS — Docker Compose + Caddy

This option serves the React SPA, Laravel API, and Socket.IO service from
`https://tracktour.com`. Caddy obtains and renews HTTPS certificates
automatically. MySQL and the Socket.IO bridge remain private to the Docker
network; only ports 80 and 443 are published.

### Prerequisites

- Ubuntu 24.04 VPS with a public IPv4 address and at least 2 GB RAM.
- DNS `A` record for `tracktour.com` pointing to the VPS. Allow DNS time to
  propagate before starting Caddy.
- In the VPS provider firewall and Ubuntu firewall, allow inbound TCP ports
  22, 80, and 443. UDP 443 is optional (HTTP/3).
- Docker Engine and the Docker Compose plugin.

### Deploy

1. Install Docker Engine and the Compose plugin using Docker's official Ubuntu
   instructions. Clone the repository onto the VPS only after the intended
   application changes have been committed and pushed.
2. From the repository root on the VPS, create the private production
   environment file:

   ```sh
   cp deploy/vps.env.example .env.production
   chmod 600 .env.production
   ```

3. Edit `.env.production`. Set unique random values for `APP_KEY`,
   `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD`, and `SOCKET_BRIDGE_SECRET`; never reuse
   values or commit this file. Generate the Laravel key in the expected format
   with:

   ```sh
   printf 'base64:'
   openssl rand -base64 32 | tr -d '\n'
   printf '\n'
   ```

   Generate the bridge secret with `openssl rand -hex 32`. Configure the
   PayMongo live keys only when the account and webhook are production-ready.
   Configure a working SMTP account for production email.
4. Build and start the services:

   ```sh
   docker compose --env-file .env.production -f compose.vps.yaml up -d --build
   docker compose --env-file .env.production -f compose.vps.yaml ps
   docker compose --env-file .env.production -f compose.vps.yaml logs -f api caddy
   ```

   The API container waits for healthy MySQL and applies Laravel migrations.
   It exits rather than serving traffic if the persistent `APP_KEY`, database,
   or migrations are invalid.
5. Verify the public app, Laravel health endpoint, and Socket.IO handshake:

   ```sh
   curl --fail https://tracktour.com/
   curl --fail https://tracktour.com/up
   curl --include 'https://tracktour.com/socket.io/?EIO=4&transport=polling'
   ```

   The socket handshake should return HTTP 200 and an Engine.IO open packet.
   Configure the PayMongo webhook URL as
   `https://tracktour.com/api/payments/webhook`.

### Production safeguards

- This Compose setup initializes an empty MySQL database and applies
  migrations. It does not import local/XAMPP data.
- Do **not** run `php artisan db:seed --force` on production: the current
  `DatabaseSeeder` creates demo data and Tourism Office accounts with the
  default password `password`. Create production administrator accounts
  through a reviewed secure procedure and set unique passwords.
- User uploads persist in the `public_uploads` Docker volume. Back up that
  volume together with the MySQL volume; a Docker volume is not a backup.
- `mysql_data`, `public_uploads`, and Caddy's certificate/config volumes must
  not be removed during routine updates. Back up the database before schema
  changes.
- The browser-visible `VITE_PAYMONGO_PUBLIC_KEY` is built into the static
  frontend image; only the public key belongs there. Secret PayMongo keys stay
  in `.env.production` for the API.
- Routine update: pull the intended Git revision, then run the `docker compose
  ... up -d --build` command above. Keep a database backup and verify
  `/up` and payment/realtime flows after the update.