import { useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { post } from '@/shared/services/api'
import { ApplicationLogo } from '@/shared/components/ApplicationLogo'
import { Alert } from '@/shared/components/Alert'

const resetPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  password_confirmation: z.string(),
}).refine((d) => d.password === d.password_confirmation, {
  message: 'Passwords do not match',
  path: ['password_confirmation'],
})

type ResetPasswordForm = z.infer<typeof resetPasswordSchema>

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  const emailFromUrl = searchParams.get('email') || ''
  const token = searchParams.get('token') || ''

  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      email: emailFromUrl,
      password: '',
      password_confirmation: '',
    },
  })

  const onSubmit = async (data: ResetPasswordForm) => {
    setError('')
    try {
      await post('/reset-password', {
        token,
        email: data.email,
        password: data.password,
        password_confirmation: data.password_confirmation,
      })
      navigate('/login', { state: { message: 'Password has been reset successfully.' } })
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } }
      if (axiosErr.response?.data?.errors) {
        const firstError = Object.values(axiosErr.response.data.errors)[0]
        setError(firstError?.[0] || 'Password reset failed')
      } else {
        setError(axiosErr.response?.data?.message || 'Password reset failed. Please try again.')
      }
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen glass-bg glass-bg-orbs flex flex-col items-center justify-center px-6 py-12">
        <div className="mb-6">
          <Link to="/">
            <ApplicationLogo className="w-30 h-30" />
          </Link>
        </div>

        <div className="w-full max-w-md px-6 py-5 glass-card rounded-2xl">
          <Alert type="error" message="Invalid or missing reset token. Please request a new password reset link." />
          <p className="mt-4 text-center text-sm text-ink-soft">
            <Link to="/forgot-password" className="font-medium text-primary hover:text-primary-dark">
              Request a new link
            </Link>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen glass-bg glass-bg-orbs flex flex-col items-center justify-center px-6 py-12">
      <div className="mb-6">
        <Link to="/">
          <ApplicationLogo className="w-30 h-30" />
        </Link>
      </div>

      <div className="w-full max-w-md px-6 py-5 glass-card rounded-2xl">
        <h1 className="text-2xl font-bold text-center text-ink mb-2">Reset Password</h1>
        <p className="text-center text-sm text-ink-soft mb-6">
          Enter your new password below.
        </p>

        {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Email</label>
            <input
              type="email"
              {...register('email')}
              className="glass-input w-full px-4 py-3"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">New Password</label>
            <input
              type="password"
              {...register('password')}
              className="glass-input w-full px-4 py-3"
              placeholder="Min 8 characters"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Confirm Password</label>
            <input
              type="password"
              {...register('password_confirmation')}
              className="glass-input w-full px-4 py-3"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary w-full py-3 px-4 font-medium disabled:opacity-50"
          >
            {isSubmitting ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>

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
