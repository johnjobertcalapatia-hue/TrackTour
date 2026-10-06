#!/usr/bin/env bash
set -euo pipefail

cd /var/www/html

# A persistent APP_KEY is recommended via Railway env. If absent (first deploy),
# generate one so the app can boot; save it back to the environment afterward.
if [ -z "${APP_KEY:-}" ]; then
  php artisan key:generate --force --no-interaction || true
fi

# Refresh Laravel's package manifest (build step runs --no-scripts on purpose).
php artisan package:discover --ansi || true

# Local-storage uploads are served at /storage via the storage:link symlink.
php artisan storage:link --no-interaction || true

# Wait for the MySQL service to accept connections, then apply migrations.
# Railway brings the database up in parallel with this container, so retry.
DB_READY=0
for i in $(seq 1 30); do
  if php -r 'try {
    new PDO(
      "mysql:host=" . (getenv("DB_HOST") ?: "") . ";port=" . (getenv("DB_PORT") ?: "3306") . ";dbname=" . (getenv("DB_DATABASE") ?: ""),
      getenv("DB_USERNAME") ?: "",
      getenv("DB_PASSWORD") ?: ""
    );
    exit(0);
    } catch (Exception $e) { exit(1); }' 2>/dev/null; then
    DB_READY=1
    break
  fi
  echo "[start-container] Waiting for database... ($i/30)"
  sleep 5
done

if [ "$DB_READY" = "1" ]; then
  php artisan migrate --force --no-interaction || echo "[start-container] migrate failed — check DB credentials"
else
  echo "[start-container] Database never became reachable; starting services anyway."
fi

# Fresh caches/clear any stale build artifacts.
php artisan config:clear || true
php artisan route:clear || true

exec supervisord -n -c /etc/supervisor/supervisord.conf