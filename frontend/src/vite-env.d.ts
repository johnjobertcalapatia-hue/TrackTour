/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PAYMONGO_PUBLIC_KEY: string
  readonly VITE_APP_NAME?: string
  readonly VITE_SOCKET_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
