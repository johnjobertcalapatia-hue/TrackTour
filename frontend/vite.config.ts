/**
 * ✅ THIS IS THE ACTIVE VITE CONFIG — edit this file.
 *
 * `frontend/vite.config.js` no longer exists (deleted 2026-09-23); this is the
 * only Vite config under `frontend/`, so it is the live configuration.
 *
 * The `apiTarget` below is the dev API backend: XAMPP Apache, not
 * `php artisan serve :8000`. If you change it back to `:8000`, restart Vite —
 * config changes are not hot-reloaded.
 *
 * See `docs/current-status/known-issues.md` → Deployment / Environment Notes.
 */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const ngrokHost = env.VITE_NGROK_HOST || ''
  // XAMPP Apache target (mod_php, mpm_winnt) — see the proxy note below.
  const apiTarget = 'http://localhost/Capstone%20Project%201/public'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: [ngrokHost, '.ngrok-free.dev', '.ngrok.io', 'localhost', 'localhost:3000'].filter(Boolean),
      hmr: ngrokHost ? false : {
        protocol: 'ws',
        host: 'localhost',
        port: 3000,
      },
      // Proxy to XAMPP Apache (mod_php, mpm_winnt) rather than `php artisan
      // serve`. The PHP built-in server is single-threaded on Windows — it
      // measured 0.87 req/s, while this app's own rider polling (offers 4s,
      // GPS 3s, map queries 10s) demands ~1 req/s, so the queue grew without
      // bound and every request eventually blew the 30s client timeout as
      // "Unable to change availability right now."
      //
      // PHP_CLI_SERVER_WORKERS does NOT help here: PHP receives the variable
      // but ignores it on Windows (worker forking needs fork()), verified with
      // a 12-way burst: 12,585ms/1 PID with it set vs 12,589ms without.
      //
      // Apache ran the same 12-way burst in 2,639ms (apache2handler) — ~4.8x
      // the capacity, with no frontend-facing URL change.
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/sanctum': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/storage': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
