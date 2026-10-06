import { useQuery } from '@tanstack/react-query';
import { get } from '@/shared/services/api';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { DashboardSkeleton } from '@/shared/components/Skeleton';
import {
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Clock,
  LogOut,
  Edit3,
  Mail,
  AlertTriangle,
} from 'lucide-react';

interface AccountStatusData {
  account_status: string;
  rejection_reason?: string;
  suspension_reason?: string;
  reviewed_at?: string;
}

export default function BusinessOwnerAccountStatus() {
  const navigate = useNavigate();
  const location = useLocation();
  const registeredJustNow = Boolean((location.state as { registered?: boolean } | null)?.registered);
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);

  const { data: statusData, isLoading } = useQuery<AccountStatusData>({
    queryKey: ['business-owner-status'],
    queryFn: () => get('/business-owner/account-status'),
  });

  if (isLoading) return <DashboardSkeleton />;

  const status = statusData?.account_status ?? user?.account_status ?? 'pending_review';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const statusDisplay: Record<
    string,
    {
      icon: typeof ShieldCheck;
      title: string;
      message: string;
      iconColor: string;
      borderColor: string;
      bgColor: string;
    }
  > = {
    approved: {
      icon: ShieldCheck,
      title: 'Account Approved',
      message:
        'Welcome! Your account has been approved. You have full access to all business owner features.',
      iconColor: 'text-[#16803C]',
      borderColor: 'border-[#BFE3CB]',
      bgColor: 'bg-[#EAF6ED]',
    },
    pending_review: {
      icon: Clock,
      title: 'Account Under Review',
      message:
        'Your account is currently being reviewed by our team. You will be notified once the review is complete. This usually takes 1-3 business days.',
      iconColor: 'text-[#A66F00]',
      borderColor: 'border-[#F4B400]/40',
      bgColor: 'bg-[#FFF7D6]',
    },
    rejected: {
      icon: ShieldX,
      title: 'Account Rejected',
      message: 'Your account application has been rejected. Please review the reason below and contact support if you believe this is an error.',
      iconColor: 'text-[#B91C1C]',
      borderColor: 'border-[#FECACA]',
      bgColor: 'bg-[#FEF2F2]',
    },
    suspended: {
      icon: ShieldAlert,
      title: 'Account Suspended',
      message: 'Your account has been suspended. Please contact support for more information.',
      iconColor: 'text-[#647067]',
      borderColor: 'border-[#E5E7EB]',
      bgColor: 'bg-[#F3F4F6]',
    },
  };

  const display = (statusDisplay[status] ?? statusDisplay.pending_review)!;
  const StatusIcon = display.icon;

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

        <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32] mb-6">Account Status</h1>

        {registeredJustNow && status === 'pending_review' && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
            <p className="text-sm font-semibold text-emerald-800 mb-1">Registration submitted</p>
            <p className="text-sm text-emerald-700">
              Your business owner account was created and is now waiting for approval. You will be
              notified once the tourism office finishes reviewing your application.
            </p>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 sm:p-8">
          <div className={`p-6 rounded-xl border ${display.bgColor} ${display.borderColor} mb-6`}>
            <div className="flex items-start gap-4">
              <div className={`mt-0.5 ${display.iconColor}`}>
                <StatusIcon className="w-10 h-10" />
              </div>
              <div className="flex-1">
                <h2 className={`text-lg font-bold ${display.iconColor} mb-2`}>{display.title}</h2>
                <p className="text-sm text-[#4B5563] leading-relaxed">{display.message}</p>
              </div>
            </div>
          </div>

          {status === 'rejected' && statusData?.rejection_reason && (
            <div className="mb-6 p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA]">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-[#B91C1C]" />
                <p className="text-xs text-[#B91C1C] uppercase tracking-wider font-semibold">Rejection Reason</p>
              </div>
              <p className="text-sm text-[#4B5563]">{statusData.rejection_reason}</p>
            </div>
          )}

          {status === 'suspended' && statusData?.suspension_reason && (
            <div className="mb-6 p-4 rounded-xl bg-[#F3F4F6] border border-[#E5E7EB]">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-[#647067]" />
                <p className="text-xs text-[#647067] uppercase tracking-wider font-semibold">Suspension Reason</p>
              </div>
              <p className="text-sm text-[#4B5563]">{statusData.suspension_reason}</p>
            </div>
          )}

          <div className="border-t border-[#E2E8E3] pt-6 space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#EAF6ED] border border-[#D7E8DB] flex items-center justify-center flex-shrink-0">
                <Mail className="w-5 h-5 text-[#16803C]" />
              </div>
              <div>
                <p className="text-xs text-[#647067] uppercase tracking-wider mb-1">Account Email</p>
                <p className="text-sm text-[#17201A]">{user?.email ?? '—'}</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#EAF6ED] border border-[#D7E8DB] flex items-center justify-center flex-shrink-0">
                <StatusIcon className={`w-5 h-5 ${display.iconColor}`} />
              </div>
              <div>
                <p className="text-xs text-[#647067] uppercase tracking-wider mb-1">Current Status</p>
                <p className="text-sm text-[#17201A] capitalize">{status.replace('_', ' ')}</p>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              to="/business-owner/profile/edit"
              className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition"
            >
              <Edit3 className="w-4 h-4" />
              Edit Profile
            </Link>

            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-2 bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] px-4 py-2.5 rounded-xl text-sm font-semibold transition"
            >
              <LogOut className="w-4 h-4" />
              Log Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
