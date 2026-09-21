import { useQuery } from '@tanstack/react-query';
import { get } from '@/shared/services/api';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { DashboardSkeleton } from '@/shared/components/Skeleton';
import { User, Mail, Phone, MapPin, Shield, Camera } from 'lucide-react';
import { toAssetUrl } from '@/shared/utils';

interface BusinessOwnerProfile {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
  profile_photo: string | null;
  account_status: string;
  created_at: string;
}

export default function BusinessOwnerProfile() {
  const user = useAuthStore((s) => s.user);

  const { data: profile, isLoading, error } = useQuery<BusinessOwnerProfile>({
    queryKey: ['business-owner-profile'],
    queryFn: () => get('/business-owner/profile'),
  });

  if (isLoading) return <DashboardSkeleton />;

  if (error) {
    return (
      <div className="min-h-full bg-[#F6F8F4] flex items-center justify-center p-4">
        <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-8 text-center max-w-md w-full">
          <p className="text-[#B91C1C] text-sm">Failed to load profile. Please try again.</p>
        </div>
      </div>
    );
  }

  const profileData = (profile ?? user) as BusinessOwnerProfile | undefined;

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    approved: { label: 'Approved', color: 'text-[#16803C]', bg: 'bg-[#EAF6ED] border-[#BFE3CB]' },
    pending_review: { label: 'Pending Review', color: 'text-[#A66F00]', bg: 'bg-[#FFF7D6] border-[#F4B400]/40' },
    rejected: { label: 'Rejected', color: 'text-[#B91C1C]', bg: 'bg-[#FEF2F2] border-[#FECACA]' },
    suspended: { label: 'Suspended', color: 'text-[#647067]', bg: 'bg-[#F3F4F6] border-[#E5E7EB]' },
  };

  const status = profileData?.account_status ?? 'pending_review';
  const config = (statusConfig[status] ?? statusConfig.pending_review)!;

  return (
    <div className="min-h-full bg-[#F6F8F4]">
      <div className="max-w-3xl mx-auto py-4 sm:py-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">My Profile</h1>
        <p className="mt-1 text-sm text-[#647067]">Manage your personal information and account details</p>

        <div className="mt-6 bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-center gap-6 px-6 sm:px-8 pt-8 pb-6">
            <div className="relative shrink-0">
              {profileData?.profile_photo ? (
                <img
                  src={toAssetUrl(profileData.profile_photo)}
                  alt="Profile"
                  className="w-24 h-24 rounded-full object-cover border-2 border-[#D7E8DB]"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-[#EAF6ED] border-2 border-[#D7E8DB] flex items-center justify-center">
                  <Camera className="w-8 h-8 text-[#16803C]" />
                </div>
              )}
            </div>
            <div className="text-center sm:text-left flex-1">
              <h2 className="text-xl font-bold text-[#17201A]">
                {profileData?.first_name} {profileData?.last_name}
              </h2>
              <p className="text-sm text-[#647067] mt-1">Business Owner</p>
              <div className={`inline-flex items-center gap-2 mt-3 px-3 py-1 rounded-full text-xs font-medium border ${config.bg} ${config.color}`}>
                <Shield className="w-3 h-3" />
                {config.label}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-[#E2E8E3]" />

          {/* Details */}
          <div className="divide-y divide-[#E2E8E3]">
            <div className="flex items-center gap-4 py-3.5 px-6 sm:px-8">
              <div className="w-10 h-10 rounded-xl bg-[#EAF6ED] border border-[#D7E8DB] flex items-center justify-center flex-shrink-0">
                <User className="w-5 h-5 text-[#16803C]" />
              </div>
              <span className="w-28 shrink-0 text-xs font-medium text-[#647067] uppercase tracking-wider">Full Name</span>
              <span className="flex-1 text-sm font-medium text-[#17201A] text-right sm:text-left break-words">
                {profileData?.first_name} {profileData?.last_name}
              </span>
            </div>

            <div className="flex items-center gap-4 py-3.5 px-6 sm:px-8">
              <div className="w-10 h-10 rounded-xl bg-[#EAF6ED] border border-[#D7E8DB] flex items-center justify-center flex-shrink-0">
                <Mail className="w-5 h-5 text-[#16803C]" />
              </div>
              <span className="w-28 shrink-0 text-xs font-medium text-[#647067] uppercase tracking-wider">Email</span>
              <span className="flex-1 text-sm font-medium text-[#17201A] text-right sm:text-left break-words">{profileData?.email}</span>
            </div>

            <div className="flex items-center gap-4 py-3.5 px-6 sm:px-8">
              <div className="w-10 h-10 rounded-xl bg-[#EAF6ED] border border-[#D7E8DB] flex items-center justify-center flex-shrink-0">
                <Phone className="w-5 h-5 text-[#16803C]" />
              </div>
              <span className="w-28 shrink-0 text-xs font-medium text-[#647067] uppercase tracking-wider">Phone</span>
              <span className="flex-1 text-sm font-medium text-[#17201A] text-right sm:text-left break-words">{profileData?.phone || 'Not provided'}</span>
            </div>

            <div className="flex items-center gap-4 py-3.5 px-6 sm:px-8">
              <div className="w-10 h-10 rounded-xl bg-[#EAF6ED] border border-[#D7E8DB] flex items-center justify-center flex-shrink-0">
                <MapPin className="w-5 h-5 text-[#16803C]" />
              </div>
              <span className="w-28 shrink-0 text-xs font-medium text-[#647067] uppercase tracking-wider">Address</span>
              <span className="flex-1 text-sm font-medium text-[#17201A] text-right sm:text-left break-words">{profileData?.address || 'Not provided'}</span>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end px-6 sm:px-8 py-5 border-t border-[#E2E8E3] bg-[#FBFCFA]">
            <Link
              to="/business-owner/profile/edit"
              className="inline-block bg-[#16803C] hover:bg-[#126B32] text-white px-5 py-2.5 rounded-[10px] text-sm font-semibold shadow-[0_6px_14px_rgba(22,101,52,0.2)] transition"
            >
              Edit Profile
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
