# TrackTour deployment plan — Render

**Status:** planning only. No Render services, database, or domain have been
created.  
**Repository revision reviewed:** `db09758` (`main`) plus uncommitted working
tree (crash fixes + deployment-readiness changes) re-verified before commit.  
**Goal:** deploy the React frontend, Laravel API, MySQL data, and Socket.IO
realtime service while preserving the existing payment, dispatch, and rider
tracking architecture.

## 1. Recommendation

Render can host the frontend and Docker-based PHP/Node services, but a complete
production TrackTour deployment is **not a zero-cost Render deployment**:

- Render's free database offering is PostgreSQL, while this project is built
  for MySQL (`pdo_mysql`, MySQL-specific migrations, and MySQL configuration).
- Render's free web services sleep after inactivity, have ephemeral filesystems,
  and cannot receive private-network traffic. That conflicts with always-on
  dispatch/realtime/background processing and the Laravel-to-Socket.IO bridge.
- Render does not offer a managed MySQL service. A separate MySQL provider is
  required.
- The app stores business media and identity documents on Laravel's `public`
  filesystem disk. Those files must not be left on an ephemeral service disk.

**Recommended production shape:** Render Static Site for React; paid Render
Docker Web Services for Laravel and Socket.IO in the same region/workspace;
managed MySQL outside Render; persistent upload storage; and a separately
controlled scheduler/queue process. Use a Render persistent disk for the
lowest-change single-instance deployment, or add/configure S3-compatible
object storage before choosing horizontal scaling.

A free Render deployment can be used for a frontend preview or limited
non-production API experiment, but it is not a dependable deployment of all
TrackTour features. Do not change the application database to PostgreSQL just
to fit the free plan without a separate compatibility assessment and migration
project.

## 2. Application topology

```text
Browser
  ├── https://<frontend-domain>       Render Static Site (React/Vite)
  ├── https://<api-domain>            Laravel 12 / PHP 8.2 Docker Web Service
  │       ├── managed external MySQL  MySQL 8-compatible service
  │       ├── one queue worker        database-backed queue
  │       ├── one scheduler           Laravel scheduled commands
  │       └── private HTTP → socket:3002
  └── https://<socket-domain>         Socket.IO Web Service (public websocket)
          └── private HTTP bridge:3002 (API only)
```

Use one region for the Render API and Socket.IO services and place the external
MySQL database in a nearby region. The public Socket.IO endpoint and private
Laravel bridge are separate listeners in the current server; only the public
listener is exposed to browsers.

## 3. Required accounts, services, and decisions

### Accounts and access

- GitHub access to `johnjobertcalapatia-hue/TrackTour`, branch `main`.
- A Render account and permission to create services in one workspace/region.
- A MySQL 8-compatible database provider with persistent storage, backups,
  TLS support, and network access from Render. Render itself does not provide
  managed MySQL.
- A storage decision for uploaded media and identity documents:
  - **Lowest code change:** paid Render disk mounted at
    `/var/www/html/storage/app`; keep the API to one instance. This preserves
    both public media and the private verification-document disk.
  - **Scale-out option:** S3-compatible object storage. The repository has an
    S3 disk configuration, but confirm/install the Laravel Flysystem S3 adapter
    and test public media plus authenticated private-document retrieval and
    deletion before using it.
- Production PayMongo account credentials and a configured webhook.
- A working SMTP account for verification, password recovery, and notifications.
- Optional domain/DNS access. Suggested names: `tracktour.com`,
  `api.tracktour.com`, and `socket.tracktour.com`.

### Production readiness decisions

- Confirm whether this deployment is a demo or will handle real users,
  identity documents, orders, or payments. Use paid always-on compute and
  durable storage for real production data.
- Decide whether the database will be fresh or imported from XAMPP. The
  existing Compose notes assume a fresh database; importing data requires a
  separately planned MySQL backup/restore and cutover.
- Adopt the existing policy: verification files are private and can be read
  only by the document owner or Tourism Office staff. Confirm retention and
  backup controls for rider IDs and business verification documents.
- Choose test vs live PayMongo keys only after verifying the PayMongo account,
  webhook, and return URLs. Never put secret keys in frontend build variables.
- Create the first Tourism Office administrator through a reviewed secure
  procedure. **Do not run the current demo seeder in production.**

## 4. Local deployment-readiness audit

The local audit and disposable Docker smoke test are complete. No Render
services or production resources have been created.

### Resolved and verified locally

