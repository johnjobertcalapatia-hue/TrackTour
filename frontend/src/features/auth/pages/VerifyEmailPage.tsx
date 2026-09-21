import { useState } from 'react'
import { Link } from 'react-router-dom'
import { post } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { ApplicationLogo } from '@/shared/components/ApplicationLogo'
import { Alert } from '@/shared/components/Alert'

export default function VerifyEmailPage() {
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [resending, setResending] = useState(false)
  const { logout } = useAuthStore()

  const handleResend = async () => {
    setError('')
    setSuccess('')
    setResending(true)
    try {
      await post('/email/verification-notification')
      setSuccess('A new verification link has been sent to your email address.')
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } }
      setError(axiosErr.response?.data?.message || 'Failed to send verification email. Please try again.')
    } finally {
      setResending(false)
    }
  }

  const handleLogout = async () => {
    await logout()
  }

  return (
    <div className="min-h-screen glass-bg glass-bg-orbs flex flex-col items-center justify-center px-6 py-12">
      <div className="mb-6">
        <Link to="/">
          <ApplicationLogo className="w-30 h-30" />
        </Link>
      </div>

      <div className="w-full max-w-md px-6 py-5 glass-card rounded-2xl">
        <h1 className="text-2xl font-bold text-center text-ink mb-2">Verify Your Email</h1>
        <p className="text-center text-sm text-ink-soft mb-6">
          We&apos;ve sent a verification link to your email address. Please check your inbox and click the link to verify your account.
        </p>

        {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}
        {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

        <div className="space-y-3">
          <button
            onClick={handleResend}
            disabled={resending}
            className="btn-primary w-full py-3 px-4 font-medium disabled:opacity-50"
          >
            {resending ? 'Sending...' : 'Resend Verification Email'}
          </button>
          <button
            onClick={handleLogout}
            className="w-full py-3 px-4 bg-white/60 hover:bg-white/90 text-ink font-medium rounded-xl border border-white/40 transition-all"
          >
            Sign Out
          </button>
        </div>

        <p className="mt-6 text-center text-sm text-ink-soft">
          <Link to="/login" className="font-medium text-primary hover:text-primary-dark">
            Back to Sign In
          </Link>
        </p>
      </div>

      <p className="mt-6 text-xs text-ink-soft/70">
        &copy; {new Date().getFullYear()} Bansud Tourism. All rights reserved.
      </p>
    </div>
  )
}
