import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { post } from '@/shared/services/api'
import { ApplicationLogo } from '@/shared/components/ApplicationLogo'
import { Alert } from '@/shared/components/Alert'

const confirmPasswordSchema = z.object({
  password: z.string().min(1, 'Password is required'),
})

type ConfirmPasswordForm = z.infer<typeof confirmPasswordSchema>

export default function ConfirmPasswordPage() {
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ConfirmPasswordForm>({
    resolver: zodResolver(confirmPasswordSchema),
  })

  const onSubmit = async (data: ConfirmPasswordForm) => {
    setError('')
    try {
      await post('/password/confirm', data)
      navigate(-1)
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } }
      if (axiosErr.response?.data?.errors) {
        const firstError = Object.values(axiosErr.response.data.errors)[0]
        setError(firstError?.[0] || 'Password confirmation failed')
      } else {
        setError(axiosErr.response?.data?.message || 'Password confirmation failed. Please try again.')
      }
    }
  }

  return (
    <div className="min-h-screen glass-bg glass-bg-orbs flex flex-col items-center justify-center px-6 py-12">
      <div className="mb-6">
        <Link to="/">
          <ApplicationLogo className="w-30 h-30" />
        </Link>
      </div>

      <div className="w-full max-w-md px-6 py-5 glass-card rounded-2xl">
        <h1 className="text-2xl font-bold text-center text-ink mb-2">Confirm Password</h1>
        <p className="text-center text-sm text-ink-soft mb-6">
          Please confirm your password to continue.
        </p>

        {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Password</label>
            <input
              type="password"
              {...register('password')}
              className="glass-input w-full px-4 py-3"
              placeholder="••••••••"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary w-full py-3 px-4 font-medium disabled:opacity-50"
          >
            {isSubmitting ? 'Confirming...' : 'Confirm Password'}
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
