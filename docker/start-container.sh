#!/usr/bin/env bash
set -euo pipefail

cd /var/www/html

# Render injects PORT for public web services. Keep the local Compose default
# at 80 while allowing the same image to serve Render's assigned port.
PORT="${PORT:-80}"
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "[start-container] PORT must be a valid TCP port number."
  exit 1
fi
sed -i "s/^Listen 80$/Listen ${PORT}/" /etc/apache2/ports.conf
sed -i "s#<VirtualHost \\*:80>#<VirtualHost *:${PORT}>#" /etc/apache2/sites-available/000-default.conf

# Enforce a single Apache MPM at runtime.
# PHP runs through mod_php, so use prefork and disable event/worker.
a2dismod -f mpm_event mpm_worker
a2enmod mpm_prefork

# Diagnose Apache MPM conflicts before starting Laravel services.
echo "[start-container] Enabled Apache MPM modules:"
apache2ctl -M 2>&1 | grep -E 'mpm_(event|worker|prefork)_module' || true

echo "[start-container] Enabled MPM module files:"
find /etc/apache2/mods-enabled -maxdepth 1 \
  \( -name 'mpm_*.load' -o -name 'mpm_*.conf' \) -print

echo "[start-container] Apache configuration test:"
apache2ctl -t

# APP_KEY must be provided as a persistent deployment secret. Generating a new
# key on each container creation invalidates sessions and encrypted data.
if [ -z "${APP_KEY:-}" ]; then
  echo "[start-container] APP_KEY is required; set a persistent production key."
  exit 1
fi

mkdir -p storage/app/public storage/app/private
chown www-data:www-data storage/app/public storage/app/private

# Refresh Laravel's package manifest (build step runs --no-scripts on purpose).
php artisan package:discover --ansi

# Local-storage uploads are served at /storage via a symlink. Keep the link
# idempotent: leave an existing correct link alone, fix a stale/broken link,
# and refuse to silently delete an unexpected file at the destination path.
if [ -L public/storage ] || [ -e public/storage ]; then
  if [ -L public/storage ] && [ "$(readlink public/storage)" = "../storage/app/public" ]; then
    echo "[start-container] public/storage link is already valid."
  else
    echo "[start-container] public/storage exists but is not the expected Laravel link."
    if [ -L public/storage ] || [ -f public/storage ] || [ -d public/storage ]; then
      echo "[start-container] Refusing to overwrite an unexpected existing public/storage entry."
      ls -ld public/storage || true
    fi
  fi
else
  ln -s ../storage/app/public public/storage
  echo "[start-container] Created public/storage symlink."
fi

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

# The artisan commands above run as root, but Laravel's runtime user is
# www-data. A root-owned storage/logs file makes every Log:: write fail with
# permission denied — and every attempt to log *that* failure fails too — so
# an ordinary logged warning escalates into an unlogged HTTP 500 with no CORS
# headers. Keep Laravel's writable paths owned by its runtime user.
chown -R www-data:www-data storage bootstrap/cache

exec supervisord -n -c /etc/supervisor/supervisord.conf