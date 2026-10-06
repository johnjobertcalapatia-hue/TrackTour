#!/usr/bin/env bash
set -euo pipefail

cd /var/www/html

# APP_KEY must be provided as a persistent deployment secret. Generating a new
# key on each container creation invalidates sessions and encrypted data.
if [ -z "${APP_KEY:-}" ]; then
  echo "[start-container] APP_KEY is required; set a persistent production key."
  exit 1
fi

# Refresh Laravel's package manifest (build step runs --no-scripts on purpose).
php artisan package:discover --ansi

# Local-storage uploads are served at /storage via the storage:link symlink.
php artisan storage:link --no-interaction

# Wait for the MySQL service to accept connections, then apply migrations.
# The database may start alongside this container, so retry before failing.
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

if [ "$DB_READY" != "1" ]; then
  echo "[start-container] Database never became reachable; refusing to start application services."
  exit 1
fi

php artisan migrate --force --no-interaction

# Fresh caches/clear any stale build artifacts.
php artisan config:clear
php artisan route:clear

exec supervisord -n -c /etc/supervisor/supervisord.conf