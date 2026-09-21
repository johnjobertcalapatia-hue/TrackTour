import type { ReactNode } from 'react'

export default function GuestLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-gray-100 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-md p-6">{children}</div>
    </div>
  )
}