1. **Runtime ports:** Apache now adapts its listener and virtual host to the
   injected `PORT` (defaulting to 80 for local Compose). The Socket.IO listener
   uses `SOCKET_PORT` when explicitly set and otherwise falls back to Render's
   `PORT`; its bridge remains on port 3002. Both image behaviors were exercised.
2. **Background processes:** the API image successfully ran Apache,
   `schedule:work`, and `queue:work` under Supervisor; the scheduler and queue
   worker run as `www-data`. Keep one API instance while these processes share
   the container, or separate them before scaling.
3. **MySQL health and migrations:** the Compose healthcheck now uses
   `mysqladmin ping` (the previously configured `healthcheck.sh` is absent
   from the MySQL image). A disposable MySQL 8.4 database became healthy and
   all 201 Laravel migrations ran with none pending.
4. **Laravel production boot:** local development files in
   `bootstrap/cache/` included a package manifest referencing dev-only Pail.
   Those generated PHP caches are now excluded from the Docker build context;
   the production API started and passed `/up`.
5. **Build and dependencies:** API, Socket.IO, and frontend images built
   successfully. NPM and Composer audits reported no remaining advisories for
   the audited dependency sets.
6. **Socket and frontend:** the socket bridge health endpoint returned
   `200 {"status":"ok"}`; the frontend served its production `index.html`.
   Compose reported API, database, and Socket.IO as healthy.
7. **Verification-document privacy:** new KYC, rider, and business
   verification documents are written to Laravel's private local disk.
   Authenticated download routes enforce owner-or-Tourism-Office access and
   return private/no-store responses. The admin and business-owner document
   views use bearer-authenticated downloads. A dry-run/`--apply` command moves
   legacy verification files from public to private storage with SHA-256
   integrity checks before deleting public copies. The isolated Compose smoke
   test passed: owner `200`, cross-owner `404`, guest `401`, legacy public URL
   `403`, and ordinary public media `200`. Run the migration command as the
   same OS user as the web service (`www-data` in this image), or private files
   created by a root-run command may not be readable by Apache.
