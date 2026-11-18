import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import LandingNav from './LandingNav'
import LandingFooter from './LandingFooter'

const POPPINS = { fontFamily: "'Poppins', ui-sans-serif, system-ui, sans-serif" }

interface LandingShellProps {
  eyebrow?: string
  title?: ReactNode
  subtitle?: ReactNode
  back?: { to: string; label: string; onClick?: () => void }
  /** Optional photo behind the title band. */
  backdrop?: string | null
  /** Extra content inside the band, under the title (search, filters…). */
  bandExtra?: ReactNode
  active?: 'home' | 'explore'
  children: ReactNode
}

/**
 * Frame for the public landing sub-pages: the shared navigation on a forest
 * green title band, page content on warm white, and the green footer.
 */
export default function LandingShell({ eyebrow, title, subtitle, back, backdrop, bandExtra, active = 'explore', children }: LandingShellProps) {
  return (
    <div className="min-h-screen bg-[#FAFAF5] text-[#17201A]" style={POPPINS}>
      <header className="relative overflow-hidden bg-gradient-to-br from-[#062814] via-[#0B5D2E] to-[#1F7A45]">
        {backdrop && <img src={backdrop} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" aria-hidden="true" />}
        <div className="absolute inset-0 bg-gradient-to-b from-[#062814]/60 via-[#062814]/30 to-[#062814]/70" aria-hidden="true" />
        <svg className="absolute -right-24 -top-24 h-96 w-96 text-[#FFD000]/10" viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r="90" fill="none" stroke="currentColor" strokeWidth="18" />
        </svg>

        <LandingNav active={active} />

        <div className={`relative z-10 mx-auto max-w-[1400px] px-5 lg:px-8 ${title ? 'pb-16 pt-10' : 'pb-8 pt-6'}`}>
          {back && (
            <Link
              to={back.to}
              onClick={back.onClick}
              className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/25 backdrop-blur hover:bg-white/20"
            >
              <ArrowLeft className="h-4 w-4" /> {back.label}
            </Link>
          )}
          {eyebrow && (
            <p className="mt-6 flex items-center gap-3 text-sm font-bold uppercase tracking-wide text-[#FFD000]">
              <span className="h-1.5 w-7 rounded-full bg-[#FFD000]" aria-hidden="true" /> {eyebrow}
            </p>
          )}
          {title && <h1 className="mt-2 text-4xl font-extrabold leading-tight text-white drop-shadow sm:text-5xl">{title}</h1>}
          {subtitle && <p className="mt-3 max-w-2xl text-base text-white/90 sm:text-lg">{subtitle}</p>}
          {bandExtra && <div className="mt-6">{bandExtra}</div>}
        </div>
      </header>

      <main className="relative mx-auto max-w-[1400px] px-5 py-10 lg:px-8">{children}</main>

      <LandingFooter badge="Bansud, Oriental Mindoro" />
    </div>
  )
}
