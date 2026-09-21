import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, put } from '@/shared/services/api';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState, useEffect } from 'react';
import { usePersistFormRHF } from '@/shared/hooks/use-persist-form-rhf';
import { DashboardSkeleton } from '@/shared/components/Skeleton';
import { ArrowLeft, Save, CheckCircle, XCircle } from 'lucide-react';

const profileSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  address: z.string().optional(),
});

type ProfileForm = z.infer<typeof profileSchema>;

interface ProfileData {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
}

const inputClass =
  'w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition';

export default function BusinessOwnerProfileEdit() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const { data: profile, isLoading } = useQuery<ProfileData>({
    queryKey: ['business-owner-profile'],
    queryFn: () => get('/business-owner/profile'),
  });

  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {},
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = form;

  const { clearDraft } = usePersistFormRHF({
    draftKey: 'bo-profile-edit',
    formId: 'bo-profile-edit',
    form,
  });

  useEffect(() => {
    if (profile) {
      reset({
        first_name: profile.first_name,
        last_name: profile.last_name,
        email: profile.email,
        phone: profile.phone ?? '',
        address: profile.address ?? '',
      });
    }
  }, [profile]);

  const mutation = useMutation({
    mutationFn: (data: ProfileForm) => put('/business-owner/profile', data),
    onSuccess: () => {
      clearDraft();
      queryClient.invalidateQueries({ queryKey: ['business-owner-profile'] });
      setFeedback({ type: 'success', message: 'Profile updated successfully.' });
      setTimeout(() => navigate('/business-owner/profile'), 1500);
    },
    onError: (err: any) => {
      setFeedback({
        type: 'error',
        message: err?.response?.data?.message ?? 'Failed to update profile. Please try again.',
      });
    },
  });

  const onSubmit = (data: ProfileForm) => {
    setFeedback(null);
    mutation.mutate(data);
  };

  if (isLoading) return <DashboardSkeleton />;

  return (
    <div className="min-h-full bg-[#F6F8F4]">
      <div className="max-w-2xl mx-auto py-4 sm:py-6">
        <Link
          to="/business-owner/profile"
          className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#16803C] mb-6 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Profile
        </Link>

        <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32] mb-2">Edit Profile</h1>
        <p className="text-sm text-[#647067] mb-6">Update your personal information and account details</p>

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
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-medium text-[#647067] uppercase tracking-wider mb-2">First Name</label>
                <input
                  {...register('first_name')}
                  className={inputClass}
                  placeholder="First name"
                />
                {errors.first_name && (
                  <p className="mt-1 text-xs text-[#B91C1C]">{errors.first_name.message}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-[#647067] uppercase tracking-wider mb-2">Last Name</label>
                <input
                  {...register('last_name')}
                  className={inputClass}
                  placeholder="Last name"
                />
                {errors.last_name && (
                  <p className="mt-1 text-xs text-[#B91C1C]">{errors.last_name.message}</p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#647067] uppercase tracking-wider mb-2">Email</label>
              <input
                {...register('email')}
                type="email"
                className={inputClass}
                placeholder="Email address"
              />
              {errors.email && (
                <p className="mt-1 text-xs text-[#B91C1C]">{errors.email.message}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-[#647067] uppercase tracking-wider mb-2">Phone</label>
              <input
                {...register('phone')}
                className={inputClass}
                placeholder="Phone number"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#647067] uppercase tracking-wider mb-2">Address</label>
              <textarea
                {...register('address')}
                rows={3}
                className={`${inputClass} resize-none`}
                placeholder="Address"
              />
            </div>

            <div className="flex items-center gap-4 pt-2">
              <button
                type="submit"
                disabled={mutation.isPending}
                className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-5 py-2.5 rounded-[10px] text-sm font-semibold shadow-[0_6px_14px_rgba(22,101,52,0.2)] transition disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {mutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
              <Link
                to="/business-owner/profile"
                className="text-sm text-[#647067] hover:text-[#16803C] transition"
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
