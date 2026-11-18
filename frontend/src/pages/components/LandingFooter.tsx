import { Link } from 'react-router-dom'
import { MapPin } from 'lucide-react'

/** Dark-green landing footer with brand, quick links and the office contact. */
export default function LandingFooter({ badge }: { badge: string }) {
  return (
    <footer
      id="contact"
      className="relative mt-6 overflow-hidden bg-gradient-to-b from-[#0B5D2E] to-[#073D1E] text-white"
      style={{ fontFamily: "'Poppins', ui-sans-serif, system-ui, sans-serif" }}
    >
      <svg className="absolute inset-x-0 top-0 h-6 w-full text-[#FAFAF5]" viewBox="0 0 1440 24" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 0 H1440 V6 C 1100 26, 340 26, 0 6 Z" fill="currentColor" />
      </svg>
      <div className="relative mx-auto flex max-w-[1400px] flex-col gap-8 px-5 pb-8 pt-12 lg:flex-row lg:items-center lg:px-8">
        <Link to="/" className="flex items-center gap-2 shrink-0" aria-label="TrackTour home">
          <img src="/assets/logo/tracktour.png" alt="TrackTour Logo" className="h-14 w-14 rounded-2xl bg-white object-contain p-1" />
          <span className="leading-tight">
            <span className="block text-2xl font-extrabold tracking-tight">
              Track<span className="text-[#FFD000]">Tour</span>
            </span>
            <span className="block text-xs text-white/85">{badge}</span>
          </span>
        </Link>

        <nav aria-label="Footer" className="flex flex-wrap items-start gap-x-7 gap-y-2 text-sm font-medium lg:border-l lg:border-white/25 lg:pl-8">
          <a href="#about" className="hover:text-[#FFD000]">About</a>
          <Link to="/explore" className="hover:text-[#FFD000]">Explore</Link>
          <Link to="/explore/categories" className="hover:text-[#FFD000]">Categories</Link>
          {/* Join TrackTour: rider program, with business owner registration right below it. */}
          <span className="flex flex-col gap-1" role="group" aria-label="Join TrackTour">
            <Link to="/become-a-rider" className="hover:text-[#FFD000]">Become a Rider</Link>
            <Link to="/register?role=business_owner" className="hover:text-[#FFD000]">Become a Business Owner</Link>
          </span>
          <Link to="/login" className="hover:text-[#FFD000]">Login / Sign Up</Link>
        </nav>

        <div className="space-y-1 text-sm text-white/85 lg:border-l lg:border-white/25 lg:pl-8">
          <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-[#FFD000]" /> Bansud Tourism Office, Municipal Hall, Bansud, Oriental Mindoro</p>
          <p className="pl-6">TrackTour is made in Bansud for the municipalities of Oriental Mindoro.</p>
        </div>

        <p
          className="lg:ml-auto -rotate-3 text-3xl text-white"
          style={{ fontFamily: "'Kaushan Script', 'Brush Script MT', cursive" }}
        >
          Let&apos;s Explore Bansud Together!
        </p>
      </div>
      <p className="relative border-t border-white/15 py-4 text-center text-xs text-white/70">
        &copy; {new Date().getFullYear()} TrackTour — Bansud Tourism Office. All rights reserved.
      </p>
    </footer>
  )
}
