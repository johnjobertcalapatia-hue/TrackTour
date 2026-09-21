import { Link } from 'react-router-dom'
import { ShieldX } from 'lucide-react'

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen glass-bg glass-bg-orbs flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 rounded-full bg-red-50 backdrop-blur-sm border border-red-200 flex items-center justify-center mx-auto mb-6">
          <ShieldX className="w-10 h-10 text-red-600" />
        </div>
        <h1 className="text-3xl font-bold text-ink mb-3">Access Denied</h1>
        <p className="text-ink-soft mb-8">
          You don&apos;t have permission to access this page. Please contact your administrator if you believe this is an error.
        </p>
        <Link
          to="/"
          className="btn-primary inline-block px-6 py-3 font-medium"
        >
          Return Home
        </Link>
      </div>
    </div>
  )
}