8. **Frontend crash fixes (working tree, re-verified):** three runtime-fatal
   undefined-symbol errors were resolved and re-validated in the current working
   tree: the staff dashboard referenced a missing `TourismBackdrop` component,
   and the rider map referenced a missing `StatusBadge` import and a missing
   `getStatusActions` function (restored to match the canonical
   `RiderDeliveriesActive.tsx` flow and the backend's allowed transitions). A
   latent type-only error (`activeDelivery` narrowing to `never` on a dead
   `activeDelivery?.id === d.id` comparison inside the `!activeDelivery`
   branch) was removed. `tsc --noEmit` reports 0 errors in the fixed files;
   126 pre-existing type errors remain inventoried (unused vars, typed-access
   narrowing, react-query generics) and are triaged, not ignored. The two
   changed files lint clean (oxlint) apart from a pre-existing unused `staff`
   variable; all 128 frontend tests pass; the production build succeeds.
9. **Image context hygiene (working tree, verified in the built image):** the
   API image runs `COPY . .`, so `docker run --entrypoint ls` was used to
   confirm dev diagnostics (`_db_check.php`, `_schema_check.php`,
   `_final_check.php`, `make_checkpoint_pdf.php`, `test_cookies.txt`) and the
   Obsidian vault folders (`00-project/`…`06-ui-ux/`) are now excluded via
   `.dockerignore` and no longer ship in the image.

### Production gates still requiring configuration or a decision

1. **Existing verification-file migration (release blocker for real users):**
   back up production storage and database, run
   `verification-documents:privatize` as the web-service user to inspect the
   dry-run report, then run it with `--apply` as that same user and verify every
   referenced file exists on the private disk and no longer exists on the
   public disk. The command fails closed for missing, unsafe, mismatched, or
   unrecognized file paths. Purge any external CDN/proxy caches of prior public
   document URLs. Do not serve real documents until this migration and access
   checks pass.
2. **Historical migration safety (release blocker):** the disposable empty
   MySQL 8.4 database accepted all 201 migrations, but that does not prove they
   are safe against a populated target. In particular,
   `2026_07_06_000012_rebuild_business_documents_table.php`,
   `2026_07_15_054106_rebuild_business_documents_to_uploads_table.php`, and
   `2026_07_23_120000_restructure_required_documents_table.php` drop/recreate
   document tables. Before any production migration, compare the real
   `migrations` table with these files, inspect affected table schemas and data,
   and confirm a recoverable database backup. Do not run
   `php artisan migrate --force` until this review is complete.
   The local read-only audit is currently blocked: `.env` targets
   `APP_ENV=local` / `localhost` / `track_tour_db`, and the XAMPP MariaDB
   process drops the MySQL protocol handshake. Its error log reports InnoDB
   future-LSN and discarded-tablespace warnings. No database status, schema,
   row counts, backup, or repair was performed. This local configuration does
   not establish the state of a Render/production database.
3. **Render networking:** use paid services in the same workspace and region
   so Laravel can reach the socket bridge through the private hostname. Keep
   port `3002` private; this connectivity cannot be validated until Render is
   configured.
4. **Domains and authentication:** set the final frontend/API origins in
   Laravel CORS, `FRONTEND_URL`, and `SANCTUM_STATEFUL_DOMAINS`, then test
   login, cookies/tokens, redirects, and credentialed API requests at those
   hostnames.
5. **Durable uploads:** use a persistent disk mounted at
   `/var/www/html/storage/app` for the single-instance option so both
   `/public` media and `/private` verification documents persist, or configure
   and test S3-compatible storage before scaling. Configure backups and a
   restore procedure. Never mount the private disk under a public web path.
6. **Database operations:** the Compose startup path applies migrations.
   Back up production before schema changes and prevent concurrent migrations;
   do not scale the combined API/scheduler/worker service horizontally.
7. **Secrets and production acceptance:** use Render secret variables for
   `APP_KEY`, database credentials, PayMongo server/webhook keys, mail
   credentials, and `SOCKET_BRIDGE_SECRET`. Finish the deployed-host smoke
   tests in §8 before enabling real users or payments.

## 5. Render service configuration

### A. React Static Site

- Connect the GitHub repository and select branch `main`.
- Root directory: `frontend`.
- Build command: `npm ci && npm run build`.
- Publish directory: `dist`.
- Add an SPA rewrite from `/*` to `/index.html` with status `200`.
- Set build-time environment variables:

  | Variable | Value |
  |---|---|
  | `VITE_API_URL` | `https://<api-domain>` |
  | `VITE_API_ORIGIN` | `https://<api-domain>` |
  | `VITE_SOCKET_URL` | `https://<socket-domain>` |
  | `VITE_PAYMONGO_PUBLIC_KEY` | PayMongo **public** key for the selected environment |
  | `VITE_NGROK_HOST` | Leave unset |

Vite embeds these values during the build. Redeploy the Static Site after
changing any of them. Never put `PAYMONGO_SECRET_KEY`, webhook secrets,
database credentials, `APP_KEY`, or `SOCKET_BRIDGE_SECRET` in this service.

### B. Laravel API Web Service

- Create a Docker Web Service from the repository.
- Root/build context: repository root.
- Dockerfile: `Dockerfile`.
- Apache adapts to Render's injected `PORT`; it defaults to port 80 for local
  Compose. Keep one API instance while the scheduler and queue worker share
  this container.
- Health check path: `/up`.
- Set `APP_ENV=production`, `APP_DEBUG=false`, and a persistent `APP_KEY`.
- Set `APP_URL`, `FRONTEND_URL`, `SANCTUM_STATEFUL_DOMAINS`, and `SESSION_DOMAIN`
  to the final deployed domains as appropriate.
- Set MySQL connection values: `DB_CONNECTION=mysql`, `DB_HOST`, `DB_PORT`,
  `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`; enable provider-required TLS.
- Keep `SESSION_DRIVER=database`, `CACHE_STORE=database`, and
  `QUEUE_CONNECTION=database` unless the architecture is deliberately changed.
- Set `FILESYSTEM_DISK` to the verified persistent disk or configured S3 disk.
- Configure `SOCKET_SERVER_URL=http://<socket-private-host>:3002` and the same
  high-entropy `SOCKET_BRIDGE_SECRET` used by the Socket.IO service.
- Configure PayMongo server-side keys, `PAYMONGO_BASE_URL`, SMTP settings, and
  the GPS/trip token settings from the deployment environment.
- Never expose port `3002` publicly.

The Docker image installs PHP 8.2 and `pdo_mysql`, and runs Laravel migrations
at container start. A fresh disposable MySQL 8.4 run completed all 201
migrations. Before production, back up the database and ensure migrations run
once per release; boot failures must remain visible in Render logs.

### C. Socket.IO Web Service

- Create a second Docker Web Service from the same repository.
- Dockerfile: `Dockerfile.socket`; build context: repository root.
- Set `NODE_ENV=production`.
- Leave `SOCKET_PORT` unset so the server uses Render's injected `PORT`, or set
  it to that same value. Set `SOCKET_BRIDGE_PORT=3002`.
- Set the same `SOCKET_BRIDGE_SECRET` as the API.
- Configure `SOCKET_LOCATION_MIN_INTERVAL_MS=1000` and
  `SOCKET_PENDING_TRIP_TTL_MS=120000` unless an approved configuration change
  says otherwise.
- Expose the public Socket.IO listener through the service URL/custom domain.
  Allow WebSocket upgrades and the polling fallback used by Socket.IO.
- The API must call port `3002` over Render's private network. Confirm service
  logs and a real authorized dispatch/accept/location flow; a browser handshake
  alone does not validate the private bridge.

### D. MySQL and upload persistence

- Provision an external MySQL 8-compatible database sized for expected traffic.
- Require TLS where supported; restrict inbound connections to the required
  provider/Render network path; keep credentials only in the API service's
  secret environment variables.
- Enable and test automated backups and a restore procedure before loading
  real data.
- For the persistent-disk option, mount at
  `/var/www/html/storage/app`, test write/read permissions for both `public`
  and `private`, verify intended `/storage/...` media URLs, and confirm
  private documents cannot be retrieved without an authorized API token.
  Accept the single-instance limitation.
- For object storage, use private credentials on the API only; separately test
  authorized access to rider/business documents and public access only for
  intended public media.

## 6. Environment variable inventory

| Scope | Required values |
|---|---|
| API | `APP_ENV`, `APP_DEBUG`, `APP_KEY`, `APP_URL`, `FRONTEND_URL`, `SANCTUM_STATEFUL_DOMAINS`, `DB_CONNECTION`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`, `SESSION_DRIVER`, `CACHE_STORE`, `QUEUE_CONNECTION`, `FILESYSTEM_DISK`, `SOCKET_SERVER_URL`, `SOCKET_BRIDGE_SECRET`, PayMongo secret/public/webhook keys, mail settings |
| Socket.IO | `NODE_ENV`, `PORT`/`SOCKET_PORT`, `SOCKET_BRIDGE_PORT`, `SOCKET_BRIDGE_SECRET`, `SOCKET_LOCATION_MIN_INTERVAL_MS`, `SOCKET_PENDING_TRIP_TTL_MS` |
| Frontend build | `VITE_API_URL`, `VITE_API_ORIGIN`, `VITE_SOCKET_URL`, `VITE_PAYMONGO_PUBLIC_KEY` |
| Optional storage | S3-compatible key, secret, region, bucket, endpoint, and path-style setting if object storage is selected |

Generate unique production secrets. `APP_KEY`, database passwords, PayMongo
secret/webhook keys, SMTP credentials, and `SOCKET_BRIDGE_SECRET` are
server-side secrets. A Vite `VITE_*` value is public to every browser user.

## 7. Deployment sequence

1. **Choose deployment class:** demo vs production; free preview vs paid
   always-on service; fresh database vs import; persistent disk vs object
   storage.
2. **Prepare code and tests:** use the completed local audit in §4; rerun the
   full backend suite, frontend tests/build, Socket.IO tests, and all three
   Docker image builds from the exact release commit.
3. **Provision storage first:** create the MySQL database and upload storage;
   verify TLS, backup policy, connectivity, and restore procedure.
4. **Create Socket.IO service:** configure its port, secret, health behavior,
   and region; record its public URL and private hostname.
5. **Create API service:** configure environment variables and secrets,
   migration procedure, `/up` health check, upload mount, and private socket
   bridge address.
6. **Create Static Site:** configure root/build/publish/rewrite and Vite
   variables using the API/socket URLs.
7. **Add domains and TLS:** attach frontend, API, and socket hostnames to the
   matching services; apply the DNS records Render provides and wait for
   certificate provisioning.
8. **Deploy schema safely:** snapshot/backup the database, run migrations once,
   inspect the migration status and required indexes/constraints, and verify a
   rollback/restore path. Do not seed demo accounts into production.
9. **Migrate existing verification documents:** after backing up both database
    and files, run the privatization command in dry-run mode, resolve any
    reported paths/files, apply it, and verify owner/staff access plus denied
    cross-account access before enabling real-user traffic.
10. **Configure PayMongo:** set the live webhook URL to
    `https://<api-domain>/api/payments/webhook`; verify provider signatures and
    return URLs using the correct environment.
11. **Smoke and acceptance test:** follow the checks in §8 before enabling
    real users or payments.

## 8. Verification and release gate

### Build and test gate

- Laravel: **573 passed / 3,137 assertions / 0 failures / 2 skipped** in the
  local audit. The skips are SQLite limitations: unsupported Haversine SQL
  functions and SQLite's handling of a dashboard `HAVING` query. Re-run from
  the exact release commit and document any environment skips.
- Frontend: **128 tests passed across 18 files**; production build succeeded.
  Vite warns that the main JavaScript bundle exceeds 500 kB; consider code
  splitting as a separate performance improvement.
- Socket.IO: **52 tests passed / 0 failures**.
- Docker: API, Socket.IO, and frontend images built; the isolated Compose
  privacy smoke test passed. The Render port behavior and non-root worker
  processes were checked.
- Database: all **201 migrations ran** against an empty disposable MySQL 8.4
  database; API and Socket.IO healthchecks passed. No production database was
  used.
- Verification-document privacy: unit and live-container access/migration
  checks passed; no real production files have been migrated by this local
  audit. Run the migration as the web-service user and complete the production
  database/storage backup and legacy-file audit before release.

### Live smoke checks

1. Frontend root loads over HTTPS, static assets return correct MIME types, and
   client-side routes refresh successfully.
2. API `/up` returns success; login and authenticated API calls work from the
   deployed frontend origin without CORS/cookie errors.
3. Socket.IO connects from the browser over HTTPS/WebSocket and polling
   fallback. Confirm authorized room isolation.
4. API-to-socket bridge works privately with the shared secret; confirm
   dispatch ping reaches only eligible rider clients.
5. Create a test order and exercise rider offer/accept, preparation gate,
   restaurant ready event, delivery state, and reconnect recovery.
6. Upload and retrieve test media; verify private document access for the
   owning rider/business and Tourism Office staff, denied cross-account access,
   and failure for missing files. Confirm uploads survive service
   restart/redeploy.
7. Test payment in PayMongo test mode, webhook idempotency, refund retry, COD
   settlement, and rider payout reporting before enabling live payments.
8. Confirm scheduler and queue-worker logs show one active scheduler and a
   healthy worker; verify scheduled dispatch/refund/GPS cleanup behavior.
9. Check Render logs/health after restart and deploy. Set up alerts and a
   routine database backup/restore drill.

## 9. Free-tier feasibility

Render officially describes free instances as suitable for hobby/testing, not
production. Free web services spin down after 15 minutes without traffic and
have ephemeral filesystems; free web services cannot receive private-network
traffic. The free Render database is PostgreSQL and expires after 30 days.
Render forwards public web traffic to only one HTTP port per service.

Consequences for this repository:

- The React Static Site can be hosted free, subject to included bandwidth and
  build limits.
- A free API may sleep and lose local uploads; scheduled tasks and queue work
  are not dependable while it is stopped.
- The current Laravel app requires MySQL; a PostgreSQL switch is not a
  deployment-only change.
- The API cannot use Render private networking to receive the current
  Socket.IO bridge on port `3002` when the relevant service is free.
- A free preview with limited features is possible only after the app's
  connectivity/storage behavior is deliberately adapted and accepted. Do not
  present it as a production-ready food ordering, payment, or GPS tracking
  deployment.

## 10. Security and operations rules

- Keep `.env`, `.env.production`, uploaded documents, private keys, and
  credentials out of Git and Docker build contexts.
- Never put PayMongo secret/webhook credentials, database credentials,
  `APP_KEY`, mail passwords, or bridge secret in a `VITE_*` variable.
- Keep socket bridge port `3002` private; only the API uses its authenticated
  bridge routes.
- Do not run `php artisan db:seed --force` in production. The current seeder
  creates demo data and Tourism Office accounts with a default password.
- Back up MySQL and uploaded files before migrations or app upgrades; test
  restoration. Keep the existing provider, webhook idempotency, refund,
  COD settlement, rider acceptance, and GPS authorization guarantees intact.
- Keep verification files on the private disk and serve them only through
  authenticated, owner-or-Tourism-Office API routes. Run the legacy-file
  privatization command before enabling production uploads; verify prior
  public copies were removed.
- Keep production error reporting enabled while `APP_DEBUG=false`; never expose
  exception details or environment values in public responses/log screenshots.

## 11. Official Render references

- [Free services and limitations](https://render.com/docs/free)
- [Web services and port binding](https://render.com/docs/web-services)
- [Docker deployments](https://render.com/docs/docker)
- [Private networking](https://render.com/docs/private-network)
- [Persistent disks](https://render.com/docs/disks)
- [Static sites](https://render.com/docs/static-sites)
