# TrackTour full-stack deployment progress audit

**Audit date:** 2026-10-16
**Scope:** deployment architecture, local readiness evidence, production status,
and remaining release gates.
**Deployment target:** user confirms Railway hosting for the React frontend,
Laravel API, MySQL, and Socket.IO. This audit does not independently verify the
currently deployed Railway services or their runtime settings.

## Executive summary

TrackTour is a React/Vite frontend, Laravel API, MySQL database, and Node.js
Socket.IO realtime service. It has passed the documented application tests,
production frontend build, three Docker image builds, an isolated Compose
smoke test, and a live-container verification-document privacy check.

The application and container verification gates are documented as passed, but
the live production configuration still needs to be confirmed. The selected
managed-hosting path is Railway for the frontend, Laravel API, MySQL, and
Socket.IO, as clarified by the user. A separate
VPS-oriented Docker Compose/Caddy configuration is also present, but is not the
user-confirmed deployment target. Production database migration state,
durable file storage, domains, secrets, and deployed-host acceptance results
must be checked against the actual Railway project.

## Full-stack components

| Layer | Technology/configuration | Role and ports |
|---|---|---|
| Frontend | React, Vite, Tailwind; production Nginx image | Vite development server defaults to `3000`; production container listens on `80`. Calls Laravel APIs and Socket.IO. |
| API | Laravel 12, PHP 8.2, Apache, Sanctum | Docker image listens on `80` by default and adapts to the platform `PORT`; local XAMPP Apache uses `80`/`443`. Health endpoint: `/up`. |
| Database | Railway MySQL service (deployment guide); Compose uses MySQL `8.4` | Railway MySQL internal port is `3306`; local XAMPP configuration points to MariaDB `10.4.32` at `localhost:3306`. |
| Realtime | Node.js `22`, Socket.IO | Browser-facing listener: `3001` locally/Compose, or the platform-provided port when deployed. Laravel bridge: `3002`; keep it private. |
| Reverse proxy / TLS | Railway routing for frontend and backend services; Caddy for VPS alternative | Caddy publishes `80` and `443` only in the VPS configuration. The isolated privacy Compose check omitted Caddy; deployed Railway routing and TLS were not verified in this audit. |
| Background work | Laravel scheduler and database queue worker under Supervisor | In the current API image these run alongside Apache. Keep the combined API service to one instance unless background workers are separated to avoid duplicate schedulers/workers. |
| Uploaded files | Laravel public and private local disks | Public media belongs on durable storage. Verification documents use private storage and authenticated owner/Tourism Office routes. Do not use ephemeral container storage for persistent uploads. |
| Payments / email | PayMongo; Resend on Railway and SMTP on VPS | Production credentials, webhook, callback URLs, and live-mode acceptance are deployment configuration, not locally verified deployment evidence. |

**Storage configuration needs a privacy-specific check:** `docs/DEPLOYMENT.md`
currently recommends a Railway volume at
`/var/www/html/storage/app/public`, but protected verification documents are
stored under `storage/app/private`. Confirm the deployed Railway volume covers
both public and private uploads (for example, mount the complete
`/var/www/html/storage/app` directory, or provide separate durable mounts) and
that the private path is never web-served. A volume covering only `public`
would not make private verification uploads durable across container
replacement.

### Local development ports

The checked-in configuration documents these local development defaults:

- Frontend Vite server: `http://localhost:3000`
- XAMPP Apache/Laravel: `http://localhost` (port `80`; HTTPS commonly `443`)
- Socket.IO: `http://localhost:3001`
- Socket.IO internal bridge: port `3002`
- XAMPP MySQL/MariaDB: port `3306`

These are local-development/container ports, not proof of deployed public URLs.
In Compose, service ports are exposed to the Compose network; only Caddy maps
host ports `80` and `443`.

## Deployment paths found in the repository

### User-confirmed path: full stack on Railway

The repository's [deployment guide](./DEPLOYMENT.md) specifies:

