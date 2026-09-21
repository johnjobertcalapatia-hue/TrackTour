import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const ngrokHost = env.VITE_NGROK_HOST || ''

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
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/sanctum': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/storage': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
  }
})
