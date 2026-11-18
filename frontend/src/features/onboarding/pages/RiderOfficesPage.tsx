import { useQuery } from '@tanstack/react-query'
import { CalendarClock, Clock, Landmark, Mail, MapPin, Phone, Sparkles } from 'lucide-react'
import { get } from '@/shared/services/api'
import LandingShell from '@/pages/components/LandingShell'
import { LandingSpinner } from '@/pages/components/LandingItemCard'
import { manilaDate, type RegistrationOffice } from '@/features/onboarding/types'

/** Public list of Tourism Offices that register and onboard riders. */
export default function RiderOfficesPage() {
  const { data: offices = [], isLoading } = useQuery({
    queryKey: ['rider-registration-offices'],
    queryFn: () => get<RegistrationOffice[]>('/rider-registration/offices'),
  })

  return (
    <LandingShell
      active="home"
      eyebrow="Training locations"
      title="Tourism Office Training Locations"
      subtitle="Register online first. After your requirements are verified, your interview and training happen at your municipality's Tourism Office — bring the original documents you uploaded."
      back={{ to: '/become-a-rider', label: 'Back' }}
    >
      {isLoading ? (
        <LandingSpinner />
      ) : (
        <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {offices.map((office) => (
            <li key={office.municipality_id} className="flex flex-col rounded-3xl bg-white p-6 shadow-[0_12px_28px_rgba(6,40,20,0.08)] ring-1 ring-[#E7E2D6]">
              <div className="flex items-start gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#0B5D2E] text-[#FFD000]">
                  <Landmark className="h-6 w-6" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="font-bold leading-snug text-[#14351F]">{office.name}</h2>
                  <p className="text-sm text-[#5B6A60]">{office.municipality}</p>
                </div>
                {office.is_home && (
                  <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-[#FFD000] px-2.5 py-1 text-[11px] font-bold text-[#14351F]">
                    <Sparkles className="h-3 w-3" aria-hidden="true" /> Main office
                  </span>
                )}
              </div>
              <dl className="mb-5 mt-4 space-y-2 text-sm text-[#3F4B43]">
                <div className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#2E8B57]" aria-hidden="true" /><dd>{office.address}</dd></div>
                <div className="flex gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-[#2E8B57]" aria-hidden="true" /><dd>{office.hours}</dd></div>
                {office.phone && <div className="flex gap-2"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-[#2E8B57]" aria-hidden="true" /><dd>{office.phone}</dd></div>}
                {office.email && <div className="flex gap-2"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#2E8B57]" aria-hidden="true" /><dd className="break-all">{office.email}</dd></div>}
              </dl>
              <p className={`mt-auto flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-semibold ${office.open_seats ? 'bg-[#E6F2EB] text-[#0B5D2E]' : 'bg-[#F4F6F4] text-[#5B6A60]'}`}>
                <CalendarClock className="h-4 w-4" aria-hidden="true" />
                {office.open_seats && office.next_session_at
                  ? `${office.open_seats} open onboarding seats · next ${manilaDate(office.next_session_at, { month: 'short', day: 'numeric' })}`
                  : 'No onboarding sessions posted yet'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </LandingShell>
  )
}
