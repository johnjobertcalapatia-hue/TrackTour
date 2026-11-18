import { MapPin } from 'lucide-react'
import { RiderOnboardingOffice } from '@/features/onboarding/components/RiderOnboardingOffice'

/**
 * Rider onboarding is strictly per municipality: a rider trains with, and is
 * seen only by, the Tourism Office of the municipality they registered in.
 * Every office (municipal or Bansud) works on its own municipality only.
 */
export function MunicipalRiderOnboardingPage() {
  return <RiderOnboardingOffice />
}

/** Bansud Tourism Office: onboarding for Bansud riders only. */
export function AdminRiderOnboardingPage() {
  return (
    <RiderOnboardingOffice
      headerSlot={
        <span className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[#14351F] ring-1 ring-[#E2E8E3]">
          <MapPin className="h-4 w-4 text-[#16803C]" aria-hidden="true" /> Bansud riders only
        </span>
      }
    />
  )
}