```text
Railway project
  ├── React/Vite frontend (public HTTPS, Nginx SPA fallback)
  ├── Laravel/Apache API (public HTTPS)
  ├── Socket.IO (public listener 3001; private bridge 3002)
  └── Railway MySQL (internal port 3306)

API ── Railway private networking ── MySQL and Socket.IO bridge
API ── Railway volume or tested object storage ── uploads
```

The separate frontend container is built from `frontend/Dockerfile`; the
Laravel API remains backend-only. Verify the Railway services, private
networking, port exposure, attached volume, and build/runtime variables in the
actual provider dashboard; repository configuration alone does not prove
those settings are deployed.

### Alternative configuration: Docker Compose on a VPS

`compose.vps.yaml` defines MySQL, Laravel API, Socket.IO, frontend, and Caddy.
It uses MySQL `8.4`, separate named volumes for the database and public/private
uploads, and Caddy for ports `80`/`443`. This is a VPS-oriented configuration;
its production host, DNS, TLS issuance, firewall, persistent volume behavior,
backup procedure, and Caddy routing were not validated by the isolated test.

Do not confuse the VPS Compose option with the user's Railway target.
The old `RENDER-DEPLOYMENT-PLAN.md` is retained as historical planning
material, not the current deployment recommendation.

## Readiness evidence

| Gate | Status | Evidence / qualification |
|---|---|---|
| Laravel tests | **Passed** | 573 passed, 3,137 assertions, 0 failures, 2 understood SQLite-related skips, as recorded in `PROGRESS.md` and the Render plan. |
| Frontend tests | **Passed** | 128 tests across 18 files. |
| Frontend production build | **Passed** | Vite production build succeeded. The plan notes a main bundle-size warning; consider code-splitting as a separate performance task. |
| Socket.IO tests | **Passed** | 52 tests, 0 failures in the documented current checkpoint. |
| Docker images | **Built** | API, Socket.IO, and frontend images built locally. |
| Isolated Compose | **Passed, scoped** | API, MySQL, Socket.IO, and frontend ran in an isolated project. API and DB were healthy; Socket.IO health endpoint returned 200; frontend served production HTML. Host ports and Caddy were intentionally omitted. |
| Private-document smoke | **Passed, isolated** | Owner 200; cross-owner 404; guest 401; old public document URL 403; public media 200. Dry-run preserved the test fixture; apply moved it with verified contents. Ran as `www-data` to match Apache. No real production documents were changed. |
| Empty-database migration run | **Passed, disposable only** | 201 migration files applied to an empty MySQL 8.4 database, 0 pending. This does not establish migration safety for an existing populated database. |
| Local development DB audit | **Completed** | `PROGRESS.md` records 191 applied migration rows, 13 pending migration files, and 3 stale rows in the local test DB. None of the pending files touch document tables or drops schema in `up()`. This is not a deployment target. |
| Local DB backup | **Restore-tested, local only** | A full dump was restored to a throwaway database and counts matched. The documented backup is still on this machine; an off-box copy/checksum verification remains outstanding. |
| Unreferenced public files | **Archived, not deleted** | 215 local public files without DB references were archived and checksum-verified; originals remain in place. The archive and manifest require off-box preservation and content review before cleanup. |
| Production provider/resources | **User reports Railway hosting; not independently verified** | Current service health, URLs, production DB/storage configuration, domains, and secrets were not queried in this audit. |
| Production migration and data cutover | **Blocked** | Target database migration history and schema have not been audited. Do not assume either the local test database or the disposable Compose database is the production target. |
| Public routing, TLS, deployed flows | **Not verified** | Caddy was omitted from the isolated Compose run. Railway service routing/private bridge, domains, TLS, frontend-to-API CORS/auth, WebSocket upgrades, payments, and deployed end-to-end flows remain to be verified on the live target. |

### Database migration risk

The following historical migration `up()` paths drop and recreate document
tables:

- `2026_07_06_000012_rebuild_business_documents_table.php`
- `2026_07_15_054106_rebuild_business_documents_to_uploads_table.php`
- `2026_07_23_120000_restructure_required_documents_table.php`

