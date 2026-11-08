import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { post } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { ApplicationLogo } from '@/shared/components/ApplicationLogo'
import { Alert } from '@/shared/components/Alert'
import { getRoleDashboardPath } from '@/shared/utils'

interface VerificationResponse {
  retry_after?: number
}

export default function VerifyEmailPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const { user, logout, fetchUser } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const didRequestCode = useRef(false)

  const sendCode = useCallback(async () => {
    setError('')
    setSuccess('')
    setSending(true)
    try {
      const response = await post<VerificationResponse>('/email/verification-notification')
      setSuccess(response.retry_after
        ? 'A code was recently sent. Check your inbox or spam folder.'
        : 'A six-digit verification code has been sent to your email.')
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } }
      setError(axiosErr.response?.data?.message || 'Failed to send the verification code. Please try again.')
    } finally {
      setSending(false)
    }
  }, [])

  useEffect(() => {
    if (!didRequestCode.current && user?.email_verified_at == null) {
      didRequestCode.current = true
      void sendCode()
    }
  }, [sendCode, user?.email_verified_at])

  const handleVerify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    setVerifying(true)

    try {
      await post('/email/verification-otp', { otp_code: code })
      await fetchUser()

      const state = location.state as { returnTo?: string } | null
      const requestedPath = state?.returnTo
      const fallbackPath = user?.role === 'business_owner'
        ? '/business-owner/account-status'
        : getRoleDashboardPath(user?.role || '')
      const destination = requestedPath?.startsWith('/') && !requestedPath.startsWith('//')
        ? requestedPath
        : fallbackPath

      navigate(destination, { replace: true, state: { emailVerified: true } })
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } }
      setError(axiosErr.response?.data?.message || 'The verification code could not be validated.')
    } finally {
      setVerifying(false)
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
          Enter the six-digit code sent to <strong>{user?.email || 'your email address'}</strong>.
          The code expires after 10 minutes.
        </p>

        {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}
        {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

        <form className="space-y-4" onSubmit={handleVerify}>
          <label htmlFor="email-verification-code" className="block text-sm font-medium text-ink">
            Verification code
          </label>
          <input
            id="email-verification-code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-full rounded-xl border border-white/50 bg-white/70 px-4 py-3 text-center text-xl tracking-[0.5em] text-ink"
            aria-label="Six-digit email verification code"
          />
          <button
            type="submit"
            disabled={verifying || code.length !== 6}
            className="btn-primary w-full py-3 px-4 font-medium disabled:opacity-50"
          >
            {verifying ? 'Verifying...' : 'Verify Email'}
          </button>
        </form>

        <div className="mt-4 space-y-3">
          <button
            type="button"
            onClick={() => void sendCode()}
            disabled={sending}
            className="w-full py-3 px-4 font-medium text-primary hover:text-primary-dark disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Resend Code'}
          </button>
          <button
            type="button"
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
