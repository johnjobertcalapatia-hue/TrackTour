import { useMutation } from '@tanstack/react-query';
import { put } from '@/shared/services/api';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { ArrowLeft, Save, CheckCircle, XCircle, Lock } from 'lucide-react';

const passwordSchema = z
  .object({
    current_password: z.string().min(1, 'Current password is required'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    password_confirmation: z.string().min(1, 'Password confirmation is required'),
  })
  .refine((data) => data.password === data.password_confirmation, {
    message: 'Passwords do not match',
    path: ['password_confirmation'],
  });

type PasswordForm = z.infer<typeof passwordSchema>;

export default function BusinessOwnerAccountSettings() {
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
  });

  const mutation = useMutation({
    mutationFn: (data: PasswordForm) => put('/business-owner/account-settings', data),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Password changed successfully.' });
      reset();
      setTimeout(() => setFeedback(null), 4000);
    },
    onError: (err: any) => {
      setFeedback({
        type: 'error',
        message: err?.response?.data?.message ?? 'Failed to change password. Please try again.',
      });
    },
  });

  const onSubmit = (data: PasswordForm) => {
    setFeedback(null);
    mutation.mutate(data);
  };

  return (
    <div className="min-h-full bg-[#F6F8F4]">
      <div className="max-w-2xl mx-auto">
        <Link
          to="/business-owner/dashboard"
          className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>

        <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32] mb-6">Account Settings</h1>

        {feedback && (
          <div
            className={`mb-6 p-4 rounded-xl border flex items-center gap-3 text-sm ${
              feedback.type === 'success'
                ? 'bg-[#EAF6ED] border-[#BFE3CB] text-[#16803C]'
                : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle className="w-5 h-5 flex-shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 flex-shrink-0" />
            )}
            {feedback.message}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-[#EAF6ED] border border-[#D7E8DB] flex items-center justify-center">
              <Lock className="w-5 h-5 text-[#16803C]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#17201A]">Change Password</h2>
              <p className="text-xs text-[#647067]">Update your password to keep your account secure</p>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <label className="block text-xs text-[#647067] uppercase tracking-wider mb-2">Current Password</label>
              <input
                {...register('current_password')}
                type="password"
                className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]"
                placeholder="Enter current password"
              />
              {errors.current_password && (
                <p className="mt-1 text-xs text-[#B91C1C]">{errors.current_password.message}</p>
              )}
            </div>

            <div>
              <label className="block text-xs text-[#647067] uppercase tracking-wider mb-2">New Password</label>
              <input
                {...register('password')}
                type="password"
                className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]"
                placeholder="Enter new password"
              />
              {errors.password && (
                <p className="mt-1 text-xs text-[#B91C1C]">{errors.password.message}</p>
              )}
            </div>

            <div>
              <label className="block text-xs text-[#647067] uppercase tracking-wider mb-2">Confirm New Password</label>
              <input
                {...register('password_confirmation')}
                type="password"
                className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]"
                placeholder="Confirm new password"
              />
              {errors.password_confirmation && (
                <p className="mt-1 text-xs text-[#B91C1C]">{errors.password_confirmation.message}</p>
              )}
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={mutation.isPending}
                className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {mutation.isPending ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