They are recorded as already applied on the audited local test DB and are not
among its 13 pending migrations. Their state on any Railway or VPS
database is unknown until that exact target is inspected. A fresh empty DB
running the full history successfully does not prove these migrations safe to
apply to populated data.

The local test DB's pending migrations include three documented data
transformations. Review and validate those against a backup before applying
them to that local test DB. Do not import its stale migration rows into a fresh
production database.

## Main production blockers

1. **Confirm and provision the selected target topology:** Railway for the
   frontend, Laravel API, MySQL, and Socket.IO. Confirm regions, domains,
   ownership, budget, and whether the target database starts fresh or imports
   local data.
2. **Provision and audit the actual MySQL target:** use a read-only connection
   first to capture migration history, affected schemas, row counts, and
   document-path references. Treat any existing target independently from the
   local and disposable databases.
3. **Backups and recovery:** take a complete database backup and complete
   storage backup before target migrations or public-file removal. Verify
   restoration, keep off-box copies, and record checksums.
4. **Resolve file inventory and privacy:** on the actual target, reconcile
   database references against public/private files. Back up first; inspect
   the privatization command's dry run; apply as the web-service account;
   verify owners/staff, cross-account denial, legacy URL denial, and public
   media. Separately review/archive orphan files; the command does not move
   unreferenced paths.
5. **Make persistent storage real:** choose and test a persistent disk or
   object storage. Confirm upload survival after redeploy/restart and preserve
   public/private separation and permissions.
6. **Confirm Railway storage and private networking:** persist both
   `storage/app/public` and `storage/app/private`; the documented public-only
   volume recommendation is insufficient for private verification documents.
   Confirm Laravel reaches the socket bridge on Railway's private network at
   port `3002`, while browsers can reach only the public Socket.IO listener.
7. **Control migration execution:** the API container startup script runs
   `php artisan migrate --force`. Inspect the Railway target and backup first,
   then ensure a single controlled migration execution per release; do not
   rely on multiple scaled API replicas racing at startup.
8. **Configure secrets and hostnames:** set server-side secrets and public
   `VITE_*` build variables on the appropriate Railway services. Keep `APP_KEY`,
   DB credentials, PayMongo secret/webhook keys, mail-provider credentials, and
   `SOCKET_BRIDGE_SECRET` server-side. Only public values belong in `VITE_*`
   frontend build variables.
9. **Run deployed acceptance tests:** verify HTTPS frontend routes, API
   health/auth/CORS, Socket.IO WebSocket and polling, private API bridge,
   authorized rooms, file permissions and persistence, scheduler/queue health,
   PayMongo test-mode webhook/refund behavior, COD settlement, and logs/alerts.

## Suggested execution order

```text
Choose host and data-cutover plan
        ↓
Provision target DB and durable storage
        ↓
Read-only target schema/migration/file audit
        ↓
Database + storage backup and restore verification
        ↓
Review and approve migration plan
        ↓
Build/deploy exact release revision
        ↓
Run migrations once under supervision
        ↓
Migrate legacy documents and verify access
        ↓
Run deployed frontend/API/realtime/payment smoke tests
        ↓
Approve release, then commit/push/deploy as authorized
```

No production migration, upload cleanup, deployment, commit, or push is
authorized or reported as completed by this audit.

## Sources in this repository

- `AGENTS.md` — architecture and deployment constraints.
- `docs/PROGRESS.md` — test checkpoints, local DB backup/audit, and privacy
  inventory.
- `docs/DEPLOYMENT.md` — full-stack Railway deployment and VPS alternative
  deployment guide.
- `docs/RENDER-DEPLOYMENT-PLAN.md` — older Render-specific planning document;
  not the selected target.
- `compose.vps.yaml`, `Caddyfile`, `Dockerfile`,
  `Dockerfile.socket`, and `frontend/Dockerfile` — VPS/container topology.
- `docker/start-container.sh` and `docker/supervisord.conf` — startup,
  migrations, scheduler, and queue worker behavior.
