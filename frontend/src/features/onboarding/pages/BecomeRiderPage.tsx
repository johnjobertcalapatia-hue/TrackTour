import { Link } from 'react-router-dom'
import { ArrowRight, Bike, CalendarCheck, ClipboardList, GraduationCap, MapPin, ShieldCheck, Sparkles } from 'lucide-react'
import LandingShell from '@/pages/components/LandingShell'

/** Two phases: (1) account + requirements online, verified by the Tourism Office; (2) interview and training, then approval. */
const STEPS = [
  { icon: ClipboardList, phase: 'Phase 1', title: 'Create your account & submit requirements', text: 'Register online, then add your vehicle and upload your license and OR/CR.' },
  { icon: CalendarCheck, phase: 'Phase 1', title: 'Requirements verified', text: 'Your Tourism Office verifies them, then schedules your interview and training automatically.' },
  { icon: GraduationCap, phase: 'Phase 2', title: 'Interview & training', text: 'Attend at your Tourism Office with your original documents and complete the rider training.' },
  { icon: ShieldCheck, phase: 'Phase 2', title: 'Approved & eligible', text: 'Pass the assessment, get approved for your services and start earning.' },
]

/** Rider registration entry: registration is online; interview and training happen at the Tourism Office. */
export default function BecomeRiderPage() {
  return (
    <LandingShell
      active="home"
      eyebrow="Rider program"
      title="Become a TrackTour Rider"
      subtitle="Earn with TrackTour. Be part of your community."
      back={{ to: '/', label: 'Back to home' }}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="relative overflow-hidden rounded-3xl bg-white p-7 shadow-[0_18px_44px_rgba(6,40,20,0.12)] ring-2 ring-[#2E8B57]" aria-labelledby="online-heading">
          <span className="absolute right-5 top-5 inline-flex items-center gap-1 rounded-full bg-[#FFD000] px-3 py-1 text-xs font-bold text-[#14351F]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Recommended
          </span>
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0B5D2E] text-[#FFD000]">
            <Bike className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 id="online-heading" className="mt-5 text-2xl font-bold text-[#0B5D2E]">Register Online</h2>
          <p className="mt-2 text-[#4B5A50]">Create your account and submit your requirements. Once the Tourism Office verifies them, your interview and training are scheduled for you.</p>
          <Link
            to="/register/rider"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#0B5D2E] px-6 py-3.5 text-sm font-bold text-white shadow-[0_10px_24px_rgba(11,93,46,0.3)] hover:bg-[#094A25]"
          >
            Get Started <ArrowRight className="h-4 w-4" />
          </Link>
        </section>

        <section className="rounded-3xl bg-white p-7 shadow-[0_12px_28px_rgba(6,40,20,0.08)] ring-1 ring-[#E7E2D6]" aria-labelledby="training-heading">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FFF6CC] text-[#B8860B]">
            <MapPin className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 id="training-heading" className="mt-5 text-2xl font-bold text-[#0B5D2E]">Training Locations</h2>
          <p className="mt-2 text-[#4B5A50]">Your interview and training take place at your municipality's Tourism Office after your requirements are verified.</p>
          <Link
            to="/become-a-rider/offices"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#FFD000] px-6 py-3.5 text-sm font-bold text-[#14351F] hover:bg-[#FFDD33]"
          >
            See training locations <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>

      <section className="mt-14" aria-labelledby="how-heading">
        <p className="flex items-center gap-3 text-sm font-bold uppercase tracking-wide text-[#E0A800]">
          <span className="h-1.5 w-7 rounded-full bg-[#FFD000]" aria-hidden="true" /> How it works
        </p>
        <h2 id="how-heading" className="mt-2 text-3xl font-bold text-[#0B5D2E]">From application to your first trip</h2>
        <ol className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-3xl bg-white p-5 ring-1 ring-[#E7E2D6]">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E6F2EB] text-[#0B5D2E]">
                  <step.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-xs font-bold uppercase tracking-wide text-[#9AA5A0]">{step.phase} · Step {i + 1}</span>
              </div>
              <h3 className="mt-3 font-bold text-[#14351F]">{step.title}</h3>
              <p className="mt-1 text-sm text-[#5B6A60]">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </LandingShell>
  )
}
